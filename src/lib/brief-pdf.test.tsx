import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderBriefPdf, type BriefData } from "./brief-pdf";

const data: BriefData = {
  taskCode: "BASMA-2026-00125", title: "Reel – طازج × أجواء المباراة", brand: "TAZAJ", campaign: "Fresh With You", contentType: "REEL", platform: "INSTAGRAM",
  priority: "HIGH", stage: "Production", objective: "Drive awareness during the match week", targetAudience: "Football fans 18–34 في الرياض",
  brief: "فيديو قصير يربط بين أجواء المباراة وطعم الدجاج الطازج.\nKeep it fun, fast and 30 seconds max.", consumerInsight: "الجمهور يجتمع لمشاهدة المباراة 🍗", keyMessage: "Fresh with you, طازج معك",
  cta: "Order now", caption: "طازج × المباراة 🔥 #tazaj", hashtags: "#tazaj #طازج", script: "SCENE 01 – لقطة افتتاحية\nWide shot of friends watching the match.\nمشهد 2: لقطة قريبة للمنتج\nSlow zoom on the product.\nSCENE 3 - Closing\nLogo + CTA",
  models: "Ahmed, Sara", location: "Riyadh – Studio 2", props: "Jerseys, TV", product: "Tazaj grilled chicken", shooting: "7 Oct 2026, 4:00 pm", publishing: "10 Oct 2026, 8:00 pm", deadline: "8 Oct 2026, 12:00 pm",
  references: "https://example.com/ref", specialNotes: null, team: [{ role: "Created by (Social Media Manager)", name: "Ali" }, { role: "Videographer", name: "أحمد" }], generatedAt: "5 Oct 2026, 11:00 pm", orgName: "Basma",
};

describe("brief pdf", () => {
  it("renders a valid PDF with Arabic and English content", async () => {
    const pdf = await renderBriefPdf(data);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(10_000);
    if (process.env.PDF_OUT) writeFileSync(process.env.PDF_OUT, pdf);
  });
  it("renders a minimal task (everything optional empty) and a very long script across pages", async () => {
    const blank = { ...data, brand: null, campaign: null, platform: null, objective: null, targetAudience: null, brief: null, consumerInsight: null, keyMessage: null, cta: null, caption: null, hashtags: null, script: null, models: null, location: null, props: null, product: null, references: null };
    expect((await renderBriefPdf(blank)).length).toBeGreaterThan(5_000);
    const long = { ...data, script: Array.from({ length: 60 }, (_, i) => `SCENE ${i + 1} – ${"lorem ipsum dolor sit amet ".repeat(12)}`).join("\n") };
    expect((await renderBriefPdf(long)).length).toBeGreaterThan(20_000);
  });
});
