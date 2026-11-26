import { test } from "node:test";
import assert from "node:assert/strict";
import { quote, parseMenu } from "../src/pricing.js";
import { EXAMPLE_RESTAURANT } from "../src/seed.js";

const menu = EXAMPLE_RESTAURANT.knowledge.menu;

test("يقرا المنيو", () => {
  const items = parseMenu(menu);
  assert.equal(items.length, 16);
  assert.equal(items.find((i) => i.name.startsWith("دولمة")).price, 10000);
});

test("يحسب بدقة ويتحمل اختلاف الكتابة", () => {
  const q = quote(menu, [{ name: "تكه لحم", qty: 2 }, { name: "كبه حلب", qty: 4 }, { name: "متبل", qty: 1 }], 2000);
  assert.equal(q.total, 18000 + 4000 + 2500 + 2000);
  assert.deepEqual(q.unmatched, []);
});

test("الصنف غير الموجود ينذكر وما ينحسب", () => {
  const q = quote(menu, [{ name: "بيتزا", qty: 1 }, { name: "كبة موصلية", qty: 2 }], 0);
  assert.deepEqual(q.unmatched, ["بيتزا"]);
  assert.equal(q.total, 5000);
});

test("أرقام عربية بالمنيو", () => {
  assert.equal(quote("- شاي: ٥٠٠", [{ name: "شاي", qty: 3 }], 0).total, 1500);
});

test("عرض العائلة بالمثال صحيح حسابياً", () => {
  const q = quote(menu, [{ name: "مشكل مشويات", qty: 1 }, { name: "كبة حلب", qty: 4 }, { name: "حمص", qty: 1 }, { name: "سلطة", qty: 1 }, { name: "مشروبات غازية", qty: 4 }], 0);
  assert.equal(q.total, 41500);
});
