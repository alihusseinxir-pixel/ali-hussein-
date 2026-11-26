// حاسبة الأسعار: تقرا المنيو المكتوب باللوحة وتحسب الطلب بدقة،
// حتى النموذج ما يغلط بالحساب أبداً (الحساب بالكود مو بالذكاء الاصطناعي).

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const toLatinDigits = (s) => String(s).replace(/[٠-٩]/g, (d) => AR_DIGITS.indexOf(d));

/** توحيد الكتابة العربية حتى «تكه» = «تكة» و«كبه حلب» = «كبة حلب» */
export function normalize(s) {
  return toLatinDigits(s)
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "") // تشكيل وتطويل
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/گ/g, "ك")
    .replace(/چ/g, "ج")
    .replace(/پ/g, "ب")
    .replace(/ڤ/g, "ف")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** يطلع قائمة الأصناف من نص المنيو. كل سطر بشكل: «اسم الصنف: السعر» */
export function parseMenu(text) {
  const items = [];
  for (const raw of String(text || "").split("\n")) {
    const line = toLatinDigits(raw).replace(/^\s*[-•*·]\s*/, "");
    const m = line.match(/^(.+?)\s*[:：=]\s*([\d][\d,٬.\s]*)\s*(?:د\.?ع|دينار|IQD)?\s*(.*)$/i);
    if (!m) continue;
    const price = Number(m[2].replace(/[,٬\s]/g, ""));
    if (!price || Number.isNaN(price)) continue;
    const name = m[1].trim();
    items.push({ name, price, note: m[3].replace(/^[()\s]+|[()\s]+$/g, ""), key: normalize(name), base: normalize(name.replace(/\(.*?\)/g, "")) });
  }
  return items;
}

/** يلگى أقرب صنف بالمنيو للاسم اللي كتبه النموذج */
export function matchItem(menu, query) {
  const q = normalize(query);
  const qBase = normalize(String(query).replace(/\(.*?\)/g, ""));
  if (!q) return null;
  let best = null;
  let bestScore = 0;
  for (const it of menu) {
    let score = 0;
    if (it.key === q) score = 100;
    else if (it.base === qBase) score = 90;
    else if (it.key.includes(qBase) || qBase.includes(it.base)) score = 60 + Math.min(it.base.length, qBase.length);
    else {
      const qw = new Set(qBase.split(" "));
      const shared = it.base.split(" ").filter((w) => qw.has(w)).length;
      if (shared) score = (shared / Math.max(qw.size, it.base.split(" ").length)) * 50;
    }
    if (score > bestScore) (bestScore = score), (best = it);
  }
  return bestScore >= 25 ? best : null;
}

export const fmt = (n) => Number(n).toLocaleString("en-US");

/**
 * items: [{name, qty}], deliveryFee: رقم
 * يرجع { lines, unmatched, subtotal, deliveryFee, total, text }
 */
export function quote(menuText, items, deliveryFee = 0) {
  const menu = parseMenu(menuText);
  const lines = [];
  const unmatched = [];
  for (const { name, qty } of items || []) {
    const q = Math.max(1, Math.round(Number(qty) || 1));
    const it = matchItem(menu, name);
    if (!it) unmatched.push(name);
    else lines.push({ name: it.name, qty: q, unit: it.price, total: it.price * q, note: it.note });
  }
  const subtotal = lines.reduce((s, l) => s + l.total, 0);
  const fee = Math.max(0, Number(deliveryFee) || 0);
  const total = subtotal + fee;
  const text = [
    ...lines.map((l) => `${l.qty} × ${l.name} = ${fmt(l.total)}`),
    fee ? `التوصيل = ${fmt(fee)}` : null,
    `المجموع = ${fmt(total)} دينار`,
    unmatched.length ? `⚠️ مو موجودة بالمنيو: ${unmatched.join("، ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return { lines, unmatched, subtotal, deliveryFee: fee, total, text };
}
