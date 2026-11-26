// لوحة التحكم — JavaScript بسيط بدون أي مكتبات
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtTime = (iso) => new Date(iso).toLocaleString("ar-IQ", { hour: "numeric", minute: "2-digit", day: "numeric", month: "short" });

const KNOWLEDGE_FIELDS = [
  ["description", "نبذة عن المحل", "مطعم أكلات عراقية بالكرادة..."],
  ["hours", "أوقات الدوام", "يومياً من 12 الظهر لـ 12 بالليل"],
  ["location", "الموقع والعنوان", "المنطقة، أقرب نقطة دالة، رابط اللوكيشن"],
  ["contact", "أرقام التواصل", ""],
  ["delivery", "التوصيل (المناطق والأسعار والوقت)", ""],
  ["menu", "المنيو / الخدمات والأسعار", "كل صنف بسطر: الاسم: السعر"],
  ["offers", "العروض الحالية", ""],
  ["faq", "أسئلة متكررة وأجوبتها", "س: ...\nج: ..."],
  ["policies", "السياسات (الدفع، الإلغاء، الاسترجاع)", ""],
  ["extra", "ملاحظات إضافية للنظام", "مثلاً: لا تعطي خصومات، الدكتور ما يداوم الثلاثاء..."],
  ["examples", "أمثلة على ردودكم (حتى يقلد أسلوبكم)", "زبون: ...\nاحنا: ..."],
];
const CHANNEL_NAMES = { whatsapp: "واتساب", messenger: "ماسنجر", instagram: "انستغرام", simulator: "تجربة" };
const ORDER_KINDS = { order: "طلب", appointment: "موعد", reservation: "حجز", other: "طلب" };
const ORDER_STATUS = { new: "جديد", confirmed: "مؤكد", done: "منتهي", cancelled: "ملغي" };

let tenants = [];
let tenantId = localStorage.getItem("tenantId");
let openConvId = null;
let simCustomer = "sim-" + Math.random().toString(36).slice(2, 8);

async function api(path, opts = {}) {
  const res = await fetch("/api" + path, {
    ...opts,
    headers: { "Content-Type": "application/json" },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
const tenant = () => tenants.find((t) => t.id === tenantId);

// ---------- التبويبات ----------
document.querySelectorAll("#tabs button").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + b.dataset.tab));
    refresh();
  })
);

// ---------- الحالة ----------
async function loadStatus() {
  const s = await api("/status");
  const pill = (ok, on, off) => `<span class="pill ${ok ? "" : "off"}">${ok ? on : off}</span>`;
  $("#statusBar").innerHTML =
    pill(s.ai, "🧠 الذكاء الاصطناعي شغال", "⚠️ وضع تجريبي (ماكو مفتاح Claude)") +
    pill(s.whatsapp, "واتساب مربوط", "واتساب مو مربوط") +
    (s.telegram ? pill(true, "إشعارات تلغرام", "") : "");
}

// ---------- المحلات ----------
async function loadTenants() {
  tenants = await api("/tenants");
  if (!tenant()) tenantId = tenants[0]?.id || null;
  $("#tenantSelect").innerHTML = tenants.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("");
  if (tenantId) $("#tenantSelect").value = tenantId;
}
$("#tenantSelect").addEventListener("change", (e) => {
  tenantId = e.target.value;
  localStorage.setItem("tenantId", tenantId);
  openConvId = null;
  fillProfile();
  refresh();
});
$("#newTenantBtn").addEventListener("click", async () => {
  const name = prompt("اسم المحل الجديد:");
  if (!name) return;
  const t = await api("/tenants", { method: "POST", body: { name, type: "restaurant" } });
  tenantId = t.id;
  localStorage.setItem("tenantId", tenantId);
  await loadTenants();
  fillProfile();
  document.querySelector('[data-tab="profile"]').click();
});

// ---------- معلومات المحل ----------
$("#knowledgeFields").innerHTML = KNOWLEDGE_FIELDS.map(
  ([k, label, ph]) => `<label>${label}<textarea name="k_${k}" placeholder="${esc(ph)}"></textarea></label>`
).join("");

function fillProfile() {
  const t = tenant();
  if (!t) return;
  const f = $("#profileForm");
  f.name.value = t.name;
  f.type.value = t.type || "other";
  f.botEnabled.checked = t.botEnabled !== false;
  for (const [k] of KNOWLEDGE_FIELDS) f["k_" + k].value = t.knowledge?.[k] || "";
  const c = $("#connectForm");
  c.ch_whatsapp.value = t.channels?.whatsapp || "";
  c.ch_messenger.value = t.channels?.messenger || "";
  c.ch_instagram.value = t.channels?.instagram || "";
  c.telegramChatId.value = t.telegramChatId || "";
  c.sec_whatsappToken.value = "";
  c.sec_pageToken.value = "";
  c.sec_whatsappToken.placeholder = c.sec_pageToken.placeholder = t.hasSecrets ? "•••• محفوظ" : "";
}
$("#profileForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const knowledge = Object.fromEntries(KNOWLEDGE_FIELDS.map(([k]) => [k, f["k_" + k].value]));
  await api("/tenants/" + tenantId, { method: "PUT", body: { name: f.name.value, type: f.type.value, botEnabled: f.botEnabled.checked, knowledge } });
  await loadTenants();
  $("#profileSaved").textContent = "✓ انحفظ";
  setTimeout(() => ($("#profileSaved").textContent = ""), 2500);
});
$("#deleteTenantBtn").addEventListener("click", async () => {
  if (!confirm(`متأكد تريد تحذف «${tenant()?.name}» وكل محادثاته؟`)) return;
  await api("/tenants/" + tenantId, { method: "DELETE" });
  tenantId = null;
  await loadTenants();
  fillProfile();
});
$("#connectForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const c = e.target;
  await api("/tenants/" + tenantId, {
    method: "PUT",
    body: {
      channels: { whatsapp: c.ch_whatsapp.value.trim(), messenger: c.ch_messenger.value.trim(), instagram: c.ch_instagram.value.trim() },
      telegramChatId: c.telegramChatId.value.trim(),
      secrets: { whatsappToken: c.sec_whatsappToken.value.trim(), pageToken: c.sec_pageToken.value.trim() },
    },
  });
  await loadTenants();
  fillProfile();
  $("#connectSaved").textContent = "✓ انحفظ";
  setTimeout(() => ($("#connectSaved").textContent = ""), 2500);
});
$("#webhookUrl").textContent = location.origin + "/webhook";

// ---------- المحادثات ----------
async function loadConversations() {
  if (!tenantId) return;
  const list = await api("/conversations?tenantId=" + tenantId);
  const unread = list.reduce((n, c) => n + (c.unread || 0), 0);
  $("#unreadBadge").hidden = !unread;
  $("#unreadBadge").textContent = unread;
  $("#convList").innerHTML = list.length
    ? list
        .map(
          (c) => `<div class="conv-item ${c.id === openConvId ? "active" : ""}" data-id="${c.id}">
      <div class="top"><span>${esc(c.customerName || c.customerId)}</span>
        <span>${c.mode === "human" ? '<span class="tag human">موظف</span>' : ""} <span class="tag">${CHANNEL_NAMES[c.channel] || c.channel}</span>
        ${c.unread ? `<span class="badge">${c.unread}</span>` : ""}</span></div>
      <div class="last">${esc(c.lastMessage?.text || "")}</div></div>`
        )
        .join("")
    : '<div class="empty">ماكو محادثات بعد. جرب من تبويب «جرّب كزبون».</div>';
  document.querySelectorAll(".conv-item").forEach((el) => el.addEventListener("click", () => openConversation(el.dataset.id)));
}

function renderMessages(container, messages) {
  const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 60;
  const label = { customer: "الزبون", bot: "🤖 الرد الآلي", staff: "👤 موظف", note: "" };
  container.innerHTML = messages
    .map((m) => `<div class="msg ${m.role}">${esc(m.text)}<small>${label[m.role]} · ${fmtTime(m.at)}</small></div>`)
    .join("");
  if (atBottom) container.scrollTop = container.scrollHeight;
}

async function openConversation(id) {
  openConvId = id;
  const { conversation: c, messages } = await api("/conversations/" + id);
  const human = c.mode === "human";
  $("#convHeader").classList.remove("muted");
  $("#convHeader").innerHTML = `<strong>${esc(c.customerName || c.customerId)}</strong>
    <span class="tag">${CHANNEL_NAMES[c.channel] || c.channel}</span>
    ${human ? `<span class="tag human">موظف ماسك المحادثة</span> <span class="muted">${esc(c.handoffReason || "")}</span>` : '<span class="tag">الرد الآلي شغال</span>'}
    <button class="ghost small" id="modeBtn" style="margin-inline-start:auto">${human ? "🤖 رجّع الرد الآلي" : "👤 استلم المحادثة"}</button>`;
  $("#modeBtn").onclick = async () => {
    await api(`/conversations/${id}/mode`, { method: "POST", body: { mode: human ? "bot" : "human" } });
    openConversation(id);
  };
  renderMessages($("#convMessages"), messages);
  $("#staffForm").hidden = false;
  loadConversations();
}
$("#staffForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("#staffText").value.trim();
  if (!text || !openConvId) return;
  $("#staffText").value = "";
  try {
    await api(`/conversations/${openConvId}/reply`, { method: "POST", body: { text } });
  } catch (err) {
    alert("ما انرسلت: " + err.message);
  }
  openConversation(openConvId);
});

// ---------- الطلبات ----------
async function loadOrders() {
  if (!tenantId) return;
  const orders = await api("/orders?tenantId=" + tenantId);
  $("#ordersList").innerHTML = orders.length
    ? orders
        .map(
          (o) => `<div class="card"><h4><span>${ORDER_KINDS[o.kind] || "طلب"} · ${esc(o.customer_name)}</span><span class="tag">${ORDER_STATUS[o.status] || o.status}</span></h4>
      <div class="sum">${esc(o.summary)}</div>
      ${o.phone ? `<div>📞 ${esc(o.phone)}</div>` : ""}${o.address ? `<div>📍 ${esc(o.address)}</div>` : ""}${o.when ? `<div>🕒 ${esc(o.when)}</div>` : ""}${o.notes ? `<div>📝 ${esc(o.notes)}</div>` : ""}
      <div class="muted">${CHANNEL_NAMES[o.channel] || o.channel} · ${fmtTime(o.createdAt)}</div>
      <div class="actions">${Object.entries(ORDER_STATUS)
        .filter(([k]) => k !== o.status)
        .map(([k, v]) => `<button class="ghost small" data-order="${o.id}" data-status="${k}">${v}</button>`)
        .join("")}</div></div>`
        )
        .join("")
    : '<div class="empty">ماكو طلبات بعد.</div>';
  document.querySelectorAll("[data-order]").forEach((b) =>
    b.addEventListener("click", async () => {
      await api("/orders/" + b.dataset.order, { method: "PUT", body: { status: b.dataset.status } });
      loadOrders();
    })
  );
}

// ---------- المحاكي ----------
const simLog = [];
function renderSim(typing) {
  renderMessages($("#simMessages"), simLog);
  if (typing) $("#simMessages").insertAdjacentHTML("beforeend", '<div class="typing">جاي يكتب...</div>');
  $("#simMessages").scrollTop = $("#simMessages").scrollHeight;
}
$("#simForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("#simText").value.trim();
  if (!text || !tenantId) return;
  $("#simText").value = "";
  simLog.push({ role: "customer", text, at: new Date().toISOString() });
  renderSim(true);
  try {
    const r = await api("/simulate", { method: "POST", body: { tenantId, customerId: simCustomer, text } });
    if (r.reply) simLog.push({ role: "bot", text: r.reply, at: new Date().toISOString() });
    for (const a of r.actions || [])
      simLog.push({ role: "note", text: a.type === "order" ? `🧾 انسجل طلب: ${a.order.summary}` : `🔔 تحويل لموظف: ${a.reason}`, at: new Date().toISOString() });
  } catch (err) {
    simLog.push({ role: "note", text: "⚠️ " + err.message, at: new Date().toISOString() });
  }
  renderSim(false);
});
$("#simReset").addEventListener("click", () => {
  simCustomer = "sim-" + Math.random().toString(36).slice(2, 8);
  simLog.length = 0;
  renderSim(false);
});

// ---------- تحديث دوري ----------
async function refresh() {
  try {
    const active = document.querySelector("#tabs button.active").dataset.tab;
    if (active === "inbox") {
      await loadConversations();
      if (openConvId) {
        const { messages } = await api("/conversations/" + openConvId);
        renderMessages($("#convMessages"), messages);
      }
    } else {
      await loadConversations(); // حتى يتحدث عداد غير المقروء
      if (active === "orders") await loadOrders();
    }
  } catch (e) {
    console.error(e);
  }
}

(async function init() {
  await Promise.all([loadStatus(), loadTenants()]);
  fillProfile();
  refresh();
  setInterval(refresh, 4000);
})();
