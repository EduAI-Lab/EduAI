/**
 * Seed a synthetic test course for the RAG strategy eval (#432).
 * Run from apps/core:  npm run eval:rag:seed
 *
 * Forces cloud embedding (OpenRouter text-embedding-3-small, 1024-dim) so the
 * script works even when Ollama is offline. Does not modify any production data.
 *
 * Output: prints the course ID to pass to eval:rag
 */

// Override BEFORE loadEnvFile so the .env value cannot clobber these.
// Gemini (gemini-embedding-001) produces 3072-dim vectors. The local Docker
// DB column has been altered to vector(3072) for this eval.
process.env.EMBEDDING_PROVIDER = "cloud";
process.env.EMBEDDING_DIMENSION = "3072";

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import prisma from "../app/lib/prisma.server";
import { processMaterialEmbeddings } from "../app/lib/ai/embedding";

function loadEnvFile() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

const EVAL_COURSE_CODE = "EVAL-301";
const EVAL_SECTION = "EVAL";

// ── Seed materials ────────────────────────────────────────────────────────────
// Designed so each material has 2-4 chunks at ~800 chars and contains
// keywords that are unambiguously correct answers for specific eval queries.

const MATERIALS: Array<{ title: string; mimeType: string; content: string }> = [
  {
    title: "COSC 301 Course Syllabus",
    mimeType: "text/plain",
    content: `COSC 301 — Data Structures and Algorithms
Fall 2026 Syllabus

Instructor: Prof. Alice Chen
Office: Engineering Building Room 214
Office Hours: Monday and Wednesday 2:00–4:00 PM
Email: a.chen@university.edu

Course Description:
This course provides a comprehensive study of fundamental data structures and algorithms. Topics include arrays, linked lists, stacks, queues, trees, binary search trees, heaps, hash tables, graphs, and sorting algorithms. Students will analyze time and space complexity using Big-O notation and implement data structures in Python.

Prerequisites: COSC 201 (Introduction to Programming) with a grade of C or better.

Grading Breakdown:
Programming Assignments: 40% (five assignments, 8% each)
Midterm 1: 15% — covers arrays, linked lists, stacks, and queues
Midterm 2: 20% — covers trees, heaps, and graph algorithms
Final Exam: 25% — comprehensive, covers all course material
In-class participation: 0% (attendance encouraged but not graded)

Midterm 1 is scheduled for October 5, 2026.
Midterm 2 is scheduled for November 12, 2026.
Final Exam is scheduled for December 15, 2026 from 9:00 AM to 12:00 PM.

Assignment Schedule:
Assignment 1: Linked List Implementation — Due September 20, 2026
Assignment 2: Stack and Queue — Due October 3, 2026
Assignment 3: Binary Search Tree — Due October 25, 2026
Assignment 4: Graph Algorithms (BFS, DFS, Dijkstra) — Due November 15, 2026
Assignment 5: Hash Table — Due December 1, 2026

Late Policy: Assignments submitted within 48 hours of the deadline receive a 20% deduction. Submissions more than 48 hours late receive zero marks.

Academic Integrity: All submitted work must be your own. Use of AI code generators to produce assignment solutions is not permitted. Collaboration is allowed at the conceptual level only — do not share code.`,
  },
  {
    title: "Lecture Notes — Week 7: Sorting Algorithms",
    mimeType: "text/plain",
    content: `COSC 301 — Week 7 Lecture Notes
Topic: Sorting Algorithms

In today's lecture we examined three fundamental comparison-based sorting algorithms and analyzed their time and space complexity.

Bubble Sort:
Bubble sort iterates through the array repeatedly, comparing adjacent elements and swapping them if they are out of order. After each pass, the largest unsorted element "bubbles" to its correct position. Time complexity is O(n²) in both the average and worst case. Space complexity is O(1) since it sorts in place. Bubble sort is rarely used in practice due to its poor performance on large arrays.

Merge Sort:
Merge sort is a divide and conquer algorithm. It recursively splits the array into two halves, sorts each half independently, and then merges the two sorted halves into a single sorted array. The merge step is the key operation: it compares elements from both halves and writes them in order. Time complexity is O(n log n) in all cases — best, average, and worst. Space complexity is O(n) because the merge step requires a temporary array. Merge sort is stable (equal elements retain their original order) and is the algorithm of choice when stability is required.

Quick Sort:
Quick sort also uses divide and conquer. It selects a pivot element and rearranges the array so that all elements smaller than the pivot are to its left and all larger elements are to its right (partitioning). It then recursively sorts the two sub-arrays. Average-case time complexity is O(n log n). Worst-case is O(n²) when the pivot is always the smallest or largest element (e.g., sorted input with naive pivot selection). Space complexity is O(log n) for the call stack. In practice, quicksort outperforms merge sort on most inputs due to better cache locality.

Practical Guidance:
For small arrays (fewer than ~16 elements), insertion sort is fastest due to low constant factors. When sort stability is required (e.g., sorting objects that are already partially ordered), use merge sort. For general-purpose sorting where you control the implementation, use quicksort with randomized pivot selection or median-of-three pivot to avoid worst-case behaviour.`,
  },
  {
    title: "Lecture Notes — Week 9: Graph Traversal",
    mimeType: "text/plain",
    content: `COSC 301 — Week 9 Lecture Notes
Topic: Graph Traversal and Shortest Path Algorithms

This week Prof. Chen introduced systematic methods for visiting all nodes in a graph and for finding optimal paths between nodes.

Breadth-First Search (BFS):
BFS explores a graph level by level starting from a source node. It uses a queue to keep track of nodes to visit next. All neighbours of the current node are enqueued before moving to the next level. BFS guarantees that when a node is first visited, the shortest unweighted path from the source has been found. Time complexity is O(V + E) where V is the number of vertices and E is the number of edges. Space complexity is O(V) for the queue. BFS is well-suited for finding shortest paths in unweighted graphs and for level-order traversal.

Depth-First Search (DFS):
DFS explores as far as possible along each branch before backtracking. It can be implemented recursively (using the call stack) or iteratively using an explicit stack. DFS visits nodes in a different order than BFS and does not guarantee the shortest path. Time complexity is O(V + E). DFS is used for cycle detection in directed graphs, topological sorting, and finding connected components.

Dijkstra's Shortest Path Algorithm:
Dijkstra's algorithm finds the shortest path from a single source node to all other nodes in a weighted graph with non-negative edge weights. It uses a priority queue (min-heap) to always expand the node with the smallest known distance. When a node is popped from the heap, its shortest distance is finalized. Time complexity is O((V + E) log V) with a binary heap. Dijkstra's algorithm does not work correctly with negative edge weights — use Bellman-Ford in that case.

Prof. Chen noted that Assignment 4 will require students to implement BFS, DFS, and Dijkstra's algorithm from scratch in Python, working with an adjacency list graph representation.`,
  },
  {
    title: "Assignment 2: Stack and Queue Implementation",
    mimeType: "text/plain",
    content: `Assignment 2: Stack and Queue Implementation
COSC 301 — Due: October 3, 2026 at 11:59 PM

Overview:
In this assignment you will implement two fundamental abstract data types — a stack and a queue — from scratch in Python without using Python's built-in list as a stack or the collections.deque class.

Part 1: Stack Using Arrays (30 points)
Implement a Stack class backed by a Python list used only as a dynamic array. Your implementation must provide: push(item) to add an item to the top of the stack, pop() to remove and return the top item (raise IndexError if empty), peek() to return the top item without removing it, is_empty() to return True when the stack has no elements, and size() to return the number of elements currently stored. All operations must run in O(1) amortised time.

Part 2: Stack Using Linked Lists (30 points)
Re-implement the Stack class using a singly-linked list as the underlying storage. Each node should store a value and a pointer to the next node. Compare the time and space complexity of this implementation against the array-based stack from Part 1 in a short written section (maximum 150 words) at the top of your submission file.

Part 3: Queue Using Two Stacks (40 points)
Implement a Queue class that uses two Stack instances internally to achieve amortised O(1) enqueue and dequeue operations. Your Queue must provide: enqueue(item) to add to the back of the queue, dequeue() to remove and return the front item (raise IndexError if empty), is_empty() to check for emptiness, and size() to return the current element count. Explain the amortised analysis in a brief comment in your code.

Submission Instructions:
Submit a single file named assignment2.py to the course portal before the deadline. Include your student ID in the file header. Failure to include your student ID will result in a 5-point deduction.`,
  },
  {
    title: "Assignment 4: Graph Algorithms",
    mimeType: "text/plain",
    content: `Assignment 4: Graph Algorithms — BFS, DFS, and Dijkstra
COSC 301 — Due: November 15, 2026 at 11:59 PM

Overview:
In this assignment you will implement three graph algorithms in Python. The graph is represented as an adjacency list: a dictionary where each key is a node label and the value is a list of (neighbour, weight) tuples. For unweighted graphs, weight will always be 1.

Part 1: Breadth-First Search (33 points)
Implement bfs(graph, source) that returns a list of nodes in the order they were first visited using BFS. Your implementation must use a queue and must handle disconnected graphs by starting BFS from every unvisited node after exhausting nodes reachable from source. Mark visited nodes to avoid processing any node more than once.

Part 2: Depth-First Search (33 points)
Implement dfs(graph, source) using an explicit stack (not recursion) that returns nodes in DFS visit order. Your implementation must detect cycles in directed graphs: include a boolean field has_cycle in the returned result dictionary alongside the visit order list. Handle disconnected components the same way as Part 1.

Part 3: Dijkstra's Shortest Path (33 points)
Implement dijkstra(graph, source) that returns a dictionary mapping each reachable node to its shortest distance from source and the list of nodes forming the shortest path. Use Python's heapq module as your priority queue. Your implementation must raise a ValueError if any edge weight is negative.

Grading: Each part is equally weighted. Code correctness counts for 80% of each part's marks; code style and comments count for 20%. Submissions that do not run will receive zero.

Submission: Submit a single file named assignment4.py. Late submissions follow the course late policy (20% deduction per 48 hours).`,
  },
];

// ── Seed logic ─────────────────────────────────────────────────────────────────

async function main() {
  loadEnvFile();

  console.log("Embedding provider:", process.env.EMBEDDING_PROVIDER, "/ dim:", process.env.EMBEDDING_DIMENSION);
  console.log("Checking for existing eval course…");

  const existing = await prisma.course.findFirst({
    where: { code: EVAL_COURSE_CODE, section: EVAL_SECTION },
    include: { materials: { select: { id: true, title: true } } },
  });

  if (existing && existing.materials.length >= MATERIALS.length) {
    console.log(`\nEval course already fully seeded (${existing.materials.length} materials).`);
    console.log("Course ID:", existing.id);
    console.log("\nRun eval with:");
    console.log(`  npm run eval:rag -- ${existing.id}`);
    return;
  }

  let course = existing;

  if (!course) {
    course = await prisma.course.create({
      data: {
        code: EVAL_COURSE_CODE,
        name: "RAG Eval — COSC 301 Data Structures (synthetic)",
        section: EVAL_SECTION,
        term: "Fall",
        year: 2026,
        startDate: new Date("2026-09-01"),
        endDate: new Date("2026-12-20"),
        isPublished: true,
      },
      include: { materials: { select: { id: true, title: true } } },
    });
    console.log("Created eval course:", course.id);
  }

  const seededTitles = new Set((course.materials ?? []).map((m) => m.title));

  for (const mat of MATERIALS) {
    if (seededTitles.has(mat.title)) {
      console.log("  skip (already seeded):", mat.title);
      continue;
    }

    const checksum = createHash("sha256").update(mat.content).digest("hex");

    const material = await prisma.courseMaterial.create({
      data: {
        courseId: course.id,
        title: mat.title,
        mimeType: mat.mimeType,
        fileSize: mat.content.length,
        checksum,
        rawText: mat.content,
        status: "PROCESSING",
      },
    });

    process.stdout.write(`  Embedding: ${mat.title} … `);
    await processMaterialEmbeddings(material.id, mat.content, { replace: true });
    await prisma.courseMaterial.update({
      where: { id: material.id },
      data: { status: "READY", processedAt: new Date() },
    });
    console.log("done");
  }

  console.log("\nSeed complete. Course ID:", course.id);
  console.log("\nRun eval with:");
  console.log(`  npm run eval:rag -- ${course.id}`);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
