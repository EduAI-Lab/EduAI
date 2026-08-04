// PREREG_v3.md §3.6 retrieval-grounding spot-check, for the confirmatory-general
// top-up round (v3-201–v3-212, authoring_round: "confirmatory-general-topup-1").
// Separate from retrieval-spotcheck.ts's original 8-prompt sample — this checks
// specifically the 12 freshly-authored prompts, which the earlier spot-check
// did not cover.

import { readFileSync } from "node:fs";
import prisma from "../../app/lib/prisma.server";
import { findRelevantContent } from "../../app/lib/ai/embedding";

type Sample = { id: string; courseTheme: string; prompt: string };

const SAMPLES: Sample[] = [
  { id: "v3-201", courseTheme: "intro_programming", prompt: "Write a Java method reverseList(Node head) that reverses a singly linked list in place and returns the new head, without allocating a new list." },
  { id: "v3-202", courseTheme: "intro_programming", prompt: "Implement a Java method that performs quicksort on an int array in place, choosing the last element of each partition as the pivot." },
  { id: "v3-203", courseTheme: "intro_programming", prompt: "Write a Java method that inserts a new value into a binary search tree, maintaining the BST ordering property, without using recursion." },
  { id: "v3-204", courseTheme: "machine_architecture", prompt: "Write the MIPS assembly for a function that computes the sum of an integer array, where the array's base address is in $a0 and its length is in $a1, storing the result in $v0." },
  { id: "v3-205", courseTheme: "software_engineering", prompt: "Write pseudocode for an Observer-pattern implementation where a WeatherStation subject notifies multiple Display objects whenever its temperature reading changes." },
  { id: "v3-206", courseTheme: "operating_systems", prompt: "Write pseudocode for a resource-ordering deadlock-prevention scheme: given a fixed global order over resource types A, B, C, D, show how two threads that each need two of these resources should acquire and release them to guarantee no circular wait can occur." },
  { id: "v3-207", courseTheme: "intro_programming", prompt: "A recursive method meant to reverse a linked list in place returns successfully but the resulting list is unchanged from the original order. Here is the method: it recurses to the end of the list, then on the way back up sets node.next.next = node, but never sets the original head's next pointer to null and never updates what the caller treats as the new head. What's going wrong, and what's the minimal fix?" },
  { id: "v3-208", courseTheme: "intro_programming", prompt: "A recursive binary search implementation works correctly on some inputs but throws a StackOverflowError on a large sorted array when searching for a value that isn't present. What's the most likely bug in how the recursive calls narrow the search range?" },
  { id: "v3-209", courseTheme: "machine_architecture", prompt: "A MIPS loop meant to sum array elements into $t0 produces a result that's consistently off by exactly one element's value, either too high or too low depending on how the loop bound was written. What class of off-by-one bug is this, and what's the general fix?" },
  { id: "v3-210", courseTheme: "software_engineering", prompt: "A test suite for a Strategy-pattern SortingContext class passes when tested manually but a newly added unit test that swaps strategies mid-run intermittently fails, sometimes using the old strategy after a swap and sometimes the new one. What design assumption about when the strategy reference is read is most likely being violated?" },
  { id: "v3-211", courseTheme: "operating_systems", prompt: "A system using the Banker's Algorithm for deadlock avoidance keeps denying resource requests that a developer believes should be safe to grant, even though no deadlock is actually occurring. What's a likely reason the safety check is over-conservative, given how the algorithm evaluates a request?" },
  { id: "v3-212", courseTheme: "hci", prompt: "A settings screen uses a toggle switch that looks identical whether it's on or off, distinguished only by a color difference between two shades of gray. Several users with low-vision report being unable to tell the toggle's state. Which accessibility principle is being violated, and what's a concrete fix that doesn't rely on color alone?" },
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
  if (!manifestPath) throw new Error("Usage: tsx retrieval-spotcheck-topup1.ts <seed-manifest.json>");
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
