import "server-only";
import path from "node:path";
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { parseScenes, pdfSafe, textDirection } from "./brief-content";

export interface BriefData {
  taskCode: string; title: string; brand: string | null; campaign: string | null; contentType: string; platform: string | null;
  priority: string; stage: string;
  objective: string | null; targetAudience: string | null; brief: string | null; consumerInsight: string | null; keyMessage: string | null; cta: string | null;
  caption: string | null; hashtags: string | null;
  script: string | null; models: string | null; location: string | null; props: string | null; product: string | null;
  shooting: string; publishing: string; deadline: string; references: string | null; specialNotes: string | null;
  team: { role: string; name: string }[];
  generatedAt: string; orgName: string;
}

const fonts = path.join(process.cwd(), "assets", "fonts");
Font.register({
  family: "Plex",
  fonts: [
    { src: path.join(fonts, "IBMPlexSansArabic-Regular.ttf"), fontWeight: 400 },
    { src: path.join(fonts, "IBMPlexSansArabic-Bold.ttf"), fontWeight: 700 },
  ],
});
Font.registerHyphenationCallback((w) => [w]); // never hyphenate (breaks Arabic words and codes)

const INK = "#0f172a", MUTED = "#64748b", BRAND = "#243f9c", LINE = "#e2e8f0";
const s = StyleSheet.create({
  page: { fontFamily: "Plex", fontSize: 10, color: INK, paddingTop: 36, paddingBottom: 54, paddingHorizontal: 40, lineHeight: 1.45 },
  band: { backgroundColor: "#142156", color: "white", paddingVertical: 18, paddingHorizontal: 40, marginHorizontal: -40, marginTop: -36, marginBottom: 18 },
  brand: { fontSize: 18, fontWeight: 700, letterSpacing: 2 },
  doc: { fontSize: 9, letterSpacing: 2, marginTop: 6, color: "#dbe7ff" },
  grid: { flexDirection: "row", flexWrap: "wrap", marginBottom: 6, borderTop: `1 solid ${LINE}` },
  cell: { width: "33.33%", paddingVertical: 6, paddingRight: 8, borderBottom: `1 solid ${LINE}` },
  label: { fontSize: 7.5, fontWeight: 700, color: MUTED, letterSpacing: 1, marginBottom: 2 },
  h: { fontSize: 11, fontWeight: 700, color: BRAND, letterSpacing: 1.2, marginTop: 14, marginBottom: 5, borderBottom: `1.5 solid ${BRAND}`, paddingBottom: 2 },
  scene: { border: `1 solid ${LINE}`, borderRadius: 3, padding: 8, marginBottom: 6, backgroundColor: "#f8fafc" },
  sceneTitle: { fontSize: 8.5, fontWeight: 700, color: BRAND, letterSpacing: 1, marginBottom: 3 },
  footer: { position: "absolute", bottom: 22, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", fontSize: 8, color: MUTED, borderTop: `1 solid ${LINE}`, paddingTop: 5 },
});

/** Arabic blocks are right-aligned; everything else left. */
/** One <Text> per line so each line gets its own base direction (RTL for Arabic-first lines). */
const Body = ({ text, title }: { text: string; title?: boolean }) => (
  <View style={title ? { marginBottom: 10 } : {}}>
    {pdfSafe(text).split("\n").map((line, i) => {
      if (!line.trim()) return <View key={i} style={{ height: 5 }} />;
      const rtl = textDirection(line) === "rtl";
      return (
        <Text key={i} style={{ direction: rtl ? "rtl" : "ltr", textAlign: rtl ? "right" : "left", ...(title ? { fontSize: 16, fontWeight: 700, lineHeight: 1.7 } : {}) }}>
          {line}
        </Text>
      );
    })}
  </View>
);
const Field = ({ label, value, wide }: { label: string; value: string | null; wide?: boolean }) => (
  <View style={[s.cell, wide ? { width: "100%" } : {}]} wrap={false}>
    <Text style={s.label}>{label.toUpperCase()}</Text>
    <Body text={value && pdfSafe(value) ? value : "—"} />
  </View>
);
const Section = ({ title, text }: { title: string; text: string | null }) =>
  text && pdfSafe(text) ? (
    <View wrap={false}><Text style={s.h}>{title}</Text><Body text={text} /></View>
  ) : null;

export function BriefDocument({ d }: { d: BriefData }) {
  const scenes = parseScenes(pdfSafe(d.script).length ? d.script : null);
  const pretty = (v: string) => v.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  return (
    <Document title={`${d.taskCode} – Production Brief`} author={d.orgName} creator="BASMA MARKETING">
      <Page size="A4" style={s.page}>
        <View style={s.band}>
          <Text style={[s.brand, { color: "white" }]}>BASMA MARKETING</Text>
          <Text style={s.doc}>CONTENT PRODUCTION BRIEF</Text>
        </View>
        <Body text={d.title} title />
        <View style={s.grid}>
          <Field label="Task ID" value={d.taskCode} />
          <Field label="Brand" value={d.brand} />
          <Field label="Campaign" value={d.campaign} />
          <Field label="Content type" value={pretty(d.contentType)} />
          <Field label="Platform" value={d.platform ? pretty(d.platform) : null} />
          <Field label="Priority" value={pretty(d.priority)} />
          <Field label="Shooting" value={d.shooting} />
          <Field label="Publishing" value={d.publishing} />
          <Field label="Deadline" value={d.deadline} />
        </View>

        <Section title="OBJECTIVE" text={d.objective} />
        <Section title="TARGET AUDIENCE" text={d.targetAudience} />
        <Section title="BRIEF" text={d.brief} />
        <Section title="CONSUMER INSIGHT" text={d.consumerInsight} />
        <Section title="KEY MESSAGE" text={d.keyMessage} />
        <Section title="CTA" text={d.cta} />
        <Section title="CAPTION" text={d.caption} />
        <Section title="HASHTAGS" text={d.hashtags} />

        {scenes.length > 0 && (
          <View>
            <Text style={s.h}>SCRIPT</Text>
            {scenes.map((sc, i) => (
              <View key={i} style={s.scene} wrap={sc.body.length > 600}>
                <Text style={s.sceneTitle}>{sc.title}</Text>
                <Body text={sc.body} />
              </View>
            ))}
          </View>
        )}

        <Section title="MODELS" text={d.models} />
        <Section title="LOCATION" text={d.location} />
        <Section title="PROPS" text={d.props} />
        <Section title="PRODUCT" text={d.product} />
        <Section title="REFERENCES" text={d.references} />
        <Section title="SPECIAL NOTES" text={d.specialNotes} />

        <View wrap={false}>
          <Text style={s.h}>ASSIGNED TEAM</Text>
          {d.team.map((m, i) => (
            <View key={i} style={{ flexDirection: "row", marginBottom: 2 }}>
              <Text style={{ width: 190, color: MUTED }}>{m.role}</Text><Text>{pdfSafe(m.name)}</Text>
            </View>
          ))}
        </View>

        <View style={s.footer} fixed>
          <Text>{d.taskCode} · {d.orgName} · Generated {d.generatedAt}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderBriefPdf(d: BriefData): Promise<Buffer> {
  return renderToBuffer(<BriefDocument d={d} />);
}
