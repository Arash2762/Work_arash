import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Plus, X, ChevronLeft, Users, Truck, FileText, LayoutGrid,
  ArrowUpRight, ArrowDownRight, Camera, Trash2, Image as ImageIcon,
  Phone, Package, Loader2, AlertCircle, Wallet, TrendingUp, CreditCard, Copy, Check, LogOut
} from "lucide-react";
import { supabase } from "./supabaseClient";
import AuthGate from "./AuthGate";

/* ---------------------------------------------------------------
  TOKENS
  bg (paper): #FBF7F1
  ink (primary text): #2B2438
  muted: #7A7288
  amber (brand / CTA): #D98E3F
  green (receivable / money coming in): #3F7D58
  rust (payable / money going out): #B5482F
  hairline: #E7E0D4
  card: #FFFFFF
  Fonts: Vazirmatn (UI/Persian), JetBrains Mono (amounts / ledger tape)
----------------------------------------------------------------*/

const T = {
  bg: "#FBF7F1",
  ink: "#2B2438",
  muted: "#7A7288",
  amber: "#D98E3F",
  amberDark: "#B9711F",
  green: "#3F7D58",
  greenBg: "#E9F3ED",
  rust: "#B5482F",
  rustBg: "#F8E9E4",
  plum: "#8B4B6B",
  plumBg: "#F3E7ED",
  hairline: "#E7E0D4",
  card: "#FFFFFF",
};

const uid = () => crypto.randomUUID();

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
          description: t.description || "",
          hasReceipt: !!t.receipt_path,
          items: custItemsByTx[t.id] || undefined,
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
          description: t.description || "",
          hasReceipt: !!t.receipt_path,
          items: supItemsByTx[t.id] || undefined,
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
          description: t.description || "",
          hasReceipt: !!t.receipt_path,
        })),
    }));

    const nestedExpenses = (expenses || []).map((e) => ({
      id: e.id,
      category: e.category,
      amount: Number(e.amount),
      date: e.date,
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

    return {
      customers: nestedCustomers,
      suppliers: nestedSuppliers,
      people: nestedPeople,
      expenses: nestedExpenses,
      reports: nestedReports,
      cards: nestedCards,
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
  await del;
  if (rows.length) await supabase.from(table).upsert(rows);
}

async function saveData(data) {
  try {
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
          description: t.description || null,
          receipt_path: t.hasReceipt ? t.id : null,
        });
        (t.items || []).forEach((it) =>
          custItemRows.push({ id: it.id, transaction_id: t.id, product_name: it.productName, quantity: it.quantity, unit_price: it.unitPrice })
        );
      })
    );
    await syncTable("customer_transactions", custTxRows);
    await syncTable("customer_transaction_items", custItemRows);

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
          description: t.description || null,
          receipt_path: t.hasReceipt ? t.id : null,
        });
        (t.items || []).forEach((it) =>
          supItemRows.push({ id: it.id, transaction_id: t.id, product_name: it.productName, quantity: it.quantity, unit_price: it.unitPrice })
        );
      })
    );
    await syncTable("supplier_transactions", supTxRows);
    await syncTable("supplier_transaction_items", supItemRows);

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
          description: t.description || null,
          receipt_path: t.hasReceipt ? t.id : null,
        })
      )
    );
    await syncTable("person_transactions", personTxRows);

    await syncTable(
      "expenses",
      data.expenses.map((e) => ({
        id: e.id,
        category: e.category,
        amount: e.amount,
        date: e.date,
        description: e.description || null,
        receipt_path: e.hasReceipt ? e.id : null,
        related_supplier_id: e.relatedSupplierId || null,
        related_purchase_id: e.relatedPurchaseId || null,
      }))
    );

    await syncTable(
      "reports",
      data.reports.map((r) => ({ id: r.id, title: r.title, date: r.date, content: r.content }))
    );

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
    return !error;
  } catch {
    return false;
  }
}
async function loadReceipt(txId) {
  try {
    const { data, error } = await supabase.storage.from("receipts").download(txId);
    if (error || !data) return null;
    return URL.createObjectURL(data);
  } catch {
    return null;
  }
}
async function deleteReceipt(txId) {
  try {
    await supabase.storage.from("receipts").remove([txId]);
  } catch {}
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new window.Image();
      img.onload = () => {
        const maxW = 900;
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.6));
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
// proportionally to each item's value share, then divides by quantity.
function purchaseLanding(purchaseTx, expenses) {
  const shippingTotal = (expenses || [])
    .filter((e) => e.category === "shipping" && e.relatedPurchaseId === purchaseTx.id)
    .reduce((s, e) => s + Number(e.amount || 0), 0);
  const items = purchaseTx.items || [];
  const subtotal = items.reduce((s, it) => s + itemSubtotal(it), 0);
  const landedItems = items.map((it) => {
    const sub = itemSubtotal(it);
    const shippingShare = subtotal ? (sub / subtotal) * shippingTotal : 0;
    const landedTotal = sub + shippingShare;
    const landedUnit = it.quantity ? landedTotal / Number(it.quantity) : null;
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
  return <div className="min-h-screen w-full pb-24" style={{ background: T.bg }}>{children}</div>;
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
  { bg: "#F3E7ED", fg: "#8B4B6B" }, // plum
  { bg: "#E9F3ED", fg: "#3F7D58" }, // green
  { bg: "#FBEFDF", fg: "#B9711F" }, // amber
  { bg: "#F8E9E4", fg: "#B5482F" }, // rust
  { bg: "#E7ECF3", fg: "#3E5C8A" }, // slate blue
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
  background: "#fff",
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
        background: disabled ? "#D9CBB0" : T.amber,
        color: "#fff",
        fontFamily: "Vazirmatn",
        opacity: disabled ? 0.7 : 1,
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
    { id: "treasury", label: "صندوق", icon: Wallet },
  ];
  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-30 flex justify-around px-2 pt-2 pb-safe"
      style={{ background: T.card, borderTop: `1px solid ${T.hairline}`, paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}
    >
      {items.map((it) => {
        const active = tab === it.id;
        return (
          <button
            key={it.id}
            onClick={() => setTab(it.id)}
            className="flex flex-col items-center gap-1 px-3.5 py-1.5 rounded-2xl transition-colors"
            style={{ color: active ? T.amberDark : T.muted, background: active ? "#FBEFDF" : "transparent" }}
          >
            <it.icon size={21} strokeWidth={active ? 2.4 : 1.8} />
            <span style={{ fontFamily: "Vazirmatn", fontSize: "11px", fontWeight: active ? 700 : 500 }}>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- Receipt viewer/upload ---------------- */
function ReceiptPicker({ value, onChange }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await compressImage(file);
      onChange(dataUrl);
    } catch {
      onChange(null);
    }
    setBusy(false);
  };
  return (
    <div>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
      {value ? (
        <div className="relative">
          <img src={value} alt="رسید" className="w-full rounded-xl" style={{ border: `1px solid ${T.hairline}` }} />
          <button
            onClick={() => onChange(null)}
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

  useEffect(() => {
    (async () => {
      const d = await loadData();
      setData({ customers: [], suppliers: [], reports: [], people: [], expenses: [], cards: [], ...(d || {}) });
      setLoading(false);
    })();
  }, []);

  const persist = useCallback(async (next) => {
    setData(next);
    const ok = await saveData(next);
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
            onBack={() => setOpenCustomer(null)}
            openModal={setModal}
            onDeleteTx={async (txId) => {
              const next = { ...data };
              const c = next.customers.find((x) => x.id === customer.id);
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
            onBack={() => setOpenSupplier(null)}
            openModal={setModal}
            onDeleteTx={async (txId) => {
              const next = { ...data };
              const s = next.suppliers.find((x) => x.id === supplier.id);
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

        {tab === "inventory" && <Inventory data={data} />}

        {tab === "treasury" && (
          <Treasury
            data={data}
            openModal={setModal}
            onDeleteFeed={async (item) => {
              const next = { ...data };
              if (item.kind === "person") {
                const p = next.people.find((x) => x.id === item.personId);
                if (p) p.transactions = p.transactions.filter((t) => t.id !== item.id);
              } else if (item.kind === "expense") {
                next.expenses = next.expenses.filter((e) => e.id !== item.id);
              }
              await deleteReceipt(item.id);
              persist(next);
            }}
          />
        )}

        {!customer && !supplier && <BottomNav tab={tab} setTab={setTab} />}

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
            productSuggestions={getAllProductNames(data)}
            onClose={() => setModal(null)}
            onSubmit={async (tx) => {
              const next = { ...data };
              const c = next.customers.find((x) => x.id === modal.customerId);
              c.transactions = [...(c.transactions || []), tx];
              await persist(next);
              if (tx.hasReceipt && tx._receiptData) await saveReceipt(tx.id, tx._receiptData);
              setModal(null);
            }}
          />
        )}

        {modal?.type === "supplierTx" && (
          <SupplierTxModal
            supplier={data.suppliers.find((s) => s.id === modal.supplierId)}
            productSuggestions={getAllProductNames(data)}
            onClose={() => setModal(null)}
            onAddShippingCost={() =>
              setModal({ type: "treasuryTx", initial: { about: "expense", direction: "out", category: "shipping", supplierId: modal.supplierId, lockSupplier: true } })
            }
            onSubmit={async (tx) => {
              const next = { ...data };
              const s = next.suppliers.find((x) => x.id === modal.supplierId);
              s.transactions = [...(s.transactions || []), tx];
              await persist(next);
              if (tx.hasReceipt && tx._receiptData) await saveReceipt(tx.id, tx._receiptData);
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

        {modal?.type === "treasuryTx" && (
          <TreasuryTxModal
            data={data}
            initial={modal.initial}
            onClose={() => setModal(null)}
            onSubmit={async (payload) => {
              const next = { ...data };
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
      const la = a.transactions[a.transactions.length - 1]?.date || "";
      const lb = b.transactions[b.transactions.length - 1]?.date || "";
      return lb.localeCompare(la);
    })
    .slice(0, 3);

  return (
    <div className="px-4 pt-6">
      <p style={{ fontFamily: "Vazirmatn", color: T.muted, fontSize: "13px" }}>داشبورد</p>
      <h1 className="text-2xl font-extrabold mt-0.5" style={{ color: T.ink, fontFamily: "Vazirmatn" }}>خلاصه حساب</h1>

      <div className="grid grid-cols-2 gap-3 mt-5">
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

/* ---------------- Customers ---------------- */
function CustomerList({ data, onOpen, openModal }) {
  return (
    <div className="px-4 pt-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold" style={{ color: T.ink, fontFamily: "Vazirmatn" }}>مشتریان</h1>
        <button onClick={() => openModal({ type: "newCustomer" })} className="p-2 rounded-full" style={{ background: T.amber }}>
          <Plus size={17} color="#fff" />
        </button>
      </div>
      <div className="mt-4 flex flex-col gap-2.5">
        {data.customers.length === 0 && <Empty icon={Users} title="هنوز مشتری‌ای ثبت نشده" subtitle="با دکمه بالا اولین مشتری را اضافه کنید." />}
        {data.customers.map((c) => {
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

function CustomerDetail({ customer, onBack, openModal, onDeleteTx, onDeleteCustomer }) {
  const bal = customerBalance(customer);
  const sorted = [...(customer.transactions || [])].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div>
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
          <p style={{ fontFamily: "Vazirmatn", color: T.muted, fontSize: "12px" }}>{bal > 0 ? "بدهکار به شما" : bal < 0 ? "طلبکار از شما" : "تسویه شده"}</p>
          <div className="mt-1"><Amount value={Math.abs(bal)} tone={bal > 0 ? "rust" : bal < 0 ? "green" : "muted"} size="lg" /></div>
        </Card>

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
                      {t.description && <p className="text-xs mt-0.5" style={{ color: T.muted, fontFamily: "Vazirmatn" }}>{t.description}</p>}
                      <p className="text-xs mt-1" style={{ color: T.muted, fontFamily: "Vazirmatn" }}>{fmtDate(t.date)}</p>
                    </div>
                  </div>
                  <div className="text-left shrink-0 flex flex-col items-end gap-1.5">
                    <Amount value={t.amount} tone={t.type === "debt" ? "rust" : "green"} size="sm" />
                    {t.hasReceipt && <ReceiptViewButton txId={t.id} />}
                    <button onClick={() => onDeleteTx(t.id)} className="text-[11px]" style={{ color: T.muted, fontFamily: "Vazirmatn" }}>حذف</button>
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
  return (
    <div className="px-4 pt-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold" style={{ color: T.ink, fontFamily: "Vazirmatn" }}>تامین‌کنندگان</h1>
        <button onClick={() => openModal({ type: "newSupplier" })} className="p-2 rounded-full" style={{ background: T.amber }}>
          <Plus size={17} color="#fff" />
        </button>
      </div>
      <div className="mt-4 flex flex-col gap-2.5">
        {data.suppliers.length === 0 && <Empty icon={Truck} title="هنوز تامین‌کننده‌ای ثبت نشده" subtitle="با دکمه بالا اولین تامین‌کننده را اضافه کنید." />}
        {data.suppliers.map((s) => {
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

function SupplierDetail({ supplier, expenses, onBack, openModal, onDeleteTx, onDeleteExpense, onDeleteSupplier }) {
  const bal = supplierBalance(supplier);
  const sorted = [...(supplier.transactions || [])].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const purchases = (supplier.transactions || []).filter((t) => t.type === "purchase");
  const supplierCosts = [...(expenses || [])]
    .filter((e) => e.category === "shipping" && e.relatedSupplierId === supplier.id)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const typeLabel = { purchase: "خرید کالا", payment: "پرداخت" };
  const typeTone = { purchase: T.rust, payment: T.green };
  const typeBg = { purchase: T.rustBg, payment: T.greenBg };
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div>
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
          <p style={{ fontFamily: "Vazirmatn", color: T.muted, fontSize: "12px" }}>{bal > 0 ? "بدهکار شما" : bal < 0 ? "طلبکار شما" : "تسویه شده"}</p>
          <div className="mt-1"><Amount value={Math.abs(bal)} tone={bal > 0 ? "rust" : bal < 0 ? "green" : "muted"} size="lg" /></div>
        </Card>

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
          style={{ background: "#FBEFDF" }}
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
                      {t.description && <p className="text-xs mt-0.5" style={{ color: T.muted, fontFamily: "Vazirmatn" }}>{t.description}</p>}
                      <p className="text-xs mt-1" style={{ color: T.muted, fontFamily: "Vazirmatn" }}>{fmtDate(t.date)}</p>
                    </div>
                  </div>
                  <div className="text-left shrink-0 flex flex-col items-end gap-1.5">
                    <Amount value={t.amount} tone={t.type === "payment" ? "green" : "rust"} size="sm" />
                    {t.hasReceipt && <ReceiptViewButton txId={t.id} />}
                    <button onClick={() => onDeleteTx(t.id)} className="text-[11px]" style={{ color: T.muted, fontFamily: "Vazirmatn" }}>حذف</button>
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
          <Plus size={17} color="#fff" />
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
            <Plus size={17} color="#fff" />
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
function Inventory({ data }) {
  const stats = computeProductStats(data);
  const totalProfit = stats.reduce((s, r) => s + r.profit, 0);
  const stockValue = stats.reduce((s, r) => s + Math.max(r.stock, 0) * r.avgCost, 0);

  return (
    <div className="px-4 pt-5">
      <h1 className="text-xl font-extrabold" style={{ color: T.ink, fontFamily: "Vazirmatn" }}>انبار و سود</h1>

      <div className="grid grid-cols-2 gap-3 mt-5">
        <div className="rounded-2xl p-4" style={{ background: totalProfit >= 0 ? T.greenBg : T.rustBg }}>
          <p style={{ fontFamily: "Vazirmatn", fontSize: "12px", color: totalProfit >= 0 ? T.green : T.rust, fontWeight: 600 }}>سود خالص کل</p>
          <div className="mt-2"><Amount value={Math.abs(totalProfit)} tone={totalProfit >= 0 ? "green" : "rust"} size="lg" /></div>
        </div>
        <div className="rounded-2xl p-4" style={{ background: "#F1ECE0" }}>
          <p style={{ fontFamily: "Vazirmatn", fontSize: "12px", color: T.muted, fontWeight: 600 }}>ارزش انبار موجود</p>
          <div className="mt-2"><Amount value={stockValue} size="lg" /></div>
        </div>
      </div>

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
    </div>
  );
}

/* ---------------- Treasury (صندوق) ---------------- */
const TREASURY_KIND_LABEL = { customer: "دریافتی از مشتری", supplier: "پرداخت به تامین‌کننده", person: "شریک/شخص", expense: "هزینه" };

function Treasury({ data, openModal, onDeleteFeed }) {
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
  feed.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  return (
    <div className="px-4 pt-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold" style={{ color: T.ink, fontFamily: "Vazirmatn" }}>صندوق</h1>
        <button onClick={() => openModal({ type: "treasuryTx" })} className="p-2 rounded-full" style={{ background: T.amber }}>
          <Plus size={17} color="#fff" />
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
                    <div className="text-left">
                      <Amount value={Math.abs(bal)} tone={bal > 0 ? "rust" : bal < 0 ? "green" : "muted"} size="sm" />
                      <p style={{ fontFamily: "Vazirmatn", fontSize: "10px", color: T.muted }}>{bal > 0 ? "بدهکار شما" : bal < 0 ? "طلبکار شما" : "تسویه"}</p>
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
                    <p className="text-xs mt-1" style={{ color: T.muted, fontFamily: "Vazirmatn" }}>{fmtDate(t.date)}</p>
                  </div>
                </div>
                <div className="text-left shrink-0 flex flex-col items-end gap-1.5">
                  <Amount value={t.amount} tone={t.direction === "in" ? "green" : "rust"} size="sm" />
                  {t.hasReceipt && <ReceiptViewButton txId={t.id} />}
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
                  color: name === s ? "#fff" : T.ink,
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
          style={{ background: name.trim() && qty && price ? T.amber : "#EFE6D4", color: "#fff" }}
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
  return (
    <Modal title={title} onClose={onClose}>
      <Field label="نام">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً: علی رضایی" />
      </Field>
      <Field label="شماره تماس (اختیاری)">
        <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="09xxxxxxxxx" dir="ltr" />
      </Field>
      <PrimaryButton disabled={!name.trim()} onClick={() => onSubmit({ name: name.trim(), phone: phone.trim() })}>
        ذخیره
      </PrimaryButton>
    </Modal>
  );
}

function CustomerTxModal({ onClose, onSubmit, productSuggestions }) {
  const [type, setType] = useState("debt");
  const [amount, setAmount] = useState("");
  const [items, setItems] = useState([]);
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState("");
  const [receipt, setReceipt] = useState(null);

  const total = items.reduce((s, it) => s + itemSubtotal(it), 0);
  const canSubmit = type === "debt" ? items.length > 0 : !!amount;

  const submit = () => {
    if (!canSubmit) return;
    const tx = {
      id: uid(),
      type,
      amount: type === "debt" ? total : Number(amount),
      date,
      description: description.trim(),
      hasReceipt: !!receipt,
      _receiptData: receipt,
    };
    if (type === "debt") tx.items = items;
    onSubmit(tx);
  };

  return (
    <Modal title="ثبت تراکنش مشتری" onClose={onClose}>
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
        <Field label="مبلغ (تومان)">
          <AmountInput value={amount} onChange={setAmount} />
        </Field>
      )}

      <Field label="تاریخ">
        <JalaliDatePicker value={date} onChange={setDate} />
      </Field>
      <Field label="یادداشت (اختیاری)">
        <TextArea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="توضیح اضافه‌ای اگر لازمه" />
      </Field>
      <Field label="رسید">
        <ReceiptPicker value={receipt} onChange={setReceipt} />
      </Field>
      <PrimaryButton disabled={!canSubmit} onClick={submit}>ذخیره تراکنش</PrimaryButton>
    </Modal>
  );
}

function SupplierTxModal({ supplier, onClose, onSubmit, onAddShippingCost, productSuggestions }) {
  const [type, setType] = useState("purchase");
  const [amount, setAmount] = useState("");
  const [items, setItems] = useState([]);
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState("");
  const [receipt, setReceipt] = useState(null);

  const total = items.reduce((s, it) => s + itemSubtotal(it), 0);
  const canSubmit = type === "purchase" ? items.length > 0 : !!amount;

  const submit = () => {
    if (!canSubmit) return;
    const tx = {
      id: uid(),
      type,
      amount: type === "purchase" ? total : Number(amount),
      date,
      description: description.trim(),
      hasReceipt: !!receipt,
      _receiptData: receipt,
    };
    if (type === "purchase") tx.items = items;
    onSubmit(tx);
  };

  return (
    <Modal title="ثبت تراکنش تامین‌کننده" onClose={onClose}>
      <div className="grid grid-cols-2 gap-2 mb-4">
        <button onClick={() => setType("purchase")} className="py-2.5 rounded-xl" style={{ background: type === "purchase" ? T.rust : T.rustBg }}>
          <span style={{ fontFamily: "Vazirmatn", fontSize: "13px", fontWeight: 700, color: type === "purchase" ? "#fff" : T.rust }}>خرید کالا</span>
        </button>
        <button onClick={() => setType("payment")} className="py-2.5 rounded-xl" style={{ background: type === "payment" ? T.green : T.greenBg }}>
          <span style={{ fontFamily: "Vazirmatn", fontSize: "13px", fontWeight: 700, color: type === "payment" ? "#fff" : T.green }}>پرداخت</span>
        </button>
      </div>

      <button
        onClick={() => {
          onClose();
          onAddShippingCost();
        }}
        className="w-full flex items-center justify-between px-4 py-3 rounded-xl mb-4"
        style={{ background: "#FBEFDF" }}
      >
        <span style={{ fontFamily: "Vazirmatn", fontSize: "12.5px", fontWeight: 700, color: T.amberDark }}>+ ثبت هزینه حمل یا جانبی برای این تامین‌کننده</span>
        <ChevronLeft size={15} color={T.amberDark} style={{ transform: "rotate(180deg)" }} />
      </button>

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
        <Field label="مبلغ (تومان)">
          <AmountInput value={amount} onChange={setAmount} />
        </Field>
      )}

      <Field label="تاریخ">
        <JalaliDatePicker value={date} onChange={setDate} />
      </Field>
      <Field label="توضیحات (اختیاری)">
        <TextArea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="مثلاً: خرید محموله جدید از تامین‌کننده" />
      </Field>
      <Field label="رسید">
        <ReceiptPicker value={receipt} onChange={setReceipt} />
      </Field>
      <PrimaryButton disabled={!canSubmit} onClick={submit}>ذخیره تراکنش</PrimaryButton>
    </Modal>
  );
}

function ReportModal({ onClose, onSubmit }) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(todayISO());
  const [content, setContent] = useState("");
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
      <PrimaryButton disabled={!title.trim() || !content.trim()} onClick={() => onSubmit({ title: title.trim(), date, content: content.trim() })}>
        ذخیره گزارش
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
      <PrimaryButton
        disabled={!canSubmit}
        onClick={() => onSubmit({ bankName: bankName.trim(), holderName: holderName.trim(), cardNumber: cardNumber.trim(), iban: iban.trim(), note: note.trim() })}
      >
        ذخیره کارت
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
      about === "expense");

  const submit = () => {
    if (!canSubmit) return;
    const base = { id: uid(), amount: Number(amount), date, description: description.trim(), hasReceipt: !!receipt, _receiptData: receipt };
    if (about === "customer") onSubmit({ kind: "customer", targetId: customerId, tx: { ...base, type: "payment" } });
    else if (about === "supplier") onSubmit({ kind: "supplier", targetId: supplierId, tx: { ...base, type: "payment" } });
    else if (about === "person")
      onSubmit({
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
      onSubmit({ kind: "expense", tx: { ...base, category, ...extra } });
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
        <ReceiptPicker value={receipt} onChange={setReceipt} />
      </Field>
      <PrimaryButton disabled={!canSubmit} onClick={submit}>ذخیره تراکنش</PrimaryButton>
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
