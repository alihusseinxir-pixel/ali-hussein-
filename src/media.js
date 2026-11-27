// الصور اللي يدزها الزبون: ننزلها مرة وحدة ونخليها بالذاكرة لحد ما النظام يرد.
// ما نخزنها بقاعدة البيانات حتى تبقى خفيفة (نخزن بس إنها كانت صورة + التعليق).
import { is360, D360, authHeaders } from "./channels/whatsapp.js";
const GRAPH = () => `${process.env.META_GRAPH_URL || "https://graph.facebook.com"}/${process.env.META_GRAPH_VERSION || "v23.0"}`;
const MAX_ITEMS = 100;
const MAX_BYTES = 4.5 * 1024 * 1024; // حد Claude للصورة الوحدة تقريباً 5MB
const ALLOWED = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

const cache = new Map(); // key -> { media_type, data(base64), at }

export function putImage(key, media_type, buffer) {
  if (!ALLOWED.has(media_type) || buffer.length > MAX_BYTES) return false;
  cache.set(key, { media_type, data: buffer.toString("base64"), at: Date.now() });
  while (cache.size > MAX_ITEMS) cache.delete(cache.keys().next().value);
  return true;
}

export const getImage = (key) => cache.get(key) || null;

async function fetchBuffer(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`media ${res.status}`);
  const type = (res.headers.get("content-type") || "").split(";")[0].trim();
  return { type, buffer: Buffer.from(await res.arrayBuffer()) };
}

/** واتساب: نجيب رابط الصورة من رقمها، وبعدين ننزلها بنفس التوكن */
export async function downloadWhatsAppImage(mediaId, token, key) {
  const auth = authHeaders(token);
  const base = is360() ? D360() : GRAPH();
  const meta = await (await fetch(`${base}/${mediaId}`, { headers: auth })).json();
  if (!meta?.url) throw new Error("no media url");
  // 360dialog: نفس الرابط بس نمرره من خلالهم
  const url = is360() ? meta.url.replace(/^https:\/\/[^/]+/, D360()) : meta.url;
  const { type, buffer } = await fetchBuffer(url, auth);
  return putImage(key, meta.mime_type || type, buffer);
}

/** ماسنجر وانستغرام: الرابط يجي جاهز بالويبهوك */
export async function downloadUrlImage(url, key) {
  const { type, buffer } = await fetchBuffer(url);
  return putImage(key, type, buffer);
}
