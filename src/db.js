// تخزين بسيط بملف JSON — يكفي للنسخة الأولى (عشرات المحلات وآلاف المحادثات).
// لما يكبر المشروع نبدله بـ PostgreSQL بدون ما نغير باقي الكود، لأن كل الوصول يمر من هنا.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DATA_DIR = process.env.DATA_DIR || path.resolve("data");
const DB_FILE = path.join(DATA_DIR, "db.json");

const empty = () => ({ tenants: [], conversations: [], messages: [], orders: [] });

let state = load();
let saveTimer = null;

function load() {
  try {
    return { ...empty(), ...JSON.parse(fs.readFileSync(DB_FILE, "utf8")) };
  } catch {
    return empty();
  }
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 50);
}

export function flush() {
  clearTimeout(saveTimer);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, DB_FILE); // كتابة ذرية حتى الملف ما يخرب إذا انطفى السيرفر
}

export const newId = (prefix) => `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
const now = () => new Date().toISOString();

// ---------- المحلات (Tenants) ----------
export function listTenants() {
  return state.tenants;
}
export function getTenant(id) {
  return state.tenants.find((t) => t.id === id) || null;
}
/** يلقى المحل حسب رقم الواتساب أو صفحة الفيسبوك أو حساب الانستغرام اللي وصلت عليه الرسالة */
export function findTenantByChannel(channel, accountId) {
  return (
    state.tenants.find((t) => (t.channels?.[channel] || "") === String(accountId)) || null
  );
}
export function saveTenant(data) {
  const existing = data.id && getTenant(data.id);
  if (existing) {
    Object.assign(existing, data, { updatedAt: now() });
    persist();
    return existing;
  }
  const t = { botEnabled: true, channels: {}, ...data, id: newId("biz"), createdAt: now(), updatedAt: now() };
  state.tenants.push(t);
  persist();
  return t;
}
export function deleteTenant(id) {
  state.tenants = state.tenants.filter((t) => t.id !== id);
  const convIds = new Set(state.conversations.filter((c) => c.tenantId === id).map((c) => c.id));
  state.conversations = state.conversations.filter((c) => c.tenantId !== id);
  state.messages = state.messages.filter((m) => !convIds.has(m.conversationId));
  state.orders = state.orders.filter((o) => o.tenantId !== id);
  persist();
}

// ---------- المحادثات ----------
export function getOrCreateConversation({ tenantId, channel, customerId, customerName }) {
  let c = state.conversations.find(
    (x) => x.tenantId === tenantId && x.channel === channel && x.customerId === customerId
  );
  if (!c) {
    c = {
      id: newId("conv"),
      tenantId,
      channel,
      customerId,
      customerName: customerName || "",
      mode: "bot", // bot = النظام يرد | human = موظف ماسك المحادثة
      handoffReason: "",
      unread: 0,
      createdAt: now(),
      updatedAt: now(),
    };
    state.conversations.push(c);
  } else if (customerName && !c.customerName) {
    c.customerName = customerName;
  }
  persist();
  return c;
}
export function getConversation(id) {
  return state.conversations.find((c) => c.id === id) || null;
}
export function updateConversation(id, patch) {
  const c = getConversation(id);
  if (!c) return null;
  Object.assign(c, patch, { updatedAt: now() });
  persist();
  return c;
}
export function listConversations(tenantId) {
  return state.conversations
    .filter((c) => !tenantId || c.tenantId === tenantId)
    .map((c) => {
      const msgs = state.messages.filter((m) => m.conversationId === c.id);
      return { ...c, lastMessage: msgs[msgs.length - 1] || null };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// ---------- الرسائل ----------
/** role: customer | bot | staff | note (ملاحظة داخلية ما توصل للزبون) */
export function addMessage({ conversationId, role, text, externalId }) {
  if (externalId && state.messages.some((m) => m.externalId === externalId)) return null; // ميتا أحياناً تعيد نفس الرسالة
  const m = { id: newId("msg"), conversationId, role, text, externalId: externalId || null, at: now() };
  state.messages.push(m);
  const c = getConversation(conversationId);
  if (c) {
    c.updatedAt = m.at;
    if (role === "customer") c.unread = (c.unread || 0) + 1;
  }
  persist();
  return m;
}
export function listMessages(conversationId, limit = 200) {
  return state.messages.filter((m) => m.conversationId === conversationId).slice(-limit);
}

// ---------- الطلبات والحجوزات ----------
export function addOrder(data) {
  const o = { id: newId("ord"), status: "new", ...data, createdAt: now() };
  state.orders.push(o);
  persist();
  return o;
}
export function listOrders(tenantId) {
  return state.orders
    .filter((o) => !tenantId || o.tenantId === tenantId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function updateOrder(id, patch) {
  const o = state.orders.find((x) => x.id === id);
  if (!o) return null;
  Object.assign(o, patch);
  persist();
  return o;
}

export function _resetForTests() {
  state = empty();
}
