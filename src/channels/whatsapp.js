// واتساب عبر WhatsApp Business Cloud API (من Meta)
// الوثائق: https://developers.facebook.com/docs/whatsapp/cloud-api
const GRAPH = () => `${process.env.META_GRAPH_URL || "https://graph.facebook.com"}/${process.env.META_GRAPH_VERSION || "v23.0"}`;

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
        else text = `[${msg.type}]`; // صوت/صورة: نضيف تحويل الصوت لنص بالمرحلة الجاية
        out.push({
          channel: "whatsapp",
          accountId,
          customerId: msg.from,
          customerName: names[msg.from] || "",
          text,
          externalId: msg.id,
          mediaType: msg.type === "text" ? null : msg.type,
        });
      }
    }
  }
  return out;
}

export async function sendText({ accountId, customerId, text, token }) {
  const res = await fetch(`${GRAPH()}/${accountId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: customerId,
      type: "text",
      text: { preview_url: false, body: text.slice(0, 4096) },
    }),
  });
  if (!res.ok) throw new Error(`WhatsApp send failed ${res.status}: ${await res.text()}`);
  return res.json();
}
