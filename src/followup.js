// المتابعة التلقائية: الزبون اللي شاف سعر طلبه وما أكد، نذكره مرة وحدة بلطف.
// نلتزم بنافذة الـ 24 ساعة مال واتساب: نرسل بس إذا آخر رسالة من الزبون قبل أقل من 23 ساعة.
import * as db from "./db.js";
import { generateFollowup } from "./brain.js";
import { deliver } from "./engine.js";

const AFTER_MIN = () => Number(process.env.FOLLOWUP_AFTER_MIN ?? 60);
const WINDOW_MS = 23 * 60 * 60 * 1000;

export function dueConversations(now = Date.now()) {
  const due = [];
  for (const c of db.listConversations()) {
    const tenant = db.getTenant(c.tenantId);
    if (!tenant || tenant.botEnabled === false || tenant.followupEnabled === false) continue;
    if (c.mode !== "bot" || c.stage !== "quoted" || c.followupSentAt || !c.quotedAt) continue;
    if (now - Date.parse(c.quotedAt) < AFTER_MIN() * 60 * 1000) continue;
    const msgs = db.listMessages(c.id, 50).filter((m) => m.role !== "note");
    const lastCustomer = [...msgs].reverse().find((m) => m.role === "customer");
    if (!lastCustomer || now - Date.parse(lastCustomer.at) > WINDOW_MS) continue;
    if (msgs.at(-1)?.role === "customer") continue; // الزبون رد وننتظر الرد الآلي، مو وقت متابعة
    due.push({ tenant, conversation: db.getConversation(c.id) });
  }
  return due;
}

export async function runFollowups(now = Date.now()) {
  let sent = 0;
  for (const { tenant, conversation } of dueConversations(now)) {
    // نعلّم قبل الإرسال حتى ما تنرسل مرتين لو صار خطأ بالنص
    db.updateConversation(conversation.id, { followupSentAt: new Date(now).toISOString() });
    try {
      const text = await generateFollowup({ tenant, conversation });
      if (!text) continue;
      db.addMessage({ conversationId: conversation.id, role: "bot", text });
      db.addMessage({ conversationId: conversation.id, role: "note", text: "⏰ رسالة متابعة تلقائية" });
      await deliver(tenant, conversation, text);
      sent++;
    } catch (err) {
      console.error("[followup]", err.message);
      db.addMessage({ conversationId: conversation.id, role: "note", text: `⚠️ المتابعة ما وصلت: ${err.message}` });
    }
  }
  return sent;
}

export function startFollowupLoop() {
  const every = Number(process.env.FOLLOWUP_CHECK_MIN ?? 5) * 60 * 1000;
  setInterval(() => runFollowups().catch((e) => console.error("[followup]", e)), every).unref();
}
