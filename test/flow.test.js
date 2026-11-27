// اختبار كامل بدون إنترنت: سيرفر وهمي يمثل Claude وواتساب، ونتأكد من:
// استلام الويبهوك ← تكوين الطلب للنموذج ← تنفيذ الأدوات ← إرسال الرد للواتساب ← التحويل لموظف.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const claudeCalls = [];
const sent = [];
const rpcCalls = [];
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
let script = []; // الردود الوهمية من Claude بالترتيب

const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const json = body ? JSON.parse(body) : {};
    res.setHeader("content-type", "application/json");
    if (req.method === "GET" && req.url === "/v23.0/MEDIA1") {
      return res.end(JSON.stringify({ url: `http://127.0.0.1:${mock.address().port}/media/file`, mime_type: "image/png" }));
    }
    if (req.method === "GET" && req.url === "/media/file") {
      if (req.headers.authorization !== "Bearer wa-token") return (res.statusCode = 401), res.end();
      res.setHeader("content-type", "image/png");
      return res.end(PNG);
    }
    if (req.url.startsWith("/rest/v1/rpc/")) {
      rpcCalls.push({ fn: req.url.split("/").pop(), json, apikey: req.headers.apikey });
      if (json.p_token !== "store-token") return (res.statusCode = 401), res.end("{}");
      return res.end(req.url.endsWith("raddbot_load") ? "null" : "");
    }
    if (req.url.startsWith("/v1/messages")) {
      claudeCalls.push({ json, headers: req.headers });
      const next = script.shift() || { content: [{ type: "text", text: "تدلل" }], stop_reason: "end_turn" };
      return res.end(JSON.stringify({ id: "msg_x", type: "message", role: "assistant", model: json.model, usage: { input_tokens: 1, output_tokens: 1 }, ...next }));
    }
    if (req.url.includes("/messages")) {
      sent.push({ url: req.url, json, auth: req.headers.authorization, d360: req.headers["d360-api-key"] });
      return res.end(JSON.stringify({ messages: [{ id: "wamid.out" }] }));
    }
    res.statusCode = 404;
    res.end("{}");
  });
});

let base, app, server;
const SECRET = "app-secret";

before(async () => {
  await new Promise((r) => mock.listen(0, r));
  const mockUrl = `http://127.0.0.1:${mock.address().port}`;
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "raddbot-")),
    ANTHROPIC_API_KEY: "test-key",
    ANTHROPIC_BASE_URL: mockUrl,
    META_GRAPH_URL: mockUrl,
    WHATSAPP_TOKEN: "wa-token",
    META_APP_SECRET: SECRET,
    META_VERIFY_TOKEN: "verify-me",
    REPLY_DEBOUNCE_MS: "50",
    SUPABASE_URL: mockUrl,
    SUPABASE_KEY: "sb-key",
    STORAGE_TOKEN: "store-token",
  });
  delete process.env.ADMIN_PASSWORD;
  app = (await import("../src/server.js")).default;
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server?.close();
  mock.close();
});

const json = (r) => r.json();
const post = (url, body, headers = {}) =>
  fetch(base + url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const waitFor = async (fn, ms = 3000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error("timeout");
};
const signed = (body) => {
  const raw = JSON.stringify(body);
  const sig = "sha256=" + crypto.createHmac("sha256", SECRET).update(raw).digest("hex");
  return fetch(base + "/webhook", { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sig }, body: raw });
};
const waMsg = (id, from, text) => ({
  object: "whatsapp_business_account",
  entry: [{ changes: [{ value: { metadata: { phone_number_id: "PN1" }, contacts: [{ wa_id: from, profile: { name: "حسين" } }], messages: [{ id, from, type: "text", text: { body: text } }] } }] }],
});

test("التحقق من الويبهوك", async () => {
  assert.equal(await (await fetch(base + "/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=77")).text(), "77");
  assert.equal((await fetch(base + "/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=77")).status, 403);
  assert.equal((await post("/webhook", waMsg("x", "1", "hi"), { "x-hub-signature-256": "sha256=bad" })).status, 401);
});

test("رسالة واتساب ← طلب أكل ← رد يوصل للزبون", async () => {
  const [tenant] = await json(await fetch(base + "/api/tenants"));
  await fetch(base + "/api/tenants/" + tenant.id, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ channels: { whatsapp: "PN1" } }) });

  script = [
    {
      stop_reason: "tool_use",
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "tool_use", id: "tu_1", name: "create_request", input: { kind: "order", summary: "2 نفر تكة لحم = 18,000", customer_name: "حسين", phone: "", address: "الجادرية", when: "", notes: "" } },
      ],
    },
    { stop_reason: "end_turn", content: [{ type: "text", text: "**تم** انسجل طلبك 🌹 المجموع 20,000 ويه التوصيل." }] },
  ];
  const r = await signed(waMsg("wamid.A", "9647700000001", "اريد نفرين تكة للجادرية"));
  assert.equal(r.status, 200);

  await waitFor(() => sent.length >= 1);
  assert.equal(sent[0].url, "/v23.0/PN1/messages");
  assert.equal(sent[0].auth, "Bearer wa-token");
  assert.equal(sent[0].json.to, "9647700000001");
  assert.equal(sent[0].json.text.body, "*تم* انسجل طلبك 🌹 المجموع 20,000 ويه التوصيل."); // Markdown ينضبط لواتساب

  // شكل الطلب المرسل لـ Claude
  const first = claudeCalls[0].json;
  assert.equal(first.model, "claude-opus-5-5");
  assert.equal(first.fallbacks, "default");
  assert.deepEqual(first.thinking, { type: "adaptive" });
  assert.match(first.system[0].text, /بيت الكبة/);
  assert.match(first.system[0].text, /تكة لحم/);
  assert.ok(first.system[0].cache_control);
  assert.match(claudeCalls[0].headers["anthropic-beta"], /server-side-fallback-2026-07-01/);
  // الطلب الثاني يحمل نتيجة الأداة وكتلة التفكير بدون تعديل
  const second = claudeCalls[1].json.messages;
  assert.equal(second.at(-2).content[0].type, "thinking");
  assert.equal(second.at(-1).content[0].type, "tool_result");

  const orders = await json(await fetch(base + "/api/orders?tenantId=" + tenant.id));
  assert.equal(orders.length, 1);
  assert.equal(orders[0].address, "الجادرية");

  // نفس الرسالة إذا انعادت من Meta ما تنعالج مرتين
  await signed(waMsg("wamid.A", "9647700000001", "اريد نفرين تكة للجادرية"));
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(sent.length, 1);
});

test("تحويل لموظف يوقف الرد الآلي، والموظف يرد من اللوحة", async () => {
  sent.length = 0;
  script = [
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu_2", name: "handoff_to_human", input: { reason: "شكوى: الأكل وصل بارد", urgency: "normal" } }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "حقك علينا، موظف راح يتواصل وياك هسه." }] },
  ];
  await signed(waMsg("wamid.B", "9647700000002", "الاكل وصل بارد!!"));
  await waitFor(() => sent.length >= 1);

  const convs = await json(await fetch(base + "/api/conversations"));
  const conv = convs.find((c) => c.customerId === "9647700000002");
  assert.equal(conv.mode, "human");

  const callsBefore = claudeCalls.length;
  await signed(waMsg("wamid.C", "9647700000002", "وينكم؟"));
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(claudeCalls.length, callsBefore, "ما لازم النظام يرد بعد التحويل");
  assert.equal(sent.length, 1);

  await post(`/api/conversations/${conv.id}/reply`, { text: "هلا عيني، راح نبدلك الطلب" });
  assert.equal(sent.at(-1).json.text.body, "هلا عيني، راح نبدلك الطلب");
});

test("رسائل متتالية تنجمع برد واحد", async () => {
  sent.length = 0;
  const callsBefore = claudeCalls.length;
  script = [{ stop_reason: "end_turn", content: [{ type: "text", text: "هلا بيك، نفتح 12 الظهر" }] }];
  await signed(waMsg("wamid.D1", "9647700000003", "هلو"));
  await signed(waMsg("wamid.D2", "9647700000003", "شوكت تفتحون؟"));
  await waitFor(() => sent.length >= 1);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(claudeCalls.length - callsBefore, 1);
  const lastTurn = claudeCalls.at(-1).json.messages.at(-1);
  assert.deepEqual(lastTurn.content.map((b) => b.text), ["هلو", "شوكت تفتحون؟"]);
});

test("المحلات ما تختلط: كل محل يشوف معلوماته بس", async () => {
  const clinic = await json(await post("/api/tenants", { name: "عيادة الشفاء", type: "clinic", channels: { whatsapp: "PN2" }, knowledge: { hours: "من 4 العصر لـ 9" } }));
  script = [{ stop_reason: "end_turn", content: [{ type: "text", text: "الدوام من 4 العصر" }] }];
  await signed({ ...waMsg("wamid.E", "9647700000004", "شوكت الدوام؟"), entry: [{ changes: [{ value: { metadata: { phone_number_id: "PN2" }, contacts: [], messages: [{ id: "wamid.E", from: "9647700000004", type: "text", text: { body: "شوكت الدوام؟" } }] } }] }] });
  await waitFor(() => claudeCalls.at(-1).json.system[0].text.includes("عيادة الشفاء"));
  const sys = claudeCalls.at(-1).json.system[0].text;
  assert.doesNotMatch(sys, /بيت الكبة|تكة/);
  assert.match(sys, /ممنوع التشخيص/);
  assert.ok(clinic.id);
});

test("البيانات تنحفظ على Supabase", async () => {
  assert.equal(rpcCalls[0].fn, "raddbot_load");
  await waitFor(() => rpcCalls.some((c) => c.fn === "raddbot_save" && c.json.p_data.tenants.some((t) => t.name === "عيادة الشفاء")), 4000);
  assert.equal(rpcCalls.at(-1).apikey, "sb-key");
});

test("البيع: حساب السعر، حفظ الزبون، السلة، والمتابعة التلقائية", async () => {
  const { runFollowups } = await import("../src/followup.js");
  sent.length = 0;
  script = [
    {
      stop_reason: "tool_use",
      content: [
        { type: "tool_use", id: "q1", name: "quote_order", input: { items: [{ name: "تكه لحم", qty: 2 }, { name: "حمص", qty: 1 }], delivery_fee: 2000 } },
        { type: "tool_use", id: "r1", name: "remember_customer", input: { name: "مصطفى", phone: "", address: "الجادرية", preferences: "ما ياكل حار" } },
      ],
    },
    { stop_reason: "end_turn", content: [{ type: "text", text: "المجموع 22,500 ويه التوصيل. أسجلك؟" }] },
  ];
  await signed(waMsg("wamid.S1", "9647700000009", "نفرين تكة وحمص للجادرية شكد؟"));
  await waitFor(() => sent.length >= 1);
  const toolResults = claudeCalls.at(-1).json.messages.at(-1).content;
  assert.match(toolResults[0].content, /المجموع = 22,500 دينار/);

  let conv = (await json(await fetch(base + "/api/conversations"))).find((c) => c.customerId === "9647700000009");
  assert.equal(conv.stage, "quoted");
  assert.equal(conv.cart.total, 22500);
  assert.equal(conv.profile.preferences, "ما ياكل حار");
  // معلومات الزبون توصل للنموذج بالمرة الجاية
  assert.match(claudeCalls.at(-1).json.system[1].text, /مصطفى/);

  // بعد ساعة بدون رد: متابعة وحدة بس
  script = [{ stop_reason: "end_turn", content: [{ type: "text", text: "هلا مصطفى، بعدك تريد التكة؟ أسجلها هسه؟" }] }];
  const later = Date.now() + 61 * 60 * 1000;
  assert.equal(await runFollowups(later), 1);
  assert.equal(sent.at(-1).json.text.body, "هلا مصطفى، بعدك تريد التكة؟ أسجلها هسه؟");
  assert.equal(await runFollowups(later + 1000), 0, "المتابعة ما تتكرر");

  // الزبون يأكد بعد المتابعة
  script = [
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "c1", name: "create_request", input: { kind: "order", summary: "2 تكة لحم + حمص", total: 22500, customer_name: "مصطفى", phone: "", address: "الجادرية", when: "", notes: "بدون حار", upsell_accepted: true } }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "انسجل طلبك 🌹" }] },
  ];
  await signed(waMsg("wamid.S2", "9647700000009", "إي سجل"));
  await waitFor(() => sent.at(-1).json.text.body === "انسجل طلبك 🌹");
  conv = (await json(await fetch(base + "/api/conversations"))).find((c) => c.customerId === "9647700000009");
  assert.equal(conv.stage, "ordered");
  assert.equal(conv.profile.orderCount, 1);
  assert.equal(conv.profile.totalSpent, 22500);

  const a = await json(await fetch(`${base}/api/analytics?tenantId=${conv.tenantId}`));
  assert.ok(a.revenue >= 22500);
  assert.equal(a.followupWins, 1);
  assert.ok(a.upsellRate > 0);
});

test("رابط المتابعة المجدولة محمي", async () => {
  assert.equal((await post("/cron/followups", {})).status, 401);
});

test("صورة من واتساب توصل لـ Claude كصورة، والرد بأزرار يوصل كأزرار", async () => {
  sent.length = 0;
  script = [{ stop_reason: "end_turn", content: [{ type: "text", text: "هذا مشكل المشويات، يكفي 3-4 بـ 30,000. أسجلك؟\n[زر: ✅ أكد الطلب]\n[زر: ✏️ أغير شي]" }] }];
  await signed({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value: { metadata: { phone_number_id: "PN1" }, contacts: [], messages: [{ id: "wamid.IMG", from: "9647700000020", type: "image", image: { id: "MEDIA1", caption: "اريد هذا" } }] } }] }],
  });
  await waitFor(() => sent.length >= 1);
  const userTurn = claudeCalls.at(-1).json.messages.at(-1).content;
  assert.equal(userTurn[0].type, "image");
  assert.equal(userTurn[0].source.media_type, "image/png");
  assert.equal(userTurn[0].source.data, PNG.toString("base64"));
  assert.equal(userTurn[1].text, "اريد هذا");

  const out = sent.at(-1).json;
  assert.equal(out.type, "interactive");
  assert.equal(out.interactive.body.text, "هذا مشكل المشويات، يكفي 3-4 بـ 30,000. أسجلك؟");
  assert.deepEqual(out.interactive.action.buttons.map((b) => b.reply.title), ["✅ أكد الطلب", "✏️ أغير شي"]);

  // ضغطة الزر ترجع كنص عادي
  script = [{ stop_reason: "end_turn", content: [{ type: "text", text: "تمام" }] }];
  await signed({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value: { metadata: { phone_number_id: "PN1" }, contacts: [], messages: [{ id: "wamid.BTN", from: "9647700000020", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "b0", title: "✅ أكد الطلب" } } }] } }] }],
  });
  await waitFor(() => sent.length >= 2);
  const turn = claudeCalls.at(-1).json.messages.at(-1).content;
  assert.equal(turn.at(-1).text, "✅ أكد الطلب");
});

test("النظام يتعلم من رد الموظف ومن التصحيح", async () => {
  const convs = await json(await fetch(base + "/api/conversations"));
  const conv = convs.find((c) => c.customerId === "9647700000020");
  // تصحيح رد النظام
  const msgs = (await json(await fetch(base + "/api/conversations/" + conv.id))).messages;
  const botMsg = msgs.find((m) => m.role === "bot" && m.text.startsWith("هذا مشكل"));
  const ex = await json(await post(`/api/conversations/${conv.id}/correct`, { messageId: botMsg.id, text: "هذا مشكل المشويات بـ 30,000، بس عرض العائلة أوفر لك بـ 35,000 وياه كبة وحمص وسلطة ومشروبات" }));
  assert.equal(ex.customer, "اريد هذا");
  assert.equal(ex.source, "correction");

  // رد موظف
  await post(`/api/conversations/${conv.id}/reply`, { text: "هلا عيني، الطلب طالع هسه 🌹" });
  const [tenant] = await json(await fetch(base + "/api/tenants"));
  assert.equal(tenant.learned[0].reply, "هلا عيني، الطلب طالع هسه 🌹");
  assert.equal(tenant.learned[1].source, "correction");

  // الأمثلة توصل للنموذج بالتعليمات
  await post(`/api/conversations/${conv.id}/mode`, { mode: "bot" });
  script = [{ stop_reason: "end_turn", content: [{ type: "text", text: "تدلل" }] }];
  const before = claudeCalls.length;
  await signed(waMsg("wamid.L1", "9647700000021", "شنو عندكم عروض؟"));
  await waitFor(() => claudeCalls.length > before);
  assert.match(claudeCalls.at(-1).json.system[0].text, /ردود حقيقية من موظفينا/);
  assert.match(claudeCalls.at(-1).json.system[0].text, /عرض العائلة أوفر لك/);
});

test("التقرير اليومي يستخدم مخرجات منظمة وينحفظ", async () => {
  const [tenant] = await json(await fetch(base + "/api/tenants"));
  script = [
    {
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({ summary: "يوم زين", score: 8, wins: ["طلب تكة"], lost: [{ customer: "علي", reason: "ما رديت على صورة", fix: "" }], unanswered: ["عدكم بيتزا؟"], knowledge_suggestions: ["أضف البيتزا إذا موجودة"] }) }],
    },
  ];
  const r = await json(await post("/api/report", { tenantId: tenant.id }));
  assert.equal(r.score, 8);
  assert.deepEqual(r.unanswered, ["عدكم بيتزا؟"]);
  const req = claudeCalls.at(-1).json;
  assert.equal(req.output_config.format.type, "json_schema");
  assert.equal(req.output_config.format.schema.additionalProperties, false);
  const [after] = await json(await fetch(base + "/api/tenants"));
  assert.equal(after.reports[0].summary, "يوم زين");
});

test("واتساب عبر الشريك 360dialog: مفتاح بالرابط وإرسال بمفتاح D360", async () => {
  const mockUrl = process.env.META_GRAPH_URL;
  Object.assign(process.env, { WHATSAPP_PROVIDER: "360dialog", D360_URL: mockUrl, WEBHOOK_KEY: "hook-key" });
  try {
    const before = sent.length;
    const bad = await post("/webhook?key=wrong-key", waMsg("wamid.Q1", "9647700000099", "هلو"));
    assert.equal(bad.status, 401);
    script = [{ stop_reason: "end_turn", content: [{ type: "text", text: "هلا بيك 🌹" }] }];
    const ok = await post("/webhook?key=hook-key", waMsg("wamid.Q2", "9647700000099", "هلو"));
    assert.equal(ok.status, 200);
    await waitFor(() => sent.length > before);
    const m = sent.at(-1);
    assert.equal(m.url, "/messages");
    assert.equal(m.d360, "wa-token");
    assert.equal(m.auth, undefined);
    assert.equal(m.json.to, "9647700000099");
  } finally {
    delete process.env.WHATSAPP_PROVIDER; delete process.env.D360_URL; delete process.env.WEBHOOK_KEY;
  }
});
