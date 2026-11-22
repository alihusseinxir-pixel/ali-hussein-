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

// STATIC mode: menu + settings come from menu.json and the order goes straight to WhatsApp.
// Switch STATIC to false once the database is connected (orders get saved + admin panel works).
BUNZ.STATIC = false;
if (BUNZ.STATIC) {
  const data = fetch('menu.json', { cache: 'no-cache' }).then(r => r.json());
  const isOpen = s => {
    if (s.open_override !== 'auto') return s.open_override === 'open';
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Baghdad', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()).replace(/^24/, '00');
    const o = s.open_time, c = s.close_time;
    if (o === c) return true;
    return o < c ? (p >= o && p < c) : (p >= o || p < c);
  };
  window.bunzApi = {
    async get(path) {
      const d = await data;
      if (path.startsWith('bunz_categories')) return d.categories.filter(c => c.active).sort((a, b) => a.sort - b.sort);
      if (path.startsWith('bunz_items')) return d.items.filter(i => i.active).sort((a, b) => a.sort - b.sort || a.id - b.id);
      throw new Error('unknown ' + path);
    },
    async rpc(fn, body) {
      const d = await data, s = d.settings;
      if (fn === 'bunz_public_settings') return { ...s, is_open: isOpen(s) };
      if (fn !== 'bunz_place_order') throw new Error('static mode');
      const p = body.p;
      if (!isOpen(s)) return { error: 'closed' };
      let sub = 0; const lines = [];
      for (const l of p.items) {
        const it = d.items.find(i => i.id === l.id && i.active && !i.sold_out);
        if (!it) return { error: 'item_unavailable' };
        let unit = it.price; const labels = [];
        it.options.forEach((g, gi) => {
          const sel = (l.sel && l.sel[gi]) || [];
          sel.forEach(pk => unit += (g.choices[pk.i].price || 0) * pk.n);
          if (sel.length) labels.push(sel.map(pk => (pk.n > 1 ? pk.n + '× ' : '') + g.choices[pk.i].name).join('، '));
        });
        sub += unit * l.qty;
        lines.push({ id: it.id, name: it.name, qty: l.qty, unit, options: labels.join(' / '), line_total: unit * l.qty });
      }
      let fee = 0, dist = null;
      if (p.type === 'delivery') {
        dist = haversine(s.rest_lat, s.rest_lng, p.lat, p.lng);
        fee = deliveryFee(s, dist, sub);
        if (fee == null) return { error: 'out_of_range' };
      }
      // short order code: day-of-month + 3 random digits, e.g. 22-417
      const no = new Date().getDate() + '-' + String(Math.floor(Math.random() * 900) + 100);
      return { order_no: no, subtotal: sub, delivery_fee: fee, total: sub + fee, distance_m: dist, lines, whatsapp: s.whatsapp };
    }
  };
}

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
