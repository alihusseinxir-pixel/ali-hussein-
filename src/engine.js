// المحرك: يستلم رسالة موحدة من أي قناة، يلقى المحل، يولد الرد، ويرسله.
import * as db from "./db.js";
import { generateReply } from "./brain.js";
import * as whatsapp from "./channels/whatsapp.js";
import * as meta from "./channels/meta.js";
import { notifyOwner } from "./notify.js";
import { downloadWhatsAppImage, downloadUrlImage } from "./media.js";

const senders = {
  whatsapp: whatsapp.sendText,
  messenger: meta.sendText,
  instagram: meta.sendText,
};

/** التوكن لكل محل (إذا عنده حساب Meta خاص) أو التوكن العام من الإعدادات */
function tokenFor(tenant, channel) {
  if (channel === "whatsapp") return tenant.secrets?.whatsappToken || process.env.WHATSAPP_TOKEN;
  return tenant.secrets?.pageToken || process.env.META_PAGE_TOKEN;
}

/** يرسل رسالة للزبون على قناته. القناة "simulator" ما ترسل لأي مكان (للتجربة من اللوحة). */
export async function deliver(tenant, conversation, text, buttons = []) {
  if (db.TEST_CHANNELS.has(conversation.channel)) return;
  const send = senders[conversation.channel];
  const token = tokenFor(tenant, conversation.channel);
  if (!send || !token) throw new Error(`القناة ${conversation.channel} مو مربوطة (ناقص التوكن)`);
  await send({ accountId: tenant.channels[conversation.channel], customerId: conversation.customerId, text, token, buttons });
}

async function fetchImage(tenant, incoming, key) {
  try {
    if (incoming.image?.mediaId) return await downloadWhatsAppImage(incoming.image.mediaId, tokenFor(tenant, "whatsapp"), key);
    if (incoming.image?.url) return await downloadUrlImage(incoming.image.url, key);
    if (incoming.image?.base64) {
      const { putImage } = await import("./media.js");
      return putImage(key, incoming.image.mediaType, Buffer.from(incoming.image.base64, "base64"));
    }
  } catch (err) {
    console.error("[media]", err.message);
  }
  return false;
}

// طابور لكل محادثة حتى إذا الزبون دز 3 رسائل ورا بعض، نرد بالترتيب ومرة وحدة على الكل
const queues = new Map();
const pending = new Map();
const DEBOUNCE_MS = Number(process.env.REPLY_DEBOUNCE_MS ?? 1500);

/**
 * incoming: { channel, accountId, customerId, customerName, text, externalId, tenantId? }
 * يرجع Promise تنحل بعد ما ينرسل الرد (مفيد للمحاكي والاختبارات).
 */
export async function handleIncoming(incoming) {
  const tenant = incoming.tenantId
    ? db.getTenant(incoming.tenantId)
    : db.findTenantByChannel(incoming.channel, incoming.accountId);
  if (!tenant) {
    console.warn(`[engine] رسالة على حساب غير مربوط بأي محل: ${incoming.channel}/${incoming.accountId}`);
    return null;
  }
  const conversation = db.getOrCreateConversation({
    tenantId: tenant.id,
    channel: incoming.channel,
    customerId: incoming.customerId,
    customerName: incoming.customerName,
  });
  const saved = db.addMessage({
    conversationId: conversation.id,
    role: "customer",
    text: incoming.text,
    externalId: incoming.externalId,
    media: incoming.image ? "image" : null,
  });
  if (!saved) return null; // رسالة مكررة
  if (incoming.image && !(await fetchImage(tenant, incoming, saved.id))) {
    db.updateMessage(saved.id, { media: "image-unavailable" });
  }

  if (!tenant.botEnabled || db.getConversation(conversation.id).mode === "human") return null;

  // ننتظر شوية حتى نجمع الرسائل المتتالية ونرد مرة وحدة
  const key = conversation.id;
  clearTimeout(pending.get(key)?.timer);
  return new Promise((resolve) => {
    const waiters = [...(pending.get(key)?.waiters || []), resolve];
    const timer = setTimeout(() => {
      pending.delete(key);
      const prev = queues.get(key) || Promise.resolve();
      const run = prev
        .then(() => respond(tenant.id, key))
        .catch((err) => console.error("[engine]", err))
        .then((r) => waiters.forEach((w) => w(r ?? null)));
      queues.set(key, run);
    }, DEBOUNCE_MS);
    pending.set(key, { timer, waiters });
  });
}

async function respond(tenantId, conversationId) {
  const tenant = db.getTenant(tenantId);
  const conversation = db.getConversation(conversationId);
  if (!tenant || !conversation || conversation.mode === "human" || !tenant.botEnabled) return null;

  let result;
  try {
    result = await generateReply({ tenant, conversation });
  } catch (err) {
    console.error("[brain] فشل توليد الرد:", err.message);
    db.addMessage({ conversationId, role: "note", text: `⚠️ النظام ما گدر يرد: ${err.message}` });
    return null;
  }

  if (result.reply) {
    const m = db.addMessage({ conversationId, role: "bot", text: result.reply, buttons: result.buttons });
    try {
      await deliver(tenant, conversation, result.reply, result.buttons);
    } catch (err) {
      console.error("[send]", err.message);
      db.addMessage({ conversationId, role: "note", text: `⚠️ ما وصل الرد للزبون: ${err.message}` });
    }
    result.message = m;
  }
  for (const action of result.actions) {
    notifyOwner(tenant, conversation, action).catch((e) => console.error("[notify]", e.message));
  }
  return result;
}

/** رد الموظف من اللوحة */
export async function staffReply(conversationId, text) {
  const conversation = db.getConversation(conversationId);
  if (!conversation) throw new Error("المحادثة مو موجودة");
  const tenant = db.getTenant(conversation.tenantId);
  // نتعلم من الموظف: آخر رسائل الزبون + رد الموظف = مثال يقلده النظام
  const history = db.listMessages(conversationId, 20).filter((x) => x.role !== "note");
  const lastCustomer = [];
  for (let i = history.length - 1; i >= 0 && history[i].role !== "staff"; i--) {
    if (history[i].role === "customer") lastCustomer.unshift(history[i].text);
    else if (lastCustomer.length) break;
  }
  const m = db.addMessage({ conversationId, role: "staff", text });
  if (lastCustomer.length) db.addLearnedExample(tenant.id, { customer: lastCustomer.join("\n"), reply: text, source: "staff" });
  await deliver(tenant, conversation, text);
  return m;
}

/** صاحب المحل يصحح رد النظام من اللوحة (التصحيح ما ينرسل للزبون، بس يتعلمه النظام) */
export function correctBotReply(conversationId, messageId, text) {
  const conversation = db.getConversation(conversationId);
  const history = db.listMessages(conversationId, 500).filter((x) => x.role !== "note");
  const idx = history.findIndex((x) => x.id === messageId);
  if (!conversation || idx < 0 || history[idx].role !== "bot") throw new Error("الرسالة مو موجودة");
  const customer = [];
  for (let i = idx - 1; i >= 0 && history[i].role === "customer"; i--) customer.unshift(history[i].text);
  if (!customer.length) throw new Error("ماكو سؤال زبون قبل هذا الرد");
  db.updateMessage(messageId, { corrected: text });
  return db.addLearnedExample(conversation.tenantId, { customer: customer.join("\n"), reply: text, wrong: history[idx].text, source: "correction" });
}
