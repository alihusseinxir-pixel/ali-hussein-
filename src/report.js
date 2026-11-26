// التقرير اليومي: Claude يراجع محادثات آخر 24 ساعة ويطلع لصاحب المحل:
// وين خسرنا زبائن وليش، الأسئلة اللي ما عرفنا نجاوبها، وشنو يضيف لمعلومات المحل.
import Anthropic from "@anthropic-ai/sdk";
import * as db from "./db.js";
import { aiEnabled } from "./brain.js";
import { notifyText } from "./notify.js";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string", description: "ملخص اليوم بجملتين أو ثلاث" },
    score: { type: "integer", description: "تقييم أداء الرد الآلي اليوم من 1 إلى 10" },
    wins: { type: "array", items: { type: "string" }, description: "أشياء نجحت (بيع، اقتراح انقبل...)" },
    lost: {
      type: "array",
      description: "محادثات خسرنا بيها زبون أو ما كملت",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          customer: { type: "string" },
          reason: { type: "string", description: "ليش ما كمل" },
          fix: { type: "string", description: "شنو نغير حتى ما تتكرر" },
        },
        required: ["customer", "reason", "fix"],
      },
    },
    unanswered: { type: "array", items: { type: "string" }, description: "أسئلة الزبائن اللي ما كان جوابها موجود" },
    knowledge_suggestions: {
      type: "array",
      items: { type: "string" },
      description: "معلومات محددة لازم صاحب المحل يضيفها أو يصححها باللوحة",
    },
  },
  required: ["summary", "score", "wins", "lost", "unanswered", "knowledge_suggestions"],
};

function collect(tenantId, sinceMs, includeSimulator) {
  return db
    .listConversations(tenantId)
    .filter((c) => (includeSimulator || !db.TEST_CHANNELS.has(c.channel)) && Date.parse(c.updatedAt) >= sinceMs)
    .slice(0, 40)
    .map((c) => {
      const msgs = db.listMessages(c.id, 40).filter((m) => Date.parse(m.at) >= sinceMs - 6 * 3600 * 1000);
      const who = c.profile?.name || c.customerName || c.customerId;
      const lines = msgs.map((m) => {
        const r = { customer: "الزبون", bot: "النظام", staff: "الموظف", note: "ملاحظة" }[m.role];
        return `${r}: ${m.text}${m.corrected ? ` (صححه صاحب المحل إلى: ${m.corrected})` : ""}`;
      });
      return { who, stage: c.stage || "browsing", channel: c.channel, text: lines.join("\n") };
    })
    .filter((c) => c.text);
}

export async function generateReport(tenantId, { hours = 24, includeSimulator = false } = {}) {
  const tenant = db.getTenant(tenantId);
  if (!tenant) throw new Error("المحل مو موجود");
  const since = Date.now() - hours * 3600 * 1000;
  const convs = collect(tenantId, since, includeSimulator);
  const stats = db.analytics(tenantId, Math.max(1, Math.ceil(hours / 24)));

  if (!convs.length) {
    return db.addReport(tenantId, { hours, stats, summary: "ماكو محادثات بهاي الفترة.", score: null, wins: [], lost: [], unanswered: [], knowledge_suggestions: [] });
  }
  if (!aiEnabled()) {
    return db.addReport(tenantId, {
      hours,
      stats,
      summary: `${convs.length} محادثة، ${stats.orders} طلب. (التحليل الذكي يحتاج مفتاح Claude)`,
      score: null,
      wins: [],
      lost: convs.filter((c) => c.stage === "quoted").map((c) => ({ customer: c.who, reason: "شاف السعر وما أكد", fix: "" })),
      unanswered: [],
      knowledge_suggestions: [],
    });
  }

  const transcript = convs
    .map((c, i) => `### محادثة ${i + 1}: ${c.who} (${c.channel}، المرحلة: ${c.stage})\n${c.text}`)
    .join("\n\n");
  const response = await new Anthropic().beta.messages.create({
    model: MODEL,
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
    system:
      "انت مدير مبيعات خبير تراجع محادثات الرد الآلي لمحل عراقي. اكتب باللهجة العراقية البسيطة، مختصر ومحدد، كل نقطة جملة وحدة. ركز على اللي يزيد المبيعات: وين ضاع زبون وليش، وشنو المعلومة الناقصة. لا تكرر نفس النقطة. إذا ماكو شي بقسم خليه فارغ.",
    messages: [
      {
        role: "user",
        content: `المحل: ${tenant.name}\nالأرقام: ${JSON.stringify(stats)}\n\nمحادثات آخر ${hours} ساعة:\n\n${transcript}`,
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("ما گدرنا نسوي التقرير");
  const text = response.content.find((b) => b.type === "text")?.text || "{}";
  return db.addReport(tenantId, { hours, stats, ...JSON.parse(text) });
}

export function formatReport(tenant, r) {
  const list = (title, items) => (items?.length ? `\n${title}\n${items.map((x) => `• ${x}`).join("\n")}` : "");
  return [
    `📊 تقرير ${tenant.name}`,
    r.summary,
    r.score ? `التقييم: ${r.score}/10` : "",
    `المحادثات ${r.stats.conversations} · الطلبات ${r.stats.orders} · الإيرادات ${Number(r.stats.revenue).toLocaleString("en-US")} د.ع`,
    list("✅ اللي نجح:", r.wins),
    list("❌ زبائن ضاعوا:", (r.lost || []).map((l) => `${l.customer}: ${l.reason}${l.fix ? ` ← ${l.fix}` : ""}`)),
    list("❓ أسئلة ما عرفنا نجاوبها:", r.unanswered),
    list("📝 أضف للوحة:", r.knowledge_suggestions),
  ]
    .filter(Boolean)
    .join("\n");
}

export async function runDailyReports() {
  let n = 0;
  for (const t of db.listTenants()) {
    try {
      const r = await generateReport(t.id);
      if (r.stats.conversations) await notifyText(t, formatReport(t, r));
      n++;
    } catch (e) {
      console.error("[report]", t.name, e.message);
    }
  }
  return n;
}
