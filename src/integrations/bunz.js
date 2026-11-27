// ربط مباشر ويه نظام طلبات 10 BUNZ (موقع + لوحة تحكم على Supabase).
// الطلب يروح لنفس الدالة اللي يستخدمها موقعهم (bunz_place_order)، فيظهر بلوحة التحكم
// ويوصل إشعار الطلب الجديد لأجهزة المطعم تلقائياً (trigger بقاعدة بياناتهم).
const MENU_TTL = 5 * 60 * 1000;
const caches = new Map(); // url -> { at, items, settings }

export const bunzConfig = (tenant) => (tenant?.integration?.type === "bunz" && tenant.integration.url && tenant.integration.key ? tenant.integration : null);

async function call(cfg, path, body) {
  const res = await fetch(`${cfg.url}/rest/v1/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`10bunz ${path} ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

export async function loadMenu(cfg, { fresh = false } = {}) {
  const c = caches.get(cfg.url);
  if (!fresh && c && Date.now() - c.at < MENU_TTL) return c;
  const [items, settings] = await Promise.all([
    call(cfg, "bunz_items?select=id,name,price,options,sold_out&active=eq.true&order=sort.asc,id.asc"),
    call(cfg, "rpc/bunz_public_settings", {}),
  ]);
  const v = { at: Date.now(), items: items || [], settings: settings || {} };
  caches.set(cfg.url, v);
  return v;
}

// ---------- مطابقة الأسماء (الزبون والنموذج ما يكتبون الاسم حرفياً دائماً) ----------
export const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/گ/g, "ك")
    .replace(/[()\-–_.,،:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function bestMatch(list, name, key = (x) => x.name) {
  const n = norm(name);
  if (!n) return null;
  const exact = list.find((x) => norm(key(x)) === n);
  if (exact) return exact;
  const contains = list.filter((x) => norm(key(x)).includes(n) || n.includes(norm(key(x))));
  if (contains.length === 1) return contains[0];
  // الأقرب طولاً إذا أكثر من واحد يحتوي الاسم
  return contains.sort((a, b) => Math.abs(norm(key(a)).length - n.length) - Math.abs(norm(key(b)).length - n.length))[0] || null;
}

/** يحول اختيارات الزبون (أسماء) لصيغة موقعهم: sel[group] = [{i, n}] */
function buildSelection(item, picked) {
  const groups = item.options || [];
  const left = [...(picked || [])].map((p) => String(p));
  const sel = groups.map(() => []);
  const problems = [];
  groups.forEach((g, gi) => {
    const counts = new Map();
    for (let k = 0; k < left.length; k++) {
      const choice = bestMatch(g.choices.map((c, i) => ({ ...c, i })), left[k]);
      if (choice) {
        counts.set(choice.i, (counts.get(choice.i) || 0) + 1);
        left.splice(k--, 1);
      }
    }
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    const min = Number(g.min ?? 0), max = Number(g.max ?? 1);
    if (total < min || total > max) {
      problems.push(`«${item.name}»: ${g.name} (لازم ${min === max ? min : `${min} لـ ${max}`}، الخيارات: ${g.choices.map((c) => c.name).join("، ")})`);
    }
    sel[gi] = [...counts.entries()].map(([i, n]) => ({ i, n }));
  });
  return { sel, problems };
}

/** آخر موقع دزه الزبون بالمحادثة (رسالة موقع واتساب أو زر الموقع بصفحة التجربة) */
export function lastLocation(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "customer") continue;
    const x = /📍[^\d-]*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(.*)$/s.exec(m.text || "");
    if (x) return { lat: Number(x[1]), lng: Number(x[2]), label: x[3].trim().slice(0, 200) };
  }
  return null;
}

const toRad = (x) => (x * Math.PI) / 180;
export function distanceM(a, b, c, d) {
  const h = Math.sin(toRad(c - a) / 2) ** 2 + Math.cos(toRad(a)) * Math.cos(toRad(c)) * Math.sin(toRad(d - b) / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(h)));
}
/** نفس حساب موقعهم (الخادم مالهم يبقى هو الحكم النهائي) */
export function deliveryFee(s, distM, subtotal = 0) {
  const km = distM / 1000;
  if (s.max_km > 0 && km > s.max_km) return null;
  if (s.free_delivery_above > 0 && subtotal >= s.free_delivery_above) return 0;
  if (s.delivery_mode === "flat") return s.flat_fee;
  for (const t of [...(s.tiers || [])].sort((x, y) => x.upto_km - y.upto_km)) if (km <= t.upto_km) return t.fee;
  return null;
}

/** سطور تنضاف لتعليمات الرد: هل المطعم مفتوح، موقع الزبون وأجرة التوصيل، والخيارات المطلوبة */
export async function contextFor(tenant, messages) {
  const cfg = bunzConfig(tenant);
  if (!cfg) return "";
  try {
    const { items, settings: s } = await loadMenu(cfg);
    const lines = ["<نظام_الطلبات>"];
    lines.push(s.is_open === false ? "المطعم مسكر هسه حسب نظام الطلبات: لا تسجل طلب، گول للزبون الدوام وخليه يطلب من يفتح." : "المطعم مفتوح ويستلم طلبات هسه.");
    if (s.announcement) lines.push(`إعلان المطعم: ${s.announcement}`);
    const soldOut = items.filter((i) => i.sold_out).map((i) => i.name);
    if (soldOut.length) lines.push(`خالص هسه (لا تبيعه): ${soldOut.join("، ")}`);
    const loc = lastLocation(messages);
    if (loc && s.rest_lat) {
      const d = distanceM(s.rest_lat, s.rest_lng, loc.lat, loc.lng);
      const fee = deliveryFee(s, d);
      lines.push(
        fee == null
          ? `موقع الزبون وصل: يبعد ${(d / 1000).toFixed(1)} كم، خارج منطقة التوصيل (أقصى ${s.max_km} كم). اقترح الاستلام من المطعم.`
          : `موقع الزبون وصل: يبعد ${(d / 1000).toFixed(1)} كم، أجرة التوصيل ${fee.toLocaleString("en-US")} دينار.`
      );
    } else {
      lines.push("موقع الزبون ما وصل بعد. للتوصيل لازم الزبون يدز اللوكيشن (📎 ← الموقع) حتى نحسب الأجرة ونسجل الطلب.");
    }
    const tiers = (s.tiers || []).map((t) => `لحد ${t.upto_km} كم: ${t.fee.toLocaleString("en-US")}`).join("، ");
    if (tiers) lines.push(`أجور التوصيل حسب المسافة: ${tiers}.`);
    const withOptions = items.filter((i) => i.options?.length);
    if (withOptions.length) {
      lines.push("أصناف تحتاج اختيار قبل التسجيل (اسأل الزبون إذا ما حدد):");
      const seen = new Set();
      for (const i of withOptions) {
        const desc = i.options.map((g) => `${g.name}: ${g.choices.map((c) => c.name + (c.price ? ` (+${c.price})` : "")).join("، ")}`).join(" | ");
        if (seen.has(desc) && i.options.length === 1) continue; // نوع اللحم نفسه لكل البركرات: نكتبه مرة
        seen.add(desc);
        lines.push(`- ${i.options.length === 1 && i.options[0].name.includes("اللحم") ? "كل بركر ووجبة لحم" : i.name}: ${desc}`);
      }
    }
    lines.push("</نظام_الطلبات>");
    return lines.join("\n");
  } catch (e) {
    console.error("[bunz] context", e.message);
    return "";
  }
}

const ERRORS = {
  closed: "المطعم مسكر هسه، ما ينسجل طلب. گول للزبون الدوام.",
  name: "الاسم ناقص أو غلط. اسأل الزبون عن اسمه.",
  phone: "رقم الموبايل لازم يكون عراقي مثل 07XXXXXXXXX. اسأل الزبون عن رقمه.",
  type: "نوع الطلب غير متاح (توصيل/استلام).",
  too_many: "طلبات كثيرة من نفس الرقم خلال 10 دقايق. خلي الموظف يتابع.",
  items: "ماكو أصناف بالطلب.",
  qty: "الكمية لازم من 1 لـ 20 لكل صنف.",
  min_order: "المجموع أقل من الحد الأدنى للطلب.",
  location: "موقع الزبون ما وصل. اطلب منه يدز اللوكيشن من الواتساب (📎 ← الموقع)، أو يختار استلام.",
  out_of_range: "موقع الزبون خارج منطقة التوصيل. اقترح الاستلام من المطعم.",
};

/**
 * يسجل الطلب بنظام 10 BUNZ نفسه.
 * input: { items:[{name, qty, options[], note}], order_type, customer_name, phone, address_note, notes }
 * يرجع { ok, result (نص للنموذج), order? }
 */
export async function placeOrder(tenant, conversation, messages, input, { test = false } = {}) {
  const cfg = bunzConfig(tenant);
  const { items } = await loadMenu(cfg);
  const lines = [];
  const problems = [];
  for (const it of input.items || []) {
    const item = bestMatch(items, it.name);
    if (!item) {
      problems.push(`«${it.name}» مو موجود بالمنيو`);
      continue;
    }
    if (item.sold_out) {
      problems.push(`«${item.name}» خالص هسه`);
      continue;
    }
    const { sel, problems: p } = buildSelection(item, it.options);
    problems.push(...p);
    lines.push({ id: item.id, qty: Math.max(1, Math.min(20, Number(it.qty) || 1)), sel, note: String(it.note || "").slice(0, 120) });
  }
  if (problems.length) return { ok: false, result: `ما انسجل الطلب. صحح ويه الزبون:\n- ${problems.join("\n- ")}` };

  const type = input.order_type === "pickup" ? "pickup" : "delivery";
  const loc = type === "delivery" ? lastLocation(messages) : null;
  const payload = {
    name: String(input.customer_name || conversation.profile?.name || conversation.customerName || "").trim(),
    phone: String(input.phone || conversation.profile?.phone || (conversation.channel === "whatsapp" ? conversation.customerId : "")).trim(),
    type,
    lat: loc?.lat ?? null,
    lng: loc?.lng ?? null,
    location_label: loc?.label || "",
    address_note: String(input.address_note || "").slice(0, 200),
    notes: [test ? "🧪 طلب تجريبي من صفحة التجربة (رد)" : `💬 من ${conversation.channel === "whatsapp" ? "الواتساب" : conversation.channel === "instagram" ? "الانستغرام" : conversation.channel} عن طريق الرد الآلي`, input.notes]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 500),
    source: cfg.source || "raddbot",
    items: lines,
  };
  const r = await call(cfg, "rpc/bunz_place_order", { p: payload });
  if (r?.error) {
    let msg = ERRORS[r.error] || `ما انسجل الطلب (${r.error}).`;
    if (r.error === "item_unavailable") msg = "أحد الأصناف خالص هسه. گول للزبون واقترح بديل.";
    if (r.error === "option") msg = `اختيار ناقص${r.item ? ` بـ «${r.item}» (${r.group})` : ""}. اسأل الزبون.`;
    if (r.error === "min_order") msg += ` الحد الأدنى ${r.min}.`;
    if (r.error === "item_unavailable" || r.error === "closed") loadMenu(cfg, { fresh: true }).catch(() => {});
    return { ok: false, result: `ما انسجل الطلب: ${msg}` };
  }
  const track = cfg.siteUrl && r.token ? `${cfg.siteUrl.replace(/\/$/, "")}/r.html?t=${r.token}` : "";
  const summary = (r.lines || []).map((l) => `${l.qty} × ${l.name}${l.options ? ` (${l.options})` : ""}`).join("، ");
  const fmt = (n) => Number(n || 0).toLocaleString("en-US");
  return {
    ok: true,
    order: { orderNo: r.order_no, token: r.token, subtotal: r.subtotal, deliveryFee: r.delivery_fee, total: r.total, summary, type, track },
    result:
      `انسجل الطلب بلوحة تحكم المطعم برقم #${r.order_no} ووصلهم إشعار.\n${summary}\n` +
      `المجموع ${fmt(r.subtotal)}${type === "delivery" ? ` + توصيل ${fmt(r.delivery_fee)} = ${fmt(r.total)}` : ""} دينار.` +
      (track ? `\nرابط متابعة الطلب للزبون: ${track}` : "") +
      "\nأكد للزبون الرقم والمجموع ووقت التوصيل، ودزله رابط المتابعة.",
  };
}
