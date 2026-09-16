import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 10000;
const MODEL = process.env.OPENAI_VISION_MODEL || "gpt-5.4-mini";
app.use(express.json({ limit: "18mb" }));

const PERSIAN = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC = "٠١٢٣٤٥٦٧٨٩";
const normalizeDigits = (v = "") => String(v).replace(/[۰-۹]/g, d => String(PERSIAN.indexOf(d))).replace(/[٠-٩]/g, d => String(ARABIC.indexOf(d)));
const cleanNumber = v => v == null ? null : (normalizeDigits(v).replace(/[^0-9]/g, "") || null);
const cleanText = v => v == null ? null : (String(v).trim() || null);
const confidence = v => Math.max(0, Math.min(1, Number(v) || 0));

const LABELS = [
  "شماره پیگیری بانک مرکزی", "شماره رهگیری بانک مرکزی", "کد پیگیری بانک مرکزی",
  "شماره پیگیری", "کد پیگیری", "شماره رهگیری", "کد رهگیری", "شماره مرجع",
  "کد مرجع", "مرجع تراکنش", "شماره سند", "کد سند", "شناسه تراکنش", "شماره تراکنش"
];

const field = () => ({
  type: "object", additionalProperties: false,
  properties: {
    value: { type: ["string", "null"] },
    confidence: { type: "number" },
    evidence: { type: ["string", "null"] },
    label: { type: ["string", "null"] }
  }, required: ["value", "confidence", "evidence", "label"]
});

const fastSchema = {
  type: "object", additionalProperties: false,
  properties: {
    candidates: { type: "array", items: { type: "object", additionalProperties: false, properties: {
      value: { type: "string" }, label: { type: "string" }, kind: { type: "string" }, confidence: { type: "number" }, evidence: { type: ["string", "null"] }
    }, required: ["value", "label", "kind", "confidence", "evidence"] } },
    selected: field(), documentNumber: field(), trackingNumber: field(), referenceNumber: field(),
    confidence: { type: "number" }, rawText: { type: ["string", "null"] }
  }, required: ["candidates", "selected", "documentNumber", "trackingNumber", "referenceNumber", "confidence", "rawText"]
};

const fullKeys = ["documentNumber", "trackingNumber", "referenceNumber", "amount", "date", "time", "destCardLast4", "senderName", "receiverName"];
const fullSchema = {
  type: "object", additionalProperties: false,
  properties: Object.fromEntries([...fullKeys.map(k => [k, { type: ["string", "null"] }]), ["confidence", {type:"number"}], ["rawText", {type:["string","null"]}], ["fields", {type:"object", additionalProperties:false, properties:Object.fromEntries(fullKeys.map(k=>[k,field()])), required:fullKeys}]]),
  required: [...fullKeys, "confidence", "rawText", "fields"]
};

function promptFor(mode, retryField) {
  const retry = mode === "retry" || mode === "full_retry" || mode === "field_retry";
  if (mode !== "full" && mode !== "full_retry" && mode !== "field_retry") return `این تصویر یک رسید بانکی/مالی ایرانی است. فقط شماره‌های حساس را استخراج کن.\n\nبرچسب‌های اولویت‌دار:\n${LABELS.map((x,i)=>`${i+1}. ${x}`).join("\n")}\n\nقوانین: هر عدد را فقط وقتی قبول کن که کنار برچسب درست باشد. اگر چند شماره وجود دارد همه را در candidates بیاور. شماره سند فقط وقتی گزینه جایگزین باشد که پیگیری/رهگیری/مرجع پیدا نشده باشد. اعداد فارسی و عربی را به انگلیسی تبدیل کن. فاصله، نقطه، خط تیره و / را از شماره حذف کن. هرگز برای کامل کردن شماره، رقم جدید اضافه نکن؛ مخصوصاً «۱» را در ابتدای عدد اضافه نکن. عدد را دقیقاً از همان ردیف و همان برچسب کپی کن. رقم مبهم را حدس نزن و confidence را پایین بده یا مقدار را null کن. selected بهترین گزینه است و اگر مطمئن نیستی null باشد. evidence باید برچسب قابل مشاهده را کوتاه توضیح دهد. ${retry ? "این تلاش مجدد است؛ نتیجه قبلی اصلاً در اختیار تو نیست و باید مستقل از تصویر دوباره بخوانی." : ""}`;
  if (mode === "field_retry") return `این تصویر یک رسید بانکی/مالی ایرانی است. فقط فیلد «${retryField || "شماره پیگیری"}» را دوباره و مستقل از هر نتیجه قبلی بخوان. نتیجه قبلی وجود ندارد و نباید حدس بزنی. برچسب همان فیلد و عدد همان ردیف را تطبیق بده. اعداد فارسی/عربی را به انگلیسی تبدیل کن. اگر رقم واضح نیست null بده. ${retry ? "این یک تلاش مجدد مستقل است." : ""}`;
  return `تمام اطلاعات قابل خواندن این رسید بانکی/مالی ایرانی را استخراج کن. برای شماره‌های حساس بسیار سخت‌گیر باش و «برچسب + مقدار همان ردیف» را ملاک قرار بده. شماره‌های پیگیری/رهگیری/مرجع/سند را قاطی نکن. اعداد فارسی و عربی را به انگلیسی تبدیل کن. هیچ رقم اضافی، مخصوصاً «۱» ابتدای شماره، اضافه نکن. عدد را دقیقاً از روی تصویر و همان ردیف بخوان. اگر چیزی مبهم است null بده و حدس نزن. برای هر فیلد confidence و evidence بده. ${retry ? "این تلاش مجدد مستقل است و نتیجه قبلی را ندیده‌ای." : ""}`;
}

async function callVision(image, mode, retryField) {
  const isFast = mode === "fast" || mode === "retry";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      input: [{ role: "user", content: [{type:"input_text", text:promptFor(mode,retryField)}, {type:"input_image", image_url:image, detail:"high"}] }],
      text: { format: { type:"json_schema", name:isFast?"iranian_receipt_reference_v11":"iranian_receipt_full_v11", strict:true, schema:isFast?fastSchema:fullSchema } },
      reasoning: { effort: mode === "retry" || mode === "full_retry" || mode === "field_retry" ? "medium" : "low" },
      max_output_tokens: isFast ? 1100 : 1800
    })
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message || "Vision OCR request failed.");
  const text = body.output_text || body.output?.flatMap(i=>i.content||[]).map(c=>c.text).filter(Boolean).join("") || "";
  try { return JSON.parse(text); } catch { throw new Error("Vision returned invalid structured OCR."); }
}

function normalize(result, mode) {
  const nField = x => x ? {...x, value:cleanNumber(x.value), confidence:confidence(x.confidence), label:cleanText(x.label), evidence:cleanText(x.evidence)} : {value:null,confidence:0,label:null,evidence:null};
  if (mode === "full") {
    for (const k of fullKeys) result[k] = ["documentNumber","trackingNumber","referenceNumber","amount","destCardLast4"].includes(k) ? cleanNumber(result[k]) : cleanText(result[k]);
    for (const k of fullKeys) if (result.fields?.[k]) result.fields[k] = {...result.fields[k], value:["documentNumber","trackingNumber","referenceNumber","amount","destCardLast4"].includes(k)?cleanNumber(result.fields[k].value):cleanText(result.fields[k].value), confidence:confidence(result.fields[k].confidence), label:cleanText(result.fields[k].label), evidence:cleanText(result.fields[k].evidence)};
  } else {
    result.candidates=(result.candidates||[]).map(c=>({...c,value:cleanNumber(c.value),confidence:confidence(c.confidence),label:cleanText(c.label),kind:cleanText(c.kind),evidence:cleanText(c.evidence)})).filter(c=>c.value);
    result.selected=nField(result.selected); result.documentNumber=nField(result.documentNumber); result.trackingNumber=nField(result.trackingNumber); result.referenceNumber=nField(result.referenceNumber);
  }
  result.confidence=confidence(result.confidence); result.rawText=cleanText(result.rawText); result.mode=mode;
  return result;
}

app.get("/api/health", (_req,res)=>res.json({ok:true, visionConfigured:Boolean(process.env.OPENAI_API_KEY), model:MODEL, version:"receipt-ocr-v12"}));
app.get("/api/aed-rate", async (_req,res)=>{
  try {
    const r = await fetch("https://chandshode.com/", { headers: { "User-Agent": "Mozilla/5.0" } });
    const html = await r.text();
    if (!r.ok) throw new Error("Chand Shode unavailable");
    const normalized = html.replace(/\s+/g," ");
    const idx = normalized.indexOf("درهم امارات");
    if (idx < 0) throw new Error("AED rate not found on Chand Shode");
    const around = normalized.slice(idx, idx + 1800);
    const digits = normalizeDigits(around);
    const matches = [...digits.matchAll(/(?:درهم امارات)[^0-9]{0,300}([0-9]{4,8})/g)];
    const rate = matches.length ? Number(matches[0][1]) : null;
    if (!rate) throw new Error("AED rate could not be parsed");
    res.json({ rate, currency:"AED", source:"Chand Shode", fetchedAt:new Date().toISOString() });
  } catch (e) {
    console.error("AED rate error", e);
    res.status(502).json({ error:e?.message || "AED rate unavailable" });
  }
});
app.post("/api/ocr-receipt", async (req,res)=>{
  try {
    if(!process.env.OPENAI_API_KEY) return res.status(503).json({error:"OPENAI_API_KEY is not configured on the server."});
    const image=req.body?.image; const mode=["fast","full","retry","full_retry","field_retry"].includes(req.body?.mode)?req.body.mode:"fast"; const retryField=cleanText(req.body?.field);
    if(typeof image!=="string"||!image.startsWith("data:image/")) return res.status(400).json({error:"A receipt image data URL is required."});
    if(image.length>18_000_000) return res.status(413).json({error:"Image is too large."});
    // Deliberately do NOT accept or forward previous OCR results. Every retry starts from the image.
    const result=normalize(await callVision(image,mode,retryField),mode);
    res.json(result);
  } catch(e){ console.error("OCR server error",e); res.status(500).json({error:e?.message||"OCR server error"}); }
});

const dist=path.join(__dirname,"..","dist");
app.use(express.static(dist));
app.get(/.*/,(_req,res)=>res.sendFile(path.join(dist,"index.html")));
app.listen(PORT,()=>console.log(`Shared Ledger server listening on port ${PORT} — OCR v12`));
