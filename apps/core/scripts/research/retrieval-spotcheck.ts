// PREREG_v3.md §3.6 retrieval-grounding spot-check.
// Given a courseId and a query, calls the real Core retrieval path
// (findRelevantContent) and reports the top chunks' source + similarity,
// so a human can eyeball whether the retrieved material actually supports
// the prompt (not a substitute for the full validate-task-suite.mjs gate
// §3.6 specifies, which doesn't exist yet — see PREREG §10 deviation log).

import { readFileSync } from "node:fs";
import prisma from "../../app/lib/prisma.server";
import { findRelevantContent } from "../../app/lib/ai/embedding";

type Sample = { id: string; courseTheme: string; prompt: string };

const SAMPLES: Sample[] = [
  { id: "v3-077", courseTheme: "machine_architecture", prompt: "Why do interrupts let a processor avoid wasting cycles on polling for slow I/O devices?" },
  { id: "v3-107", courseTheme: "software_engineering", prompt: "For a library system, a 'Return Book' use case and a 'Renew Book' use case both need to check whether a book is overdue. What relationship should connect them in a use case diagram?" },
  { id: "v3-143", courseTheme: "operating_systems", prompt: "What is the difference between deadlock prevention and deadlock avoidance?" },
  { id: "v3-048", courseTheme: "machine_architecture", prompt: "Explain how instruction forwarding reduces stalls caused by data hazards." },
  { id: "v3-129", courseTheme: "operating_systems", prompt: "What coordination problem do semaphores solve that mutexes alone may not in a producer-consumer scenario?" },
  { id: "v3-147", courseTheme: "operating_systems", prompt: "A program's memory usage keeps growing over a long run even though it calls free(). What could be going wrong?" },
  { id: "v3-136", courseTheme: "operating_systems", prompt: "Why does round robin scheduling generally produce worse average turnaround time than shortest-job-first for CPU-bound processes?" },
  { id: "v3-119", courseTheme: "software_engineering", prompt: "Why is a class diagram the wrong tool for showing the step-by-step message flow of a single use case?" },
];

const themeToSlug: Record<string, string> = {
  intro_programming: "intro-programming",
  machine_architecture: "machine-architecture",
  software_engineering: "software-engineering",
  operating_systems: "operating-systems",
  hci: "hci",
};

async function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) throw new Error("Usage: tsx retrieval-spotcheck.ts <seed-manifest.json>");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  for (const s of SAMPLES) {
    const slug = themeToSlug[s.courseTheme];
    const courseId = manifest[slug]?.courseId;
    if (!courseId) {
      console.log(`\n=== ${s.id} (${s.courseTheme}) === NO courseId for slug ${slug}, skipping`);
      continue;
    }
    console.log(`\n=== ${s.id} (${s.courseTheme} / ${courseId}) ===`);
    console.log(`Q: ${s.prompt}`);
    try {
      const chunks = await findRelevantContent(s.prompt, courseId, 4, 0);
      if (!chunks || chunks.length === 0) {
        console.log("  NO CHUNKS RETRIEVED");
        continue;
      }
      for (const c of chunks) {
        const preview = c.content.replace(/\s+/g, " ").slice(0, 200);
        console.log(`  [sim=${c.similarity.toFixed(3)}] ${c.materialTitle}: ${preview}...`);
      }
    } catch (err) {
      console.log(`  ERROR: ${(err as Error).message}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
