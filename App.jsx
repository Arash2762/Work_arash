import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Plus, X, ChevronLeft, Users, Truck, FileText, LayoutGrid,
  ArrowUpRight, ArrowDownRight, Camera, Trash2, Image as ImageIcon,
  Phone, Package, Loader2, AlertCircle, Wallet, TrendingUp, CreditCard, Copy, Check, LogOut, Printer, Download, Search, Pencil, RefreshCw
} from "lucide-react";
import { supabase } from "./supabaseClient";
import AuthGate from "./AuthGate";

/* ---------------------------------------------------------------
  TOKENS — "Obsidian Ledger" dark theme
  bg (obsidian): #0B0C10
  card (elevated surface): #15171E
  card2 (secondary elevated / hover / gradient end): #1C1F28
  ink (primary text, light): #F3EFE6
  muted: #938E80
  gold (brand / CTA): #C9A768 · bright: #EAD09A · deep: #8C6F35
  emerald (receivable / money coming in): #3FBF8F
  wine (payable / money going out): #C0605A
  hairline: rgba(255,255,255,.08)
  Fonts: Vazirmatn (UI/Persian), JetBrains Mono (amounts / ledger tape)
----------------------------------------------------------------*/

const T = {
  bg: "#0B0C10",
  card: "#15171E",
  card2: "#1C1F28",
  ink: "#F3EFE6",
  muted: "#938E80",
  muted2: "#5C594E",
  amber: "#C9A768",
  amberBright: "#EAD09A",
  amberDark: "#8C6F35",
  green: "#3FBF8F",
  greenBg: "rgba(63,191,143,0.12)",
  rust: "#C0605A",
  rustBg: "rgba(192,96,90,0.14)",
  plum: "#C79BD6",
  plumBg: "rgba(199,155,214,0.12)",
  hairline: "rgba(255,255,255,0.08)",
  hairline2: "rgba(255,255,255,0.14)",
  midnight: "#1C1F28",
  midnightSoft: "#20222C",
  cream: "#F3EFE6",
};

const uid = () => crypto.randomUUID();
// True deep copy — required because several handlers below mutate nested
// objects (e.g. customer.transactions.push-equivalent) in place. Without
// this, "next" and the previous state would secretly share the same nested
// objects, corrupting the before/after comparison used to decide what to save.
const deepClone = (obj) => JSON.parse(JSON.stringify(obj));

// Downloads everything (minus any transient in-flight receipt image data)
// as a single JSON file the person can keep somewhere safe.
function downloadBackup(data) {
  const clean = deepClone(data);
  ["customers", "suppliers"].forEach((k) => {
    (clean[k] || []).forEach((entity) => {
      (entity.transactions || []).forEach((t) => {
        delete t._receiptData;
      });
    });
  });
  (clean.people || []).forEach((p) => (p.transactions || []).forEach((t) => delete t._receiptData));
  (clean.expenses || []).forEach((e) => delete e._receiptData);

  const blob = new Blob([JSON.stringify(clean, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `backup-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function fmt(n) {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString("en-US");
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(d) {
  try {
    return new Date(d).toLocaleDateString("fa-IR", { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return d;
  }
}

// Always shows the time in Iran (Asia/Tehran) local time, regardless of
// what timezone the phone/browser itself is set to.
function fmtTime(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("fa-IR", { timeZone: "Asia/Tehran", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}
// Sort key combining date + real creation timestamp, newest first.
function sortKey(t) {
  return t.createdAt || t.date || "";
}

/* ---------------- Receipt duplicate detection ----------------
   Two layers, in order of confidence:
   1. Reference/tracking/document number read off the receipt via OCR — this
      is what actually identifies a bank transfer, so it catches a receipt
      re-used with the amount edited or re-photographed differently.
   2. Exact image byte fingerprint (SHA-256) — catches the simple case of
      literally re-attaching the same photo file. */
async function hashDataUrl(dataUrl) {
  try {
    const base64 = dataUrl.split(",")[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const digest = await crypto.subtle.digest("SHA-256", bytes.buffer);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

function normalizeDigits(str) {
  const persian = "۰۱۲۳۴۵۶۷۸۹";
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  return str
    .replace(/[۰-۹]/g, (d) => String(persian.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(arabic.indexOf(d)));
}

// Pulls a reference/tracking/document number and a destination card's last
// digits out of raw OCR text, using the common labels Iranian bank apps use.
// Persian and Arabic-Indic digit glyphs look almost identical (e.g. ۵ vs ٥),
// so everything is normalized to plain Latin digits before matching.
//
// Iranian bank-app receipts render each row as "value (left) ... label
// (right)" — since OCR reads left-to-right, the NUMBER usually comes out
// BEFORE the label in the recognized text, not after it. So every keyword
// is checked in both directions, and matching is done per-line first (more
// reliable) with a whole-text fallback.
const REF_KEYWORDS = [
  "شماره\\s*پیگیری", "کد\\s*پیگیری", "پیگیری",
  "شماره\\s*رهگیری", "کد\\s*رهگیری", "رهگیری",
  "شماره\\s*مرجع", "مرجع\\s*تراکنش", "مرجع",
  "شماره\\s*سند", "سند",
  "شماره\\s*تراکنش", "کد\\s*تراکنش",
  "شناسه\\s*تسویه", "شناسه\\s*پرداخت", "شناسه",
  "tracking", "reference", "ref\\.?", "transaction\\s*id",
];
const CARD_KEYWORDS = ["کارت\\s*مقصد", "به\\s*کارت", "شماره\\s*کارت\\s*مقصد", "شماره\\s*کارت", "حساب\\s*مقصد", "شماره\\s*حساب\\s*مقصد"];

function findNumberNearKeywords(lines, keywords, minDigits = 4) {
  for (const kw of keywords) {
    const after = new RegExp(kw + `[^0-9\\n]{0,20}(\\d{${minDigits},20})`, "i");
    const before = new RegExp(`(\\d{${minDigits},20})[^0-9\\n]{0,20}` + kw, "i");
    for (const line of lines) {
      const m1 = line.match(after);
      if (m1) return m1[1];
      const m2 = line.match(before);
      if (m2) return m2[1];
    }
  }
  return null;
}

function extractReceiptFields(rawText) {
  const text = normalizeDigits(rawText || "");
  const lines = text.split("\n").filter((l) => l.trim());

  let referenceNumber = findNumberNearKeywords(lines, REF_KEYWORDS);
  // Fallback: any line with a generic "شماره/کد/شناسه" label near a longish digit run.
  if (!referenceNumber) {
    referenceNumber = findNumberNearKeywords(lines, ["شماره", "کد", "شناسه"], 6);
  }

  let destCard = findNumberNearKeywords(lines, CARD_KEYWORDS);
  if (destCard) destCard = destCard.replace(/[^\d]/g, "").slice(-4);

  return { referenceNumber, destCard };
}

// Runs OCR (Persian + English) on a receipt image, entirely in the browser.
// Paths are pinned explicitly to jsdelivr — inside a bundler (Vite) tesseract.js
// can't reliably auto-locate its worker/core/language files, which silently
// produces empty results without this.
async function runOcr(dataUrl, lang) {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(lang, 1, {
    workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js",
    corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0/tesseract-core-simd.wasm.js",
    langPath: "https://tessdata.projectnaptha.com/4.0.0",
    logger: () => {},
  });
  const {
    data: { text },
  } = await worker.recognize(dataUrl);
  await worker.terminate();
  return text;
}

async function ocrReceipt(dataUrl, { mode = "fast", field = null } = {}) {
  try {
    const response = await fetch("/api/ocr-receipt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: dataUrl, mode, field }),
    });
    if (!response.ok) throw new Error(await response.text().catch(() => "OCR failed"));
    const result = await response.json();
    return {
      referenceNumber: result.documentNumber || result.trackingNumber || result.referenceNumber || null,
      destCard: result.destCardLast4 || null,
      documentNumber: result.documentNumber?.value ?? result.documentNumber ?? null,
      trackingNumber: result.trackingNumber?.value ?? result.trackingNumber ?? null,
      referenceId: result.referenceNumber?.value ?? result.referenceNumber ?? null,
      amount: result.amount || null,
      date: result.date || null,
      time: result.time || null,
      senderName: result.senderName || null,
      receiverName: result.receiverName || null,
      fields: result.fields || {},
      candidates: result.candidates || [],
      selectedCandidate: result.selected || null,
      rawText: result.rawText || null,
      confidence: result.confidence ?? null,
      source: "vision",
      mode: result.mode === "full_retry" ? "full" : (result.mode || mode),
    };
  } catch (err) {
    console.warn("Server OCR failed:", err?.message || err);
    return { source: "none", error: err?.message || String(err), mode };
  }
}

const RECEIPT_FIELD_DEFS = [
  ["amount", "مبلغ"],
  ["date", "تاریخ"],
  ["time", "ساعت"],
  ["documentNumber", "شماره سند"],
  ["trackingNumber", "شماره پیگیری"],
  ["referenceId", "شماره مرجع / رهگیری"],
  ["destCard", "۴ رقم آخر کارت مقصد"],
  ["senderName", "فرستنده"],
  ["receiverName", "گیرنده"],
];

function makeReceiptInfo(result, selected = null) {
  const values = {};
  for (const [key] of RECEIPT_FIELD_DEFS) {
    const raw = result?.[key] ?? result?.fields?.[key]?.value ?? null;
    if (raw != null && String(raw).trim() !== "") values[key] = String(raw).trim();
  }
  const isFast = result?.mode === "fast" || result?.mode === "retry";
  if (isFast && result?.selectedCandidate?.value) {
    const c = result.selectedCandidate;
    if (c.kind === "tracking") values.trackingNumber = String(c.value);
    else if (c.kind === "document") values.documentNumber = String(c.value);
    else values.referenceId = String(c.value);
  }
  const defaultSelected = selected || RECEIPT_FIELD_DEFS.reduce((acc, [key]) => {
    if (values[key]) acc[key] = true;
    return acc;
  }, {});
  if (isFast && !selected) {
    for (const [key] of RECEIPT_FIELD_DEFS) defaultSelected[key] = false;
    const c = result?.selectedCandidate;
    if (c?.kind === "tracking") defaultSelected.trackingNumber = true;
    else if (c?.kind === "document") defaultSelected.documentNumber = true;
    else if (c?.value) defaultSelected.referenceId = true;
  }
  return {
    values,
    selected: defaultSelected,
    confidence: result?.confidence ?? null,
    fields: result?.fields || {},
    rawText: result?.rawText || null,
    candidates: result?.candidates || [],
    mode: result?.mode || "fast",
    selectedCandidate: result?.selectedCandidate || null,
  };
}

function receiptInfoToText(info) {
  if (!info?.values) return "";
  return RECEIPT_FIELD_DEFS
    .filter(([key]) => info.selected?.[key] && info.values[key])
    .map(([key, label]) => `${label}: ${info.values[key]}`)
    .join("\n");
}

// Scans every receipt already in the ledger for a match — reference number
// first (most reliable), then falls back to the raw image fingerprint.
function textSimilarity(a, b) {
  const x = String(a || '').trim().toLowerCase();
  const y = String(b || '').trim().toLowerCase();
  if (!x || !y) return 0;
  if (x === y) return 1;
  const prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    for (let j = 0; j <= y.length; j++) prev[j] = cur[j];
  }
  return 1 - prev[y.length] / Math.max(x.length, y.length, 1);
}

function normalizeReceiptValue(v) {
  return normalizeDigits(String(v || '')).replace(/[^0-9]/g, '');
}

function receiptIdentity(tx) {
  const info = tx?.receiptInfo || {};
  const values = info.values || info;
  const ref = normalizeReceiptValue(tx?.receiptRef || values.trackingNumber || values.referenceId || values.documentNumber);
  const amount = Number(tx?.amount || values.amount || 0);
  const date = String(values.date || tx?.date || '').trim();
  const time = String(values.time || '').replace(/[^0-9:]/g, '');
  const sender = String(values.senderName || '').trim();
  const receiver = String(values.receiverName || '').trim();
  return { ref, amount, date, time, sender, receiver };
}

function timeToMinutes(v) {
  const m = String(v || '').match(/(\d{1,2})\D+(\d{1,2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function receiptSimilarity(a, b) {
  const A = receiptIdentity(a), B = receiptIdentity(b);
  let score = 0, weight = 0, comparable = 0;
  if (A.ref && B.ref) { score += (A.ref === B.ref ? 1 : textSimilarity(A.ref, B.ref)) * 0.42; weight += 0.42; comparable++; }
  if (A.amount && B.amount) { score += (A.amount === B.amount ? 1 : 0) * 0.24; weight += 0.24; comparable++; }
  if (A.date && B.date) { score += (A.date === B.date ? 1 : textSimilarity(A.date, B.date)) * 0.14; weight += 0.14; comparable++; }
  if (A.time && B.time) {
    const am = timeToMinutes(A.time), bm = timeToMinutes(B.time);
    const ts = am != null && bm != null ? (Math.abs(am - bm) <= 2 ? 1 : Math.max(0, 1 - Math.abs(am - bm) / 60)) : textSimilarity(A.time, B.time);
    score += ts * 0.08; weight += 0.08; comparable++;
  }
  if (A.sender && B.sender) { score += textSimilarity(A.sender, B.sender) * 0.06; weight += 0.06; comparable++; }
  if (A.receiver && B.receiver) { score += textSimilarity(A.receiver, B.receiver) * 0.06; weight += 0.06; comparable++; }
  return { score: weight ? score / weight : 0, comparable };
}

function findDuplicateReceipt(data, { hash, referenceNumber, receiptInfo, amount, date }, excludeTxId) {
  const all = [];
  (data.customers || []).forEach((c) => (c.transactions || []).forEach((t) => all.push({ ...t, name: c.name, context: t.type === 'debt' ? 'تحویل جنس' : 'دریافت وجه' })));
  (data.suppliers || []).forEach((s) => (s.transactions || []).forEach((t) => all.push({ ...t, name: s.name, context: t.type === 'purchase' ? 'خرید کالا' : 'پرداخت' })));
  (data.people || []).forEach((p) => (p.transactions || []).forEach((t) => all.push({ ...t, name: p.name, context: 'تراکنش شخص' })));
  (data.expenses || []).forEach((e) => all.push({ ...e, name: EXPENSE_CATEGORY_LABEL[e.category] || 'هزینه', context: 'هزینه' }));

  const ref = normalizeReceiptValue(referenceNumber);
  if (ref) {
    const byRef = all.find((t) => t.id !== excludeTxId && normalizeReceiptValue(t.receiptRef) === ref);
    if (byRef) return { name: byRef.name, context: byRef.context, date: byRef.date, via: 'شماره پیگیری', score: 1 };
  }
  if (hash) {
    const byHash = all.find((t) => t.id !== excludeTxId && t.receiptHash === hash);
    if (byHash) return { name: byHash.name, context: byHash.context, date: byHash.date, via: 'تصویر یکسان', score: 1 };
  }

  const probe = { receiptInfo, receiptRef: ref || null, amount, date };
  let best = null;
  for (const t of all) {
    if (t.id === excludeTxId) continue;
    const sim = receiptSimilarity(probe, t);
    if (!best || sim.score > best.score) best = { name: t.name, context: t.context, date: t.date, via: 'شباهت اطلاعات رسید', score: sim.score, comparable: sim.comparable };
  }
  return best && best.score >= 0.84 && best.comparable >= 3 ? best : null;
}

/* ---------------- Jalali (Shamsi) calendar helpers ----------------
   We lean on the browser/Node's built-in ICU Persian calendar (via Intl)
   for Gregorian->Jalali, then invert it with a small local search — this
   keeps us consistent with fmtDate() above without hand-rolling leap-year
   math ourselves. */
const persianFormatter = new Intl.DateTimeFormat("en-US-u-ca-persian", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  timeZone: "UTC",
});
const JALALI_MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];

function gregorianToJalali(date) {
  const parts = persianFormatter.formatToParts(date);
  const get = (t) => parseInt(parts.find((p) => p.type === t).value, 10);
  return { jy: get("year"), jm: get("month"), jd: get("day") };
}
function jalaliToGregorian(jy, jm, jd) {
  const approxGy = jy + 621;
  const monthLen = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 29];
  let dayOffset = 0;
  for (let i = 0; i < jm - 1; i++) dayOffset += monthLen[i];
  dayOffset += jd - 1;
  const guess = new Date(Date.UTC(approxGy, 2, 21));
  guess.setUTCDate(guess.getUTCDate() + dayOffset);
  for (let delta = -8; delta <= 8; delta++) {
    const d = new Date(guess);
    d.setUTCDate(d.getUTCDate() + delta);
    const cur = gregorianToJalali(d);
    if (cur.jy === jy && cur.jm === jm && cur.jd === jd) return d;
  }
  return guess;
}
function daysInJalaliMonth(jy, jm) {
  const g1 = jalaliToGregorian(jy, jm, 1);
  const nextJy = jm === 12 ? jy + 1 : jy;
  const nextJm = jm === 12 ? 1 : jm + 1;
  const g2 = jalaliToGregorian(nextJy, nextJm, 1);
  return Math.round((g2 - g1) / 86400000);
}
function isoToJalali(iso) {
  return gregorianToJalali(new Date(iso + "T00:00:00Z"));
}
function jalaliToISO(jy, jm, jd) {
  return jalaliToGregorian(jy, jm, jd).toISOString().slice(0, 10);
}

/* ---------------- storage helpers (Supabase-backed) ---------------- */

// Fetch everything from Supabase and assemble it into the same nested
// shape the rest of the app already expects (data.customers[].transactions[].items[], etc).
async function loadData() {
  try {
    const [
      { data: customers },
      { data: customerTx },
      { data: customerItems },
      { data: suppliers },
      { data: supplierTx },
      { data: supplierItems },
      { data: people },
      { data: personTx },
      { data: expenses },
      { data: reports },
      { data: cards },
      { data: stockAdjustments },
    ] = await Promise.all([
      supabase.from("customers").select("*"),
      supabase.from("customer_transactions").select("*"),
      supabase.from("customer_transaction_items").select("*"),
      supabase.from("suppliers").select("*"),
      supabase.from("supplier_transactions").select("*"),
      supabase.from("supplier_transaction_items").select("*"),
      supabase.from("people").select("*"),
      supabase.from("person_transactions").select("*"),
      supabase.from("expenses").select("*"),
      supabase.from("reports").select("*"),
      supabase.from("cards").select("*"),
      supabase.from("stock_adjustments").select("*"),
    ]);

    const itemsByTx = (rows) => {
      const map = {};
      (rows || []).forEach((it) => {
        (map[it.transaction_id] = map[it.transaction_id] || []).push({
          id: it.id,
          productName: it.product_name,
          quantity: Number(it.quantity),
          unitPrice: Number(it.unit_price),
        });
      });
      return map;
    };
    const custItemsByTx = itemsByTx(customerItems);
    const supItemsByTx = itemsByTx(supplierItems);

    const nestedCustomers = (customers || []).map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone || "",
      transactions: (customerTx || [])
        .filter((t) => t.customer_id === c.id)
        .map((t) => ({
          id: t.id,
          type: t.type,
          amount: Number(t.amount),
          date: t.date,
          createdAt: t.created_at,
          receiptHash: t.receipt_hash || null,
          receiptRef: t.receipt_ref || null,
          receiptDestCard: t.receipt_dest_card || null,
          receiptInfo: t.receipt_info || null,
          linkedInvoiceId: t.linked_invoice_id || null,
          description: t.description || "",
          hasReceipt: !!t.receipt_path,
          items: custItemsByTx[t.id] || undefined,
          cardId: t.card_id || null,
          directPaySupplierId: t.direct_pay_supplier_id || null,
          linkedSupplierTxId: t.linked_supplier_tx_id || null,
        })),
    }));

    const nestedSuppliers = (suppliers || []).map((s) => ({
      id: s.id,
      name: s.name,
      phone: s.phone || "",
      transactions: (supplierTx || [])
        .filter((t) => t.supplier_id === s.id)
        .map((t) => ({
          id: t.id,
          type: t.type,
          amount: Number(t.amount),
          date: t.date,
          createdAt: t.created_at,
          receiptHash: t.receipt_hash || null,
          receiptRef: t.receipt_ref || null,
          receiptDestCard: t.receipt_dest_card || null,
          receiptInfo: t.receipt_info || null,
          linkedPurchaseId: t.linked_purchase_id || null,
          description: t.description || "",
          hasReceipt: !!t.receipt_path,
          items: supItemsByTx[t.id] || undefined,
          cardId: t.card_id || null,
          directPayCustomerId: t.direct_pay_customer_id || null,
          linkedCustomerTxId: t.linked_customer_tx_id || null,
        })),
    }));

    const nestedPeople = (people || []).map((p) => ({
      id: p.id,
      name: p.name,
      transactions: (personTx || [])
        .filter((t) => t.person_id === p.id)
        .map((t) => ({
          id: t.id,
          type: t.type,
          amount: Number(t.amount),
          date: t.date,
          createdAt: t.created_at,
          receiptHash: t.receipt_hash || null,
          receiptRef: t.receipt_ref || null,
          receiptDestCard: t.receipt_dest_card || null,
          receiptInfo: t.receipt_info || null,
          description: t.description || "",
          hasReceipt: !!t.receipt_path,
        })),
    }));

    const nestedExpenses = (expenses || []).map((e) => ({
      id: e.id,
      category: e.category,
      amount: Number(e.amount),
      date: e.date,
      createdAt: e.created_at,
      receiptHash: e.receipt_hash || null,
      receiptRef: e.receipt_ref || null,
      receiptDestCard: e.receipt_dest_card || null,
      receiptInfo: e.receipt_info || null,
      description: e.description || "",
      hasReceipt: !!e.receipt_path,
      relatedSupplierId: e.related_supplier_id || null,
      relatedPurchaseId: e.related_purchase_id || null,
    }));

    const nestedReports = (reports || []).map((r) => ({ id: r.id, title: r.title, date: r.date, content: r.content }));

    const nestedCards = (cards || []).map((c) => ({
      id: c.id,
      bankName: c.bank_name,
      holderName: c.holder_name || "",
      cardNumber: c.card_number,
      iban: c.iban || "",
      note: c.note || "",
    }));

    const nestedStockAdjustments = (stockAdjustments || []).map((a) => ({
      id: a.id,
      productName: a.product_name,
      quantity: Number(a.quantity),
      unitCost: Number(a.unit_cost || 0),
      date: a.date,
      note: a.note || "",
    }));

    return {
      customers: nestedCustomers,
      suppliers: nestedSuppliers,
      people: nestedPeople,
      expenses: nestedExpenses,
      reports: nestedReports,
      cards: nestedCards,
      stockAdjustments: nestedStockAdjustments,
    };
  } catch {
    return null;
  }
}

// Replaces every row in `table` (optionally scoped to a parent id) with
// exactly the given rows — mirrors the "save the whole thing" model the
// rest of the app already uses, so no other code has to change.
async function syncTable(table, rows, parentColumn, parentId) {
  const ids = rows.map((r) => r.id);
  let del = supabase.from(table).delete();
  if (parentColumn) del = del.eq(parentColumn, parentId);
  del = ids.length ? del.not("id", "in", `(${ids.join(",")})`) : del.not("id", "is", null);
  const { error: delError } = await del;
  if (delError) throw new Error(`[${table}] delete failed: ${delError.message}`);
  if (rows.length) {
    const { error: upsertError } = await supabase.from(table).upsert(rows);
    if (upsertError) throw new Error(`[${table}] upsert failed: ${upsertError.message}`);
  }
}

async function saveData(data, prev) {
  try {
    const changed = (key) => !prev || JSON.stringify(prev[key]) !== JSON.stringify(data[key]);

    if (changed("customers")) {
      await syncTable(
        "customers",
        data.customers.map((c) => ({ id: c.id, name: c.name, phone: c.phone || null }))
      );
      const custTxRows = [];
      const custItemRows = [];
      data.customers.forEach((c) =>
        (c.transactions || []).forEach((t) => {
          custTxRows.push({
            id: t.id,
            customer_id: c.id,
            type: t.type,
            amount: t.amount,
            date: t.date,
            created_at: t.createdAt || undefined,
            receipt_hash: t.receiptHash || null,
            receipt_ref: t.receiptRef || null,
            receipt_dest_card: t.receiptDestCard || null,
            receipt_info: t.receiptInfo || null,
            linked_invoice_id: t.linkedInvoiceId || null,
            description: t.description || null,
            receipt_path: t.hasReceipt ? t.id : null,
            card_id: t.cardId || null,
            direct_pay_supplier_id: t.directPaySupplierId || null,
            linked_supplier_tx_id: t.linkedSupplierTxId || null,
          });
          (t.items || []).forEach((it) =>
            custItemRows.push({ id: it.id, transaction_id: t.id, product_name: it.productName, quantity: it.quantity, unit_price: it.unitPrice })
          );
        })
      );
      await syncTable("customer_transactions", custTxRows);
      await syncTable("customer_transaction_items", custItemRows);
    }

    if (changed("suppliers")) {
      await syncTable(
        "suppliers",
        data.suppliers.map((s) => ({ id: s.id, name: s.name, phone: s.phone || null }))
      );
      const supTxRows = [];
      const supItemRows = [];
      data.suppliers.forEach((s) =>
        (s.transactions || []).forEach((t) => {
          supTxRows.push({
            id: t.id,
            supplier_id: s.id,
            type: t.type,
            amount: t.amount,
            date: t.date,
            created_at: t.createdAt || undefined,
            receipt_hash: t.receiptHash || null,
            receipt_ref: t.receiptRef || null,
            receipt_dest_card: t.receiptDestCard || null,
            receipt_info: t.receiptInfo || null,
            linked_purchase_id: t.linkedPurchaseId || null,
            description: t.description || null,
            receipt_path: t.hasReceipt ? t.id : null,
            card_id: t.cardId || null,
            direct_pay_customer_id: t.directPayCustomerId || null,
            linked_customer_tx_id: t.linkedCustomerTxId || null,
          });
          (t.items || []).forEach((it) =>
            supItemRows.push({ id: it.id, transaction_id: t.id, product_name: it.productName, quantity: it.quantity, unit_price: it.unitPrice })
          );
        })
      );
      await syncTable("supplier_transactions", supTxRows);
      await syncTable("supplier_transaction_items", supItemRows);
    }

    if (changed("people")) {
      await syncTable(
        "people",
        data.people.map((p) => ({ id: p.id, name: p.name }))
      );
      const personTxRows = [];
      data.people.forEach((p) =>
        (p.transactions || []).forEach((t) =>
          personTxRows.push({
            id: t.id,
            person_id: p.id,
            type: t.type,
            amount: t.amount,
            date: t.date,
            created_at: t.createdAt || undefined,
            receipt_hash: t.receiptHash || null,
            receipt_ref: t.receiptRef || null,
            receipt_dest_card: t.receiptDestCard || null,
            receipt_info: t.receiptInfo || null,
            description: t.description || null,
            receipt_path: t.hasReceipt ? t.id : null,
          })
        )
      );
      await syncTable("person_transactions", personTxRows);
    }

    if (changed("expenses")) {
      await syncTable(
        "expenses",
        data.expenses.map((e) => ({
          id: e.id,
          category: e.category,
          amount: e.amount,
          date: e.date,
          created_at: e.createdAt || undefined,
          receipt_hash: e.receiptHash || null,
          receipt_ref: e.receiptRef || null,
          receipt_dest_card: e.receiptDestCard || null,
          receipt_info: e.receiptInfo || null,
          description: e.description || null,
          receipt_path: e.hasReceipt ? e.id : null,
          related_supplier_id: e.relatedSupplierId || null,
          related_purchase_id: e.relatedPurchaseId || null,
        }))
      );
    }

    if (changed("reports")) {
      await syncTable(
        "reports",
        data.reports.map((r) => ({ id: r.id, title: r.title, date: r.date, content: r.content }))
      );
    }

    if (changed("cards")) {
      await syncTable(
        "cards",
        data.cards.map((c) => ({
          id: c.id,
          bank_name: c.bankName,
          holder_name: c.holderName || null,
          card_number: c.cardNumber,
          iban: c.iban || null,
          note: c.note || null,
        }))
      );
    }

    if (changed("stockAdjustments")) {
      await syncTable(
        "stock_adjustments",
        data.stockAdjustments.map((a) => ({
          id: a.id,
          product_name: a.productName,
          quantity: a.quantity,
          unit_cost: a.unitCost || 0,
          date: a.date,
          note: a.note || null,
        }))
      );
    }

    return true;
  } catch (err) {
    console.error("saveData error:", err);
    return false;
  }
}

function dataUrlToBlob(dataUrl) {
  const [meta, base64] = dataUrl.split(",");
  const mime = meta.match(/:(.*?);/)[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function saveReceipt(txId, dataUrl) {
  try {
    const blob = dataUrlToBlob(dataUrl);
    const { error } = await supabase.storage.from("receipts").upload(txId, blob, { upsert: true, contentType: "image/jpeg" });
    if (error) console.error("saveReceipt upload error:", error.message);
    return !error;
  } catch (err) {
    console.error("saveReceipt error:", err);
    return false;
  }
}
async function loadReceipt(txId) {
  try {
    const { data, error } = await supabase.storage.from("receipts").download(txId);
    if (error) {
      console.error("loadReceipt download error:", error.message);
      return null;
    }
    if (!data) return null;
    return URL.createObjectURL(data);
  } catch (err) {
    console.error("loadReceipt error:", err);
    return null;
  }
}
async function deleteReceipt(txId) {
  try {
    await supabase.storage.from("receipts").remove([txId]);
  } catch {}
}

// Returns { storageDataUrl, ocrDataUrl } — the storage version is compressed
// small to keep upload/storage cheap; the OCR version is kept much larger
// since Tesseract's digit recognition (especially Persian digits) degrades
// badly on small/blurry text.
function processReceiptImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new window.Image();
      img.onload = () => {
        const render = (maxW, quality, enhance = false) => {
          // Upscale smaller photos instead of keeping them tiny. This helps when
          // the receipt was photographed from another phone and the text is small.
          const scale = Math.min(2.2, Math.max(1, maxW / Math.max(img.width, 1)));
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          if (enhance) {
            const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const px = frame.data;
            for (let i = 0; i < px.length; i += 4) {
              const y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
              // Gentle contrast + threshold protection: keep background light and
              // darken faint printed glyphs without destroying anti-aliased edges.
              const boosted = Math.max(0, Math.min(255, (y - 128) * 1.28 + 128));
              px[i] = px[i + 1] = px[i + 2] = boosted;
            }
            ctx.putImageData(frame, 0, 0);
          }
          return canvas.toDataURL("image/jpeg", quality);
        };
        resolve({
          storageDataUrl: render(1100, 0.68, false),
          ocrDataUrl: render(3200, 0.96, false),
          ocrEnhancedDataUrl: render(3200, 0.96, true),
        });
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ---------------- balance calculations ---------------- */
function customerBalance(c) {
  // positive = customer owes you (receivable)
  return (c.transactions || []).reduce((sum, t) => {
    if (t.type === "debt") return sum + Number(t.amount || 0);
    if (t.type === "payment") return sum - Number(t.amount || 0);
    return sum;
  }, 0);
}
function supplierBalance(s) {
  // positive = you owe supplier (payable) — shipping/incidental costs are the
  // business's own expense, not owed to the supplier, so they're excluded here.
  return (s.transactions || []).reduce((sum, t) => {
    if (t.type === "purchase") return sum + Number(t.amount || 0);
    if (t.type === "payment") return sum - Number(t.amount || 0);
    return sum;
  }, 0);
}
function itemSubtotal(it) {
  return Number(it.quantity || 0) * Number(it.unitPrice || 0);
}

// Landed cost per purchase: allocates any linked shipping/incidental cost
// (from the general expenses ledger, category "shipping") across items
// proportionally to each item's CARTON COUNT (quantity) — not its price —
// since every carton takes the same space/cost to ship regardless of what's in it.
function purchaseLanding(purchaseTx, expenses) {
  const shippingTotal = (expenses || [])
    .filter((e) => e.category === "shipping" && e.relatedPurchaseId === purchaseTx.id)
    .reduce((s, e) => s + Number(e.amount || 0), 0);
  const items = purchaseTx.items || [];
  const subtotal = items.reduce((s, it) => s + itemSubtotal(it), 0);
  const totalQty = items.reduce((s, it) => s + Number(it.quantity || 0), 0);
  const landedItems = items.map((it) => {
    const sub = itemSubtotal(it);
    const qty = Number(it.quantity || 0);
    const shippingShare = totalQty ? (qty / totalQty) * shippingTotal : 0;
    const landedTotal = sub + shippingShare;
    const landedUnit = qty ? landedTotal / qty : null;
    return { ...it, subtotal: sub, shippingShare, landedTotal, landedUnit };
  });
  return { items: landedItems, shippingTotal, subtotal, grandTotal: subtotal + shippingTotal };
}

// Collect distinct product names already used, for autocomplete suggestions.
function getAllProductNames(data) {
  const names = new Set();
  (data.customers || []).forEach((c) =>
    (c.transactions || []).forEach((t) => (t.items || []).forEach((it) => it.productName && names.add(it.productName)))
  );
  (data.suppliers || []).forEach((s) =>
    (s.transactions || []).forEach((t) => (t.items || []).forEach((it) => it.productName && names.add(it.productName)))
  );
  return Array.from(names).sort((a, b) => a.localeCompare(b, "fa"));
}

// Per-product inventory + profit, derived entirely from the transaction log
// (average-cost method): stock = purchased - sold, profit = revenue - avgCost*sold.
function computeProductStats(data) {
  const map = {};
  const ensure = (name) => {
    if (!map[name]) map[name] = { productName: name, purchasedQty: 0, purchasedCost: 0, soldQty: 0, soldRevenue: 0 };
    return map[name];
  };
  (data.suppliers || []).forEach((s) => {
    (s.transactions || []).filter((t) => t.type === "purchase").forEach((p) => {
      purchaseLanding(p, data.expenses).items.forEach((it) => {
        const rec = ensure(it.productName);
        rec.purchasedQty += Number(it.quantity || 0);
        rec.purchasedCost += it.landedTotal;
      });
    });
  });
  (data.stockAdjustments || []).forEach((a) => {
    const rec = ensure(a.productName);
    rec.purchasedQty += Number(a.quantity || 0);
    rec.purchasedCost += Number(a.quantity || 0) * Number(a.unitCost || 0);
  });
  (data.customers || []).forEach((c) => {
    (c.transactions || []).filter((t) => t.type === "debt").forEach((d) => {
      (d.items || []).forEach((it) => {
        const rec = ensure(it.productName);
        rec.soldQty += Number(it.quantity || 0);
        rec.soldRevenue += itemSubtotal(it);
      });
    });
  });
  return Object.values(map)
    .map((r) => {
      const avgCost = r.purchasedQty ? r.purchasedCost / r.purchasedQty : 0;
      const stock = r.purchasedQty - r.soldQty;
      const cogs = avgCost * r.soldQty;
      return { ...r, avgCost, stock, cogs, profit: r.soldRevenue - cogs };
    })
    .sort((a, b) => a.productName.localeCompare(b.productName, "fa"));
}

// positive = business currently owes this person (paid them less than received from them... inverse tracked below)
function personBalance(p) {
  return (p.transactions || []).reduce((s, t) => (t.type === "out" ? s + Number(t.amount || 0) : s - Number(t.amount || 0)), 0);
}

const EXPENSE_CATEGORY_LABEL = {
  shipping: "حمل‌ونقل",
  personal: "خرید / برداشت شخصی",
  overhead: "هزینه‌های جانبی و سربار",
  other: "سایر",
};

/* ---------------- small UI atoms ---------------- */
function Screen({ children }) {
  return <div className="min-h-screen w-full pb-24 mobile-app" style={{ background: T.bg }}>{children}</div>;
}

function Header({ title, onBack, right }) {
  return (
    <div
      className="sticky top-0 z-20 flex items-center justify-between px-4 py-4"
      style={{ background: T.bg, borderBottom: `1px solid ${T.hairline}` }}
    >
      <div className="flex items-center gap-2">
        {onBack && (
          <button onClick={onBack} className="p-1 -ml-1 rounded-full active:bg-black/5">
            <ChevronLeft size={22} color={T.ink} />
          </button>
        )}
        <h1 className="text-lg font-bold" style={{ color: T.ink, fontFamily: "Vazirmatn" }}>{title}</h1>
      </div>
      {right}
    </div>
  );
}

function Amount({ value, tone = "ink", size = "base" }) {
  const colorMap = { ink: T.ink, green: T.green, rust: T.rust, muted: T.muted };
  const sizeMap = { sm: "13px", base: "16px", lg: "22px" };
  return (
    <span
      style={{
        fontFamily: "'JetBrains Mono', monospace",
        color: colorMap[tone],
        fontSize: sizeMap[size],
        fontWeight: 600,
        fontVariantNumeric: "tabular-nums",
      }}
      dir="ltr"
    >
      {fmt(value)}
    </span>
  );
}

function Perforation() {
  return (
    <div
      className="w-full"
      style={{
        height: "1px",
        backgroundImage: `repeating-linear-gradient(90deg, ${T.hairline} 0 6px, transparent 6px 12px)`,
      }}
    />
  );
}

function Card({ children, onClick, className = "" }) {
  return (
    <div
      onClick={onClick}
      className={`rounded-2xl p-4 ${onClick ? "active:scale-[0.98] transition-transform" : ""} ${className}`}
      style={{ background: T.card, border: `1px solid ${T.hairline}`, boxShadow: "0 1px 2px rgba(43,36,56,0.04)" }}
    >
      {children}
    </div>
  );
}

// Colorful initials avatar for people/customers/suppliers — picks a hue
// deterministically from the name so the same person always gets the same color.
const AVATAR_PALETTE = [
  { bg: "rgba(199,155,214,0.14)", fg: "#D9A8E8" }, // plum
  { bg: "rgba(63,191,143,0.14)", fg: "#5FDDA8" }, // emerald
  { bg: "rgba(201,167,104,0.16)", fg: "#EAD09A" }, // gold
  { bg: "rgba(192,96,90,0.16)", fg: "#E08B84" }, // wine
  { bg: "rgba(122,150,214,0.16)", fg: "#9BB8EA" }, // periwinkle
];
function Avatar({ name, size = 38 }) {
  const idx = Math.abs((name || "?").split("").reduce((h, c) => h + c.charCodeAt(0), 0)) % AVATAR_PALETTE.length;
  const { bg, fg } = AVATAR_PALETTE[idx];
  return (
    <div
      className="rounded-full flex items-center justify-center shrink-0"
      style={{ width: size, height: size, background: bg, color: fg, fontFamily: "Vazirmatn", fontWeight: 800, fontSize: size * 0.4 }}
    >
      {(name || "?").trim().charAt(0)}
    </div>
  );
}

// Signature element: a rotated wax-seal / ledger stamp, the kind that would
// mark a settled invoice or a stamped customs paper. Used wherever a balance
// reads as fully settled — a small ceremonial moment instead of a plain "0".
function StampBadge({ label = "تسویه", tone = "brass" }) {
  const color = tone === "brass" ? T.amberDark : T.green;
  return (
    <div
      className="inline-flex items-center justify-center shrink-0"
      style={{
        width: 64,
        height: 64,
        borderRadius: "9999px",
        border: `2px solid ${color}`,
        boxShadow: `inset 0 0 0 3px ${T.card}, inset 0 0 0 4px ${color}55`,
        transform: "rotate(-8deg)",
        color,
      }}
    >
      <span style={{ fontFamily: "Vazirmatn", fontWeight: 800, fontSize: "12.5px", letterSpacing: "0.5px" }}>{label}</span>
    </div>
  );
}

/* ---------------- Printable Invoice ---------------- */
function InvoiceView({ kind, partyName, partyPhone, transaction, allTransactions, onClose }) {
  const invoiceNo = "INV-" + transaction.id.replace(/-/g, "").slice(0, 8).toUpperCase();
  const items = transaction.items || [];
  const total = items.length ? items.reduce((s, it) => s + itemSubtotal(it), 0) : transaction.amount;
  const title = kind === "sale" ? "فاکتور فروش" : "فاکتور خرید";
  const partyLabel = kind === "sale" ? "خریدار" : "فروشنده";
  const linkField = kind === "sale" ? "linkedInvoiceId" : "linkedPurchaseId";
  const paidAmount = (allTransactions || [])
    .filter((t) => t.type === "payment" && t[linkField] === transaction.id)
    .reduce((s, t) => s + Number(t.amount || 0), 0);
  const isSettled = paidAmount >= total && total > 0;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: T.bg }}>
      <div className="fixed inset-0" style={{ background: T.bg }} />
      <div className="relative">
        <div className="no-print sticky top-0 z-10 flex items-center justify-between px-4 py-3" style={{ background: T.midnight }}>
          <button onClick={onClose} className="p-2 rounded-full active:bg-white/10">
            <X size={20} color="#fff" />
          </button>
          <button onClick={() => window.print()} className="flex items-center gap-1.5 px-4 py-2 rounded-full" style={{ background: T.amber }}>
            <Printer size={15} color={T.bg} />
            <span style={{ fontFamily: "Vazirmatn", fontSize: "13px", fontWeight: 700, color: T.bg }}>چاپ فاکتور</span>
          </button>
        </div>

        <div className="invoice-print max-w-2xl mx-auto p-6 sm:p-10 relative" style={{ background: "#fff", color: "#111", fontFamily: "Vazirmatn" }} dir="rtl">
          {isSettled && (
            <div
              className="absolute flex items-center justify-center"
              style={{
                top: 24,
                left: 24,
                width: 92,
                height: 92,
                borderRadius: "9999px",
                border: "3px solid #1F6E4E",
                boxShadow: "inset 0 0 0 4px #fff, inset 0 0 0 5px #1F6E4E",
                transform: "rotate(-12deg)",
                color: "#1F6E4E",
              }}
            >
              <span style={{ fontFamily: "Vazirmatn", fontWeight: 800, fontSize: "16px", letterSpacing: "0.5px" }}>تسویه</span>
            </div>
          )}
          <div className="flex items-start justify-between pb-5" style={{ borderBottom: "2px solid #111" }}>
            <div>
              <h1 className="text-2xl font-extrabold">{title}</h1>
              <p className="text-xs mt-1" style={{ color: "#666" }}>شماره فاکتور: <span dir="ltr">{invoiceNo}</span></p>
            </div>
            <div className="text-left">
              <p className="text-sm font-bold">تاریخ</p>
              <p className="text-sm" style={{ color: "#444" }}>
                {fmtDate(transaction.date)}
                {transaction.createdAt && <span dir="ltr"> — {fmtTime(transaction.createdAt)}</span>}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between mt-5 mb-6 px-4 py-3 rounded-xl" style={{ background: "#F5F3EE" }}>
            <p className="text-xs" style={{ color: "#666" }}>{partyLabel}</p>
            <div className="text-left">
              <p className="text-sm font-bold">{partyName}</p>
              {partyPhone && <p className="text-xs" style={{ color: "#666" }} dir="ltr">{partyPhone}</p>}
            </div>
          </div>

          {items.length > 0 ? (
            <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #111" }}>
                  <th className="text-right py-2">کالا</th>
                  <th className="text-center py-2">تعداد</th>
                  <th className="text-center py-2">قیمت واحد</th>
                  <th className="text-left py-2">جمع</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} style={{ borderBottom: "1px solid #ddd" }}>
                    <td className="py-2.5">{it.productName}</td>
                    <td className="py-2.5 text-center" dir="ltr">{fmt(it.quantity)}</td>
                    <td className="py-2.5 text-center" dir="ltr">{fmt(it.unitPrice)}</td>
                    <td className="py-2.5 text-left" dir="ltr">{fmt(itemSubtotal(it))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            transaction.description && <p className="text-sm" style={{ color: "#444" }}>{transaction.description}</p>
          )}

          <div className="flex justify-end mt-4">
            <div className="w-56">
              <div className="flex items-center justify-between py-2" style={{ borderTop: "2px solid #111" }}>
                <span className="font-bold">جمع کل</span>
                <span className="font-bold" dir="ltr">{fmt(total)}</span>
              </div>
            </div>
          </div>

          {transaction.description && items.length > 0 && (
            <p className="text-xs mt-4" style={{ color: "#666" }}>توضیحات: {transaction.description}</p>
          )}

          <div className="flex justify-between mt-16 pt-4" style={{ borderTop: "1px dashed #999" }}>
            <div className="text-center w-32">
              <div style={{ height: 40 }} />
              <p className="text-xs" style={{ color: "#666", borderTop: "1px solid #999", paddingTop: 4 }}>امضای فروشنده</p>
            </div>
            <div className="text-center w-32">
              <div style={{ height: 40 }} />
              <p className="text-xs" style={{ color: "#666", borderTop: "1px solid #999", paddingTop: 4 }}>امضای خریدار</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Empty({ icon: Icon, title, subtitle }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <div className="rounded-2xl p-3.5 mb-1" style={{ background: T.plumBg }}>
        <Icon size={26} color={T.plum} strokeWidth={1.6} />
      </div>
      <p className="mt-3 font-semibold" style={{ color: T.ink, fontFamily: "Vazirmatn" }}>{title}</p>
      {subtitle && <p className="mt-1 text-sm" style={{ color: T.muted, fontFamily: "Vazirmatn" }}>{subtitle}</p>}
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: "rgba(43,36,56,0.45)" }} onClick={onClose}>
      <div
        className="w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl max-h-[90vh] overflow-y-auto"
        style={{ background: T.bg }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between px-5 py-4" style={{ background: T.bg, borderBottom: `1px solid ${T.hairline}` }}>
          <h2 className="font-bold text-base" style={{ color: T.ink, fontFamily: "Vazirmatn" }}>{title}</h2>
          <button onClick={onClose} className="p-1 rounded-full active:bg-black/5">
            <X size={20} color={T.muted} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function ConfirmDialog({ title, message, onConfirm, onCancel }) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p style={{ fontFamily: "Vazirmatn", color: T.muted, fontSize: "13.5px", lineHeight: 1.9 }}>{message}</p>
      <div className="flex gap-2.5 mt-5">
        <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl" style={{ background: T.card, border: `1px solid ${T.hairline}` }}>
          <span style={{ fontFamily: "Vazirmatn", fontSize: "13px", fontWeight: 700, color: T.ink }}>انصراف</span>
        </button>
        <button onClick={onConfirm} className="flex-1 py-2.5 rounded-xl" style={{ background: T.rust }}>
          <span style={{ fontFamily: "Vazirmatn", fontSize: "13px", fontWeight: 700, color: "#fff" }}>حذف کن</span>
        </button>
      </div>
    </Modal>
  );
}

function Field({ label, children }) {
  return (
    <div className="mb-4">
      <label className="block mb-1.5 text-sm font-medium" style={{ color: T.muted, fontFamily: "Vazirmatn" }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "11px 14px",
  borderRadius: "12px",
  border: `1px solid ${T.hairline}`,
  background: "#101216",
  color: T.ink,
  fontFamily: "Vazirmatn",
  fontSize: "15px",
  outline: "none",
};

function TextInput(props) {
  return <input {...props} style={{ ...inputStyle, ...(props.style || {}) }} />;
}
function TextArea(props) {
  return <textarea {...props} style={{ ...inputStyle, minHeight: "80px", resize: "vertical", ...(props.style || {}) }} />;
}

function SearchBar({ value, onChange, placeholder = "جستجو..." }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl px-3.5 py-2.5" style={{ background: T.card, border: `1px solid ${T.hairline}` }}>
      <Search size={15} color={T.muted} className="shrink-0" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: T.ink, fontFamily: "Vazirmatn", fontSize: "13px" }}
      />
      {value && (
        <button onClick={() => onChange("")} className="shrink-0">
          <X size={14} color={T.muted} />
        </button>
      )}
    </div>
  );
}

// Numeric input that shows live thousand-separators (1,000,000) while
// keeping the underlying value as a plain digit string for calculations.
function AmountInput({ value, onChange, placeholder = "0" }) {
  const display = value ? Number(value).toLocaleString("en-US") : "";
  return (
    <TextInput
      inputMode="numeric"
      value={display}
      onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
      placeholder={placeholder}
      dir="ltr"
      style={{ fontFamily: "'JetBrains Mono', monospace" }}
    />
  );
}

// Custom Jalali (Shamsi) day/month/year picker — HTML's native date input
// is always Gregorian, so this replaces it everywhere a date is entered.
function JalaliDatePicker({ value, onChange }) {
  const initial = useRef(isoToJalali(value)).current;
  const [jy, setJy] = useState(initial.jy);
  const [jm, setJm] = useState(initial.jm);
  const [jd, setJd] = useState(initial.jd);
  const dayCount = daysInJalaliMonth(jy, jm);
  const safeDay = Math.min(jd, dayCount);

  useEffect(() => {
    onChange(jalaliToISO(jy, jm, safeDay));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jy, jm, safeDay]);

  const selStyle = { ...inputStyle, padding: "11px 8px", textAlign: "center" };
  return (
    <div className="flex gap-2">
      <select value={safeDay} onChange={(e) => setJd(Number(e.target.value))} style={selStyle}>
        {Array.from({ length: dayCount }, (_, i) => i + 1).map((d) => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>
      <select value={jm} onChange={(e) => setJm(Number(e.target.value))} style={{ ...selStyle, flex: 1.4 }}>
        {JALALI_MONTHS.map((m, i) => (
          <option key={m} value={i + 1}>{m}</option>
        ))}
      </select>
      <select value={jy} onChange={(e) => setJy(Number(e.target.value))} style={selStyle}>
        {Array.from({ length: 6 }, (_, i) => jy - 4 + i).map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
    </div>
  );
}

function PrimaryButton({ children, onClick, disabled, full = true }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${full ? "w-full" : ""} py-3 rounded-xl font-bold text-sm active:scale-[0.98] transition-transform`}
      style={{
        background: disabled ? "#3A3628" : `linear-gradient(135deg, ${T.amberBright}, ${T.amberDark})`,
        color: "#1A1408",
        fontFamily: "Vazirmatn",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  );
}

/* ---------------- Bottom Nav ---------------- */
function BottomNav({ tab, setTab }) {
  const items = [
    { id: "dashboard", label: "داشبورد", icon: LayoutGrid },
    { id: "customers", label: "مشتریان", icon: Users },
    { id: "suppliers", label: "تامین‌کنندگان", icon: Truck },
    { id: "inventory", label: "انبار", icon: Package },
    { id: "invoices", label: "فاکتورها", icon: FileText },
    { id: "treasury", label: "صندوق", icon: Wallet },
  ];
  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 flex justify-center px-3" style={{ paddingBottom: "max(14px, env(safe-area-inset-bottom))" }}>
      <div
        className="flex items-center gap-0 px-1.5 py-2"
        style={{ background: T.midnight, borderRadius: "9999px", boxShadow: "0 10px 30px rgba(27,30,43,0.35)" }}
      >
        {items.map((it) => {
          const active = tab === it.id;
          return (
            <button
              key={it.id}
              onClick={() => setTab(it.id)}
              className="flex flex-col items-center gap-1 px-2 py-2 rounded-full transition-colors"
              style={{ color: active ? T.midnight : "rgba(255,255,255,0.55)", background: active ? T.amber : "transparent", minWidth: 49 }}
            >
              <it.icon size={19} strokeWidth={active ? 2.4 : 1.8} />
              <span style={{ fontFamily: "Vazirmatn", fontSize: "9.5px", fontWeight: active ? 700 : 500 }}>{it.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Receipt viewer/upload ---------------- */
function ReceiptPicker({ value, onChange, onOcrImage, onOcrEnhancedImage }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const { storageDataUrl, ocrDataUrl, ocrEnhancedDataUrl } = await processReceiptImage(file);
      onChange(storageDataUrl);
      if (onOcrImage) onOcrImage(ocrDataUrl);
      if (onOcrEnhancedImage) onOcrEnhancedImage(ocrEnhancedDataUrl);
    } catch {
      onChange(null);
    }
    setBusy(false);
  };
  return (
    <div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      {value ? (
        <div className="relative">
          <img src={value} alt="رسید" className="w-full rounded-xl" style={{ border: `1px solid ${T.hairline}` }} />
          <button
            onClick={() => {
              onChange(null);
              if (onOcrImage) onOcrImage(null);
              if (onOcrEnhancedImage) onOcrEnhancedImage(null);
            }}
            className="absolute top-2 left-2 p-1.5 rounded-full"
            style={{ background: "rgba(43,36,56,0.7)" }}
          >
            <Trash2 size={15} color="#fff" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-xl border-2 border-dashed"
          style={{ borderColor: T.hairline, color: T.muted }}
        >
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
          <span style={{ fontFamily: "Vazirmatn", fontSize: "14px" }}>{busy ? "در حال پردازش..." : "افزودن عکس رسید (اختیاری)"}</span>
        </button>
      )}
    </div>
  );
}

// Wraps ReceiptPicker with automatic duplicate-photo detection: as soon as
// an image is attached, it's fingerprinted and checked against every other
// receipt already in the ledger.
function ReceiptField({ value, onChange, data, excludeTxId, onHashChange, onRefChange, onInfoChange, initialRef, initialReceiptInfo, onBlockChange }) {
  const [checking, setChecking] = useState(false);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrAttempt, setOcrAttempt] = useState(0);
  const [dup, setDup] = useState(null);
  const [hash, setHash] = useState(null);
  const [refNumber, setRefNumber] = useState(initialRef || "");
  const [ocrImage, setOcrImage] = useState(null);
  const [ocrEnhancedImage, setOcrEnhancedImage] = useState(null);
  const [receiptInfo, setReceiptInfo] = useState(initialReceiptInfo || null);
  const [ocrMode, setOcrMode] = useState("fast");
  const [editingField, setEditingField] = useState(null);

  const applyDup = (d) => {
    setDup(d);
    if (onBlockChange) onBlockChange(!!(d && d.via === "شماره پیگیری"));
  };

  useEffect(() => {
    let cancelled = false;
    if (!value) {
      applyDup(null); setHash(null); setReceiptInfo(null); setOcrResultSafe(null);
      onHashChange(null); if (onInfoChange) onInfoChange(null); return;
    }
    if (!value.startsWith("data:")) return;
    setChecking(true);
    hashDataUrl(value).then((h) => {
      if (cancelled) return;
      setHash(h); onHashChange(h);
      applyDup(findDuplicateReceipt(data, { hash: h, referenceNumber: refNumber || null, receiptInfo, amount: null, date: null }, excludeTxId));
      setChecking(false);
    });
    return () => { cancelled = true; };
  }, [value]);

  function setOcrResultSafe() { /* retained as a no-op reset hook for compatibility */ }

  const syncPreferred = useCallback((info) => {
    const preferred = info?.selected?.trackingNumber && info.values.trackingNumber
      ? info.values.trackingNumber
      : info?.selected?.referenceId && info.values.referenceId
        ? info.values.referenceId
        : info?.selected?.documentNumber && info.values.documentNumber
          ? info.values.documentNumber
          : "";
    const chosenCard = info?.selected?.destCard ? info.values.destCard : null;
    setRefNumber(preferred);
    onRefChange(preferred || null, chosenCard);
    applyDup(findDuplicateReceipt(data, { hash, referenceNumber: preferred || null, receiptInfo: info, amount: info?.values?.amount || null, date: info?.values?.date || null }, excludeTxId));
  }, [data, hash, excludeTxId, onRefChange]);

  const runVision = useCallback(async (mode = "fast", field = null) => {
    const image = (mode === "retry" || mode === "field_retry") ? (ocrEnhancedImage || ocrImage) : ocrImage;
    if (!image) return;
    setOcrRunning(true);
    setOcrMode(mode === "full" ? "full" : receiptInfo?.mode === "full" && mode === "retry" ? "full" : "fast");
    try {
      const apiMode = mode === "retry" && (receiptInfo?.mode === "full" || ocrMode === "full") ? "full_retry" : mode;
      const result = await ocrReceipt(image, { mode: apiMode, field });
      if (result?.source === "none") throw new Error(result.error || "خوانش ناموفق بود");
      let info = makeReceiptInfo(result, mode === "field_retry" ? receiptInfo?.selected || {} : null);
      if (mode === "field_retry" && receiptInfo) {
        const keyMap = {
          "مبلغ": "amount", "تاریخ": "date", "ساعت": "time", "شماره سند": "documentNumber",
          "شماره پیگیری": "trackingNumber", "شماره مرجع / رهگیری": "referenceId", "۴ رقم آخر کارت مقصد": "destCard",
          "فرستنده": "senderName", "گیرنده": "receiverName"
        };
        const key = keyMap[field] || field;
        const mergedValues = { ...receiptInfo.values };
        const mergedFields = { ...receiptInfo.fields };
        if (key && result[key] != null) mergedValues[key] = String(result[key]);
        if (key && result.fields?.[key]) mergedFields[key] = result.fields[key];
        info = { ...receiptInfo, values: mergedValues, fields: mergedFields, mode: "full" };
      }
      setReceiptInfo(info);
      if (onInfoChange) onInfoChange(info);
      syncPreferred(info);
    } catch (err) {
      console.error("OCR error:", err);
      setReceiptInfo((prev) => prev || { values: {}, selected: {}, fields: {}, candidates: [], mode: "fast" });
    } finally {
      setOcrRunning(false);
    }
  }, [ocrImage, ocrEnhancedImage, receiptInfo, onInfoChange, syncPreferred]);

  useEffect(() => {
    if (!ocrImage) return;
    setOcrAttempt(1);
    runVision("fast");
  }, [ocrImage]);

  const toggleField = (key) => {
    if (!receiptInfo) return;
    const next = { ...receiptInfo, selected: { ...receiptInfo.selected, [key]: !receiptInfo.selected?.[key] } };
    setReceiptInfo(next); if (onInfoChange) onInfoChange(next); syncPreferred(next);
  };

  const updateField = (key, val) => {
    if (!receiptInfo) return;
    const next = { ...receiptInfo, values: { ...receiptInfo.values, [key]: val } };
    setReceiptInfo(next); if (onInfoChange) onInfoChange(next); syncPreferred(next);
  };

  const chooseCandidate = (candidate) => {
    if (!receiptInfo || !candidate?.value) return;
    const values = { ...receiptInfo.values, trackingNumber: null, referenceId: null, documentNumber: null };
    const selected = { ...receiptInfo.selected, trackingNumber: false, referenceId: false, documentNumber: false };
    if (candidate.kind === "tracking") { values.trackingNumber = candidate.value; selected.trackingNumber = true; }
    else if (candidate.kind === "document") { values.documentNumber = candidate.value; selected.documentNumber = true; }
    else { values.referenceId = candidate.value; selected.referenceId = true; }
    const next = { ...receiptInfo, values, selected, selectedCandidate: candidate };
    setReceiptInfo(next); if (onInfoChange) onInfoChange(next); syncPreferred(next);
  };

  const handleRefEdit = (v) => { setRefNumber(v); onRefChange(v || null, null); applyDup(findDuplicateReceipt(data, { hash, referenceNumber: v || null, receiptInfo, amount: receiptInfo?.values?.amount || null, date: receiptInfo?.values?.date || null }, excludeTxId)); };
  const isBlocking = !!dup;
  useEffect(() => {
    if (!receiptInfo || !data) return;
    const d = findDuplicateReceipt(data, { hash, referenceNumber: refNumber || null, receiptInfo, amount: receiptInfo?.values?.amount || null, date: receiptInfo?.values?.date || null }, excludeTxId);
    applyDup(d);
  }, [receiptInfo, hash, refNumber, data, excludeTxId]);
  const hasValues = receiptInfo && Object.keys(receiptInfo.values || {}).some(k => receiptInfo.values[k]);
  const isFull = receiptInfo?.mode === "full" || ocrMode === "full";

  return (
    <div>
      <ReceiptPicker value={value} onChange={onChange} onOcrImage={setOcrImage} onOcrEnhancedImage={setOcrEnhancedImage} />
      {value && value.startsWith("data:") && (
        <div className="mt-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <label className="block text-xs font-medium" style={{ color: T.muted, fontFamily: "Vazirmatn" }}>
              {ocrRunning ? "در حال خواندن رسید..." : isFull ? "اطلاعات کامل رسید" : "شماره پیگیری / رهگیری / سند"}
            </label>
            <button type="button" disabled={ocrRunning || !ocrImage} onClick={() => { setOcrAttempt(v => v + 1); runVision("retry"); }} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg" style={{ background: ocrRunning ? T.card2 : T.amber, color: ocrRunning ? T.muted : T.bg, fontFamily: "Vazirmatn", fontSize: "11px", fontWeight: 700 }}>
              <RefreshCw size={12} className={ocrRunning ? "animate-spin" : ""} />
              {ocrRunning ? "در حال تلاش..." : `تلاش مجدد${ocrAttempt > 1 ? ` (${ocrAttempt})` : ""}`}
            </button>
          </div>

          <div className="flex gap-2 mb-2">
            <button type="button" disabled={ocrRunning || !ocrImage} onClick={() => runVision("fast")} className="flex-1 px-3 py-2 rounded-xl" style={{ background: !isFull ? T.amber : T.card2, color: !isFull ? T.bg : T.muted, fontFamily: "Vazirmatn", fontSize: "11px", fontWeight: 700 }}>🎯 فقط شماره پیگیری</button>
            <button type="button" disabled={ocrRunning || !ocrImage} onClick={() => runVision("full")} className="flex-1 px-3 py-2 rounded-xl" style={{ background: isFull ? T.amber : T.card2, color: isFull ? T.bg : T.muted, fontFamily: "Vazirmatn", fontSize: "11px", fontWeight: 700 }}>📄 خواندن کامل رسید</button>
          </div>

          {ocrRunning && <div className="mb-2 px-3 py-2 rounded-xl" style={{ background: T.card2, color: T.muted, fontFamily: "Vazirmatn", fontSize: "11.5px" }}>از خود تصویر دوباره بررسی می‌کنم؛ نتیجه قبلی به هوش مصنوعی داده نمی‌شود.</div>}

          {!ocrRunning && receiptInfo?.candidates?.length > 0 && !isFull && (
            <div className="mb-3 space-y-1.5">
              <div className="text-xs font-medium mb-1" style={{ color: T.muted, fontFamily: "Vazirmatn" }}>شماره‌های پیدا شده — یکی را برای ثبت انتخاب کن</div>
              {receiptInfo.candidates.map((c, i) => {
                const active = receiptInfo.selectedCandidate?.value === c.value && receiptInfo.selectedCandidate?.kind === c.kind;
                return <button key={`${c.value}-${i}`} type="button" onClick={() => chooseCandidate(c)} className="w-full text-right flex items-center gap-2 p-2.5 rounded-xl" style={{ background: active ? T.greenBg : T.card, border: `1px solid ${active ? "rgba(63,191,143,0.35)" : T.hairline}` }}>
                  <span className="w-5 h-5 rounded-md flex items-center justify-center shrink-0" style={{ background: active ? T.green : "transparent", border: `1px solid ${active ? T.green : T.hairline2}` }}>{active ? <Check size={13} color="#08100D" strokeWidth={3} /> : null}</span>
                  <span className="flex-1"><span className="block text-xs" style={{color:T.muted,fontFamily:"Vazirmatn"}}>{c.label || c.kind}</span><span className="block text-sm" dir="ltr" style={{color:T.ink,fontFamily:"'JetBrains Mono', monospace"}}>{c.value}</span></span>
                  <span className="text-[9px]" style={{color:Number(c.confidence)>=.85?T.green:Number(c.confidence)>=.65?T.amber:T.rust}}>{Math.round(Number(c.confidence||0)*100)}%</span>
                </button>;
              })}
            </div>
          )}

          {hasValues && !ocrRunning && (
            <div className="space-y-1.5">
              {RECEIPT_FIELD_DEFS.map(([key, label]) => {
                const val = receiptInfo.values[key]; if (!val) return null;
                const fieldMeta = receiptInfo.fields?.[key]; const conf = Number(fieldMeta?.confidence ?? 0);
                const editing = editingField === key;
                return <div key={key} className="rounded-xl p-2.5" style={{ background: receiptInfo.selected?.[key] ? T.greenBg : T.card, border:`1px solid ${receiptInfo.selected?.[key] ? "rgba(63,191,143,0.35)" : T.hairline}` }}>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => toggleField(key)} className="w-5 h-5 rounded-md flex items-center justify-center shrink-0" style={{background:receiptInfo.selected?.[key]?T.green:"transparent",border:`1px solid ${receiptInfo.selected?.[key]?T.green:T.hairline2}`}}>{receiptInfo.selected?.[key]?<Check size={13} color="#08100D" strokeWidth={3}/>:null}</button>
                    <div className="flex-1 min-w-0">
                      <span className="block text-xs" style={{color:T.muted,fontFamily:"Vazirmatn"}}>{label}</span>
                      {editing ? <input autoFocus value={val} onChange={e=>updateField(key,e.target.value)} onBlur={()=>setEditingField(null)} className="w-full mt-1 px-2 py-1.5 rounded-lg outline-none" dir="ltr" style={{background:T.card2,color:T.ink,border:`1px solid ${T.hairline2}`,fontFamily:key.includes("Number")||key==="amount"||key==="destCard"?"'JetBrains Mono', monospace":"Vazirmatn"}}/> : <span className="block text-sm truncate" dir="ltr" style={{color:T.ink,fontFamily:key.includes("Number")||key==="amount"||key==="destCard"?"'JetBrains Mono', monospace":"Vazirmatn"}}>{val}</span>}
                    </div>
                    {conf > 0 && <span className="text-[9px] shrink-0" style={{color:conf>=.85?T.green:conf>=.65?T.amber:T.rust}}>{Math.round(conf*100)}%</span>}
                    <button type="button" onClick={()=>setEditingField(editing?null:key)} className="p-1.5 rounded-lg" title="ویرایش" style={{color:T.amber}}><Pencil size={13}/></button>
                    {isFull && <button type="button" disabled={ocrRunning} onClick={()=>runVision("field_retry", label)} className="p-1.5 rounded-lg" title="تکرار این فیلد" style={{color:T.amber}}><RefreshCw size={13}/></button>}
                  </div>
                </div>;
              })}
              <p className="pt-1 text-[10.5px]" style={{color:T.muted,fontFamily:"Vazirmatn",lineHeight:1.8}}>فقط موارد تیک‌خورده هنگام ذخیره تراکنش ثبت می‌شوند. برای شماره مشکوک، تلاش مجدد بزن.</p>
            </div>
          )}


          <div className="mt-2"><label className="block mb-1.5 text-xs font-medium" style={{color:T.muted,fontFamily:"Vazirmatn"}}>شماره پیگیری / مرجع (اختیاری)</label><TextInput value={refNumber} onChange={e=>handleRefEdit(e.target.value)} placeholder="مثلاً 123456789" dir="ltr" style={{fontFamily:"'JetBrains Mono', monospace"}} /></div>
        </div>
      )}
      {checking && <p className="mt-2 flex items-center gap-1.5" style={{fontFamily:"Vazirmatn",fontSize:"11.5px",color:T.muted}}><Loader2 size={12} className="animate-spin"/> در حال بررسی تکراری بودن رسید...</p>}
      {dup && <div className="mt-2 px-3 py-2.5 rounded-xl flex items-start gap-2" style={{background:T.rustBg}}><AlertCircle size={15} color={T.rust} className="shrink-0 mt-0.5"/><p style={{fontFamily:"Vazirmatn",fontSize:"12px",color:T.rust,lineHeight:1.8}}><>⚠️ این رسید احتمالاً تکراری است و قبلاً برای «{dup.name} — {dup.context}» ({fmtDate(dup.date)}) ثبت شده. میزان شباهت: {Math.round((dup.score || 1) * 100)}٪. برای جلوگیری از ثبت دوباره، ابتدا اطلاعات رسید را بررسی کن.</></p></div>}
    </div>
  );
}

function ReceiptViewButton({ txId }) {
  const [open, setOpen] = useState(false);
  const [img, setImg] = useState(null);
  const [loading, setLoading] = useState(false);
  const handleOpen = async () => {
    setOpen(true);
    setLoading(true);
    const val = await loadReceipt(txId);
    setImg(val);
    setLoading(false);
  };
  return (
    <>
      <button onClick={handleOpen} className="flex items-center gap-1 px-2 py-1 rounded-lg" style={{ background: T.rustBg }}>
        <ImageIcon size={13} color={T.amberDark} />
        <span style={{ fontFamily: "Vazirmatn", fontSize: "11px", color: T.amberDark }}>رسید</span>
      </button>
      {open && (
        <Modal title="رسید واریزی" onClose={() => setOpen(false)}>
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="animate-spin" color={T.muted} /></div>
          ) : img ? (
            <img src={img} alt="رسید" className="w-full rounded-xl" />
          ) : (
            <p style={{ fontFamily: "Vazirmatn", color: T.muted }} className="text-center py-8">رسیدی یافت نشد.</p>
          )}
        </Modal>
      )}
    </>
  );
}

/* ---------------- Transaction Row ---------------- */
function ReceiptDetailsButton({ receiptInfo }) {
  const [open, setOpen] = useState(false);
  if (!receiptInfo?.values || !Object.values(receiptInfo.values).some(Boolean)) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1 px-2 py-1 rounded-lg" style={{ background: T.card2, color: T.amber, fontFamily: "Vazirmatn", fontSize: "10.5px" }}>
        <FileText size={12} /> جزئیات رسید
      </button>
      {open && <Modal title="جزئیات کامل رسید" onClose={() => setOpen(false)}>
        <div className="space-y-2">
          {RECEIPT_FIELD_DEFS.map(([key, label]) => {
            const val = receiptInfo.values[key];
            if (!val) return null;
            return <div key={key} className="flex items-start justify-between gap-3 p-2.5 rounded-xl" style={{ background: T.card2, border: `1px solid ${T.hairline}` }}>
              <span style={{ color: T.muted, fontFamily: "Vazirmatn", fontSize: "11px" }}>{label}</span>
              <span dir="ltr" style={{ color: T.ink, fontFamily: key.includes("Number") || key === "amount" || key === "destCard" ? "'JetBrains Mono', monospace" : "Vazirmatn", fontSize: "12px", textAlign: "left" }}>{val}</span>
            </div>;
          })}
          {receiptInfo.confidence != null && <p style={{ color: T.muted, fontFamily: "Vazirmatn", fontSize: "10.5px" }}>اطمینان خوانش: {Math.round(Number(receiptInfo.confidence || 0) * 100)}٪</p>}
        </div>
      </Modal>}
    </>
  );
}

function TxRow({ tx, positiveTypes, extra }) {
  const isPositive = positiveTypes.includes(tx.type);
  const Icon = isPositive ? ArrowUpRight : ArrowDownRight;
  const tone = isPositive ? "rust" : "green";
  // Note: color semantics handled by caller via positiveTypes/labelMap; keep generic here.
  return (
    <div className="py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="mt-0.5 p-1.5 rounded-full shrink-0" style={{ background: isPositive ? T.rustBg : T.greenBg }}>
            <Icon size={13} color={isPositive ? T.rust : T.green} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: T.ink, fontFamily: "Vazirmatn" }}>{tx.label}</p>
            {tx.description && <p className="text-xs mt-0.5" style={{ color: T.muted, fontFamily: "Vazirmatn" }}>{tx.description}</p>}
            {extra}
            <p className="text-xs mt-1" style={{ color: T.muted, fontFamily: "Vazirmatn" }}>{fmtDate(tx.date)}</p>
          </div>
        </div>
        <div className="text-left shrink-0">
          <Amount value={tx.amount} tone={isPositive ? "rust" : "green"} size="sm" />
          {tx.hasReceipt && <div className="mt-1.5"><ReceiptViewButton txId={tx.id} /></div>}
        </div>
      </div>
    </div>
  );
}

/* ================= MAIN APP ================= */
function LedgerApp() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState(false);
  const [tab, setTab] = useState("dashboard");
  const [openCustomer, setOpenCustomer] = useState(null);
  const [openSupplier, setOpenSupplier] = useState(null);
  const [modal, setModal] = useState(null); // {type: 'newCustomer'|'newSupplier'|'newReport'|'newTx', payload}
  const dataRef = useRef(null);

  useEffect(() => {
    (async () => {
      const d = await loadData();
      const initial = { customers: [], suppliers: [], reports: [], people: [], expenses: [], cards: [], stockAdjustments: [], ...(d || {}) };
      dataRef.current = initial;
      setData(initial);
      setLoading(false);
    })();
  }, []);

  const persist = useCallback(async (next) => {
    const prev = dataRef.current;
    dataRef.current = next;
    setData(next);
    const ok = await saveData(next, prev);
    setSaveError(!ok);
  }, []);

  if (loading) {
    return (
      <Screen>
        <div className="flex flex-col items-center justify-center h-screen">
          <Loader2 className="animate-spin" color={T.amber} size={28} />
          <p className="mt-3 text-sm" style={{ color: T.muted, fontFamily: "Vazirmatn" }}>در حال بارگذاری...</p>
        </div>
      </Screen>
    );
  }

  const totalReceivable = data.customers.reduce((s, c) => s + Math.max(customerBalance(c), 0), 0);
  const totalPayable = data.suppliers.reduce((s, sup) => s + Math.max(supplierBalance(sup), 0), 0);

  const customer = openCustomer ? data.customers.find((c) => c.id === openCustomer) : null;
  const supplier = openSupplier ? data.suppliers.find((s) => s.id === openSupplier) : null;

  return (
    <Screen>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        * { font-family: 'Vazirmatn', sans-serif; }
        body { direction: rtl; }
      `}</style>
      <div dir="rtl">
        {saveError && (
          <div className="flex items-center gap-2 px-4 py-2 text-xs" style={{ background: T.rustBg, color: T.rust, fontFamily: "Vazirmatn" }}>
            <AlertCircle size={14} /> ذخیره‌سازی با مشکل مواجه شد. اتصال را بررسی کنید.
          </div>
        )}

        {tab === "dashboard" && !customer && !supplier && (
          <Dashboard
            data={data}
            totalReceivable={totalReceivable}
            totalPayable={totalPayable}
            openModal={setModal}
            goTab={setTab}
          />
        )}

        {tab === "customers" && !customer && (
          <CustomerList data={data} onOpen={setOpenCustomer} openModal={setModal} />
        )}
        {tab === "customers" && customer && (
          <CustomerDetail
            customer={customer}
            data={data}
            onBack={() => setOpenCustomer(null)}
            openModal={setModal}
            onDeleteTx={async (txId) => {
              const next = deepClone(data);
              const c = next.customers.find((x) => x.id === customer.id);
              const tx = (c.transactions || []).find((t) => t.id === txId);
              if (tx?.linkedSupplierTxId) {
                for (const s of next.suppliers) {
                  s.transactions = (s.transactions || []).filter((t) => t.id !== tx.linkedSupplierTxId);
                }
                await deleteReceipt(tx.linkedSupplierTxId);
              }
              c.transactions = c.transactions.filter((t) => t.id !== txId);
              await deleteReceipt(txId);
              persist(next);
            }}
            onDeleteCustomer={async (customerId) => {
              const target = data.customers.find((x) => x.id === customerId);
              for (const t of target?.transactions || []) {
                if (t.hasReceipt) await deleteReceipt(t.id);
              }
              const next = { ...data, customers: data.customers.filter((x) => x.id !== customerId) };
              setOpenCustomer(null);
              persist(next);
            }}
          />
        )}

        {tab === "suppliers" && !supplier && (
          <SupplierList data={data} onOpen={setOpenSupplier} openModal={setModal} />
        )}
        {tab === "suppliers" && supplier && (
          <SupplierDetail
            supplier={supplier}
            expenses={data.expenses}
            data={data}
            onBack={() => setOpenSupplier(null)}
            openModal={setModal}
            onDeleteTx={async (txId) => {
              const next = deepClone(data);
              const s = next.suppliers.find((x) => x.id === supplier.id);
              const tx = (s.transactions || []).find((t) => t.id === txId);
              if (tx?.linkedCustomerTxId) {
                for (const c of next.customers) {
                  c.transactions = (c.transactions || []).filter((t) => t.id !== tx.linkedCustomerTxId);
                }
                await deleteReceipt(tx.linkedCustomerTxId);
              }
              s.transactions = s.transactions.filter((t) => t.id !== txId);
              await deleteReceipt(txId);
              persist(next);
            }}
            onDeleteExpense={async (expenseId) => {
              const next = { ...data, expenses: data.expenses.filter((e) => e.id !== expenseId) };
              await deleteReceipt(expenseId);
              persist(next);
            }}
            onDeleteSupplier={async (supplierId) => {
              const target = data.suppliers.find((x) => x.id === supplierId);
              for (const t of target?.transactions || []) {
                if (t.hasReceipt) await deleteReceipt(t.id);
              }
              const next = {
                ...data,
                suppliers: data.suppliers.filter((x) => x.id !== supplierId),
                expenses: data.expenses.filter((e) => e.relatedSupplierId !== supplierId),
              };
              setOpenSupplier(null);
              persist(next);
            }}
          />
        )}

        {tab === "invoices" && <InvoiceManager data={data} openModal={setModal} />}

        {tab === "reports" && <Reports data={data} openModal={setModal} persist={persist} goTab={setTab} />}

        {tab === "cards" && (
          <Cards
            data={data}
            openModal={setModal}
            goTab={setTab}
            onDeleteCard={async (cardId) => {
              const next = { ...data, cards: data.cards.filter((c) => c.id !== cardId) };
              persist(next);
            }}
          />
        )}

        {tab === "inventory" && (
          <Inventory
            data={data}
            openModal={setModal}
            onDeleteStockAdjustment={async (id) => {
              const next = deepClone(data);
              next.stockAdjustments = next.stockAdjustments.filter((a) => a.id !== id);
              persist(next);
            }}
          />
        )}

        {tab === "treasury" && (
          <Treasury
            data={data}
            openModal={setModal}
            onDeleteFeed={async (item) => {
              const next = deepClone(data);
              if (item.kind === "person") {
                const p = next.people.find((x) => x.id === item.personId);
                if (p) p.transactions = p.transactions.filter((t) => t.id !== item.id);
              } else if (item.kind === "expense") {
                next.expenses = next.expenses.filter((e) => e.id !== item.id);
              }
              await deleteReceipt(item.id);
              persist(next);
            }}
            onDeletePerson={async (personId) => {
              const target = data.people.find((x) => x.id === personId);
              for (const t of target?.transactions || []) {
                if (t.hasReceipt) await deleteReceipt(t.id);
              }
              const next = { ...data, people: data.people.filter((x) => x.id !== personId) };
              persist(next);
            }}
          />
        )}

        {!customer && !supplier && <button onClick={() => setModal({type:'quickAdd'})} className="fab-add no-print" aria-label="افزودن" style={{background:`linear-gradient(135deg, ${T.amberBright}, ${T.amberDark})`,color:T.bg}}><Plus size={24} strokeWidth={2.6}/></button>}
        {!customer && !supplier && <BottomNav tab={tab} setTab={setTab} />}

        {modal?.type === "quickAdd" && <QuickAddModal onClose={() => setModal(null)} onAction={(type) => { if(type==='customerTx') { if(data.customers[0]) setModal({type:'customerTx',customerId:data.customers[0].id,kind:'debt'}); else setModal({type:'newCustomer'}); } else if(type==='supplierTx') { if(data.suppliers[0]) setModal({type:'supplierTx',supplierId:data.suppliers[0].id,kind:'purchase'}); else setModal({type:'newSupplier'}); } else if(type==='treasuryTx') setModal({type:'treasuryTx'}); else setModal({type}); }} />}

        {modal?.type === "newCustomer" && (
          <FormModal
            title="مشتری جدید"
            onClose={() => setModal(null)}
            onSubmit={async ({ name, phone }) => {
              const next = { ...data, customers: [...data.customers, { id: uid(), name, phone, transactions: [] }] };
              await persist(next);
              setModal(null);
            }}
          />
        )}

        {modal?.type === "newSupplier" && (
          <FormModal
            title="تامین‌کننده جدید"
            onClose={() => setModal(null)}
            onSubmit={async ({ name, phone }) => {
              const next = { ...data, suppliers: [...data.suppliers, { id: uid(), name, phone, transactions: [] }] };
              await persist(next);
              setModal(null);
            }}
          />
        )}

        {modal?.type === "customerTx" && (
          <CustomerTxModal
            data={data}
            editTx={modal.editTx}
            initialLinkedInvoiceId={modal.initialLinkedInvoiceId}
            initialType={modal.initialType}
            customer={data.customers.find((x) => x.id === modal.customerId)}
            productSuggestions={getAllProductNames(data)}
            onClose={() => setModal(null)}
            onSubmit={async (tx) => {
              const next = deepClone(data);
              const c = next.customers.find((x) => x.id === modal.customerId);
              const idx = (c.transactions || []).findIndex((t) => t.id === tx.id);

              // Sync (create/update/remove) the linked supplier-side payment for a direct pass-through.
              const prevLinkedId = tx.linkedSupplierTxId;
              if (tx.directPaySupplierId) {
                const targetSupplier = next.suppliers.find((s) => s.id === tx.directPaySupplierId);
                const linkedId = prevLinkedId || uid();
                tx.linkedSupplierTxId = linkedId;
                if (targetSupplier) {
                  const linkedTx = {
                    id: linkedId,
                    type: "payment",
                    amount: tx.amount,
                    date: tx.date,
                    createdAt: tx.createdAt,
                    description: `پرداخت مستقیم توسط مشتری: ${c.name}`,
                    hasReceipt: tx.hasReceipt,
                    _receiptData: tx._receiptData,
                    receiptHash: tx.receiptHash,
                    directPayCustomerId: c.id,
                    linkedCustomerTxId: tx.id,
                  };
                  const lIdx = (targetSupplier.transactions || []).findIndex((t) => t.id === linkedId);
                  if (lIdx >= 0) targetSupplier.transactions[lIdx] = linkedTx;
                  else targetSupplier.transactions = [...(targetSupplier.transactions || []), linkedTx];
                }
              } else if (prevLinkedId) {
                // direct-pay was turned off — remove the previously-linked supplier entry
                for (const s of next.suppliers) {
                  s.transactions = (s.transactions || []).filter((t) => t.id !== prevLinkedId);
                }
                await deleteReceipt(prevLinkedId);
                tx.linkedSupplierTxId = null;
              }

              if (idx >= 0) c.transactions[idx] = tx;
              else c.transactions = [...(c.transactions || []), tx];
              await persist(next);
              if (tx.hasReceipt && tx._receiptData) {
                await saveReceipt(tx.id, tx._receiptData);
                if (tx.linkedSupplierTxId) await saveReceipt(tx.linkedSupplierTxId, tx._receiptData);
              }
              setModal(null);
            }}
          />
        )}

        {modal?.type === "supplierTx" && (
          <SupplierTxModal
            data={data}
            editTx={modal.editTx}
            supplier={data.suppliers.find((s) => s.id === modal.supplierId)}
            productSuggestions={getAllProductNames(data)}
            onClose={() => setModal(null)}
            onAddShippingCost={() =>
              setModal({ type: "treasuryTx", initial: { about: "expense", direction: "out", category: "shipping", supplierId: modal.supplierId, lockSupplier: true } })
            }
            onSubmit={async (tx) => {
              const next = deepClone(data);
              const s = next.suppliers.find((x) => x.id === modal.supplierId);
              const idx = (s.transactions || []).findIndex((t) => t.id === tx.id);

              const prevLinkedId = tx.linkedCustomerTxId;
              if (tx.directPayCustomerId) {
                const targetCustomer = next.customers.find((c) => c.id === tx.directPayCustomerId);
                const linkedId = prevLinkedId || uid();
                tx.linkedCustomerTxId = linkedId;
                if (targetCustomer) {
                  const linkedTx = {
                    id: linkedId,
                    type: "payment",
                    amount: tx.amount,
                    date: tx.date,
                    createdAt: tx.createdAt,
                    description: `پرداخت مستقیم به تامین‌کننده: ${s.name}`,
                    hasReceipt: tx.hasReceipt,
                    _receiptData: tx._receiptData,
                    receiptHash: tx.receiptHash,
                    directPaySupplierId: s.id,
                    linkedSupplierTxId: tx.id,
                  };
                  const lIdx = (targetCustomer.transactions || []).findIndex((t) => t.id === linkedId);
                  if (lIdx >= 0) targetCustomer.transactions[lIdx] = linkedTx;
                  else targetCustomer.transactions = [...(targetCustomer.transactions || []), linkedTx];
                }
              } else if (prevLinkedId) {
                for (const c of next.customers) {
                  c.transactions = (c.transactions || []).filter((t) => t.id !== prevLinkedId);
                }
                await deleteReceipt(prevLinkedId);
                tx.linkedCustomerTxId = null;
              }

              if (idx >= 0) s.transactions[idx] = tx;
              else s.transactions = [...(s.transactions || []), tx];
              await persist(next);
              if (tx.hasReceipt && tx._receiptData) {
                await saveReceipt(tx.id, tx._receiptData);
                if (tx.linkedCustomerTxId) await saveReceipt(tx.linkedCustomerTxId, tx._receiptData);
              }
              setModal(null);
            }}
          />
        )}

        {modal?.type === "newReport" && (
          <ReportModal
            onClose={() => setModal(null)}
            onSubmit={async (r) => {
              const next = { ...data, reports: [{ id: uid(), ...r }, ...data.reports] };
              await persist(next);
              setModal(null);
            }}
          />
        )}

        {modal?.type === "newCard" && (
          <CardModal
            onClose={() => setModal(null)}
            onSubmit={async (card) => {
              const next = { ...data, cards: [...data.cards, { id: uid(), ...card }] };
              await persist(next);
              setModal(null);
            }}
          />
        )}

        {modal?.type === "newStockAdjustment" && (
          <StockAdjustmentModal
            productSuggestions={getAllProductNames(data)}
            onClose={() => setModal(null)}
            onSubmit={async (adj) => {
              const next = { ...data, stockAdjustments: [...data.stockAdjustments, { id: uid(), ...adj }] };
              await persist(next);
              setModal(null);
            }}
          />
        )}

        {modal?.type === "treasuryTx" && (
          <TreasuryTxModal
            data={data}
            initial={modal.initial}
            onClose={() => setModal(null)}
            onSubmit={async (payload) => {
              const next = deepClone(data);
              if (payload.kind === "customer") {
                const c = next.customers.find((x) => x.id === payload.targetId);
                c.transactions = [...(c.transactions || []), payload.tx];
              } else if (payload.kind === "supplier") {
                const s = next.suppliers.find((x) => x.id === payload.targetId);
                s.transactions = [...(s.transactions || []), payload.tx];
              } else if (payload.kind === "person") {
                if (payload.targetId) {
                  const p = next.people.find((x) => x.id === payload.targetId);
                  p.transactions = [...(p.transactions || []), payload.tx];
                } else {
                  next.people = [...next.people, { id: uid(), name: payload.newPersonName, transactions: [payload.tx] }];
                }
              } else if (payload.kind === "expense") {
                next.expenses = [...next.expenses, payload.tx];
              }
              await persist(next);
              if (payload.tx.hasReceipt && payload.tx._receiptData) await saveReceipt(payload.tx.id, payload.tx._receiptData);
              setModal(null);
            }}
          />
        )}
      </div>
    </Screen>
  );
}

/* ---------------- Dashboard ---------------- */
function Dashboard({ data, totalReceivable, totalPayable, openModal, goTab }) {
  const totalProfit = computeProductStats(data).reduce((s, r) => s + r.profit, 0);
  const recentCustomers = [...data.customers]
    .filter((c) => (c.transactions || []).length)
    .sort((a, b) => {
      const la = a.transactions.reduce((m, t) => (sortKey(t) > m ? sortKey(t) : m), "");
      const lb = b.transactions.reduce((m, t) => (sortKey(t) > m ? sortKey(t) : m), "");
      return lb.localeCompare(la);
    })
    .slice(0, 3);

  return (
    <div className="px-4 pt-6">
      <div className="rounded-3xl px-5 py-5 relative overflow-hidden flex items-center justify-between" style={{ background: T.midnight }}>
        <div>
          <p style={{ fontFamily: "Vazirmatn", color: "rgba(255,255,255,0.5)", fontSize: "12px", fontWeight: 600, letterSpacing: "0.3px" }}>دفتر حساب</p>
          <h1 className="text-2xl font-extrabold mt-1" style={{ color: "#fff", fontFamily: "Vazirmatn" }}>خلاصه حساب</h1>
          <div className="mt-3" style={{ width: 34, height: 3, background: T.amber, borderRadius: 2 }} />
        </div>
        {totalReceivable === 0 && totalPayable === 0 && <StampBadge label="تسویه" tone="brass" />}
      </div>

      <div className="grid grid-cols-2 gap-3 mt-4">
        <div className="rounded-2xl p-4" style={{ background: T.card, border: `1px solid ${T.hairline}` }}>
          <p style={{ fontFamily: "Vazirmatn", fontSize: "11.5px", color: T.muted, fontWeight: 600 }}>طلب از مشتریان</p>
          <div className="mt-2"><Amount value={totalReceivable} tone="green" size="lg" /></div>
        </div>
        <div className="rounded-2xl p-4" style={{ background: T.card, border: `1px solid ${T.hairline}` }}>
          <p style={{ fontFamily: "Vazirmatn", fontSize: "11.5px", color: T.muted, fontWeight: 600 }}>بدهی به تامین‌کنندگان</p>
          <div className="mt-2"><Amount value={totalPayable} tone="rust" size="lg" /></div>
        </div>
      </div>

      <button
        onClick={() => goTab("inventory")}
        className="w-full rounded-2xl p-4 mt-3 flex items-center justify-between active:scale-[0.98] transition-transform"
        style={{ background: T.card, border: `1px solid ${T.hairline}` }}
      >
        <div className="text-right">
          <p style={{ fontFamily: "Vazirmatn", fontSize: "11.5px", color: T.muted, fontWeight: 600 }}>سود خالص تخمینی</p>
          <div className="mt-2"><Amount value={Math.abs(totalProfit)} tone={totalProfit >= 0 ? "green" : "rust"} size="lg" /></div>
        </div>
        <TrendingUp size={18} color={T.muted} />
      </button>

      <button onClick={() => goTab("invoices")} className="w-full rounded-2xl p-4 mt-3 flex items-center justify-between active:scale-[0.98] transition-transform" style={{ background: `linear-gradient(135deg, ${T.card2}, ${T.card})`, border: `1px solid ${T.hairline2}` }}>
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl" style={{background:T.plumBg}}><FileText size={20} color={T.plum}/></div>
          <div className="text-right"><p style={{fontFamily:"Vazirmatn",fontSize:"13px",fontWeight:800,color:T.ink}}>مدیریت فاکتورها</p><p style={{fontFamily:"Vazirmatn",fontSize:"10.5px",color:T.muted,marginTop:3}}>فاکتورهای مشتریان، تسویه‌شده و باقی‌مانده</p></div>
        </div>
        <ChevronLeft size={17} color={T.muted} style={{transform:"rotate(180deg)"}}/>
      </button>

      <div className="flex gap-3 mt-4">
        <button onClick={() => openModal({ type: "newCustomer" })} className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl active:scale-[0.98] transition-transform" style={{ background: T.card, border: `1px solid ${T.hairline}` }}>
          <Plus size={16} color={T.amberDark} />
          <span style={{ fontFamily: "Vazirmatn", fontSize: "13px", fontWeight: 700, color: T.ink }}>مشتری جدید</span>
        </button>
        <button onClick={() => openModal({ type: "newSupplier" })} className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl active:scale-[0.98] transition-transform" style={{ background: T.card, border: `1px solid ${T.hairline}` }}>
          <Plus size={16} color={T.amberDark} />
          <span style={{ fontFamily: "Vazirmatn", fontSize: "13px", fontWeight: 700, color: T.ink }}>تامین‌کننده جدید</span>
        </button>
      </div>

      <div className="flex flex-col gap-2 mt-3">
        <button onClick={() => goTab("reports")} className="w-full flex items-center justify-between px-4 py-3 rounded-xl active:scale-[0.98] transition-transform" style={{ background: T.card, border: `1px solid ${T.hairline}` }}>
          <span className="flex items-center gap-2" style={{ fontFamily: "Vazirmatn", fontSize: "13px", fontWeight: 700, color: T.ink }}>
            <FileText size={16} color={T.muted} /> گزارش‌ها و یادداشت‌های کاری
          </span>
          <ChevronLeft size={16} color={T.muted} style={{ transform: "rotate(180deg)" }} />
        </button>
        <button onClick={() => goTab("cards")} className="w-full flex items-center justify-between px-4 py-3 rounded-xl active:scale-[0.98] transition-transform" style={{ background: T.card, border: `1px solid ${T.hairline}` }}>
          <span className="flex items-center gap-2" style={{ fontFamily: "Vazirmatn", fontSize: "13px", fontWeight: 700, color: T.ink }}>
            <CreditCard size={16} color={T.muted} /> مدیریت کارت‌های بانکی
          </span>
          <ChevronLeft size={16} color={T.muted} style={{ transform: "rotate(180deg)" }} />
        </button>
        <button onClick={() => downloadBackup(data)} className="w-full flex items-center justify-between px-4 py-3 rounded-xl active:scale-[0.98] transition-transform" style={{ background: T.card, border: `1px solid ${T.hairline}` }}>
          <span className="flex items-center gap-2" style={{ fontFamily: "Vazirmatn", fontSize: "13px", fontWeight: 700, color: T.ink }}>
            <Download size={16} color={T.muted} /> پشتیبان‌گیری از اطلاعات
          </span>
          <ChevronLeft size={16} color={T.muted} style={{ transform: "rotate(180deg)" }} />
        </button>
        <button onClick={() => supabase.auth.signOut()} className="w-full flex items-center justify-between px-4 py-3 rounded-xl active:scale-[0.98] transition-transform" style={{ background: T.card, border: `1px solid ${T.hairline}` }}>
          <span className="flex items-center gap-2" style={{ fontFamily: "Vazirmatn", fontSize: "13px", fontWeight: 700, color: T.rust }}>
            <LogOut size={16} color={T.rust} /> خروج از حساب
          </span>
        </button>
      </div>

      <div className="mt-7">
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="font-bold text-sm" style={{ color: T.ink, fontFamily: "Vazirmatn" }}>آخرین فعالیت مشتریان</h2>
          <button onClick={() => goTab("customers")} style={{ color: T.amberDark, fontFamily: "Vazirmatn", fontSize: "12px", fontWeight: 700 }}>همه</button>
        </div>
        {recentCustomers.length === 0 ? (
          <Card><p style={{ fontFamily: "Vazirmatn", color: T.muted, fontSize: "13px" }} className="text-center py-2">هنوز فعالیتی ثبت نشده.</p></Card>
        ) : (
          <div className="flex flex-col gap-2">
            {recentCustomers.map((c) => {
              const bal = customerBalance(c);
              return (
                <Card key={c.id}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={c.name} size={34} />
                      <p style={{ fontFamily: "Vazirmatn", fontWeight: 700, color: T.ink, fontSize: "14px" }}>{c.name}</p>
                    </div>
                    <Amount value={Math.abs(bal)} tone={bal >= 0 ? "rust" : "green"} size="sm" />
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}


/* ---------------- Invoice Management ---------------- */
function invoiceStats(customer, invoice) {
  const payments = (customer?.transactions || []).filter((t) => t.type === 'payment' && t.linkedInvoiceId === invoice.id);
  const paid = payments.reduce((s, t) => s + Number(t.amount || 0), 0);
  const total = Number(invoice.amount || 0);
  const remaining = Math.max(total - paid, 0);
  const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
  return { payments, paid, total, remaining, pct, status: remaining <= 0 && total > 0 ? 'settled' : paid > 0 ? 'partial' : 'unpaid' };
}

function InvoiceManager({ data, openModal }) {
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [detailInvoice, setDetailInvoice] = useState(null);
  const [query, setQuery] = useState('');
  const customers = data.customers.filter(c => {
    const q = query.trim().toLowerCase();
    return !q || c.name.toLowerCase().includes(q) || (c.phone || '').includes(q);
  });
  const customer = selectedCustomer ? data.customers.find(c => c.id === selectedCustomer) : null;
  const invoices = customer ? (customer.transactions || []).filter(t => t.type === 'debt').sort((a,b) => sortKey(b).localeCompare(sortKey(a))) : [];
  const statusMeta = { settled: ['تسویه کامل', T.green, T.greenBg], partial: ['تسویه بخشی', T.amber, 'rgba(201,167,104,.12)'], unpaid: ['تسویه نشده', T.rust, T.rustBg] };

  if (customer) return (
    <div className="px-4 pt-5 pb-32">
      {detailInvoice && <InvoiceView kind="sale" partyName={customer.name} partyPhone={customer.phone} transaction={detailInvoice} allTransactions={customer.transactions} onClose={() => setDetailInvoice(null)} />}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => setSelectedCustomer(null)} className="p-2 rounded-full" style={{background:T.card,border:`1px solid ${T.hairline}`}}><ChevronLeft size={19} color={T.ink}/></button>
        <Avatar name={customer.name} size={42}/>
        <div className="min-w-0"><h1 className="text-lg font-extrabold" style={{color:T.ink,fontFamily:'Vazirmatn'}}>{customer.name}</h1><p style={{color:T.muted,fontFamily:'Vazirmatn',fontSize:11}}>{invoices.length} فاکتور</p></div>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-4">
        {[
          ['کل فاکتورها', invoices.length, T.ink],
          ['تسویه‌شده', invoices.filter(i=>invoiceStats(customer,i).status==='settled').length, T.green],
          ['باز', invoices.filter(i=>invoiceStats(customer,i).status!=='settled').length, T.rust]
        ].map(([l,v,c]) => <Card key={l} className="!p-3"><p style={{fontFamily:'Vazirmatn',fontSize:10,color:T.muted}}>{l}</p><p className="mt-1 text-lg font-extrabold" style={{color:c}}>{v}</p></Card>)}
      </div>
      {invoices.length === 0 ? <Empty icon={FileText} title="فاکتوری برای این مشتری ثبت نشده" subtitle="از بخش مشتریان یک تحویل جنس ثبت کن."/> : <div className="space-y-3">
        {invoices.map((inv, i) => {
          const st = invoiceStats(customer, inv), meta=statusMeta[st.status];
          return <Card key={inv.id} className="!p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><p className="font-extrabold text-sm" style={{color:T.ink,fontFamily:'Vazirmatn'}}>فاکتور {invoices.length-i}</p><p className="text-xs mt-1" style={{color:T.muted,fontFamily:'Vazirmatn'}}>{fmtDate(inv.date)}{inv.description ? ` — ${inv.description}` : ''}</p></div>
              <span className="px-2 py-1 rounded-full text-[10px] font-bold shrink-0" style={{background:meta[2],color:meta[1],fontFamily:'Vazirmatn'}}>{meta[0]}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-4">
              <div><p className="text-[10px]" style={{color:T.muted,fontFamily:'Vazirmatn'}}>مبلغ فاکتور</p><Amount value={st.total} size="sm"/></div>
              <div><p className="text-[10px]" style={{color:T.muted,fontFamily:'Vazirmatn'}}>تسویه شده</p><Amount value={st.paid} size="sm" tone="green"/></div>
              <div><p className="text-[10px]" style={{color:T.muted,fontFamily:'Vazirmatn'}}>باقی‌مانده</p><Amount value={st.remaining} size="sm" tone={st.remaining ? 'rust':'green'}/></div>
            </div>
            <div className="mt-4 h-2 rounded-full overflow-hidden" style={{background:T.card2}}><div className="h-full rounded-full" style={{width:`${st.pct}%`,background:st.status==='settled'?T.green:T.amber}}/></div>
            <div className="flex gap-2 mt-3">
              <button onClick={() => openModal({type:'customerTx',customerId:customer.id,kind:'payment',initialLinkedInvoiceId:inv.id,initialType:'payment'})} className="flex-1 py-2.5 rounded-xl" style={{background:T.greenBg,color:T.green,fontFamily:'Vazirmatn',fontSize:12,fontWeight:700}}>ثبت تسویه</button>
              <button onClick={() => setDetailInvoice(inv)} className="flex-1 py-2.5 rounded-xl" style={{background:T.card2,color:T.ink,fontFamily:'Vazirmatn',fontSize:12,fontWeight:700}}>جزئیات</button>
            </div>
          </Card>;
        })}
      </div>}
    </div>
  );

  return <div className="px-4 pt-5 pb-32">
    <div className="flex items-center justify-between gap-3"><div><h1 className="text-xl font-extrabold" style={{color:T.ink,fontFamily:'Vazirmatn'}}>مدیریت فاکتورها</h1><p className="text-xs mt-1" style={{color:T.muted,fontFamily:'Vazirmatn'}}>مشتری را انتخاب کن تا فاکتورهایش را ببینی.</p></div><FileText size={26} color={T.amber}/></div>
    <div className="mt-4"><SearchBar value={query} onChange={setQuery} placeholder="جستجوی مشتری..."/></div>
    <div className="mt-4 space-y-2.5">
      {customers.map(c => { const invs=(c.transactions||[]).filter(t=>t.type==='debt'); const open=invs.filter(i=>invoiceStats(c,i).status!=='settled').length; const remaining=invs.reduce((s,i)=>s+invoiceStats(c,i).remaining,0); return <Card key={c.id} onClick={()=>setSelectedCustomer(c.id)} className="!p-4"><div className="flex items-center gap-3"><Avatar name={c.name}/><div className="flex-1 min-w-0"><p className="font-bold text-sm" style={{color:T.ink,fontFamily:'Vazirmatn'}}>{c.name}</p><p className="text-[11px] mt-1" style={{color:T.muted,fontFamily:'Vazirmatn'}}>{invs.length} فاکتور · {open} باز</p></div><div className="text-left"><Amount value={remaining} tone={remaining?'rust':'green'} size="sm"/><p className="text-[10px] mt-1" style={{color:T.muted,fontFamily:'Vazirmatn'}}>باقی‌مانده</p></div></div></Card> })}
      {customers.length===0 && <Empty icon={Users} title="مشتری‌ای پیدا نشد"/>}
    </div>
  </div>;
}

function QuickAddModal({ onClose, onAction }) {
  const actions=[['customerTx','ثبت تراکنش مشتری',Users],['supplierTx','ثبت تراکنش تامین‌کننده',Truck],['treasuryTx','ثبت تراکنش صندوق',Wallet],['newCustomer','مشتری جدید',Users],['newSupplier','تامین‌کننده جدید',Truck]];
  return <Modal title="افزودن سریع" onClose={onClose}><div className="grid grid-cols-2 gap-2">{actions.map(([type,label,Icon])=><button key={type} onClick={()=>onAction(type)} className="p-4 rounded-2xl text-right" style={{background:T.card,border:`1px solid ${T.hairline}`}}><Icon size={20} color={T.amber}/><p className="mt-2 text-xs font-bold" style={{color:T.ink,fontFamily:'Vazirmatn'}}>{label}</p></button>)}</div></Modal>;
}

/* ---------------- Customers ---------------- */
function CustomerList({ data, onOpen, openModal }) {
  const [query, setQuery] = useState("");
  const filtered = data.customers.filter((c) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || (c.phone || "").includes(q);
  });
  return (
    <div className="px-4 pt-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold" style={{ color: T.ink, fontFamily: "Vazirmatn" }}>مشتریان</h1>
        <button onClick={() => openModal({ type: "newCustomer" })} className="p-2 rounded-full" style={{ background: T.amber }}>
          <Plus size={17} color={T.bg} />
        </button>
      </div>
      {data.customers.length > 0 && (
        <div className="mt-4">
          <SearchBar value={query} onChange={setQuery} placeholder="جستجوی مشتری..." />
        </div>
      )}
      <div className="mt-4 flex flex-col gap-2.5">
        {data.customers.length === 0 && <Empty icon={Users} title="هنوز مشتری‌ای ثبت نشده" subtitle="با دکمه بالا اولین مشتری را اضافه کنید." />}
        {data.customers.length > 0 && filtered.length === 0 && (
          <p className="text-center py-8" style={{ fontFamily: "Vazirmatn", color: T.muted, fontSize: "13px" }}>چیزی پیدا نشد.</p>
        )}
        {filtered.map((c) => {
          const bal = customerBalance(c);
          return (
            <Card key={c.id} onClick={() => onOpen(c.id)}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Avatar name={c.name} />
                  <div>
                    <p style={{ fontFamily: "Vazirmatn", fontWeight: 700, color: T.ink, fontSize: "15px" }}>{c.name}</p>
                    {c.phone && <p className="flex items-center gap-1 mt-0.5" style={{ fontFamily: "Vazirmatn", color: T.muted, fontSize: "12px" }}><Phone size={11} /> {c.phone}</p>}
                  </div>
                </div>
                <div className="text-left">
                  <Amount value={Math.abs(bal)} tone={bal > 0 ? "rust" : bal < 0 ? "green" : "muted"} />
                  <p style={{ fontFamily: "Vazirmatn", fontSize: "11px", color: T.muted }}>{bal > 0 ? "بدهکار به شما" : bal < 0 ? "طلبکار" : "تسویه"}</p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function CustomerDetail({ customer, data, onBack, openModal, onDeleteTx, onDeleteCustomer }) {
  const bal = customerBalance(customer);
  const totalSold = (customer.transactions || []).filter((t) => t.type === "debt").reduce((s, t) => s + Number(t.amount || 0), 0);
  const totalReceived = (customer.transactions || []).filter((t) => t.type === "payment").reduce((s, t) => s + Number(t.amount || 0), 0);
  const sorted = [...(customer.transactions || [])].sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [invoiceTx, setInvoiceTx] = useState(null);
  return (
    <div>
      {invoiceTx && (
        <InvoiceView kind="sale" partyName={customer.name} partyPhone={customer.phone} transaction={invoiceTx} allTransactions={customer.transactions} onClose={() => setInvoiceTx(null)} />
      )}
      <Header
        title={customer.name}
        onBack={onBack}
        right={
          <button onClick={() => setConfirmDelete(true)} className="p-2 rounded-full active:bg-black/5">
            <Trash2 size={18} color={T.rust} />
          </button>
        }
      />
      {confirmDelete && (
        <ConfirmDialog
          title="حذف مشتری"
          message={`مشتری «${customer.name}» و همه تراکنش‌های او برای همیشه حذف می‌شود. این کار قابل بازگشت نیست.`}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => onDeleteCustomer(customer.id)}
        />
      )}
      <div className="px-4 pt-4">
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p style={{ fontFamily: "Vazirmatn", color: T.muted, fontSize: "12px" }}>{bal > 0 ? "بدهکار به شما" : bal < 0 ? "طلبکار از شما" : "تسویه شده"}</p>
              <div className="mt-1"><Amount value={Math.abs(bal)} tone={bal > 0 ? "rust" : bal < 0 ? "green" : "muted"} size="lg" /></div>
            </div>
            {bal === 0 && <StampBadge label="تسویه" tone="green" />}
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-2.5 mt-2.5">
          <Card>
            <p style={{ fontFamily: "Vazirmatn", fontSize: "10.5px", color: T.muted }}>جمع کل فروش</p>
            <div className="mt-1"><Amount value={totalSold} size="sm" /></div>
          </Card>
          <Card>
            <p style={{ fontFamily: "Vazirmatn", fontSize: "10.5px", color: T.muted }}>جمع کل دریافتی</p>
            <div className="mt-1"><Amount value={totalReceived} size="sm" tone="green" /></div>
          </Card>
        </div>

        <div className="flex gap-2.5 mt-3">
          <button onClick={() => openModal({ type: "customerTx", customerId: customer.id, kind: "debt" })} className="flex-1 py-2.5 rounded-xl" style={{ background: T.rustBg }}>
            <span style={{ fontFamily: "Vazirmatn", fontSize: "13px", fontWeight: 700, color: T.rust }}>تحویل جنس</span>
          </button>
          <button onClick={() => openModal({ type: "customerTx", customerId: customer.id, kind: "payment" })} className="flex-1 py-2.5 rounded-xl" style={{ background: T.greenBg }}>
            <span style={{ fontFamily: "Vazirmatn", fontSize: "13px", fontWeight: 700, color: T.green }}>دریافت وجه</span>
          </button>
        </div>

        <h3 className="mt-6 mb-1 font-bold text-sm" style={{ color: T.ink, fontFamily: "Vazirmatn" }}>تراکنش‌ها</h3>
        {sorted.length === 0 ? (
          <Empty icon={Package} title="تراکنشی ثبت نشده" />
        ) : (
          <Card className="!p-4">
            {sorted.map((t, i) => (
              <div key={t.id}>
                {i > 0 && <Perforation />}
                <div className="flex items-start justify-between gap-2 py-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className="mt-0.5 p-1.5 rounded-full shrink-0" style={{ background: t.type === "debt" ? T.rustBg : T.greenBg }}>
                      {t.type === "debt" ? <ArrowUpRight size={13} color={T.rust} /> : <ArrowDownRight size={13} color={T.green} />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold" style={{ color: T.ink, fontFamily: "Vazirmatn" }}>{t.type === "debt" ? "تحویل جنس" : "دریافت وجه"}</p>
                      {t.items && t.items.length > 0 && (
                        <div className="mt-1 flex flex-col gap-0.5">
                          {t.items.map((it) => (
                            <p key={it.id} className="text-xs" style={{ color: T.muted, fontFamily: "Vazirmatn" }} dir="rtl">
                              {it.productName} — {fmt(it.quantity)} × <span dir="ltr">{fmt(it.unitPrice)}</span>
                            </p>
                          ))}
                        </div>
                      )}
                      {t.directPaySupplierId && (() => { const sp = data.suppliers.find((x) => x.id === t.directPaySupplierId); return sp ? <p className="text-xs mt-0.5" style={{ color: T.amberDark, fontFamily: "Vazirmatn" }}>{"\u2192 مستقیم به تامین\u200cکننده: " + sp.name}</p> : null; })()}
                      {t.cardId && (() => { const cd = data.cards.find((x) => x.id === t.cardId); return cd ? <p className="text-xs mt-0.5" style={{ color: T.muted, fontFamily: "Vazirmatn" }}>{"\ud83d\udcb3 " + cd.bankName}</p> : null; })()}
                      {t.receiptRef && <p className="text-xs mt-0.5" style={{ color: T.muted, fontFamily: "Vazirmatn" }} dir="ltr">{"# " + t.receiptRef}</p>}
                      {t.description && <p className="text-xs mt-0.5" style={{ color: T.muted, fontFamily: "Vazirmatn" }}>{t.description}</p>}
                      <p className="text-xs mt-1" style={{ color: T.muted, fontFamily: "Vazirmatn" }}>{fmtDate(t.date)}{t.createdAt && <span dir="ltr"> — {fmtTime(t.createdAt)}</span>}</p>
                    </div>
                  </div>
                  <div className="text-left shrink-0 flex flex-col items-end gap-1.5">
                    <Amount value={t.amount} tone={t.type === "debt" ? "rust" : "green"} size="sm" />
                    {t.hasReceipt && <ReceiptViewButton txId={t.id} />}
                    {t.receiptInfo && <ReceiptDetailsButton receiptInfo={t.receiptInfo} />}
                    {t.items && t.items.length > 0 && (
                      <button onClick={() => setInvoiceTx(t)} className="flex items-center gap-1 px-2 py-1 rounded-lg" style={{ background: T.plumBg }}>
                        <Printer size={12} color={T.plum} />
                        <span style={{ fontFamily: "Vazirmatn", fontSize: "11px", color: T.plum }}>فاکتور</span>
                      </button>
                    )}
                    <div className="flex items-center gap-2.5">
                      <button onClick={() => openModal({ type: "customerTx", customerId: customer.id, editTx: t })} className="text-[11px] flex items-center gap-0.5" style={{ color: T.amberDark, fontFamily: "Vazirmatn" }}>
                        <Pencil size={11} /> ویرایش
                      </button>
                      <button onClick={() => onDeleteTx(t.id)} className="text-[11px]" style={{ color: T.muted, fontFamily: "Vazirmatn" }}>حذف</button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}

/* ---------------- Suppliers ---------------- */
function SupplierList({ data, onOpen, openModal }) {
  const [query, setQuery] = useState("");
  const filtered = data.suppliers.filter((s) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return s.name.toLowerCase().includes(q) || (s.phone || "").includes(q);
  });
  return (
    <div className="px-4 pt-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold" style={{ color: T.ink, fontFamily: "Vazirmatn" }}>تامین‌کنندگان</h1>
        <button onClick={() => openModal({ type: "newSupplier" })} className="p-2 rounded-full" style={{ background: T.amber }}>
          <Plus size={17} color={T.bg} />
        </button>
      </div>
      {data.suppliers.length > 0 && (
        <div className="mt-4">
          <SearchBar value={query} onChange={setQuery} placeholder="جستجوی تامین‌کننده..." />
        </div>
      )}
      <div className="mt-4 flex flex-col gap-2.5">
        {data.suppliers.length === 0 && <Empty icon={Truck} title="هنوز تامین‌کننده‌ای ثبت نشده" subtitle="با دکمه بالا اولین تامین‌کننده را اضافه کنید." />}
        {data.suppliers.length > 0 && filtered.length === 0 && (
          <p className="text-center py-8" style={{ fontFamily: "Vazirmatn", color: T.muted, fontSize: "13px" }}>چیزی پیدا نشد.</p>
        )}
        {filtered.map((s) => {
          const bal = supplierBalance(s);
          return (
            <Card key={s.id} onClick={() => onOpen(s.id)}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Avatar name={s.name} />
                  <div>
                    <p style={{ fontFamily: "Vazirmatn", fontWeight: 700, color: T.ink, fontSize: "15px" }}>{s.name}</p>
                    {s.phone && <p className="flex items-center gap-1 mt-0.5" style={{ fontFamily: "Vazirmatn", color: T.muted, fontSize: "12px" }}><Phone size={11} /> {s.phone}</p>}
                  </div>
                </div>
                <div className="text-left">
                  <Amount value={Math.abs(bal)} tone={bal > 0 ? "rust" : bal < 0 ? "green" : "muted"} />
                  <p style={{ fontFamily: "Vazirmatn", fontSize: "11px", color: T.muted }}>{bal > 0 ? "بدهکار شما" : bal < 0 ? "طلبکار شما" : "تسویه"}</p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function SupplierDetail({ supplier, expenses, data, onBack, openModal, onDeleteTx, onDeleteExpense, onDeleteSupplier }) {
  const bal = supplierBalance(supplier);
  const totalPurchased = (supplier.transactions || []).filter((t) => t.type === "purchase").reduce((s, t) => s + Number(t.amount || 0), 0);
  const totalPaid = (supplier.transactions || []).filter((t) => t.type === "payment").reduce((s, t) => s + Number(t.amount || 0), 0);
  const sorted = [...(supplier.transactions || [])].sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
  const purchases = (supplier.transactions || []).filter((t) => t.type === "purchase");
  const supplierCosts = [...(expenses || [])]
    .filter((e) => e.category === "shipping" && e.relatedSupplierId === supplier.id)
    .sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
  const typeLabel = { purchase: "خرید کالا", payment: "پرداخت" };
  const typeTone = { purchase: T.rust, payment: T.green };
  const typeBg = { purchase: T.rustBg, payment: T.greenBg };
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [invoiceTx, setInvoiceTx] = useState(null);

  return (
    <div>
      {invoiceTx && (
        <InvoiceView kind="purchase" partyName={supplier.name} partyPhone={supplier.phone} transaction={invoiceTx} allTransactions={supplier.transactions} onClose={() => setInvoiceTx(null)} />
      )}
      <Header
        title={supplier.name}
        onBack={onBack}
        right={
          <button onClick={() => setConfirmDelete(true)} className="p-2 rounded-full active:bg-black/5">
            <Trash2 size={18} color={T.rust} />
          </button>
        }
      />
      {confirmDelete && (
        <ConfirmDialog
          title="حذف تامین‌کننده"
          message={`تامین‌کننده «${supplier.name}» و همه تراکنش‌های او برای همیشه حذف می‌شود. این کار قابل بازگشت نیست.`}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => onDeleteSupplier(supplier.id)}
        />
      )}
      <div className="px-4 pt-4">
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p style={{ fontFamily: "Vazirmatn", color: T.muted, fontSize: "12px" }}>{bal > 0 ? "بدهکار شما" : bal < 0 ? "طلبکار شما" : "تسویه شده"}</p>
              <div className="mt-1"><Amount value={Math.abs(bal)} tone={bal > 0 ? "rust" : bal < 0 ? "green" : "muted"} size="lg" /></div>
            </div>
            {bal === 0 && <StampBadge label="تسویه" tone="green" />}
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-2.5 mt-2.5">
          <Card>
            <p style={{ fontFamily: "Vazirmatn", fontSize: "10.5px", color: T.muted }}>جمع کل خرید</p>
            <div className="mt-1"><Amount value={totalPurchased} size="sm" /></div>
          </Card>
          <Card>
            <p style={{ fontFamily: "Vazirmatn", fontSize: "10.5px", color: T.muted }}>جمع کل پرداختی</p>
            <div className="mt-1"><Amount value={totalPaid} size="sm" tone="green" /></div>
          </Card>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-3">
          <button onClick={() => openModal({ type: "supplierTx", supplierId: supplier.id, kind: "purchase" })} className="py-2.5 rounded-xl" style={{ background: T.rustBg }}>
            <span style={{ fontFamily: "Vazirmatn", fontSize: "13px", fontWeight: 700, color: T.rust }}>خرید کالا</span>
          </button>
          <button onClick={() => openModal({ type: "supplierTx", supplierId: supplier.id, kind: "payment" })} className="py-2.5 rounded-xl" style={{ background: T.greenBg }}>
            <span style={{ fontFamily: "Vazirmatn", fontSize: "13px", fontWeight: 700, color: T.green }}>پرداخت</span>
          </button>
        </div>

        <button
          onClick={() =>
            openModal({ type: "treasuryTx", initial: { about: "expense", direction: "out", category: "shipping", supplierId: supplier.id, lockSupplier: true } })
          }
          className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl mt-2"
          style={{ background: "rgba(201,167,104,0.12)" }}
        >
          <span style={{ fontFamily: "Vazirmatn", fontSize: "12.5px", fontWeight: 700, color: T.amberDark }}>+ هزینه حمل یا جانبی (بر عهده خودتان، نه تامین‌کننده)</span>
          <ChevronLeft size={15} color={T.amberDark} style={{ transform: "rotate(180deg)" }} />
        </button>

        {purchases.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-2 font-bold text-sm" style={{ color: T.ink, fontFamily: "Vazirmatn" }}>هزینه تمام‌شده خریدها</h3>
            <div className="flex flex-col gap-2">
              {purchases.map((p) => {
                const landing = purchaseLanding(p, expenses);
                return (
                  <Card key={p.id}>
                    <div className="flex items-center justify-between mb-1">
                      <p style={{ fontFamily: "Vazirmatn", fontSize: "13px", fontWeight: 700, color: T.ink }}>{p.description || "خرید"}</p>
                      <span style={{ fontFamily: "Vazirmatn", fontSize: "11px", color: T.muted }}>{fmtDate(p.date)}</span>
                    </div>
                    {landing.items.map((it, i) => (
                      <div key={it.id}>
                        {i > 0 && <Perforation />}
                        <div className="flex items-center justify-between py-2">
                          <div>
                            <p style={{ fontFamily: "Vazirmatn", fontSize: "12.5px", fontWeight: 600, color: T.ink }}>{it.productName}</p>
                            <p style={{ fontFamily: "Vazirmatn", fontSize: "10.5px", color: T.muted }} dir="ltr">
                              خرید {fmt(it.unitPrice)} {it.shippingShare > 0 ? `+ حمل ${fmt(it.shippingShare / it.quantity)}` : ""}
                            </p>
                          </div>
                          <div className="text-left">
                            <p style={{ fontFamily: "Vazirmatn", fontSize: "10px", color: T.muted }}>هزینه تمام‌شده هر واحد</p>
                            <Amount value={it.landedUnit} size="sm" tone="rust" />
                          </div>
                        </div>
                      </div>
                    ))}
                    <div style={{ height: 1, background: T.hairline }} className="my-1" />
                    <div className="flex items-center justify-between pt-2">
                      <span style={{ fontFamily: "Vazirmatn", fontSize: "11px", color: T.muted }}>خرید {fmt(landing.subtotal)} + حمل {fmt(landing.shippingTotal)}</span>
                      <Amount value={landing.grandTotal} size="sm" />
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {supplierCosts.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-2 font-bold text-sm" style={{ color: T.ink, fontFamily: "Vazirmatn" }}>هزینه‌های حمل و جانبی (بر عهده شما)</h3>
            <Card className="!p-4">
              {supplierCosts.map((e, i) => {
                const relatedPurchase = purchases.find((p) => p.id === e.relatedPurchaseId);
                return (
                  <div key={e.id}>
                    {i > 0 && <Perforation />}
                    <div className="flex items-start justify-between gap-2 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold" style={{ color: T.ink, fontFamily: "Vazirmatn" }}>{e.description || "هزینه حمل"}</p>
                        {relatedPurchase && (
                          <p className="text-xs mt-0.5" style={{ color: T.muted, fontFamily: "Vazirmatn" }}>مرتبط با: {relatedPurchase.description || "خرید"} — {fmtDate(relatedPurchase.date)}</p>
                        )}
                        <p className="text-xs mt-1" style={{ color: T.muted, fontFamily: "Vazirmatn" }}>{fmtDate(e.date)}</p>
                      </div>
                      <div className="text-left shrink-0 flex flex-col items-end gap-1.5">
                        <Amount value={e.amount} tone="rust" size="sm" />
                        {e.hasReceipt && <ReceiptViewButton txId={e.id} />}
                        <button onClick={() => onDeleteExpense(e.id)} className="text-[11px]" style={{ color: T.muted, fontFamily: "Vazirmatn" }}>حذف</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </Card>
          </div>
        )}

        <h3 className="mt-6 mb-1 font-bold text-sm" style={{ color: T.ink, fontFamily: "Vazirmatn" }}>تراکنش‌ها</h3>
        {sorted.length === 0 ? (
          <Empty icon={Package} title="تراکنشی ثبت نشده" />
        ) : (
          <Card className="!p-4">
            {sorted.map((t, i) => (
              <div key={t.id}>
                {i > 0 && <Perforation />}
                <div className="flex items-start justify-between gap-2 py-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className="mt-0.5 p-1.5 rounded-full shrink-0" style={{ background: typeBg[t.type] }}>
                      {t.type === "payment" ? <ArrowDownRight size={13} color={T.green} /> : <ArrowUpRight size={13} color={typeTone[t.type]} />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold" style={{ color: T.ink, fontFamily: "Vazirmatn" }}>{typeLabel[t.type]}</p>
                      {t.items && t.items.length > 0 && (
                        <div className="mt-1 flex flex-col gap-0.5">
                          {t.items.map((it) => (
                            <p key={it.id} className="text-xs" style={{ color: T.muted, fontFamily: "Vazirmatn" }} dir="rtl">
                              {it.productName} — {fmt(it.quantity)} × <span dir="ltr">{fmt(it.unitPrice)}</span>
                            </p>
                          ))}
                        </div>
                      )}
                      {t.directPayCustomerId && (() => { const cu = data.customers.find((x) => x.id === t.directPayCustomerId); return cu ? <p className="text-xs mt-0.5" style={{ color: T.amberDark, fontFamily: "Vazirmatn" }}>{"\u2192 مستقیم توسط مشتری: " + cu.name}</p> : null; })()}
                      {t.cardId && (() => { const cd = data.cards.find((x) => x.id === t.cardId); return cd ? <p className="text-xs mt-0.5" style={{ color: T.muted, fontFamily: "Vazirmatn" }}>{"\ud83d\udcb3 " + cd.bankName}</p> : null; })()}
                      {t.receiptRef && <p className="text-xs mt-0.5" style={{ color: T.muted, fontFamily: "Vazirmatn" }} dir="ltr">{"# " + t.receiptRef}</p>}
                      {t.description && <p className="text-xs mt-0.5" style={{ color: T.muted, fontFamily: "Vazirmatn" }}>{t.description}</p>}
                      <p className="text-xs mt-1" style={{ color: T.muted, fontFamily: "Vazirmatn" }}>{fmtDate(t.date)}{t.createdAt && <span dir="ltr"> — {fmtTime(t.createdAt)}</span>}</p>
                    </div>
                  </div>
                  <div className="text-left shrink-0 flex flex-col items-end gap-1.5">
                    <Amount value={t.amount} tone={t.type === "payment" ? "green" : "rust"} size="sm" />
                    {t.hasReceipt && <ReceiptViewButton txId={t.id} />}
                    {t.receiptInfo && <ReceiptDetailsButton receiptInfo={t.receiptInfo} />}
                    {t.items && t.items.length > 0 && (
                      <button onClick={() => setInvoiceTx(t)} className="flex items-center gap-1 px-2 py-1 rounded-lg" style={{ background: T.plumBg }}>
                        <Printer size={12} color={T.plum} />
                        <span style={{ fontFamily: "Vazirmatn", fontSize: "11px", color: T.plum }}>فاکتور</span>
                      </button>
                    )}
                    <div className="flex items-center gap-2.5">
                      <button onClick={() => openModal({ type: "supplierTx", supplierId: supplier.id, editTx: t })} className="text-[11px] flex items-center gap-0.5" style={{ color: T.amberDark, fontFamily: "Vazirmatn" }}>
                        <Pencil size={11} /> ویرایش
                      </button>
                      <button onClick={() => onDeleteTx(t.id)} className="text-[11px]" style={{ color: T.muted, fontFamily: "Vazirmatn" }}>حذف</button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}

/* ---------------- Reports ---------------- */
function Reports({ data, openModal, persist, goTab }) {
  const del = async (id) => {
    const next = { ...data, reports: data.reports.filter((r) => r.id !== id) };
    persist(next);
  };
  return (
    <div>
      <Header title="گزارش‌ها" onBack={() => goTab("dashboard")} right={
        <button onClick={() => openModal({ type: "newReport" })} className="p-2 rounded-full" style={{ background: T.amber }}>
          <Plus size={17} color={T.bg} />
        </button>
      } />
      <div className="px-4 pt-4 flex flex-col gap-2.5">
        {data.reports.length === 0 && <Empty icon={FileText} title="گزارشی ثبت نشده" subtitle="یادداشت‌ها و گزارش‌های کاری‌تان را اینجا بنویسید." />}
        {data.reports.map((r) => (
          <Card key={r.id}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p style={{ fontFamily: "Vazirmatn", fontWeight: 700, color: T.ink, fontSize: "14px" }}>{r.title}</p>
                <p style={{ fontFamily: "Vazirmatn", color: T.muted, fontSize: "11px" }} className="mt-0.5">{fmtDate(r.date)}</p>
                <p style={{ fontFamily: "Vazirmatn", color: T.ink, fontSize: "13px" }} className="mt-2 whitespace-pre-wrap">{r.content}</p>
              </div>
              <button onClick={() => del(r.id)} className="shrink-0"><Trash2 size={15} color={T.muted} /></button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Cards (bank card management) ---------------- */
function maskCardNumber(num) {
  const digits = (num || "").replace(/\s/g, "");
  if (digits.length <= 4) return digits;
  return digits.slice(0, 4) + " •••• •••• " + digits.slice(-4);
}
function formatCardNumber(num) {
  const digits = (num || "").replace(/\s/g, "");
  return digits.replace(/(.{4})/g, "$1 ").trim();
}

function CardRow({ card, onDelete }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText((card.cardNumber || "").replace(/\s/g, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  return (
    <Card>
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p style={{ fontFamily: "Vazirmatn", fontWeight: 700, color: T.ink, fontSize: "14px" }}>{card.bankName}</p>
          {card.holderName && <p style={{ fontFamily: "Vazirmatn", color: T.muted, fontSize: "11.5px" }} className="mt-0.5">{card.holderName}</p>}
        </div>
        <button onClick={() => onDelete(card.id)} className="shrink-0"><Trash2 size={15} color={T.muted} /></button>
      </div>
      <div className="flex items-center justify-between mt-3">
        <p onClick={() => setRevealed((v) => !v)} dir="ltr" style={{ fontFamily: "'JetBrains Mono', monospace", color: T.ink, fontSize: "15px", letterSpacing: "0.5px", cursor: "pointer" }}>
          {revealed ? formatCardNumber(card.cardNumber) : maskCardNumber(card.cardNumber)}
        </p>
        <button onClick={copy} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg shrink-0" style={{ background: T.bg }}>
          {copied ? <Check size={13} color={T.green} /> : <Copy size={13} color={T.muted} />}
          <span style={{ fontFamily: "Vazirmatn", fontSize: "11px", color: copied ? T.green : T.muted }}>{copied ? "کپی شد" : "کپی"}</span>
        </button>
      </div>
      {card.iban && <p className="mt-2" dir="ltr" style={{ fontFamily: "'JetBrains Mono', monospace", color: T.muted, fontSize: "11.5px" }}>{card.iban}</p>}
      {card.note && <p className="mt-2" style={{ fontFamily: "Vazirmatn", color: T.muted, fontSize: "12px" }}>{card.note}</p>}
    </Card>
  );
}

function Cards({ data, openModal, goTab, onDeleteCard }) {
  return (
    <div>
      <Header
        title="مدیریت کارت‌های بانکی"
        onBack={() => goTab("dashboard")}
        right={
          <button onClick={() => openModal({ type: "newCard" })} className="p-2 rounded-full" style={{ background: T.amber }}>
            <Plus size={17} color={T.bg} />
          </button>
        }
      />
      <div className="px-4 pt-4 flex flex-col gap-2.5">
        {data.cards.length === 0 && <Empty icon={CreditCard} title="کارتی ثبت نشده" subtitle="شماره کارت‌های بانکی خودتان را برای دسترسی سریع اینجا ذخیره کنید." />}
        {data.cards.map((card) => (
          <CardRow key={card.id} card={card} onDelete={onDeleteCard} />
        ))}
      </div>
    </div>
  );
}

/* ---------------- Inventory ---------------- */
function Inventory({ data, openModal, onDeleteStockAdjustment }) {
  const stats = computeProductStats(data);
  const totalProfit = stats.reduce((s, r) => s + r.profit, 0);
  const stockValue = stats.reduce((s, r) => s + Math.max(r.stock, 0) * r.avgCost, 0);
  const adjustments = [...(data.stockAdjustments || [])].sort((a, b) => sortKey(b).localeCompare(sortKey(a)));

  return (
    <div className="px-4 pt-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold" style={{ color: T.ink, fontFamily: "Vazirmatn" }}>انبار و سود</h1>
        <button onClick={() => openModal({ type: "newStockAdjustment" })} className="p-2 rounded-full" style={{ background: T.amber }}>
          <Plus size={17} color={T.bg} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 mt-5">
        <div className="rounded-2xl p-4" style={{ background: totalProfit >= 0 ? T.greenBg : T.rustBg }}>
          <p style={{ fontFamily: "Vazirmatn", fontSize: "12px", color: totalProfit >= 0 ? T.green : T.rust, fontWeight: 600 }}>سود خالص کل</p>
          <div className="mt-2"><Amount value={Math.abs(totalProfit)} tone={totalProfit >= 0 ? "green" : "rust"} size="lg" /></div>
        </div>
        <div className="rounded-2xl p-4" style={{ background: T.card2 }}>
          <p style={{ fontFamily: "Vazirmatn", fontSize: "12px", color: T.muted, fontWeight: 600 }}>ارزش انبار موجود</p>
          <div className="mt-2"><Amount value={stockValue} size="lg" /></div>
        </div>
      </div>

      <button
        onClick={() => openModal({ type: "newStockAdjustment" })}
        className="w-full flex items-center justify-between px-4 py-3 rounded-xl mt-3 active:scale-[0.98] transition-transform"
        style={{ background: T.card, border: `1px solid ${T.hairline}` }}
      >
        <span className="flex items-center gap-2" style={{ fontFamily: "Vazirmatn", fontSize: "13px", fontWeight: 700, color: T.ink }}>
          <Package size={16} color={T.amberDark} /> افزودن موجودی دستی (کالاهایی که از قبل داشتید)
        </span>
        <ChevronLeft size={16} color={T.muted} style={{ transform: "rotate(180deg)" }} />
      </button>

      <h3 className="mt-6 mb-2 font-bold text-sm" style={{ color: T.ink, fontFamily: "Vazirmatn" }}>کالاها</h3>
      {stats.length === 0 ? (
        <Empty icon={Package} title="هنوز کالایی ثبت نشده" subtitle="با ثبت خرید از تامین‌کننده یا فروش به مشتری، کالاها اینجا نمایش داده می‌شوند." />
      ) : (
        <div className="flex flex-col gap-2.5">
          {stats.map((r) => (
            <Card key={r.productName}>
              <div className="flex items-center justify-between">
                <p style={{ fontFamily: "Vazirmatn", fontWeight: 700, color: T.ink, fontSize: "14px" }}>{r.productName}</p>
                {r.stock < 0 && (
                  <span style={{ fontFamily: "Vazirmatn", fontSize: "10.5px", color: T.rust }}>⚠ موجودی منفی</span>
                )}
              </div>
              <div className="grid grid-cols-4 gap-2 mt-2.5 text-center">
                <div>
                  <p style={{ fontFamily: "Vazirmatn", fontSize: "10px", color: T.muted }}>موجودی</p>
                  <Amount value={r.stock} size="sm" tone={r.stock < 0 ? "rust" : "ink"} />
                </div>
                <div>
                  <p style={{ fontFamily: "Vazirmatn", fontSize: "10px", color: T.muted }}>تمام‌شده هر واحد</p>
                  <Amount value={r.avgCost} size="sm" tone="muted" />
                </div>
                <div>
                  <p style={{ fontFamily: "Vazirmatn", fontSize: "10px", color: T.muted }}>فروش رفته</p>
                  <Amount value={r.soldQty} size="sm" tone="muted" />
                </div>
                <div>
                  <p style={{ fontFamily: "Vazirmatn", fontSize: "10px", color: T.muted }}>سود</p>
                  <Amount value={r.profit} size="sm" tone={r.profit >= 0 ? "green" : "rust"} />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {adjustments.length > 0 && (
        <>
          <h3 className="mt-6 mb-2 font-bold text-sm" style={{ color: T.ink, fontFamily: "Vazirmatn" }}>موجودی‌های دستی ثبت‌شده</h3>
          <Card className="!p-4">
            {adjustments.map((a, i) => (
              <div key={a.id}>
                {i > 0 && <Perforation />}
                <div className="flex items-start justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold" style={{ color: T.ink, fontFamily: "Vazirmatn" }}>{a.productName}</p>
                    <p className="text-xs mt-0.5" style={{ color: T.muted, fontFamily: "Vazirmatn" }} dir="rtl">
                      {fmt(a.quantity)} واحد — قیمت تمام‌شده هر واحد: <span dir="ltr">{fmt(a.unitCost)}</span>
                    </p>
                    {a.note && <p className="text-xs mt-0.5" style={{ color: T.muted, fontFamily: "Vazirmatn" }}>{a.note}</p>}
                    <p className="text-xs mt-1" style={{ color: T.muted, fontFamily: "Vazirmatn" }}>{fmtDate(a.date)}{a.createdAt && <span dir="ltr"> — {fmtTime(a.createdAt)}</span>}</p>
                  </div>
                  <button onClick={() => onDeleteStockAdjustment(a.id)} className="text-[11px] shrink-0" style={{ color: T.muted, fontFamily: "Vazirmatn" }}>حذف</button>
                </div>
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}

/* ---------------- Treasury (صندوق) ---------------- */
const TREASURY_KIND_LABEL = { customer: "دریافتی از مشتری", supplier: "پرداخت به تامین‌کننده", person: "شریک/شخص", expense: "هزینه" };

function Treasury({ data, openModal, onDeleteFeed, onDeletePerson }) {
  const [confirmDeletePerson, setConfirmDeletePerson] = useState(null);
  const feed = [];
  (data.customers || []).forEach((c) =>
    (c.transactions || []).filter((t) => t.type === "payment").forEach((t) => feed.push({ ...t, direction: "in", kind: "customer", name: c.name }))
  );
  (data.suppliers || []).forEach((s) =>
    (s.transactions || []).filter((t) => t.type === "payment").forEach((t) => feed.push({ ...t, direction: "out", kind: "supplier", name: s.name }))
  );
  (data.people || []).forEach((p) =>
    (p.transactions || []).forEach((t) => feed.push({ ...t, direction: t.type, kind: "person", name: p.name, personId: p.id }))
  );
  (data.expenses || []).forEach((e) => {
    const relatedSupplier = e.relatedSupplierId ? (data.suppliers || []).find((s) => s.id === e.relatedSupplierId) : null;
    feed.push({
      ...e,
      direction: "out",
      kind: "expense",
      name: EXPENSE_CATEGORY_LABEL[e.category] || "هزینه",
      subtext: relatedSupplier ? `مرتبط با تامین‌کننده: ${relatedSupplier.name}` : null,
    });
  });
  feed.sort((a, b) => sortKey(b).localeCompare(sortKey(a)));

  return (
    <div className="px-4 pt-5">
      {confirmDeletePerson && (
        <ConfirmDialog
          title="حذف شخص"
          message={`«${confirmDeletePerson.name}» و همه تراکنش‌های او برای همیشه حذف می‌شود. این کار قابل بازگشت نیست.`}
          onCancel={() => setConfirmDeletePerson(null)}
          onConfirm={() => {
            onDeletePerson(confirmDeletePerson.id);
            setConfirmDeletePerson(null);
          }}
        />
      )}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold" style={{ color: T.ink, fontFamily: "Vazirmatn" }}>صندوق</h1>
        <button onClick={() => openModal({ type: "treasuryTx" })} className="p-2 rounded-full" style={{ background: T.amber }}>
          <Plus size={17} color={T.bg} />
        </button>
      </div>

      {data.people.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 font-bold text-sm" style={{ color: T.ink, fontFamily: "Vazirmatn" }}>اشخاص و شرکا</h3>
          <div className="flex flex-col gap-2">
            {data.people.map((p) => {
              const bal = personBalance(p);
              return (
                <Card key={p.id}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={p.name} size={32} />
                      <p style={{ fontFamily: "Vazirmatn", fontWeight: 700, color: T.ink, fontSize: "14px" }}>{p.name}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-left">
                        <Amount value={Math.abs(bal)} tone={bal > 0 ? "rust" : bal < 0 ? "green" : "muted"} size="sm" />
                        <p style={{ fontFamily: "Vazirmatn", fontSize: "10px", color: T.muted }}>{bal > 0 ? "بدهکار شما" : bal < 0 ? "طلبکار شما" : "تسویه"}</p>
                      </div>
                      <button onClick={() => setConfirmDeletePerson(p)} className="shrink-0">
                        <Trash2 size={15} color={T.muted} />
                      </button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      <h3 className="mt-6 mb-2 font-bold text-sm" style={{ color: T.ink, fontFamily: "Vazirmatn" }}>تراکنش‌های صندوق</h3>
      {feed.length === 0 ? (
        <Empty icon={Wallet} title="هنوز تراکنشی ثبت نشده" subtitle="واریزی‌ها و پرداخت‌های عمومی را اینجا ثبت کنید." />
      ) : (
        <Card className="!p-4">
          {feed.map((t, i) => (
            <div key={t.id}>
              {i > 0 && <Perforation />}
              <div className="flex items-start justify-between gap-2 py-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className="mt-0.5 p-1.5 rounded-full shrink-0" style={{ background: t.direction === "in" ? T.greenBg : T.rustBg }}>
                    {t.direction === "in" ? <ArrowDownRight size={13} color={T.green} /> : <ArrowUpRight size={13} color={T.rust} />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold" style={{ color: T.ink, fontFamily: "Vazirmatn" }}>{t.name}</p>
                    <p className="text-xs mt-0.5" style={{ color: T.muted, fontFamily: "Vazirmatn" }}>{TREASURY_KIND_LABEL[t.kind]}</p>
                    {t.subtext && <p className="text-xs mt-0.5" style={{ color: T.amberDark, fontFamily: "Vazirmatn" }}>{t.subtext}</p>}
                    {t.description && <p className="text-xs mt-0.5" style={{ color: T.muted, fontFamily: "Vazirmatn" }}>{t.description}</p>}
                    <p className="text-xs mt-1" style={{ color: T.muted, fontFamily: "Vazirmatn" }}>{fmtDate(t.date)}{t.createdAt && <span dir="ltr"> — {fmtTime(t.createdAt)}</span>}</p>
                  </div>
                </div>
                <div className="text-left shrink-0 flex flex-col items-end gap-1.5">
                  <Amount value={t.amount} tone={t.direction === "in" ? "green" : "rust"} size="sm" />
                  {t.hasReceipt && <ReceiptViewButton txId={t.id} />}
                    {t.receiptInfo && <ReceiptDetailsButton receiptInfo={t.receiptInfo} />}
                  {(t.kind === "person" || t.kind === "expense") && (
                    <button onClick={() => onDeleteFeed(t)} className="text-[11px]" style={{ color: T.muted, fontFamily: "Vazirmatn" }}>حذف</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
function LineItemsEditor({ items, setItems, suggestions, priceLabel, qtyLabel = "تعداد" }) {
  const [mode, setMode] = useState(suggestions.length ? "pick" : "new");
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");

  const add = () => {
    if (!name.trim() || !qty || !price) return;
    setItems([...items, { id: uid(), productName: name.trim(), quantity: Number(qty), unitPrice: Number(price) }]);
    setName("");
    setQty("");
    setPrice("");
    if (suggestions.length) setMode("pick");
  };
  const remove = (id) => setItems(items.filter((it) => it.id !== id));
  const total = items.reduce((s, it) => s + itemSubtotal(it), 0);

  return (
    <div>
      {items.length > 0 && (
        <div className="mb-3 rounded-xl overflow-hidden" style={{ border: `1px solid ${T.hairline}` }}>
          {items.map((it, i) => (
            <div key={it.id}>
              {i > 0 && <div style={{ height: 1, background: T.hairline }} />}
              <div className="flex items-center justify-between px-3 py-2.5" style={{ background: "#fff" }}>
                <div className="min-w-0">
                  <p style={{ fontFamily: "Vazirmatn", fontSize: "13px", fontWeight: 700, color: T.ink }}>{it.productName}</p>
                  <p style={{ fontFamily: "Vazirmatn", fontSize: "11px", color: T.muted }} dir="ltr">
                    {fmt(it.quantity)} × {fmt(it.unitPrice)} = {fmt(itemSubtotal(it))}
                  </p>
                </div>
                <button onClick={() => remove(it.id)} className="shrink-0 p-1">
                  <Trash2 size={14} color={T.muted} />
                </button>
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between px-3 py-2" style={{ background: T.bg }}>
            <span style={{ fontFamily: "Vazirmatn", fontSize: "12px", fontWeight: 700, color: T.ink }}>جمع کل</span>
            <Amount value={total} size="sm" />
          </div>
        </div>
      )}

      <div className="rounded-xl p-3" style={{ background: "#fff", border: `1px dashed ${T.hairline}` }}>
        {mode === "pick" ? (
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ WebkitOverflowScrolling: "touch" }}>
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => setName(s)}
                className="shrink-0 px-3.5 py-2 rounded-full whitespace-nowrap"
                style={{
                  background: name === s ? T.amber : T.bg,
                  border: `1px solid ${name === s ? T.amber : T.hairline}`,
                  fontFamily: "Vazirmatn",
                  fontSize: "12.5px",
                  fontWeight: 700,
                  color: name === s ? T.bg : T.ink,
                }}
              >
                {s}
              </button>
            ))}
            <button
              onClick={() => {
                setMode("new");
                setName("");
              }}
              className="shrink-0 px-3.5 py-2 rounded-full whitespace-nowrap flex items-center gap-1"
              style={{ background: T.bg, border: `1px dashed ${T.hairline}`, fontFamily: "Vazirmatn", fontSize: "12.5px", fontWeight: 700, color: T.amberDark }}
            >
              <Plus size={13} /> کالای جدید
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="نام کالای جدید" />
            {suggestions.length > 0 && (
              <button onClick={() => setMode("pick")} className="shrink-0 px-3 py-2.5 rounded-xl" style={{ background: T.bg, border: `1px solid ${T.hairline}` }}>
                <span style={{ fontFamily: "Vazirmatn", fontSize: "12px", color: T.muted }}>لیست</span>
              </button>
            )}
          </div>
        )}

        <div className="flex gap-2 mt-2">
          <AmountInput value={qty} onChange={setQty} placeholder={qtyLabel} />
          <AmountInput value={price} onChange={setPrice} placeholder={priceLabel} />
        </div>
        <button
          onClick={add}
          disabled={!name.trim() || !qty || !price}
          className="w-full mt-2 py-2 rounded-lg flex items-center justify-center gap-1"
          style={{ background: name.trim() && qty && price ? T.amber : T.card2, color: name.trim() && qty && price ? T.bg : T.muted }}
        >
          <Plus size={15} />
          <span style={{ fontFamily: "Vazirmatn", fontSize: "13px", fontWeight: 700 }}>افزودن کالا</span>
        </button>
      </div>
    </div>
  );
}

/* ---------------- Modals / Forms ---------------- */
function FormModal({ title, onClose, onSubmit }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    await onSubmit({ name: name.trim(), phone: phone.trim() });
  };
  return (
    <Modal title={title} onClose={onClose}>
      <Field label="نام">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً: علی رضایی" />
      </Field>
      <Field label="شماره تماس (اختیاری)">
        <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="09xxxxxxxxx" dir="ltr" />
      </Field>
      <PrimaryButton disabled={!name.trim() || busy} onClick={submit}>
        {busy ? "در حال ذخیره..." : "ذخیره"}
      </PrimaryButton>
    </Modal>
  );
}

function CustomerTxModal({ onClose, onSubmit, productSuggestions, data, editTx, customer, initialLinkedInvoiceId, initialType }) {
  const [type, setType] = useState(editTx?.type || initialType || "debt");
  const [amount, setAmount] = useState(editTx && editTx.type === "payment" ? String(editTx.amount) : "");
  const [items, setItems] = useState(editTx?.items || []);
  const [date, setDate] = useState(editTx?.date || todayISO());
  const [description, setDescription] = useState(editTx?.description || "");
  const [receipt, setReceipt] = useState(null);
  const [receiptHash, setReceiptHash] = useState(editTx?.receiptHash || null);
  const [receiptRef, setReceiptRef] = useState(editTx?.receiptRef || "");
  const [duplicateBlocked, setDuplicateBlocked] = useState(false);
  const [receiptDestCard, setReceiptDestCard] = useState(editTx?.receiptDestCard || null);
  const [receiptInfo, setReceiptInfo] = useState(editTx?.receiptInfo || null);
  const [loadingReceipt, setLoadingReceipt] = useState(!!editTx?.hasReceipt);
  const [destination, setDestination] = useState(editTx?.directPaySupplierId ? "supplier" : "self");
  const [directSupplierId, setDirectSupplierId] = useState(editTx?.directPaySupplierId || "");
  const [cardId, setCardId] = useState(editTx?.cardId || "");
  const [linkedInvoiceId, setLinkedInvoiceId] = useState(editTx?.linkedInvoiceId || initialLinkedInvoiceId || "");
  const invoices = (customer?.transactions || []).filter((t) => t.type === "debt");

  useEffect(() => {
    if (editTx?.hasReceipt) {
      loadReceipt(editTx.id).then((url) => {
        setReceipt(url);
        setLoadingReceipt(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = items.reduce((s, it) => s + itemSubtotal(it), 0);
  const canSubmit = (type === "debt" ? items.length > 0 : !!amount && (destination === "self" || !!directSupplierId)) && !duplicateBlocked;
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    const tx = {
      id: editTx?.id || uid(),
      type,
      amount: type === "debt" ? total : Number(amount),
      date,
      createdAt: editTx?.createdAt || new Date().toISOString(),
      description: description.trim(),
      hasReceipt: !!receipt,
      _receiptData: receipt && receipt.startsWith("data:") ? receipt : undefined,
      receiptHash: receiptHash || null,
      receiptRef: receiptRef || null,
      receiptDestCard: receiptDestCard || null,
      receiptInfo: receiptInfo || null,
      linkedSupplierTxId: editTx?.linkedSupplierTxId || null,
    };
    if (type === "debt") tx.items = items;
    if (type === "payment") {
      tx.directPaySupplierId = destination === "supplier" ? directSupplierId : null;
      tx.cardId = destination === "self" ? cardId || null : null;
      tx.linkedInvoiceId = linkedInvoiceId || null;
    }
    await onSubmit(tx);
  };

  return (
    <Modal title={editTx ? "ویرایش تراکنش" : "ثبت تراکنش مشتری"} onClose={onClose}>
      <div className="flex gap-2 mb-4">
        <button onClick={() => setType("debt")} className="flex-1 py-2.5 rounded-xl" style={{ background: type === "debt" ? T.rust : T.rustBg }}>
          <span style={{ fontFamily: "Vazirmatn", fontSize: "13px", fontWeight: 700, color: type === "debt" ? "#fff" : T.rust }}>تحویل جنس</span>
        </button>
        <button onClick={() => setType("payment")} className="flex-1 py-2.5 rounded-xl" style={{ background: type === "payment" ? T.green : T.greenBg }}>
          <span style={{ fontFamily: "Vazirmatn", fontSize: "13px", fontWeight: 700, color: type === "payment" ? "#fff" : T.green }}>دریافت وجه</span>
        </button>
      </div>

      {type === "debt" ? (
        <Field label="کالاها">
          <LineItemsEditor
            items={items}
            setItems={setItems}
            suggestions={productSuggestions}
            priceLabel="قیمت فروش هر واحد"
          />
        </Field>
      ) : (
        <>
          <Field label="مبلغ (تومان)">
            <AmountInput value={amount} onChange={setAmount} />
          </Field>
          {invoices.length > 0 && (
            <Field label="بابت کدام فاکتور؟ (اختیاری)">
              <select value={linkedInvoiceId} onChange={(e) => setLinkedInvoiceId(e.target.value)} style={inputStyle}>
                <option value="">— بدون ارتباط با فاکتور خاص —</option>
                {invoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {(inv.items?.[0]?.productName || inv.description || "فاکتور") + " — " + fmtDate(inv.date) + " — " + fmt(inv.amount)}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="این وجه کجا رفت؟">
            <div className="flex gap-2 mb-2">
              <button onClick={() => setDestination("self")} className="flex-1 py-2 rounded-xl" style={{ background: destination === "self" ? T.amber : T.card, border: `1px solid ${T.hairline}` }}>
                <span style={{ fontFamily: "Vazirmatn", fontSize: "12.5px", fontWeight: 700, color: destination === "self" ? T.bg : T.ink }}>به حساب خودم</span>
              </button>
              <button onClick={() => setDestination("supplier")} className="flex-1 py-2 rounded-xl" style={{ background: destination === "supplier" ? T.amber : T.card, border: `1px solid ${T.hairline}` }}>
                <span style={{ fontFamily: "Vazirmatn", fontSize: "12.5px", fontWeight: 700, color: destination === "supplier" ? T.bg : T.ink }}>مستقیم به تامین‌کننده</span>
              </button>
            </div>
            {destination === "supplier" ? (
              <>
                <select value={directSupplierId} onChange={(e) => setDirectSupplierId(e.target.value)} style={inputStyle}>
                  <option value="">کدام تامین‌کننده؟</option>
                  {data.suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs" style={{ fontFamily: "Vazirmatn", color: T.muted, lineHeight: 1.8 }}>
                  این مبلغ هم از بدهی این مشتری کم میشه، هم به‌عنوان پرداخت به همون تامین‌کننده ثبت میشه.
                </p>
              </>
            ) : (
              data.cards.length > 0 && (
                <select value={cardId} onChange={(e) => setCardId(e.target.value)} style={inputStyle}>
                  <option value="">کارت مقصد (اختیاری)</option>
                  {data.cards.map((c) => (
                    <option key={c.id} value={c.id}>{c.bankName}{c.holderName ? " — " + c.holderName : ""}</option>
                  ))}
                </select>
              )
            )}
          </Field>
        </>
      )}

      <Field label="تاریخ">
        <JalaliDatePicker value={date} onChange={setDate} />
      </Field>
      <Field label="یادداشت (اختیاری)">
        <TextArea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="توضیح اضافه‌ای اگر لازمه" />
      </Field>
      <Field label="رسید">
        {loadingReceipt ? (
          <p className="flex items-center gap-1.5" style={{ fontFamily: "Vazirmatn", fontSize: "12px", color: T.muted }}>
            <Loader2 size={13} className="animate-spin" /> در حال بارگذاری رسید قبلی...
          </p>
        ) : (
          <ReceiptField value={receipt} onChange={setReceipt} data={data} excludeTxId={editTx?.id} onHashChange={setReceiptHash} onRefChange={(r, d) => { setReceiptRef(r || ""); if (d) setReceiptDestCard(d); }} onInfoChange={setReceiptInfo} initialRef={editTx?.receiptRef} initialReceiptInfo={editTx?.receiptInfo} onBlockChange={setDuplicateBlocked} />
        )}
      </Field>
      <PrimaryButton disabled={!canSubmit || busy} onClick={submit}>{busy ? "در حال ذخیره..." : editTx ? "ذخیره ویرایش" : "ذخیره تراکنش"}</PrimaryButton>
    </Modal>
  );
}

function SupplierTxModal({ supplier, onClose, onSubmit, onAddShippingCost, productSuggestions, data, editTx }) {
  const [type, setType] = useState(editTx?.type || "purchase");
  const [amount, setAmount] = useState(editTx && editTx.type === "payment" ? String(editTx.amount) : "");
  const [items, setItems] = useState(editTx?.items || []);
  const [date, setDate] = useState(editTx?.date || todayISO());
  const [description, setDescription] = useState(editTx?.description || "");
  const [receipt, setReceipt] = useState(null);
  const [receiptHash, setReceiptHash] = useState(editTx?.receiptHash || null);
  const [receiptRef, setReceiptRef] = useState(editTx?.receiptRef || "");
  const [duplicateBlocked, setDuplicateBlocked] = useState(false);
  const [receiptDestCard, setReceiptDestCard] = useState(editTx?.receiptDestCard || null);
  const [receiptInfo, setReceiptInfo] = useState(editTx?.receiptInfo || null);
  const [loadingReceipt, setLoadingReceipt] = useState(!!editTx?.hasReceipt);
  const [source, setSource] = useState(editTx?.directPayCustomerId ? "customer" : "self");
  const [directCustomerId, setDirectCustomerId] = useState(editTx?.directPayCustomerId || "");
  const [cardId, setCardId] = useState(editTx?.cardId || "");
  const [linkedPurchaseId, setLinkedPurchaseId] = useState(editTx?.linkedPurchaseId || "");
  const purchaseInvoices = (supplier?.transactions || []).filter((t) => t.type === "purchase");

  useEffect(() => {
    if (editTx?.hasReceipt) {
      loadReceipt(editTx.id).then((url) => {
        setReceipt(url);
        setLoadingReceipt(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = items.reduce((s, it) => s + itemSubtotal(it), 0);
  const canSubmit = (type === "purchase" ? items.length > 0 : !!amount && (source === "self" || !!directCustomerId)) && !duplicateBlocked;
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    const tx = {
      id: editTx?.id || uid(),
      type,
      amount: type === "purchase" ? total : Number(amount),
      date,
      createdAt: editTx?.createdAt || new Date().toISOString(),
      description: description.trim(),
      hasReceipt: !!receipt,
      _receiptData: receipt && receipt.startsWith("data:") ? receipt : undefined,
      receiptHash: receiptHash || null,
      receiptRef: receiptRef || null,
      receiptDestCard: receiptDestCard || null,
      receiptInfo: receiptInfo || null,
      linkedCustomerTxId: editTx?.linkedCustomerTxId || null,
    };
    if (type === "purchase") tx.items = items;
    if (type === "payment") {
      tx.directPayCustomerId = source === "customer" ? directCustomerId : null;
      tx.cardId = source === "self" ? cardId || null : null;
      tx.linkedPurchaseId = linkedPurchaseId || null;
    }
    await onSubmit(tx);
  };

  return (
    <Modal title={editTx ? "ویرایش تراکنش" : "ثبت تراکنش تامین‌کننده"} onClose={onClose}>
      <div className="grid grid-cols-2 gap-2 mb-4">
        <button onClick={() => setType("purchase")} className="py-2.5 rounded-xl" style={{ background: type === "purchase" ? T.rust : T.rustBg }}>
          <span style={{ fontFamily: "Vazirmatn", fontSize: "13px", fontWeight: 700, color: type === "purchase" ? "#fff" : T.rust }}>خرید کالا</span>
        </button>
        <button onClick={() => setType("payment")} className="py-2.5 rounded-xl" style={{ background: type === "payment" ? T.green : T.greenBg }}>
          <span style={{ fontFamily: "Vazirmatn", fontSize: "13px", fontWeight: 700, color: type === "payment" ? "#fff" : T.green }}>پرداخت</span>
        </button>
      </div>

      {!editTx && (
        <button
          onClick={() => {
            onClose();
            onAddShippingCost();
          }}
          className="w-full flex items-center justify-between px-4 py-3 rounded-xl mb-4"
          style={{ background: "rgba(201,167,104,0.12)" }}
        >
          <span style={{ fontFamily: "Vazirmatn", fontSize: "12.5px", fontWeight: 700, color: T.amberDark }}>+ ثبت هزینه حمل یا جانبی برای این تامین‌کننده</span>
          <ChevronLeft size={15} color={T.amberDark} style={{ transform: "rotate(180deg)" }} />
        </button>
      )}

      {type === "purchase" ? (
        <Field label="کالاها">
          <LineItemsEditor
            items={items}
            setItems={setItems}
            suggestions={productSuggestions}
            priceLabel="قیمت خرید هر واحد"
          />
        </Field>
      ) : (
        <>
          <Field label="مبلغ (تومان)">
            <AmountInput value={amount} onChange={setAmount} />
          </Field>
          {purchaseInvoices.length > 0 && (
            <Field label="بابت کدام خرید؟ (اختیاری)">
              <select value={linkedPurchaseId} onChange={(e) => setLinkedPurchaseId(e.target.value)} style={inputStyle}>
                <option value="">— بدون ارتباط با خرید خاص —</option>
                {purchaseInvoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {(inv.items?.[0]?.productName || inv.description || "خرید") + " — " + fmtDate(inv.date) + " — " + fmt(inv.amount)}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="این وجه از کجا پرداخت شد؟">
            <div className="flex gap-2 mb-2">
              <button onClick={() => setSource("self")} className="flex-1 py-2 rounded-xl" style={{ background: source === "self" ? T.amber : T.card, border: `1px solid ${T.hairline}` }}>
                <span style={{ fontFamily: "Vazirmatn", fontSize: "12.5px", fontWeight: 700, color: source === "self" ? T.bg : T.ink }}>از حساب خودم</span>
              </button>
              <button onClick={() => setSource("customer")} className="flex-1 py-2 rounded-xl" style={{ background: source === "customer" ? T.amber : T.card, border: `1px solid ${T.hairline}` }}>
                <span style={{ fontFamily: "Vazirmatn", fontSize: "12.5px", fontWeight: 700, color: source === "customer" ? T.bg : T.ink }}>مستقیم توسط مشتری</span>
              </button>
            </div>
            {source === "customer" ? (
              <>
                <select value={directCustomerId} onChange={(e) => setDirectCustomerId(e.target.value)} style={inputStyle}>
                  <option value="">کدام مشتری؟</option>
                  {data.customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs" style={{ fontFamily: "Vazirmatn", color: T.muted, lineHeight: 1.8 }}>
                  این مبلغ هم از بدهی شما به این تامین‌کننده کم میشه، هم به‌عنوان دریافتی از همون مشتری ثبت میشه.
                </p>
              </>
            ) : (
              data.cards.length > 0 && (
                <select value={cardId} onChange={(e) => setCardId(e.target.value)} style={inputStyle}>
                  <option value="">کارت مبدأ (اختیاری)</option>
                  {data.cards.map((c) => (
                    <option key={c.id} value={c.id}>{c.bankName}{c.holderName ? " — " + c.holderName : ""}</option>
                  ))}
                </select>
              )
            )}
          </Field>
        </>
      )}

      <Field label="تاریخ">
        <JalaliDatePicker value={date} onChange={setDate} />
      </Field>
      <Field label="توضیحات (اختیاری)">
        <TextArea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="مثلاً: خرید محموله جدید از تامین‌کننده" />
      </Field>
      <Field label="رسید">
        {loadingReceipt ? (
          <p className="flex items-center gap-1.5" style={{ fontFamily: "Vazirmatn", fontSize: "12px", color: T.muted }}>
            <Loader2 size={13} className="animate-spin" /> در حال بارگذاری رسید قبلی...
          </p>
        ) : (
          <ReceiptField value={receipt} onChange={setReceipt} data={data} excludeTxId={editTx?.id} onHashChange={setReceiptHash} onRefChange={(r, d) => { setReceiptRef(r || ""); if (d) setReceiptDestCard(d); }} onInfoChange={setReceiptInfo} initialRef={editTx?.receiptRef} initialReceiptInfo={editTx?.receiptInfo} onBlockChange={setDuplicateBlocked} />
        )}
      </Field>
      <PrimaryButton disabled={!canSubmit || busy} onClick={submit}>{busy ? "در حال ذخیره..." : editTx ? "ذخیره ویرایش" : "ذخیره تراکنش"}</PrimaryButton>
    </Modal>
  );
}

function ReportModal({ onClose, onSubmit }) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(todayISO());
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy || !title.trim() || !content.trim()) return;
    setBusy(true);
    await onSubmit({ title: title.trim(), date, content: content.trim() });
  };
  return (
    <Modal title="گزارش جدید" onClose={onClose}>
      <Field label="عنوان">
        <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثلاً: گزارش روزانه فروش" />
      </Field>
      <Field label="تاریخ">
        <JalaliDatePicker value={date} onChange={setDate} />
      </Field>
      <Field label="متن گزارش">
        <TextArea value={content} onChange={(e) => setContent(e.target.value)} placeholder="جزئیات را بنویسید..." style={{ minHeight: "140px" }} />
      </Field>
      <PrimaryButton disabled={!title.trim() || !content.trim() || busy} onClick={submit}>
        {busy ? "در حال ذخیره..." : "ذخیره گزارش"}
      </PrimaryButton>
    </Modal>
  );
}

function CardModal({ onClose, onSubmit }) {
  const [bankName, setBankName] = useState("");
  const [holderName, setHolderName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [iban, setIban] = useState("");
  const [note, setNote] = useState("");

  const handleCardNumberChange = (e) => {
    const digits = e.target.value.replace(/[^0-9]/g, "").slice(0, 16);
    setCardNumber(digits.replace(/(.{4})/g, "$1 ").trim());
  };

  const canSubmit = bankName.trim() && cardNumber.replace(/\s/g, "").length >= 12;
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    await onSubmit({ bankName: bankName.trim(), holderName: holderName.trim(), cardNumber: cardNumber.trim(), iban: iban.trim(), note: note.trim() });
  };

  return (
    <Modal title="کارت بانکی جدید" onClose={onClose}>
      <Field label="نام بانک">
        <TextInput value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="مثلاً: ملت، ملی، سامان" />
      </Field>
      <Field label="نام صاحب کارت (اختیاری)">
        <TextInput value={holderName} onChange={(e) => setHolderName(e.target.value)} />
      </Field>
      <Field label="شماره کارت">
        <TextInput value={cardNumber} onChange={handleCardNumberChange} placeholder="0000 0000 0000 0000" dir="ltr" inputMode="numeric" style={{ fontFamily: "'JetBrains Mono', monospace" }} />
      </Field>
      <Field label="شماره شبا (اختیاری)">
        <TextInput value={iban} onChange={(e) => setIban(e.target.value)} placeholder="IR..." dir="ltr" style={{ fontFamily: "'JetBrains Mono', monospace" }} />
      </Field>
      <Field label="یادداشت (اختیاری)">
        <TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلاً: حساب مخصوص دریافتی از مشتری‌ها" />
      </Field>
      <PrimaryButton disabled={!canSubmit || busy} onClick={submit}>
        {busy ? "در حال ذخیره..." : "ذخیره کارت"}
      </PrimaryButton>
    </Modal>
  );
}

function StockAdjustmentModal({ onClose, onSubmit, productSuggestions }) {
  const [mode, setMode] = useState(productSuggestions.length ? "pick" : "new");
  const [productName, setProductName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const canSubmit = productName.trim() && quantity;

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    await onSubmit({
      productName: productName.trim(),
      quantity: Number(quantity),
      unitCost: unitCost ? Number(unitCost) : 0,
      date,
      note: note.trim(),
    });
  };

  return (
    <Modal title="افزودن موجودی دستی" onClose={onClose}>
      <p className="text-xs mb-4" style={{ fontFamily: "Vazirmatn", color: T.muted, lineHeight: 1.8 }}>
        برای کالاهایی که از قبل (بدون ثبت خرید توی این برنامه) داشتید. اگه قیمت تمام‌شده هر واحد رو هم بزنید، محاسبه سود دقیق‌تر میشه.
      </p>

      <Field label="نام کالا">
        {mode === "pick" ? (
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ WebkitOverflowScrolling: "touch" }}>
            {productSuggestions.map((s) => (
              <button
                key={s}
                onClick={() => setProductName(s)}
                className="shrink-0 px-3.5 py-2 rounded-full whitespace-nowrap"
                style={{
                  background: productName === s ? T.amber : T.bg,
                  border: `1px solid ${productName === s ? T.amber : T.hairline}`,
                  fontFamily: "Vazirmatn",
                  fontSize: "12.5px",
                  fontWeight: 700,
                  color: productName === s ? T.bg : T.ink,
                }}
              >
                {s}
              </button>
            ))}
            <button
              onClick={() => {
                setMode("new");
                setProductName("");
              }}
              className="shrink-0 px-3.5 py-2 rounded-full whitespace-nowrap flex items-center gap-1"
              style={{ background: T.bg, border: `1px dashed ${T.hairline}`, fontFamily: "Vazirmatn", fontSize: "12.5px", fontWeight: 700, color: T.amberDark }}
            >
              <Plus size={13} /> کالای جدید
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <TextInput value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="نام کالا" />
            {productSuggestions.length > 0 && (
              <button onClick={() => setMode("pick")} className="shrink-0 px-3 py-2.5 rounded-xl" style={{ background: T.bg, border: `1px solid ${T.hairline}` }}>
                <span style={{ fontFamily: "Vazirmatn", fontSize: "12px", color: T.muted }}>لیست</span>
              </button>
            )}
          </div>
        )}
      </Field>

      <div className="flex gap-2">
        <div className="flex-1">
          <Field label="تعداد">
            <AmountInput value={quantity} onChange={setQuantity} placeholder="مثلاً 50" />
          </Field>
        </div>
        <div className="flex-1">
          <Field label="قیمت تمام‌شده هر واحد (اختیاری)">
            <AmountInput value={unitCost} onChange={setUnitCost} placeholder="0" />
          </Field>
        </div>
      </div>

      <Field label="تاریخ">
        <JalaliDatePicker value={date} onChange={setDate} />
      </Field>
      <Field label="یادداشت (اختیاری)">
        <TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلاً: موجودی اول دوره" />
      </Field>

      <PrimaryButton disabled={!canSubmit || busy} onClick={submit}>
        {busy ? "در حال ذخیره..." : "ذخیره موجودی"}
      </PrimaryButton>
    </Modal>
  );
}

function TreasuryTxModal({ data, onClose, onSubmit, initial }) {
  const [direction, setDirection] = useState(initial?.direction || "in");
  const [about, setAbout] = useState(initial?.about || "customer");
  const [customerId, setCustomerId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [personId, setPersonId] = useState("");
  const [newPersonName, setNewPersonName] = useState("");
  const [category, setCategory] = useState(initial?.category || "shipping");
  const [costSupplierId, setCostSupplierId] = useState(initial?.supplierId || "");
  const [costPurchaseId, setCostPurchaseId] = useState(initial?.purchaseId || "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState("");
  const [receipt, setReceipt] = useState(null);
  const [receiptHash, setReceiptHash] = useState(null);
  const [receiptRef, setReceiptRef] = useState("");
  const [duplicateBlocked, setDuplicateBlocked] = useState(false);
  const [receiptDestCard, setReceiptDestCard] = useState(null);
  const [receiptInfo, setReceiptInfo] = useState(null);

  const lockSupplier = !!initial?.lockSupplier;

  const setDirectionSafe = (dir) => {
    setDirection(dir);
    if (dir === "in" && (about === "supplier" || about === "expense")) setAbout("customer");
    if (dir === "out" && about === "customer") setAbout("supplier");
  };

  const aboutOptions =
    direction === "in"
      ? [{ v: "customer", l: "مشتری (بدهکار)" }, { v: "person", l: "شریک / شخص" }]
      : [{ v: "supplier", l: "تامین‌کننده" }, { v: "person", l: "شریک / شخص" }, { v: "expense", l: "هزینه کسب‌وکار" }];

  const costSupplier = data.suppliers.find((s) => s.id === costSupplierId);
  const costPurchases = (costSupplier?.transactions || []).filter((t) => t.type === "purchase");

  const canSubmit =
    !!amount &&
    ((about === "customer" && customerId) ||
      (about === "supplier" && supplierId) ||
      (about === "person" && (personId || newPersonName.trim())) ||
      about === "expense") &&
    !duplicateBlocked;
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    const base = { id: uid(), amount: Number(amount), date, createdAt: new Date().toISOString(), description: description.trim(), hasReceipt: !!receipt, _receiptData: receipt, receiptHash: receiptHash || null, receiptRef: receiptRef || null, receiptDestCard: receiptDestCard || null, receiptInfo: receiptInfo || null };
    if (about === "customer") await onSubmit({ kind: "customer", targetId: customerId, tx: { ...base, type: "payment" } });
    else if (about === "supplier") await onSubmit({ kind: "supplier", targetId: supplierId, tx: { ...base, type: "payment" } });
    else if (about === "person")
      await onSubmit({
        kind: "person",
        targetId: personId || null,
        newPersonName: personId ? null : newPersonName.trim(),
        tx: { ...base, type: direction },
      });
    else if (about === "expense") {
      const extra =
        category === "shipping"
          ? { relatedSupplierId: costSupplierId || null, relatedPurchaseId: costPurchaseId || null }
          : {};
      await onSubmit({ kind: "expense", tx: { ...base, category, ...extra } });
    }
  };

  return (
    <Modal title="ثبت تراکنش صندوق" onClose={onClose}>
      <div className="flex gap-2 mb-4">
        <button onClick={() => setDirectionSafe("in")} className="flex-1 py-2.5 rounded-xl" style={{ background: direction === "in" ? T.green : T.greenBg }}>
          <span style={{ fontFamily: "Vazirmatn", fontSize: "13px", fontWeight: 700, color: direction === "in" ? "#fff" : T.green }}>واریزی دریافتی</span>
        </button>
        <button onClick={() => setDirectionSafe("out")} className="flex-1 py-2.5 rounded-xl" style={{ background: direction === "out" ? T.rust : T.rustBg }}>
          <span style={{ fontFamily: "Vazirmatn", fontSize: "13px", fontWeight: 700, color: direction === "out" ? "#fff" : T.rust }}>پرداخت / انتقال</span>
        </button>
      </div>

      <Field label="بابت چه کسی یا چه چیزی؟">
        <select value={about} onChange={(e) => setAbout(e.target.value)} style={inputStyle}>
          {aboutOptions.map((o) => (
            <option key={o.v} value={o.v}>{o.l}</option>
          ))}
        </select>
      </Field>

      {about === "customer" && (
        <Field label="مشتری">
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} style={inputStyle}>
            <option value="">انتخاب کنید</option>
            {data.customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
      )}

      {about === "supplier" && (
        <Field label="تامین‌کننده">
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} style={inputStyle}>
            <option value="">انتخاب کنید</option>
            {data.suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </Field>
      )}

      {about === "person" && (
        <Field label="شریک / شخص">
          <select
            value={personId}
            onChange={(e) => {
              setPersonId(e.target.value);
              if (e.target.value) setNewPersonName("");
            }}
            style={inputStyle}
          >
            <option value="">+ شخص جدید</option>
            {data.people.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {!personId && (
            <TextInput className="mt-2" value={newPersonName} onChange={(e) => setNewPersonName(e.target.value)} placeholder="نام شخص جدید" />
          )}
        </Field>
      )}

      {about === "expense" && (
        <>
          <Field label="نوع هزینه">
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle}>
              {Object.entries(EXPENSE_CATEGORY_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </Field>

          {category === "shipping" && (
            <>
              <Field label="مربوط به کدام تامین‌کننده؟ (اختیاری)">
                {lockSupplier ? (
                  <div style={{ ...inputStyle, background: T.bg, color: T.ink }}>{costSupplier?.name}</div>
                ) : (
                  <select
                    value={costSupplierId}
                    onChange={(e) => {
                      setCostSupplierId(e.target.value);
                      setCostPurchaseId("");
                    }}
                    style={inputStyle}
                  >
                    <option value="">— بدون ارتباط —</option>
                    {data.suppliers.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                )}
              </Field>
              {costSupplierId && (
                <Field label="مربوط به کدام خرید؟ (اختیاری)">
                  <select value={costPurchaseId} onChange={(e) => setCostPurchaseId(e.target.value)} style={inputStyle}>
                    <option value="">— بدون ارتباط با خرید خاص —</option>
                    {costPurchases.map((p) => (
                      <option key={p.id} value={p.id}>{(p.description || "خرید") + " — " + fmtDate(p.date)}</option>
                    ))}
                  </select>
                </Field>
              )}
            </>
          )}
        </>
      )}

      <Field label="مبلغ (تومان)">
        <AmountInput value={amount} onChange={setAmount} />
      </Field>
      <Field label="تاریخ">
        <JalaliDatePicker value={date} onChange={setDate} />
      </Field>
      <Field label="توضیحات (اختیاری)">
        <TextArea value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="رسید">
        <ReceiptField value={receipt} onChange={setReceipt} data={data} onHashChange={setReceiptHash} onRefChange={(r, d) => { setReceiptRef(r || ""); if (d) setReceiptDestCard(d); }} onInfoChange={setReceiptInfo} onBlockChange={setDuplicateBlocked} />
      </Field>
      <PrimaryButton disabled={!canSubmit || busy} onClick={submit}>{busy ? "در حال ذخیره..." : "ذخیره تراکنش"}</PrimaryButton>
    </Modal>
  );
}

export default function App() {
  return (
    <AuthGate>
      <LedgerApp />
    </AuthGate>
  );
}
