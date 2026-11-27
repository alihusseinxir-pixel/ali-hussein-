// واتساب عبر WhatsApp Business Cloud API (من Meta)
// الوثائق: https://developers.facebook.com/docs/whatsapp/cloud-api
// أو عبر شريك رسمي 360dialog (نفس شكل الرسائل، بس عنوان ومفتاح مختلف): WHATSAPP_PROVIDER=360dialog
const GRAPH = () => `${process.env.META_GRAPH_URL || "https://graph.facebook.com"}/${process.env.META_GRAPH_VERSION || "v23.0"}`;
export const is360 = () => (process.env.WHATSAPP_PROVIDER || "").toLowerCase() === "360dialog";
export const D360 = () => process.env.D360_URL || "https://waba-v2.360dialog.io";
export const authHeaders = (token) => (is360() ? { "D360-API-KEY": token } : { Authorization: `Bearer ${token}` });

/** يحول جسم الويبهوك لرسائل موحدة: [{channel, accountId, customerId, customerName, text, externalId}] */
export function parseWebhook(body) {
  const out = [];
  if (body?.object !== "whatsapp_business_account") return out;
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      const accountId = v.metadata?.phone_number_id;
      const names = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name || ""]));
      for (const msg of v.messages || []) {
        let text = null;
        if (msg.type === "text") text = msg.text?.body;
        else if (msg.type === "button") text = msg.button?.text;
        else if (msg.type === "interactive")
          text = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title;
        else if (msg.type === "location")
          text = `📍 موقع الزبون: ${msg.location?.latitude},${msg.location?.longitude} ${msg.location?.address || ""}`;
        else if (msg.type === "image") text = msg.image?.caption || "[صورة]";
        else text = `[${msg.type}]`; // الصوت: نضيف تحويل الصوت لنص بالمرحلة الجاية
        out.push({
          channel: "whatsapp",
          accountId,
          customerId: msg.from,
          customerName: names[msg.from] || "",
          text,
          externalId: msg.id,
          mediaType: msg.type === "text" ? null : msg.type,
          image: msg.type === "image" ? { mediaId: msg.image?.id } : null,
        });
      }
    }
  }
  return out;
}

export async function sendText({ accountId, customerId, text, token, buttons = [] }) {
  // واتساب: لحد 3 أزرار، عنوان كل زر 20 حرف كحد أقصى، والنص 1024 حرف
  const payload = buttons.length
    ? {
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: text.slice(0, 1024) },
          action: {
            buttons: buttons.slice(0, 3).map((b, i) => ({ type: "reply", reply: { id: `b${i}`, title: b.slice(0, 20) } })),
          },
        },
      }
    : { type: "text", text: { preview_url: false, body: text.slice(0, 4096) } };
  const url = is360() ? `${D360()}/messages` : `${GRAPH()}/${accountId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: customerId, ...payload }),
  });
  if (!res.ok) throw new Error(`WhatsApp send failed ${res.status}: ${await res.text()}`);
  return res.json();
}
