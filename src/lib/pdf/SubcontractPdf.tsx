import * as React from "react";
import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";
import type { AgreementSection } from "@/lib/subContracts/shared";

// THE SIGNED SUBCONTRACT (2026-11-08, the subcontractors plan, part 4): the agreement as the signing page showed it —
// the parties, the numbered sections, the payment schedule — with both signatures stamped under it (the company's
// typed name when it was sent, the sub's typed name with the time, the address and the browser), rendered on the
// server the moment the sub signs (lib/subContracts/server) and kept in the private store as a SubDocument. Letter,
// Helvetica, the proposal PDF's palette (./ProposalPdf) so the company's paper looks like one set.

const C = {
  paper: "#FAFAF7",
  ink: "#111113",
  soft: "#2A2A2E",
  muted: "#6B6A64",
  faint: "#A6A49D",
  line: "#E8E6DE",
  accent: "#1F7A52",
};

const s = StyleSheet.create({
  page: { backgroundColor: C.paper, color: C.ink, paddingTop: 56, paddingBottom: 72, paddingHorizontal: 56, fontFamily: "Helvetica", fontSize: 10, lineHeight: 1.5 },
  logoRow: { marginBottom: 14 },
  logo: { height: 40, maxWidth: 160, objectFit: "contain", objectPosition: "left" },
  eyebrow: { fontSize: 8, letterSpacing: 1.6, color: C.muted, textTransform: "uppercase" },
  title: { fontSize: 24, fontFamily: "Helvetica-Bold", marginTop: 6, letterSpacing: -0.5, lineHeight: 1.1 },
  sub: { fontSize: 10.5, color: C.soft, marginTop: 4 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 14, paddingBottom: 12, borderBottomWidth: 0.5, borderBottomColor: C.line },
  metaItem: { flexDirection: "column", gap: 2, maxWidth: "32%" },
  metaLabel: { fontSize: 7.5, letterSpacing: 1.4, color: C.muted, textTransform: "uppercase" },
  metaValue: { fontSize: 10.5, color: C.ink },
  section: { marginTop: 16 },
  heading: { fontSize: 11, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  line: { fontSize: 10, color: C.soft, marginBottom: 3 },
  bullet: { flexDirection: "row", marginBottom: 2 },
  dot: { width: 10, color: C.faint },
  bulletText: { flex: 1, fontSize: 10, color: C.soft },
  sigBlock: { marginTop: 26, paddingTop: 14, borderTopWidth: 0.5, borderTopColor: C.line, flexDirection: "row", gap: 24 },
  sig: { flex: 1 },
  sigLabel: { fontSize: 7.5, letterSpacing: 1.4, color: C.muted, textTransform: "uppercase", marginBottom: 6 },
  sigName: { fontSize: 14, fontFamily: "Helvetica-Oblique", color: C.ink, paddingBottom: 4, borderBottomWidth: 0.75, borderBottomColor: C.ink },
  sigMeta: { fontSize: 8.5, color: C.muted, marginTop: 4 },
  stamp: { marginTop: 14, fontSize: 8.5, color: C.accent, letterSpacing: 0.4 },
  footer: { position: "absolute", bottom: 32, left: 56, right: 56, flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 10, borderTopWidth: 0.5, borderTopColor: C.line },
  footerText: { fontSize: 8, color: C.muted },
  footerAccent: { fontSize: 8, color: C.accent, letterSpacing: 0.5 },
});

export type SubcontractPdfData = {
  number: string;
  title: string;
  company: { name: string; phone: string | null; logoSrc: string | null };
  sub: { name: string; company: string | null; license: string | null };
  project: { name: string; address: string | null };
  sections: AgreementSection[];
  signatures: {
    company: { name: string; at: string } | null;
    sub: { name: string; at: string; ip: string | null; userAgent: string | null } | null;
  };
  /** "Executed on JobFlex, November 8, 2026 at 1:04 PM Pacific". */
  stamp: string | null;
};

export function SubcontractPdfDocument({ data }: { data: SubcontractPdfData }) {
  return (
    <Document title={`Subcontract ${data.number} — ${data.title}`} author={data.company.name} subject={data.project.name}>
      <Page size="LETTER" style={s.page}>
        {data.company.logoSrc ? (
          <View style={s.logoRow}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's Image takes no alt */}
            <Image style={s.logo} src={data.company.logoSrc} />
          </View>
        ) : null}
        <Text style={s.eyebrow}>Subcontract {data.number}</Text>
        <Text style={s.title}>{data.title}</Text>
        <Text style={s.sub}>{data.project.name}{data.project.address ? ` · ${data.project.address}` : ""}</Text>
        <View style={s.metaRow}>
          <View style={s.metaItem}>
            <Text style={s.metaLabel}>Contractor</Text>
            <Text style={s.metaValue}>{data.company.name}</Text>
            {data.company.phone ? <Text style={s.metaValue}>{data.company.phone}</Text> : null}
          </View>
          <View style={s.metaItem}>
            <Text style={s.metaLabel}>Subcontractor</Text>
            <Text style={s.metaValue}>{data.sub.name}</Text>
            {data.sub.company && data.sub.company !== data.sub.name ? <Text style={s.metaValue}>{data.sub.company}</Text> : null}
            {data.sub.license ? <Text style={s.metaValue}>License {data.sub.license}</Text> : null}
          </View>
          <View style={s.metaItem}>
            <Text style={s.metaLabel}>Status</Text>
            <Text style={s.metaValue}>{data.signatures.sub ? "Executed" : "Awaiting signature"}</Text>
          </View>
        </View>

        {data.sections.map((sec) => (
          <View key={sec.key} style={s.section} wrap={sec.key !== "payments"}>
            <Text style={s.heading}>{sec.heading}</Text>
            {sec.key === "scope" || sec.key === "payments" || sec.key === "attachments"
              ? sec.lines.map((l, i) => (
                  <View key={i} style={s.bullet}>
                    <Text style={s.dot}>•</Text>
                    <Text style={s.bulletText}>{l}</Text>
                  </View>
                ))
              : sec.lines.map((l, i) => (
                  <Text key={i} style={s.line}>
                    {l}
                  </Text>
                ))}
          </View>
        ))}

        <View style={s.sigBlock} wrap={false}>
          <View style={s.sig}>
            <Text style={s.sigLabel}>For the contractor · {data.company.name}</Text>
            <Text style={s.sigName}>{data.signatures.company?.name ?? " "}</Text>
            <Text style={s.sigMeta}>{data.signatures.company ? `Signed ${data.signatures.company.at}` : "Not signed"}</Text>
          </View>
          <View style={s.sig}>
            <Text style={s.sigLabel}>For the subcontractor · {data.sub.name}</Text>
            <Text style={s.sigName}>{data.signatures.sub?.name ?? " "}</Text>
            <Text style={s.sigMeta}>{data.signatures.sub ? `Signed ${data.signatures.sub.at}${data.signatures.sub.ip ? ` · from ${data.signatures.sub.ip}` : ""}` : "Not signed"}</Text>
            {data.signatures.sub?.userAgent ? <Text style={s.sigMeta}>{data.signatures.sub.userAgent.slice(0, 110)}</Text> : null}
          </View>
        </View>
        {data.stamp ? <Text style={s.stamp}>{data.stamp}</Text> : null}

        {/* No "Page n of N": a render-prop Text in @react-pdf/renderer 4.5.1 drops the whole fixed footer when rendered
            on the server (2026-11-08), and alone it never draws. */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>
            Subcontract {data.number} · {data.company.name} and {data.sub.name}
          </Text>
          <Text style={s.footerAccent}>JOBFLEX · jobflex.app</Text>
        </View>
      </Page>
    </Document>
  );
}
