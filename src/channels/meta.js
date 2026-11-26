// فيسبوك ماسنجر وانستغرام عبر Meta Graph API (نفس تطبيق Meta اللي يشغل الواتساب)
// الوثائق: https://developers.facebook.com/docs/messenger-platform و https://developers.facebook.com/docs/instagram-platform
const GRAPH = () => `${process.env.META_GRAPH_URL || "https://graph.facebook.com"}/${process.env.META_GRAPH_VERSION || "v23.0"}`;

export function parseWebhook(body) {
  const out = [];
  const channel = body?.object === "page" ? "messenger" : body?.object === "instagram" ? "instagram" : null;
  if (!channel) return out;
  for (const entry of body.entry || []) {
    const accountId = entry.id; // رقم الصفحة أو حساب الانستغرام
    for (const ev of entry.messaging || []) {
      const msg = ev.message;
      if (!msg || msg.is_echo) continue; // نتجاهل رسائلنا احنا
      const att = msg.attachments?.[0];
      const text = msg.quick_reply ? msg.text : msg.text || (att ? (att.type === "image" ? "[صورة]" : `[${att.type}]`) : null);
      if (!text) continue;
      out.push({
        channel,
        accountId,
        customerId: ev.sender?.id,
        customerName: "",
        text,
        externalId: msg.mid,
        mediaType: msg.text ? null : att?.type,
        image: att?.type === "image" && att.payload?.url ? { url: att.payload.url } : null,
      });
    }
  }
  return out;
}

export async function sendText({ accountId, customerId, text, token, buttons = [] }) {
  const res = await fetch(`${GRAPH()}/${accountId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: customerId },
      messaging_type: "RESPONSE",
      message: {
        text: text.slice(0, 2000),
        ...(buttons.length
          ? { quick_replies: buttons.slice(0, 13).map((b) => ({ content_type: "text", title: b.slice(0, 20), payload: b.slice(0, 1000) })) }
          : {}),
      },
    }),
  });
  if (!res.ok) throw new Error(`Meta send failed ${res.status}: ${await res.text()}`);
  return res.json();
}
