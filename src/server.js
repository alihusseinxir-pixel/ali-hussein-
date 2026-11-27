import "dotenv/config";
import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import * as db from "./db.js";
import * as whatsapp from "./channels/whatsapp.js";
import * as meta from "./channels/meta.js";
import { handleIncoming, staffReply } from "./engine.js";
import { aiEnabled } from "./brain.js";
import { seedIfEmpty, demoTenant, salesTenant, prospectTenant, prospectBrand } from "./seed.js";
import { notifyText } from "./notify.js";
import { runFollowups, startFollowupLoop } from "./followup.js";
import { generateReport, runDailyReports } from "./report.js";
import { correctBotReply } from "./engine.js";

const app = express();
const PORT = Number(process.env.PORT || 3000);

// نحتفظ بالجسم الخام حتى نتحقق من توقيع Meta
app.use(express.json({ limit: "8mb", verify: (req, _res, buf) => (req.rawBody = buf) }));

app.get("/health", (_req, res) => res.json({ ok: true, ai: aiEnabled() }));

// ================= Webhook واحد لكل منصات Meta =================
// واتساب + ماسنجر + انستغرام كلهم يوصلون هنا
app.get("/webhook", (req, res) => {
  const ok =
    req.query["hub.mode"] === "subscribe" &&
    process.env.META_VERIFY_TOKEN &&
    req.query["hub.verify_token"] === process.env.META_VERIFY_TOKEN;
  if (ok) return res.status(200).send(req.query["hub.challenge"]);
  res.sendStatus(403);
});

function validSignature(req) {
  // 360dialog ما يوقّع الرسائل: نحمي الويبهوك بمفتاح سري بالرابط ‎/webhook?key=...
  const shared = process.env.WEBHOOK_KEY;
  if (shared && req.query.key) {
    const a = Buffer.from(String(req.query.key)), b = Buffer.from(shared);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  const secret = process.env.META_APP_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production"; // بالتجربة المحلية نسمح، بالإنتاج لازم السر
  const sig = req.get("x-hub-signature-256") || "";
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(req.rawBody || "").digest("hex");
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

app.post("/webhook", (req, res) => {
  if (!validSignature(req)) return res.sendStatus(401);
  res.sendStatus(200); // Meta تريد رد سريع، والشغل يكمل بالخلفية
  const items = [...whatsapp.parseWebhook(req.body), ...meta.parseWebhook(req.body)];
  for (const it of items) handleIncoming(it).catch((e) => console.error("[webhook]", e));
});

// ================= المتابعة الدورية =================
// السيرفر المجاني ينام، فمهمة مجدولة خارجية (Supabase cron) تنادي هذا الرابط كل 10 دقايق
function cronAuth(req, res, next) {
  const token = process.env.CRON_TOKEN;
  const given = req.get("x-cron-token") || "";
  if (!token || given.length !== token.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token)))
    return res.sendStatus(401);
  next();
}
app.post("/cron/followups", cronAuth, async (_req, res) => res.json({ sent: await runFollowups() }));
app.post("/cron/report", cronAuth, async (_req, res) => {
  res.json({ started: true }); // التقرير ياخذ وقت، نرد فوراً ونكمل
  runDailyReports().catch((e) => console.error("[report]", e));
});

// ================= لوحة التحكم =================
function adminAuth(req, res, next) {
  const pass = process.env.ADMIN_PASSWORD;
  if (!pass) {
    // بدون كلمة سر = تشغيل محلي فقط. على الإنترنت نقفل اللوحة حتى ما يدخلها أحد
    if (process.env.NODE_ENV === "production") return res.status(503).send("ADMIN_PASSWORD مو محددة");
    return next();
  }
  const [, b64 = ""] = (req.get("authorization") || "").split(" ");
  const [, given = ""] = Buffer.from(b64, "base64").toString().split(":");
  const a = Buffer.from(given), b = Buffer.from(pass);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
  res.set("WWW-Authenticate", 'Basic realm="raddbot"').sendStatus(401);
}

const api = express.Router();
api.use(adminAuth);

// نخفي التوكنات الخاصة من اللوحة
const publicTenant = (t) => ({ ...t, secrets: undefined, hasSecrets: Boolean(t.secrets && Object.values(t.secrets).some(Boolean)) });

api.get("/status", (_req, res) =>
  res.json({
    ai: aiEnabled(),
    model: process.env.CLAUDE_MODEL || "claude-opus-5-5",
    whatsapp: Boolean(process.env.WHATSAPP_TOKEN),
    metaPages: Boolean(process.env.META_PAGE_TOKEN),
    telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    webhookSecured: Boolean(process.env.META_APP_SECRET),
  })
);

api.get("/tenants", (_req, res) => res.json(db.listTenants().map(publicTenant)));
api.post("/tenants", (req, res) => {
  const { name, type, knowledge, channels, botEnabled, telegramChatId, secrets } = req.body || {};
  if (!name) return res.status(400).json({ error: "اسم المحل مطلوب" });
  res.json(publicTenant(db.saveTenant({ name, type: type || "other", knowledge: knowledge || {}, channels: channels || {}, botEnabled: botEnabled !== false, telegramChatId: telegramChatId || "", secrets: secrets || {} })));
});
api.put("/tenants/:id", (req, res) => {
  const t = db.getTenant(req.params.id);
  if (!t) return res.sendStatus(404);
  const patch = {};
  for (const k of ["name", "type", "knowledge", "channels", "botEnabled", "followupEnabled", "telegramChatId"])
    if (k in (req.body || {})) patch[k] = req.body[k];
  if (req.body?.secrets) {
    // الحقل الفارغ يعني "لا تغيّر"
    patch.secrets = { ...(t.secrets || {}) };
    for (const [k, v] of Object.entries(req.body.secrets)) if (v) patch.secrets[k] = v;
  }
  res.json(publicTenant(db.saveTenant({ ...patch, id: t.id })));
});
api.delete("/tenants/:id", (req, res) => {
  db.deleteTenant(req.params.id);
  res.json({ ok: true });
});

api.get("/conversations", (req, res) => res.json(db.listConversations(req.query.tenantId)));
api.get("/conversations/:id", (req, res) => {
  const c = db.getConversation(req.params.id);
  if (!c) return res.sendStatus(404);
  db.updateConversation(c.id, { unread: 0 });
  res.json({ conversation: c, messages: db.listMessages(c.id, 500) });
});
api.post("/conversations/:id/mode", (req, res) => {
  const mode = req.body?.mode === "human" ? "human" : "bot";
  const c = db.updateConversation(req.params.id, { mode, ...(mode === "bot" ? { handoffReason: "", urgency: "" } : {}) });
  if (!c) return res.sendStatus(404);
  db.addMessage({ conversationId: c.id, role: "note", text: mode === "human" ? "👤 موظف استلم المحادثة" : "🤖 رجع الرد الآلي" });
  res.json(c);
});
api.post("/conversations/:id/reply", async (req, res) => {
  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "الرسالة فارغة" });
  try {
    db.updateConversation(req.params.id, { mode: "human" }); // الموظف رد = هو ماسك المحادثة
    res.json(await staffReply(req.params.id, text));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

api.post("/report", async (req, res) => {
  try {
    res.json(await generateReport(req.body?.tenantId, { hours: Number(req.body?.hours) || 24, includeSimulator: Boolean(req.body?.includeSimulator) }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
api.post("/conversations/:id/correct", (req, res) => {
  try {
    res.json(correctBotReply(req.params.id, req.body?.messageId, String(req.body?.text || "").trim()));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
api.delete("/tenants/:id/learned/:exId", (req, res) => {
  db.removeLearnedExample(req.params.id, req.params.exId);
  res.json({ ok: true });
});

api.get("/analytics", (req, res) => res.json(db.analytics(req.query.tenantId, Number(req.query.days) || 30)));

api.get("/orders", (req, res) => res.json(db.listOrders(req.query.tenantId)));
api.put("/orders/:id", (req, res) => {
  const o = db.updateOrder(req.params.id, { status: req.body?.status });
  o ? res.json(o) : res.sendStatus(404);
});

// المحاكي: تجرب كأنك زبون بدون واتساب
api.post("/simulate", async (req, res) => {
  const { tenantId, customerId = "test-customer", text, image } = req.body || {};
  if (!tenantId || (!text && !image)) return res.status(400).json({ error: "tenantId و text مطلوبة" });
  try {
    const result = await handleIncoming({
      channel: "simulator",
      tenantId,
      customerId,
      customerName: "زبون تجريبي",
      text: text || "[صورة]",
      image: image?.base64 ? { base64: image.base64, mediaType: image.mediaType } : null,
    });
    res.json({ ok: true, reply: result?.reply || null, buttons: result?.buttons || [], actions: result?.actions || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.use("/api", api);

// ================= موقع البيع العام + التجربة الحية =================
// حد للاستخدام حتى ما أحد يصرف رصيد Claude: لكل IP، ولكل يوم
const hits = new Map();
const DEMO_PER_IP_HOUR = Number(process.env.DEMO_PER_IP_HOUR || 25);
const DEMO_PER_DAY = Number(process.env.DEMO_PER_DAY || 400);
let dayKey = "", dayCount = 0;
function demoLimit(req, res, next) {
  const ip = (req.get("x-forwarded-for") || req.ip || "").split(",").pop().trim(); // آخر قيمة يضيفها Render، ما يگدر الزائر يزورها
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 3600_000);
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dayKey) (dayKey = today), (dayCount = 0);
  if (list.length >= DEMO_PER_IP_HOUR || dayCount >= DEMO_PER_DAY)
    return res.status(429).json({ error: "وصلت حد التجربة لهسه. اترك رقمك ونتواصل وياك 🌹" });
  list.push(now);
  hits.set(ip, list);
  dayCount++;
  if (hits.size > 5000) hits.clear();
  next();
}

app.post("/demo/chat", demoLimit, async (req, res) => {
  const { sessionId, text, mode, slug } = req.body || {};
  const clean = String(text || "").trim().slice(0, 500);
  const sid = String(sessionId || "").replace(/[^a-z0-9]/gi, "").slice(0, 24);
  const tenant = slug ? prospectTenant(String(slug)) : mode === "sales" ? salesTenant() : demoTenant();
  if (!clean || !sid || !tenant) return res.status(400).json({ error: "رسالة فارغة" });
  try {
    const result = await handleIncoming({ channel: "demo", tenantId: tenant.id, customerId: `demo-${sid}`, customerName: "", text: clean });
    if (!result?.reply && slug) {
      const c = db.listConversations(tenant.id).find((x) => x.customerId === `demo-${sid}`);
      if (c?.mode === "human") return res.json({ reply: "", buttons: [], events: [{ type: "handoff_active" }] });
    }
    if (!result?.reply) return res.status(503).json({ error: "التجربة الحية متوقفة مؤقتاً، جرب بعد شوية أو اترك رقمك تحت ونتواصل وياك 🌹" });
    // أحداث تبين لصاحب المحل شنو يصير وراء الكواليس (طلب انسجل، تحويل لموظف)
    const events = (result.actions || [])
      .map((a) => (a.type === "order" ? { type: "order", ref: a.order.id.slice(-6), summary: a.order.summary || "", total: a.order.total || 0 } : a.type === "handoff" ? { type: "handoff" } : null))
      .filter(Boolean);
    res.json({ reply: result.reply, buttons: result.buttons || [], events });
  } catch (e) {
    console.error("[demo]", e.message);
    res.status(500).json({ error: "صار خطأ، جرب مرة ثانية" });
  }
});

// صفحة تجربة باسم محل حقيقي: /try/10bunz
app.get("/demo/info/:slug", (req, res) => {
  const brand = prospectBrand(req.params.slug);
  const t = prospectTenant(req.params.slug);
  if (!brand || !t) return res.status(404).json({ error: "غير موجود" });
  res.json({ ...brand, hours: t.knowledge?.hours || "", location: t.knowledge?.location || "" });
});
app.get("/try/:slug", (req, res) => (prospectBrand(req.params.slug) ? res.sendFile(path.resolve("public/try/index.html")) : res.redirect("/")));

app.post("/demo/lead", demoLimit, async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // فخ للبوتات
  const field = (k, n = 120) => String(b[k] || "").trim().slice(0, n);
  const lead = { name: field("name"), business: field("business"), type: field("type", 40), city: field("city", 60), phone: field("phone", 30), notes: field("notes", 500) };
  if (!lead.name || !/^[+\d\s-]{7,20}$/.test(lead.phone)) return res.status(400).json({ error: "اكتب اسمك ورقم موبايل صحيح" });
  const sales = salesTenant();
  if (!sales) return res.status(500).json({ error: "غير متاح" });
  const order = db.addOrder({
    tenantId: sales.id,
    channel: "website",
    kind: "appointment",
    summary: `طلب تجربة مجانية: ${lead.business || "محل"} (${lead.type || "؟"}) - ${lead.city || ""}`,
    customer_name: lead.name,
    phone: lead.phone,
    address: lead.city,
    when: "",
    notes: lead.notes,
    total: 0,
    upsell_accepted: false,
  });
  notifyText(sales, `🎯 زبون محتمل جديد من الموقع\n${lead.name} · ${lead.phone}\n${order.summary}${lead.notes ? `\n${lead.notes}` : ""}`).catch(() => {});
  res.json({ ok: true });
});

app.get("/admin", (req, res, next) => (req.originalUrl.split("?")[0] === "/admin" ? res.redirect("/admin/") : next()));
app.use("/admin", adminAuth, express.static(path.resolve("public/admin")));
app.use("/", express.static(path.resolve("public/site")));

await db.init();
seedIfEmpty();
for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, async () => {
    db.flush();
    await db.flushRemote();
    process.exit(0);
  });

if (process.env.NODE_ENV !== "test") {
  startFollowupLoop();
  app.listen(PORT, () => {
    console.log(`✅ السيرفر شغال: http://localhost:${PORT}`);
    console.log(aiEnabled() ? "🧠 Claude مفعل" : "⚠️  ماكو ANTHROPIC_API_KEY — النظام بالوضع التجريبي (ردود بسيطة)");
  });
}

export default app;
