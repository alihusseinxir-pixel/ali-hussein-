// إشعار صاحب المحل بطلب جديد أو تحويل لموظف.
// الطريقة الحالية: بوت تلغرام (مجاني وسهل). اللوحة تعرض كل شي حتى بدون تلغرام.
export async function notifyOwner(tenant, conversation, action) {
  if (action.type !== "order" && action.type !== "handoff") return;
  return notifyText(tenant, formatAction(tenant, conversation, action));
}

export async function notifyText(tenant, text) {
  console.log(`[notify] ${text.replace(/\n/g, " | ").slice(0, 300)}`);
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = tenant.telegramChatId;
  if (!token || !chatId) return;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) }),
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}`);
}

function formatAction(tenant, conversation, action) {
  const who = `${conversation.customerName || conversation.customerId} (${conversation.channel})`;
  if (action.type === "order") {
    const o = action.order;
    return [
      `🧾 طلب جديد - ${tenant.name}`,
      `الزبون: ${o.customer_name || who}`,
      o.phone && `الموبايل: ${o.phone}`,
      `التفاصيل: ${o.summary}`,
      o.address && `العنوان: ${o.address}`,
      o.when && `الوقت: ${o.when}`,
      o.notes && `ملاحظات: ${o.notes}`,
    ]
      .filter(Boolean)
      .join("\n");
  }
  return `🔔 ${action.urgency === "high" ? "عاجل! " : ""}محادثة تحتاج موظف - ${tenant.name}\nالزبون: ${who}\nالسبب: ${action.reason}`;
}
