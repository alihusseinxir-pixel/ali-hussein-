window.BUNZ = {
  SUPABASE_URL: 'https://dycjowdipzchxdwekirh.supabase.co',
  SUPABASE_KEY: 'sb_publishable_2ta0kL29MbXmDt9DF0HZUg_5JpxoE4r',
  LOGO: 'https://api.foodifypos.com/rificafe/images/03eb78b5-bb65-44a8-b107-29526a3ec380.webp'
};

window.bunzApi = {
  headers() {
    return { apikey: BUNZ.SUPABASE_KEY, Authorization: 'Bearer ' + BUNZ.SUPABASE_KEY, 'Content-Type': 'application/json' };
  },
  async get(path) {
    const r = await fetch(BUNZ.SUPABASE_URL + '/rest/v1/' + path, { headers: this.headers() });
    if (!r.ok) throw new Error('GET ' + path + ' ' + r.status);
    return r.json();
  },
  async rpc(fn, body) {
    const r = await fetch(BUNZ.SUPABASE_URL + '/rest/v1/rpc/' + fn, { method: 'POST', headers: this.headers(), body: JSON.stringify(body || {}) });
    if (!r.ok) throw new Error('RPC ' + fn + ' ' + r.status + ' ' + (await r.text()));
    return r.json();
  }
};

window.fmtIQD = n => (Math.round(n) || 0).toLocaleString('en-US') + ' د.ع';
window.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
window.haversine = (a, b, c, d) => {
  const R = 6371000, r = x => x * Math.PI / 180;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
};
// mirrors public.bunz_fee on the server; the server stays authoritative
window.deliveryFee = (s, distM, subtotal) => {
  const km = distM / 1000;
  if (s.max_km > 0 && km > s.max_km) return null;
  if (s.free_delivery_above > 0 && subtotal >= s.free_delivery_above) return 0;
  if (s.delivery_mode === 'flat') return s.flat_fee;
  const tiers = [...(s.tiers || [])].sort((x, y) => x.upto_km - y.upto_km);
  for (const t of tiers) if (km <= t.upto_km) return t.fee;
  return null;
};
