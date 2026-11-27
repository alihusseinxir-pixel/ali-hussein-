import { test } from "node:test";
import assert from "node:assert/strict";
import { placeOrder, lastLocation, deliveryFee, norm } from "../src/integrations/bunz.js";

const MEAT = [{ name: "اختر نوع اللحم", min: 1, max: 1, choices: [{ name: "سماش" }, { name: "كلاسيك" }] }];
const ITEMS = [
  { id: 1, name: "هوم بركر", price: 6000, options: MEAT },
  { id: 28, name: "بوكس الاصدقاء", price: 34750, options: [
    { name: "اختر 3 بركر لحم", min: 3, max: 3, choices: [{ name: "سماش 10 بنز" }, { name: "سماش هوم بركر" }, { name: "سماش جيزي" }] },
    { name: "اختر 2 بركر دجاج", min: 2, max: 2, choices: [{ name: "اورجنال كولسلو دجاج" }, { name: "كلاسك 10 بنز دجاج" }, { name: "سبايسي 10 بنز دجاج" }] },
  ] },
  { id: 42, name: "صوص تشيدر", price: 500, options: [] },
];
const SETTINGS = { is_open: true, rest_lat: 35.44, rest_lng: 44.378, delivery_mode: "tiers", tiers: [{ upto_km: 1, fee: 1000 }, { upto_km: 3, fee: 2000 }], max_km: 3 };
const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  calls.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : null });
  const u = String(url);
  const json = u.includes("bunz_items") ? ITEMS : u.includes("bunz_public_settings") ? SETTINGS
    : { order_no: 1501, token: "tok-1", subtotal: 35750, delivery_fee: 2000, total: 37750, lines: [{ qty: 1, name: "بوكس الاصدقاء", options: "x" }, { qty: 2, name: "صوص تشيدر", options: "" }] };
  return new Response(JSON.stringify(json), { status: 200 });
};
const tenant = { integration: { type: "bunz", url: "https://x.supabase.co", key: "k", siteUrl: "https://10bunz.com", source: "raddbot" } };
const conv = { channel: "whatsapp", customerId: "9647701112233", profile: {} };

test("10bunz: مطابقة الأسماء والموقع والأجرة", () => {
  assert.equal(norm("بوكس الأصدقاء"), norm("بوكس الاصدقاء"));
  const loc = lastLocation([{ role: "customer", text: "📍 موقع الزبون: 35.4535,44.3905 حي الواسطي" }]);
  assert.deepEqual([loc.lat, loc.lng, loc.label], [35.4535, 44.3905, "حي الواسطي"]);
  assert.equal(deliveryFee(SETTINGS, 2500), 2000);
  assert.equal(deliveryFee(SETTINGS, 5000), null);
});

test("10bunz: اختيار ناقص يرجع للنموذج بدون ما ينرسل طلب", async () => {
  calls.length = 0;
  const r = await placeOrder(tenant, conv, [], { items: [{ name: "هوم بركر", qty: 1, options: [], note: "" }], order_type: "pickup", customer_name: "علي", phone: "", address_note: "", notes: "" });
  assert.equal(r.ok, false);
  assert.match(r.result, /نوع اللحم/);
  assert.ok(!calls.some((c) => c.url.includes("bunz_place_order")));
});

test("10bunz: الطلب يروح للوحة بصيغة موقعهم", async () => {
  calls.length = 0;
  const msgs = [{ role: "customer", text: "📍 موقع الزبون: 35.4535,44.3905" }];
  const r = await placeOrder(tenant, conv, msgs, {
    items: [
      { name: "بوكس الأصدقاء", qty: 1, options: ["سماش 10 بنز", "سماش 10 بنز", "سماش جيزي", "كلاسك 10 بنز دجاج", "سبايسي 10 بنز دجاج"], note: "" },
      { name: "صوص تشيدر", qty: 2, options: [], note: "" },
    ],
    order_type: "delivery", customer_name: "مصطفى", phone: "", address_note: "قرب جامع الواسطي", notes: "",
  });
  assert.equal(r.ok, true);
  const p = calls.find((c) => c.url.includes("bunz_place_order")).body.p;
  assert.equal(p.phone, "9647701112233");
  assert.equal(p.type, "delivery");
  assert.equal(p.lat, 35.4535);
  assert.deepEqual(p.items[0], { id: 28, qty: 1, sel: [[{ i: 0, n: 2 }, { i: 2, n: 1 }], [{ i: 1, n: 1 }, { i: 2, n: 1 }]], note: "" });
  assert.equal(p.items[1].id, 42);
  assert.match(r.result, /#1501/);
  assert.match(r.result, /r\.html\?t=tok-1/);
});
