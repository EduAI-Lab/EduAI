#!/usr/bin/env node
/**
 * Export strict oracle labels to a Word table (prompt | appropriate model).
 *
 * Env:
 *   RESEARCH_LABEL_OUT  default URA/docs/research/data/runs/labels/labels-strict.v1.jsonl
 *   RESEARCH_DOCX_OUT   output .docx path
 */
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  HeadingLevel,
  BorderStyle,
} from "docx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const URA_RUNS = resolve(__dirname, "../../../../../docs/research/data/runs");

function readEnv(name, fallback) {
  const v = process.env[name];
  return v !== undefined && v !== "" ? v : fallback;
}

function loadJsonl(path) {
  const raw = readFileSync(path, "utf8").trim();
  if (!raw) return [];
  return raw.split("\n").map((line, i) => {
    try {
      return JSON.parse(line);
    } catch (e) {
      throw new Error(`${path} line ${i + 1}: ${e.message}`);
    }
  });
}

function tierLabel(tier) {
  if (tier === 1) return "7B (tier 1)";
  if (tier === 3) return "32B (tier 3)";
  return String(tier ?? "—");
}

function cellParagraph(text, opts = {}) {
  return new Paragraph({
    children: [
      new TextRun({
        text: String(text ?? ""),
        bold: opts.bold ?? false,
        size: opts.size ?? 22,
      }),
    ],
  });
}

function headerCell(text) {
  return new TableCell({
    children: [cellParagraph(text, { bold: true, size: 24 })],
    shading: { fill: "E8EEF7" },
  });
}

function bodyCell(text) {
  return new TableCell({
    children: [cellParagraph(text)],
  });
}

async function main() {
  const labelsPath = readEnv(
    "RESEARCH_LABEL_OUT",
    join(URA_RUNS, "labels/labels-strict.v1.jsonl"),
  );
  const outPath = readEnv(
    "RESEARCH_DOCX_OUT",
    join(URA_RUNS, "labels/oracle-prompts-by-tier.docx"),
  );

  const rows = loadJsonl(labelsPath).sort((a, b) =>
    (a.prompt_id ?? "").localeCompare(b.prompt_id ?? ""),
  );

  const tier3 = rows.filter((r) => r.min_adequate_tier === 3);
  const tier1 = rows.filter((r) => r.min_adequate_tier === 1);

  const tableRows = [
    new TableRow({
      children: [
        headerCell("Prompt ID"),
        headerCell("Prompt"),
        headerCell("Appropriate model"),
        headerCell("Stratum"),
        headerCell("Category"),
        headerCell("Tier-sensitive"),
      ],
      tableHeader: true,
    }),
    ...rows.map(
      (r) =>
        new TableRow({
          children: [
            bodyCell(r.prompt_id),
            bodyCell(r.prompt),
            bodyCell(tierLabel(r.min_adequate_tier)),
            bodyCell(r.stratum),
            bodyCell(r.category),
            bodyCell(r.tier_sensitive ? "Yes" : "No"),
          ],
        }),
    ),
  ];

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun("Oracle labels — prompt vs appropriate model")],
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: `Strict automated labels (labels-strict.v1). ${rows.length} dev prompts: ${tier1.length} need 7B only, ${tier3.length} need 32B. Generated ${new Date().toISOString().slice(0, 10)}.`,
                size: 22,
              }),
            ],
          }),
          new Paragraph({ children: [] }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: tableRows,
            borders: {
              top: { style: BorderStyle.SINGLE, size: 1 },
              bottom: { style: BorderStyle.SINGLE, size: 1 },
              left: { style: BorderStyle.SINGLE, size: 1 },
              right: { style: BorderStyle.SINGLE, size: 1 },
              insideHorizontal: { style: BorderStyle.SINGLE, size: 1 },
              insideVertical: { style: BorderStyle.SINGLE, size: 1 },
            },
          }),
          new Paragraph({ children: [] }),
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun("Prompts requiring 32B (tier 3)")],
          }),
          ...tier3.flatMap((r) => [
            new Paragraph({
              children: [
                new TextRun({ text: `${r.prompt_id} — `, bold: true }),
                new TextRun({ text: r.prompt }),
              ],
            }),
          ]),
        ],
      },
    ],
  });

  mkdirSync(dirname(outPath), { recursive: true });
  const buffer = await Packer.toBuffer(doc);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(outPath, buffer);

  console.log("Wrote:", outPath);
  console.log(`Rows: ${rows.length} (tier 1: ${tier1.length}, tier 3: ${tier3.length})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
