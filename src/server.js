import "dotenv/config";
import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import * as db from "./db.js";
import * as whatsapp from "./channels/whatsapp.js";
import * as meta from "./channels/meta.js";
import { handleIncoming, staffReply } from "./engine.js";
import { aiEnabled } from "./brain.js";
import { seedIfEmpty } from "./seed.js";
import { runFollowups, startFollowupLoop } from "./followup.js";

const app = express();
const PORT = Number(process.env.PORT || 3000);

// نحتفظ بالجسم الخام حتى نتحقق من توقيع Meta
app.use(express.json({ limit: "2mb", verify: (req, _res, buf) => (req.rawBody = buf) }));

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
app.post("/cron/followups", async (req, res) => {
  const token = process.env.CRON_TOKEN;
  const given = req.get("x-cron-token") || "";
  if (!token || given.length !== token.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token)))
    return res.sendStatus(401);
  res.json({ sent: await runFollowups() });
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

api.get("/analytics", (req, res) => res.json(db.analytics(req.query.tenantId, Number(req.query.days) || 30)));

api.get("/orders", (req, res) => res.json(db.listOrders(req.query.tenantId)));
api.put("/orders/:id", (req, res) => {
  const o = db.updateOrder(req.params.id, { status: req.body?.status });
  o ? res.json(o) : res.sendStatus(404);
});

// المحاكي: تجرب كأنك زبون بدون واتساب
api.post("/simulate", async (req, res) => {
  const { tenantId, customerId = "test-customer", text } = req.body || {};
  if (!tenantId || !text) return res.status(400).json({ error: "tenantId و text مطلوبة" });
  try {
    const result = await handleIncoming({ channel: "simulator", tenantId, customerId, customerName: "زبون تجريبي", text });
    res.json({ ok: true, reply: result?.reply || null, actions: result?.actions || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.use("/api", api);
app.use("/", adminAuth, express.static(path.resolve("public")));

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
