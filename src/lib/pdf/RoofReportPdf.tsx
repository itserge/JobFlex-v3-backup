// THE ROOF REPORT AS A PDF (2026-11-13) — the sample the owner was shown (artifact J453PeRVwsvGQVwst46Xte), made
// from a real measured roof (lib/roofReport). Letter pages: the cover (the shop's logo, the address, the aerial photo
// with the roof drawn on it, the headline figures, the lines), the facets diagram and table, the lines diagram and
// table, the waste table and the order list (the contractor's copy only), and the facts about the roof with how it was
// measured. The shop's logo leads; "Measured with JobFlex" sits small in the footer. Built like ProposalPdf.
import * as React from "react";
import { Document, Image, Page, Path, StyleSheet, Svg, Line, Text, View } from "@react-pdf/renderer";
import type { FacetEdgeType } from "@/lib/roofFacets/model";
import { squaresWords, type PlanDrawing, type PlanPoint, type RoofReportData } from "@/lib/roofReport/report";

const INK = "#0a0a0a";
const MUTED = "#55524c";
const RULE = "#d9d5cc";
const PAPER = "#f2f0eb";
const ACCENT = "#1854a0";
/** The lines' colours — the same legend as the admin roof lab's drawing. */
export const EDGE_COLOR: Record<FacetEdgeType, string> = { EAVE: "#2f55a4", RAKE: "#3f7d44", RIDGE: "#b23a3a", HIP: "#b8872b", VALLEY: "#5b3a8c", STEP: "#111111", WALL: "#555555", BREAK: "#0f7f86" };
const EDGE_DASH: Partial<Record<FacetEdgeType, string>> = { STEP: "4 3", WALL: "1 3" };

const s = StyleSheet.create({
  page: { paddingTop: 34, paddingBottom: 46, paddingHorizontal: 36, fontFamily: "Helvetica", fontSize: 9.5, color: INK },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", borderBottomWidth: 1.5, borderBottomColor: INK, paddingBottom: 6, marginBottom: 14 },
  headName: { fontSize: 9, fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 1 },
  headRight: { fontSize: 8, color: MUTED, textAlign: "right" },
  foot: { position: "absolute", bottom: 20, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: MUTED, borderTopWidth: 0.5, borderTopColor: RULE, paddingTop: 5 },
  coverTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  logo: { height: 42, maxWidth: 190, objectFit: "contain", objectPosition: "left" },
  coName: { fontSize: 15, fontFamily: "Helvetica-Bold" },
  coLine: { fontSize: 8.5, color: MUTED, textAlign: "right", marginTop: 1 },
  kicker: { fontSize: 8, fontFamily: "Helvetica-Bold", letterSpacing: 2, color: ACCENT, textTransform: "uppercase", marginBottom: 5 },
  addr1: { fontSize: 21, fontFamily: "Helvetica-Bold", letterSpacing: -0.3 },
  addr2: { fontSize: 11, color: "#2a2a2a", marginTop: 2 },
  meta: { fontSize: 8, color: MUTED, marginTop: 6, marginBottom: 12 },
  picBox: { borderWidth: 1.5, borderColor: INK, marginBottom: 12, alignSelf: "center" },
  tiles: { flexDirection: "row", flexWrap: "wrap", borderWidth: 1.5, borderColor: INK, marginBottom: 10 },
  tile: { width: "33.333%", paddingVertical: 7, paddingHorizontal: 9, borderRightWidth: 0.75, borderBottomWidth: 0.75, borderColor: RULE },
  tileLbl: { fontSize: 6.8, letterSpacing: 1.1, color: MUTED, textTransform: "uppercase", marginBottom: 3 },
  tileVal: { fontSize: 17, fontFamily: "Helvetica-Bold" },
  tileSub: { fontSize: 7.2, color: MUTED, marginTop: 1 },
  strip: { flexDirection: "row", borderWidth: 1, borderColor: INK, marginBottom: 10 },
  stripCell: { flexGrow: 1, flexBasis: 0, paddingVertical: 5, paddingHorizontal: 6, borderRightWidth: 0.75, borderColor: RULE },
  stripLbl: { fontSize: 6.5, letterSpacing: 0.8, textTransform: "uppercase", fontFamily: "Helvetica-Bold" },
  stripVal: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 2 },
  stamp: { flexDirection: "row", alignItems: "center" },
  stampBox: { borderWidth: 1.5, paddingVertical: 4, paddingHorizontal: 8, marginRight: 10, flexShrink: 0 },
  stampText: { fontSize: 8, fontFamily: "Helvetica-Bold", letterSpacing: 0.6 },
  stampNote: { fontSize: 7.5, color: MUTED, flex: 1, lineHeight: 1.35 },
  h1: { fontSize: 15, fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 },
  lede: { fontSize: 8.5, color: MUTED, marginBottom: 10, lineHeight: 1.4 },
  h2: { fontSize: 9, fontFamily: "Helvetica-Bold", letterSpacing: 1.3, textTransform: "uppercase", marginTop: 10, marginBottom: 5 },
  drawBox: { borderWidth: 1.5, borderColor: INK, backgroundColor: "#ffffff", marginBottom: 10 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: RULE, paddingVertical: 3.2 },
  th: { flexDirection: "row", borderBottomWidth: 1.2, borderBottomColor: INK, paddingBottom: 3, marginBottom: 1 },
  thText: { fontSize: 7, fontFamily: "Helvetica-Bold", letterSpacing: 0.8, textTransform: "uppercase", color: MUTED },
  num: { textAlign: "right", fontFamily: "Helvetica-Bold" },
  hot: { backgroundColor: PAPER },
  li: { fontSize: 8.6, lineHeight: 1.45, marginBottom: 3, color: "#222" },
  facts: { flexDirection: "row", flexWrap: "wrap", borderWidth: 1, borderColor: INK, marginBottom: 6 },
  fact: { width: "33.333%", paddingVertical: 5, paddingHorizontal: 7, borderRightWidth: 0.75, borderBottomWidth: 0.75, borderColor: RULE },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 8 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4, fontSize: 7.5 },
  small: { fontSize: 7.2, color: MUTED, lineHeight: 1.4 },
});

const whole = (n: number) => Math.round(n).toLocaleString("en-US");
const ftWords = (n: number) => `${whole(n)} ft`;

/** A plan drawing fitted into a box of points: the scale and where its corner lands. */
function fit(plan: { width: number; height: number }, boxW: number, boxH: number, margin = 10) {
  const k = Math.min((boxW - 2 * margin) / plan.width, (boxH - 2 * margin) / plan.height);
  const ox = (boxW - plan.width * k) / 2;
  const oy = (boxH - plan.height * k) / 2;
  return { k, at: (p: PlanPoint) => ({ x: ox + p.x * k, y: oy + p.y * k }) };
}

const ringPath = (rings: PlanPoint[][], at: (p: PlanPoint) => PlanPoint) => rings.map((ring) => `M${ring.map((p) => { const q = at(p); return `${q.x.toFixed(1)} ${q.y.toFixed(1)}`; }).join("L")}Z`).join("");

/** A facet's wash: the steeper, the darker the blue (as the lab's diagram). */
function pitchFill(rise12: number): string {
  const t = Math.min(1, Math.max(0, rise12 / 12));
  const from = [240, 244, 252], to = [140, 170, 222];
  return `rgb(${from.map((v, k) => Math.round(v + (to[k] - v) * t)).join(",")})`;
}

/** A label placed over a drawing: absolute, centred on (x, y). */
function Label({ x, y, w, children, size = 7.5, color = INK, bold = true, bg }: { x: number; y: number; w: number; children: string; size?: number; color?: string; bold?: boolean; bg?: string }) {
  const h = size + 3;
  return (
    <Text style={{ position: "absolute", left: x - w / 2, top: y - h / 2, width: w, height: h, textAlign: "center", fontSize: size, fontFamily: bold ? "Helvetica-Bold" : "Helvetica", color, ...(bg ? { backgroundColor: bg } : {}) }}>
      {children}
    </Text>
  );
}

function FacetsDrawing({ plan, w, h }: { plan: PlanDrawing; w: number; h: number }) {
  const f = fit(plan, w, h);
  return (
    <View style={[s.drawBox, { width: w, height: h, position: "relative" }]}>
      <Svg width={w - 3} height={h - 3} viewBox={`0 0 ${w - 3} ${h - 3}`}>
        {plan.facets.map((fc) => (
          <Path key={fc.letter} d={ringPath(fc.rings, f.at)} fill={pitchFill(fc.pitch12)} fillRule="evenodd" stroke={INK} strokeWidth={1} strokeLinejoin="round" />
        ))}
      </Svg>
      {plan.facets.map((fc) => {
        const p = f.at(fc.label);
        const roomy = fc.roomy && fc.areaSqft >= 40;
        return (
          <View key={`l${fc.letter}`} style={{ position: "absolute", left: 0, top: 0 }}>
            <Label x={p.x} y={roomy ? p.y - 7 : p.y} w={26} size={9}>{fc.letter}</Label>
            {roomy ? <Label x={p.x} y={p.y + 3} w={60} size={6.6}>{`${whole(fc.areaSqft)} sf`}</Label> : null}
            {roomy ? <Label x={p.x} y={p.y + 11} w={40} size={6.2} bold={false} color={MUTED}>{fc.pitchLabel}</Label> : null}
          </View>
        );
      })}
      <NorthArrow x={w - 22} y={16} />
    </View>
  );
}

function LinesDrawing({ plan, w, h }: { plan: PlanDrawing; w: number; h: number }) {
  const f = fit(plan, w, h);
  const labels: Array<{ x: number; y: number; text: string; color: string }> = [];
  const taken: Array<{ x: number; y: number }> = [];
  for (const e of plan.edges) {
    if (e.lengthFt < 3) continue;
    const a = f.at(e.a), b = f.at(e.b);
    if (Math.hypot(a.x - b.x, a.y - b.y) < 16) continue;
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (taken.some((t) => Math.abs(t.x - m.x) < 16 && Math.abs(t.y - m.y) < 8)) continue;
    taken.push(m);
    labels.push({ ...m, text: `${Math.round(e.lengthFt)}'`, color: EDGE_COLOR[e.type] });
  }
  return (
    <View style={[s.drawBox, { width: w, height: h, position: "relative" }]}>
      <Svg width={w - 3} height={h - 3} viewBox={`0 0 ${w - 3} ${h - 3}`}>
        {plan.facets.map((fc) => (
          <Path key={fc.letter} d={ringPath(fc.rings, f.at)} fill="#f7f6f2" fillRule="evenodd" stroke="none" />
        ))}
        {plan.edges.map((e, i) => {
          const a = f.at(e.a), b = f.at(e.b);
          return <Line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={EDGE_COLOR[e.type]} strokeWidth={2} strokeLinecap="round" strokeDasharray={EDGE_DASH[e.type]} />;
        })}
      </Svg>
      {labels.map((l, i) => (
        <View key={i} style={{ position: "absolute", left: 0, top: 0 }}>
          <Label x={l.x} y={l.y} w={22} size={6.6} color={l.color} bg="#ffffff">{l.text}</Label>
        </View>
      ))}
      <NorthArrow x={w - 22} y={16} />
    </View>
  );
}

function NorthArrow({ x, y }: { x: number; y: number }) {
  return (
    <View style={{ position: "absolute", left: x - 8, top: y - 10, width: 16, alignItems: "center" }}>
      <Svg width={10} height={12} viewBox="0 0 10 12">
        <Path d="M5 0 L10 12 L5 9 L0 12 Z" fill={INK} />
      </Svg>
      <Text style={{ fontSize: 6.5, fontFamily: "Helvetica-Bold", marginTop: 1 }}>N</Text>
    </View>
  );
}

function Head({ d }: { d: RoofReportData }) {
  return (
    <View style={s.head} fixed>
      <Text style={s.headName}>{d.company.name}</Text>
      <Text style={s.headRight}>
        Roof report · {d.address.line1} · {d.number}
      </Text>
    </View>
  );
}

function Foot({ d }: { d: RoofReportData }) {
  return (
    <View style={s.foot} fixed>
      <Text>
        {d.number} · {d.dateWords} · {d.copy === "contractor" ? "Contractor's copy" : "Homeowner's copy"}
      </Text>
      <Text>Measured with JobFlex</Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}

function Cover({ d, pictureSrc }: { d: RoofReportData; pictureSrc: string | null }) {
  const boxW = 540, boxH = 318;
  const k = Math.min(boxW / d.photo.widthM, boxH / d.photo.heightM);
  const pw = d.photo.widthM * k, ph = d.photo.heightM * k;
  const outline = d.photo.outline.map((ring) => `M${ring.map((p) => `${(p.x * k).toFixed(1)} ${(p.y * k).toFixed(1)}`).join("L")}Z`).join("");
  const level = d.confidence.level;
  const stampColor = level === "high" ? "#3a7d44" : level === "medium" ? "#b88420" : "#a83232";
  const tiles: Array<[string, string, string?]> = [
    ["Total roof area", `${whole(d.headline.areaSqft)} sq ft`, d.headline.areaFrom === "eagleview" ? "EagleView aerial measurement" : "from the drawing"],
    ["Squares", String(d.headline.squares), "100 sq ft each, no waste"],
    ["Main pitch", d.headline.pitch, "rise in 12"],
    ["Roof faces", String(d.headline.facets), "lettered on page 2"],
    ["Stories", d.headline.stories ? String(d.headline.stories) : "—", d.headline.stories ? "from the eave height" : "not measured"],
    d.copy === "contractor"
      ? ["To order", `${squaresWords(d.orderSquares)} sq`, `at ${d.suggestedWastePct}% waste — see page 4`]
      : ["Roof age", d.roofAgeYears != null ? `About ${Math.round(d.roofAgeYears)} yrs` : "—", d.roofAgeYears != null ? "EagleView's estimate" : "not estimated"],
  ];
  return (
    <Page size="LETTER" style={s.page}>
      <View style={s.coverTop}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf Image has no alt prop */}
        {d.company.logoSrc ? <Image src={d.company.logoSrc} style={s.logo} /> : <Text style={s.coName}>{d.company.name}</Text>}
        <View>
          {d.company.logoSrc ? <Text style={[s.coLine, { color: INK, fontFamily: "Helvetica-Bold", fontSize: 10 }]}>{d.company.name}</Text> : null}
          {d.company.phone ? <Text style={s.coLine}>{d.company.phone}</Text> : null}
          {d.company.website ? <Text style={s.coLine}>{d.company.website}</Text> : null}
        </View>
      </View>
      <Text style={s.kicker}>Roof measurement report</Text>
      <Text style={s.addr1}>{d.address.line1}</Text>
      {d.address.line2 ? <Text style={s.addr2}>{d.address.line2}</Text> : null}
      <Text style={s.meta}>
        Report {d.number} · {d.dateWords} · {d.copy === "contractor" ? "Contractor's copy" : "Homeowner's copy"}
      </Text>
      {pictureSrc ? (
        <View style={[s.picBox, { width: pw + 3, height: ph + 3, position: "relative" }]}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf Image has no alt prop */}
          <Image src={pictureSrc} style={{ position: "absolute", left: 0, top: 0, width: pw, height: ph }} />
          <Svg width={pw} height={ph} viewBox={`0 0 ${pw} ${ph}`} style={{ position: "absolute", left: 0, top: 0 }}>
            {d.photo.lines ? (
              // the hand-traced lines (lib/roofTrace): each in its kind's colour on a white edge, as the admin drew them
              <>
                {d.photo.lines.map((l, i) => (
                  <Line key={`u${i}`} x1={l.a.x * k} y1={l.a.y * k} x2={l.b.x * k} y2={l.b.y * k} stroke="#ffffff" strokeWidth={3.2} strokeLinecap="round" />
                ))}
                {d.photo.lines.map((l, i) => (
                  <Line key={`l${i}`} x1={l.a.x * k} y1={l.a.y * k} x2={l.b.x * k} y2={l.b.y * k} stroke={EDGE_COLOR[l.type]} strokeWidth={1.6} strokeLinecap="round" strokeDasharray={EDGE_DASH[l.type]} />
                ))}
              </>
            ) : (
              <>
                <Path d={outline} fill="none" stroke="#ffffff" strokeWidth={2.4} strokeLinejoin="round" />
                <Path d={outline} fill="none" stroke="#f2b705" strokeWidth={1.1} strokeLinejoin="round" />
              </>
            )}
          </Svg>
        </View>
      ) : (
        <FacetsDrawing plan={d.plan} w={540} h={250} />
      )}
      <View style={s.tiles}>
        {tiles.map(([lbl, val, sub]) => (
          <View key={lbl} style={s.tile}>
            <Text style={s.tileLbl}>{lbl}</Text>
            <Text style={s.tileVal}>{val}</Text>
            {sub ? <Text style={s.tileSub}>{sub}</Text> : null}
          </View>
        ))}
      </View>
      <View style={s.strip}>
        {d.lines.filter((l) => l.type !== "BREAK").map((l) => (
          <View key={l.type} style={s.stripCell}>
            <Text style={[s.stripLbl, { color: EDGE_COLOR[l.type] }]}>{l.words}</Text>
            <Text style={s.stripVal}>{ftWords(l.feet)}</Text>
          </View>
        ))}
      </View>
      <View style={s.stamp}>
        <View style={[s.stampBox, { borderColor: stampColor }]}>
          <Text style={[s.stampText, { color: stampColor }]}>{`MEASURED · CONFIDENCE ${level.toUpperCase()}`}</Text>
        </View>
        <Text style={s.stampNote}>Measured from above{d.photo.date ? ` on imagery of ${d.photo.date}` : ""}. Confirm on site before ordering — how it was measured is on the last page.</Text>
      </View>
      <Foot d={d} />
    </Page>
  );
}

function FacetsPage({ d }: { d: RoofReportData }) {
  return (
    <Page size="LETTER" style={s.page}>
      <Head d={d} />
      <Text style={s.h1}>Roof faces</Text>
      <Text style={s.lede}>Top view, north up. Each face is lettered with its area along the slope and its pitch; the steeper the face, the darker the blue.</Text>
      <FacetsDrawing plan={d.plan} w={540} h={330} />
      <View style={s.th}>
        <Text style={[s.thText, { width: "12%" }]}>Face</Text>
        <Text style={[s.thText, { width: "34%" }]}>Part of the roof</Text>
        <Text style={[s.thText, { width: "16%" }]}>Pitch</Text>
        <Text style={[s.thText, { width: "18%" }]}>Faces</Text>
        <Text style={[s.thText, { width: "20%", textAlign: "right" }]}>Area, sq ft</Text>
      </View>
      {d.facetsTable.map((f) => (
        <View key={f.letter} style={s.tr} wrap={false}>
          <Text style={{ width: "12%", fontFamily: "Helvetica-Bold" }}>{f.letter}</Text>
          <Text style={{ width: "34%" }}>{f.part}</Text>
          <Text style={{ width: "16%" }}>{f.pitch}</Text>
          <Text style={{ width: "18%" }}>{f.facing}</Text>
          <Text style={[s.num, { width: "20%" }]}>{whole(f.areaSqft)}</Text>
        </View>
      ))}
      <View style={[s.tr, { borderBottomWidth: 1.2, borderBottomColor: INK }]}>
        <Text style={{ width: "80%", fontFamily: "Helvetica-Bold" }}>All faces</Text>
        <Text style={[s.num, { width: "20%" }]}>{whole(d.compare.drawingSqft)}</Text>
      </View>
      <Foot d={d} />
    </Page>
  );
}

function LinesPage({ d }: { d: RoofReportData }) {
  return (
    <Page size="LETTER" style={s.page}>
      <Head d={d} />
      <Text style={s.h1}>Lines and lengths</Text>
      <Text style={s.lede}>Every edge of the roof with its length in feet, measured along the slope.</Text>
      <View style={s.legend}>
        {d.lines.map((l) => (
          <View key={l.type} style={s.legendItem}>
            <Svg width={18} height={4} viewBox="0 0 18 4">
              <Line x1={0} y1={2} x2={18} y2={2} stroke={EDGE_COLOR[l.type]} strokeWidth={2.4} strokeDasharray={EDGE_DASH[l.type]} />
            </Svg>
            <Text>{l.words}</Text>
          </View>
        ))}
      </View>
      <LinesDrawing plan={d.plan} w={540} h={330} />
      <View style={s.th}>
        <Text style={[s.thText, { width: "24%" }]}>Line</Text>
        <Text style={[s.thText, { width: "12%", textAlign: "right" }]}>Runs</Text>
        <Text style={[s.thText, { width: "16%", textAlign: "right" }]}>Length</Text>
        <Text style={[s.thText, { width: "48%", paddingLeft: 14 }]}>What it is for</Text>
      </View>
      {d.lines.map((l) => (
        <View key={l.type} style={s.tr} wrap={false}>
          <Text style={{ width: "24%", fontFamily: "Helvetica-Bold", color: EDGE_COLOR[l.type] }}>{l.words}</Text>
          <Text style={[s.num, { width: "12%", fontFamily: "Helvetica" }]}>{l.count}</Text>
          <Text style={[s.num, { width: "16%" }]}>{ftWords(l.feet)}</Text>
          <Text style={{ width: "48%", paddingLeft: 14, color: MUTED }}>{l.use}</Text>
        </View>
      ))}
      <Foot d={d} />
    </Page>
  );
}

function OrderPage({ d }: { d: RoofReportData }) {
  return (
    <Page size="LETTER" style={s.page}>
      <Head d={d} />
      <Text style={s.h1}>Waste and order list</Text>
      <Text style={s.lede}>
        {`Squares are rounded up to a third (three bundles a square). The suggested waste, ${d.suggestedWastePct}%, follows the roof's cuts: 8% on a plain roof, more for every hip and valley.`}
      </Text>
      <View style={s.th}>
        <Text style={[s.thText, { width: "30%" }]}>Waste</Text>
        <Text style={[s.thText, { width: "35%", textAlign: "right" }]}>Area, sq ft</Text>
        <Text style={[s.thText, { width: "35%", textAlign: "right" }]}>Squares</Text>
      </View>
      {d.waste.map((w) => (
        <View key={w.pct} style={[s.tr, ...(w.suggested ? [s.hot] : [])]} wrap={false}>
          <Text style={{ width: "30%", fontFamily: w.suggested ? "Helvetica-Bold" : "Helvetica" }}>{`${w.pct}%${w.suggested ? "  · suggested" : ""}`}</Text>
          <Text style={[s.num, { width: "35%", fontFamily: "Helvetica" }]}>{whole(w.areaSqft)}</Text>
          <Text style={[s.num, { width: "35%" }]}>{squaresWords(w.squares)}</Text>
        </View>
      ))}
      <Text style={s.h2}>{`Order list — ${squaresWords(d.orderSquares)} squares at ${d.suggestedWastePct}%`}</Text>
      <View style={s.th}>
        <Text style={[s.thText, { width: "34%" }]}>Item</Text>
        <Text style={[s.thText, { width: "12%", textAlign: "right" }]}>Qty</Text>
        <Text style={[s.thText, { width: "12%", paddingLeft: 6 }]}>Unit</Text>
        <Text style={[s.thText, { width: "42%" }]}>How it is counted</Text>
      </View>
      {d.order.map((o) => (
        <View key={o.item} style={s.tr} wrap={false}>
          <Text style={{ width: "34%", fontFamily: "Helvetica-Bold" }}>{o.item}</Text>
          <Text style={[s.num, { width: "12%" }]}>{whole(o.qty)}</Text>
          <Text style={{ width: "12%", paddingLeft: 6 }}>{o.unit}</Text>
          <Text style={{ width: "42%", color: MUTED, fontSize: 8 }}>{o.rule}</Text>
        </View>
      ))}
      <Text style={[s.small, { marginTop: 8 }]}>
        For asphalt shingles. Pipe boots, vents, skylight kits and anything not on the drawing are counted on site. Check the counts against your supplier&apos;s bundle and roll sizes.
      </Text>
      <Foot d={d} />
    </Page>
  );
}

function AboutPage({ d }: { d: RoofReportData }) {
  return (
    <Page size="LETTER" style={s.page}>
      <Head d={d} />
      <Text style={s.h1}>About the roof</Text>
      <Text style={s.lede}>What the aerial measurement saw. Classifications are EagleView&apos;s, read from above.</Text>
      {d.facts.length ? (
        <View style={s.facts}>
          {d.facts.map((f) => (
            <View key={f.label} style={s.fact}>
              <Text style={s.tileLbl}>{f.label}</Text>
              <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold" }}>{f.value}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={s.li}>No classifications came with this measurement.</Text>
      )}
      {d.eaves.length ? (
        <>
          <Text style={s.h2}>Eave height by side</Text>
          <View style={[s.facts, { borderWidth: 1 }]}>
            {d.eaves.map((e) => (
              <View key={e.side} style={[s.fact, { width: `${100 / Math.max(4, d.eaves.length)}%` }]}>
                <Text style={s.tileLbl}>{e.side}</Text>
                <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold" }}>{`${e.feet} ft`}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}
      {d.copy === "contractor" ? (
        <>
          <Text style={s.h2}>Check on site</Text>
          {d.checkOnSite.map((c, i) => (
            <Text key={i} style={s.li}>{`·  ${c}`}</Text>
          ))}
        </>
      ) : null}
      <Text style={s.h2}>How it was measured</Text>
      {d.howMeasured.map((c, i) => (
        <Text key={i} style={s.li}>{`·  ${c}`}</Text>
      ))}
      <Text style={[s.small, { marginTop: 10 }]}>
        {`This report is an aerial estimate for planning and ordering. It is not a survey or an engineering document. ${d.company.name} prepared it with JobFlex.`}
      </Text>
      <Foot d={d} />
    </Page>
  );
}

export function RoofReportPdfDocument({ data, pictureSrc }: { data: RoofReportData; pictureSrc: string | null }) {
  return (
    <Document title={`Roof report — ${data.address.line1}`} author={data.company.name} creator="JobFlex" producer="JobFlex">
      <Cover d={data} pictureSrc={pictureSrc} />
      <FacetsPage d={data} />
      <LinesPage d={data} />
      {data.copy === "contractor" ? <OrderPage d={data} /> : null}
      <AboutPage d={data} />
    </Document>
  );
}
