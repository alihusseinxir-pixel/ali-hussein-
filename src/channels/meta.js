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
      const text = msg.text || (msg.attachments?.length ? `[${msg.attachments[0].type}]` : null);
      if (!text) continue;
      out.push({
        channel,
        accountId,
        customerId: ev.sender?.id,
        customerName: "",
        text,
        externalId: msg.mid,
        mediaType: msg.text ? null : msg.attachments?.[0]?.type,
      });
    }
  }
  return out;
}

export async function sendText({ accountId, customerId, text, token }) {
  const res = await fetch(`${GRAPH()}/${accountId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: customerId },
      messaging_type: "RESPONSE",
      message: { text: text.slice(0, 2000) },
    }),
  });
  if (!res.ok) throw new Error(`Meta send failed ${res.status}: ${await res.text()}`);
  return res.json();
}
