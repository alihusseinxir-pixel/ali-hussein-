// 10 BUNZ push sender: the admin panel posts {pin, title, body, url}; the PIN is checked by the database.
const http = require('http');
const webpush = require('web-push');
const { VAPID_PUBLIC, VAPID_PRIVATE, SUPABASE_URL, SUPABASE_KEY } = process.env;
const ORIGINS = (process.env.ALLOW_ORIGIN || 'https://one0bunz-order.onrender.com').split(',').map(x => x.trim());
const ORIGIN = ORIGINS[0];
let reqOrigin = ORIGIN;
webpush.setVapidDetails(ORIGIN, VAPID_PUBLIC, VAPID_PRIVATE);

async function rpc(fn, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', body: JSON.stringify(body),
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' }
  });
  if (!r.ok) throw new Error(fn + ' ' + r.status);
  return r.json();
}

function reply(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': reqOrigin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
  res.end(JSON.stringify(obj));
}

// Restaurant devices: called by the database (new order / late order) with the shared secret.
function staff(req, res) {
  let raw = '';
  req.on('data', c => { raw += c; if (raw.length > 4000) req.destroy(); });
  req.on('end', async () => {
    try {
      const { secret, title, body, tag } = JSON.parse(raw || '{}');
      if (!secret || !process.env.NOTIFY_SECRET || secret !== process.env.NOTIFY_SECRET) return reply(res, 401, { error: 'secret' });
      const list = await rpc('bunz_staff_subs_for', { secret });
      if (list.error) return reply(res, 401, { error: list.error });
      const payload = JSON.stringify({ title: String(title || '').slice(0, 80), body: String(body || '').slice(0, 200), url: 'admin.html', tag: String(tag || 'order').slice(0, 40), staff: true });
      const rs = await Promise.allSettled(list.subs.map(s => webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 900, urgency: 'high' })));
      const dead = list.subs.filter((s, k) => rs[k].status === 'rejected' && [404, 410].includes(rs[k].reason && rs[k].reason.statusCode)).map(s => s.endpoint);
      if (dead.length) await rpc('bunz_staff_subs_remove', { secret, endpoints: dead });
      reply(res, 200, { sent: rs.filter(r => r.status === 'fulfilled').length, total: list.subs.length });
    } catch (e) {
      console.error(e);
      reply(res, 500, { error: 'server' });
    }
  });
}

http.createServer((req, res) => {
  reqOrigin = ORIGINS.includes(req.headers.origin) ? req.headers.origin : ORIGIN;
  if (req.method === 'OPTIONS') return reply(res, 204, {});
  if (req.method === 'GET') return reply(res, 200, { ok: true });
  if (req.method === 'POST' && req.url === '/staff') return staff(req, res);
  if (req.method !== 'POST' || req.url !== '/send') return reply(res, 404, { error: 'not_found' });
  let raw = '';
  req.on('data', c => { raw += c; if (raw.length > 4000) req.destroy(); });
  req.on('end', async () => {
    try {
      const { pin, title, body, url } = JSON.parse(raw || '{}');
      if (!pin || !title || !body) return reply(res, 400, { error: 'missing' });
      const list = await rpc('bunz_admin_push_list', { pin: String(pin) });
      if (list.error) return reply(res, 401, { error: list.error });
      const target = typeof url === 'string' && ORIGINS.some(o => url.startsWith(o)) ? url : ORIGIN + '/';
      const payload = JSON.stringify({ title: String(title).slice(0, 60), body: String(body).slice(0, 160), url: target });
      let sent = 0; const dead = [];
      for (let i = 0; i < list.subs.length; i += 50) {
        const chunk = list.subs.slice(i, i + 50);
        const rs = await Promise.allSettled(chunk.map(s => webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 6 * 3600 })));
        rs.forEach((r, k) => {
          if (r.status === 'fulfilled') sent++;
          else if ([404, 410].includes(r.reason && r.reason.statusCode)) dead.push(chunk[k].endpoint);
        });
      }
      if (dead.length) await rpc('bunz_admin_push_remove', { pin: String(pin), endpoints: dead });
      reply(res, 200, { sent, removed: dead.length, total: list.subs.length });
    } catch (e) {
      console.error(e);
      reply(res, 500, { error: 'server' });
    }
  });
}).listen(process.env.PORT || 10000);
