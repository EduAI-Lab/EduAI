#!/usr/bin/env node
/**
 * One-shot expansion script for task suite v1 (48 → 120 prompts).
 * Run: node apps/core/scripts/research/expand-task-suite-v1.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PROMPTS_PATH } from "./paths.mjs";

const NEW_PROMPTS = [
  // easy ×19 (ts-049–067)
  { id: "ts-049", prompt: "What is computational thinking?", stratum: "easy", category: "definition", rag_context: "none", tools_expected: "none", course_code: null, source: "course_seed" },
  { id: "ts-050", prompt: "Define abstraction in computer science.", stratum: "easy", category: "definition", rag_context: "none", tools_expected: "none", course_code: null, source: "course_seed" },
  { id: "ts-051", prompt: "What is a variable in a program?", stratum: "easy", category: "definition", rag_context: "none", tools_expected: "none", course_code: null, source: "course_seed" },
  { id: "ts-052", prompt: "What is an IP address?", stratum: "easy", category: "definition", rag_context: "none", tools_expected: "none", course_code: null, source: "course_seed" },
  { id: "ts-053", prompt: "Define polymorphism in object-oriented programming.", stratum: "easy", category: "definition", rag_context: "none", tools_expected: "none", course_code: null, source: "course_seed" },
  { id: "ts-054", prompt: "What is a hash table?", stratum: "easy", category: "definition", rag_context: "none", tools_expected: "none", course_code: null, source: "course_seed" },
  { id: "ts-055", prompt: "What is the primary function of mitochondria in a cell?", stratum: "easy", category: "definition", rag_context: "none", tools_expected: "none", course_code: null, source: "course_seed" },
  { id: "ts-056", prompt: "Define osmosis in biology.", stratum: "easy", category: "definition", rag_context: "none", tools_expected: "none", course_code: null, source: "course_seed" },
  { id: "ts-057", prompt: "State Newton's first law of motion.", stratum: "easy", category: "definition", rag_context: "none", tools_expected: "none", course_code: null, source: "course_seed" },
  { id: "ts-058", prompt: "What is momentum in physics?", stratum: "easy", category: "definition", rag_context: "none", tools_expected: "none", course_code: null, source: "course_seed" },
  { id: "ts-059", prompt: "What is classical conditioning in psychology?", stratum: "easy", category: "definition", rag_context: "none", tools_expected: "none", course_code: null, source: "course_seed" },
  { id: "ts-060", prompt: "Define operant conditioning.", stratum: "easy", category: "definition", rag_context: "none", tools_expected: "none", course_code: null, source: "course_seed" },
  { id: "ts-061", prompt: "What is a thesis statement in academic writing?", stratum: "easy", category: "definition", rag_context: "none", tools_expected: "none", course_code: null, source: "course_seed" },
  { id: "ts-062", prompt: "Define paraphrasing in academic writing.", stratum: "easy", category: "definition", rag_context: "none", tools_expected: "none", course_code: null, source: "course_seed" },
  { id: "ts-063", prompt: "What was the Industrial Revolution?", stratum: "easy", category: "definition", rag_context: "none", tools_expected: "none", course_code: null, source: "course_seed" },
  { id: "ts-064", prompt: "What is a neuron?", stratum: "easy", category: "definition", rag_context: "none", tools_expected: "none", course_code: null, source: "course_seed" },
  { id: "ts-065", prompt: "Define plagiarism in academic work.", stratum: "easy", category: "definition", rag_context: "none", tools_expected: "none", course_code: null, source: "course_seed" },
  { id: "ts-066", prompt: "What is a database index used for?", stratum: "easy", category: "definition", rag_context: "none", tools_expected: "none", course_code: null, source: "course_seed" },
  { id: "ts-067", prompt: "Define pattern recognition in machine learning.", stratum: "easy", category: "definition", rag_context: "none", tools_expected: "none", course_code: null, source: "benchmark_adapted" },

  // medium ×35 (ts-068–102)
  { id: "ts-068", prompt: "From COSC 121 materials, explain test-driven development and when unit tests are written.", stratum: "medium", category: "rag_grounded", rag_context: "strong", tools_expected: "none", course_code: "COSC 121", source: "course_seed" },
  { id: "ts-069", prompt: "Compare RISC and CISC instruction set architectures as covered in COSC 211.", stratum: "medium", category: "rag_grounded", rag_context: "strong", tools_expected: "none", course_code: "COSC 211", source: "course_seed" },
  { id: "ts-070", prompt: "From COSC 211 course materials: what is the role of the TLB in virtual memory?", stratum: "medium", category: "rag_grounded", rag_context: "strong", tools_expected: "none", course_code: "COSC 211", source: "course_seed" },
  { id: "ts-071", prompt: "Using COSC 211 notes, explain why branch mispredictions become more expensive in very deep pipelines.", stratum: "medium", category: "rag_grounded", rag_context: "strong", tools_expected: "none", course_code: "COSC 211", source: "course_seed" },
  { id: "ts-072", prompt: "From MATH 200 materials, state the definition of a partial derivative at a point (a, b).", stratum: "medium", category: "rag_grounded", rag_context: "strong", tools_expected: "none", course_code: "MATH 200", source: "course_seed" },
  { id: "ts-073", prompt: "According to MATH 200 content, when can you switch the order of integration in a double integral?", stratum: "medium", category: "rag_grounded", rag_context: "strong", tools_expected: "none", course_code: "MATH 200", source: "course_seed" },
  { id: "ts-074", prompt: "From MATH 200, explain when a vector field is conservative on a simply connected domain.", stratum: "medium", category: "rag_grounded", rag_context: "strong", tools_expected: "none", course_code: "MATH 200", source: "course_seed" },
  { id: "ts-075", prompt: "From STAT 300, define an unbiased estimator and give a short example.", stratum: "medium", category: "rag_grounded", rag_context: "strong", tools_expected: "none", course_code: "STAT 300", source: "course_seed" },
  { id: "ts-076", prompt: "Using STAT 300 course notes, explain what R-squared represents in ordinary least squares regression.", stratum: "medium", category: "rag_grounded", rag_context: "strong", tools_expected: "none", course_code: "STAT 300", source: "course_seed" },
  { id: "ts-077", prompt: "From DATA 310 materials, why do we need both a validation set and a test set?", stratum: "medium", category: "rag_grounded", rag_context: "strong", tools_expected: "none", course_code: "DATA 310", source: "course_seed" },
  { id: "ts-078", prompt: "In DATA 310 context: for imbalanced binary classification, which single metric is least informative on its own?", stratum: "medium", category: "rag_grounded", rag_context: "strong", tools_expected: "none", course_code: "DATA 310", source: "course_seed" },
  { id: "ts-079", prompt: "From PSYO 121, describe encoding, storage, and retrieval with one failure example for each.", stratum: "medium", category: "rag_grounded", rag_context: "strong", tools_expected: "none", course_code: "PSYO 121", source: "course_seed" },
  { id: "ts-080", prompt: "From BIOL 116 materials, name two distinct functions of the endoplasmic reticulum.", stratum: "medium", category: "rag_grounded", rag_context: "strong", tools_expected: "none", course_code: "BIOL 116", source: "course_seed" },
  { id: "ts-081", prompt: "Using PHYS 121 notes, state the work-energy theorem and give a one-line application example.", stratum: "medium", category: "rag_grounded", rag_context: "strong", tools_expected: "none", course_code: "PHYS 121", source: "course_seed" },
  { id: "ts-082", prompt: "From PHYS 121, why is momentum conserved in a sticky collision but kinetic energy is not?", stratum: "medium", category: "rag_grounded", rag_context: "strong", tools_expected: "none", course_code: "PHYS 121", source: "course_seed" },
  { id: "ts-083", prompt: "From HIST 210 course content: which factor was NOT a driver of Britain's early Industrial Revolution?", stratum: "medium", category: "rag_grounded", rag_context: "strong", tools_expected: "none", course_code: "HIST 210", source: "course_seed" },
  { id: "ts-084", prompt: "Using HIST 210 materials, list two short-term and one long-term cause of World War I.", stratum: "medium", category: "rag_grounded", rag_context: "strong", tools_expected: "none", course_code: "HIST 210", source: "course_seed" },
  { id: "ts-085", prompt: "From ENGL 110, what makes evidence use strong versus weak in an argument essay?", stratum: "medium", category: "rag_grounded", rag_context: "strong", tools_expected: "none", course_code: "ENGL 110", source: "course_seed" },
  { id: "ts-086", prompt: "From PHIL 220, summarize utilitarianism and one standard objection.", stratum: "medium", category: "rag_grounded", rag_context: "weak", tools_expected: "none", course_code: "PHIL 220", source: "course_seed" },
  { id: "ts-087", prompt: "From COSC 101, what are three considerations for evaluating trustworthiness of an online source?", stratum: "medium", category: "rag_grounded", rag_context: "strong", tools_expected: "none", course_code: "COSC 101", source: "course_seed" },
  { id: "ts-088", prompt: "Explain how merge sort works and state its average time complexity.", stratum: "medium", category: "explanation", rag_context: "none", tools_expected: "none", course_code: null, source: "course_seed" },
  { id: "ts-089", prompt: "Compare stack versus queue data structures with one real use case for each.", stratum: "medium", category: "explanation", rag_context: "none", tools_expected: "none", course_code: null, source: "course_seed" },
  { id: "ts-090", prompt: "Explain the difference between precision and recall for a binary classifier.", stratum: "medium", category: "explanation", rag_context: "none", tools_expected: "none", course_code: null, source: "benchmark_adapted" },
  { id: "ts-091", prompt: "Solve: find the gradient of f(x,y) = x^2 y + 3xy at the point (1, 2).", stratum: "medium", category: "problem_solving", rag_context: "none", tools_expected: "none", course_code: null, source: "benchmark_adapted" },
  { id: "ts-092", prompt: "Write an SQL query that counts active enrollments per course_id from an enrollments table.", stratum: "medium", category: "code", rag_context: "none", tools_expected: "none", course_code: null, source: "synthetic" },
  { id: "ts-093", prompt: "Explain the bias-variance tradeoff when choosing a deep decision tree versus L2-regularized logistic regression.", stratum: "medium", category: "explanation", rag_context: "none", tools_expected: "none", course_code: null, source: "benchmark_adapted" },
  { id: "ts-094", prompt: "Walk through one partition step of quicksort on [3, 6, 8, 10, 1, 2, 1] using the last element as pivot.", stratum: "medium", category: "problem_solving", rag_context: "none", tools_expected: "none", course_code: null, source: "course_seed" },
  { id: "ts-095", prompt: "Explain the central limit theorem in plain language with a classroom example.", stratum: "medium", category: "explanation", rag_context: "none", tools_expected: "none", course_code: null, source: "course_seed" },
  { id: "ts-096", prompt: "From DATA 310 course content, compare k-means and hierarchical clustering—when would you prefer each?", stratum: "medium", category: "rag_grounded", rag_context: "strong", tools_expected: "none", course_code: "DATA 310", source: "course_seed" },
  { id: "ts-097", prompt: "Explain Type I and Type II errors with a medical screening example.", stratum: "medium", category: "explanation", rag_context: "none", tools_expected: "none", course_code: null, source: "course_seed" },
  { id: "ts-098", prompt: "Find the eigenvalues of the matrix [[2, 1], [1, 2]] and show your steps.", stratum: "medium", category: "problem_solving", rag_context: "none", tools_expected: "none", course_code: null, source: "benchmark_adapted" },
  { id: "ts-099", prompt: "Explain how CPU caches exploit temporal locality and spatial locality.", stratum: "medium", category: "explanation", rag_context: "none", tools_expected: "none", course_code: null, source: "course_seed" },
  { id: "ts-100", prompt: "Describe the difference between iterative and recursive binary search implementations.", stratum: "medium", category: "explanation", rag_context: "none", tools_expected: "none", course_code: null, source: "course_seed" },
  { id: "ts-101", prompt: "Look up current UBC Okanagan library Friday closing hours and summarize them.", stratum: "medium", category: "tool_requiring", rag_context: "none", tools_expected: "webSearch", course_code: null, source: "synthetic" },
  { id: "ts-102", prompt: "Find a recent reputable estimate of BC electricity grid carbon intensity and state the value with source.", stratum: "medium", category: "tool_requiring", rag_context: "none", tools_expected: "webSearch", course_code: null, source: "synthetic" },

  // hard ×18 (ts-103–120)
  { id: "ts-103", prompt: "Prove that sqrt(2) is irrational using a contradiction argument.", stratum: "hard", category: "problem_solving", rag_context: "none", tools_expected: "none", course_code: null, source: "benchmark_adapted" },
  { id: "ts-104", prompt: "From MATH 320 materials, outline why every continuous function on a closed bounded interval is Riemann integrable.", stratum: "hard", category: "rag_grounded", rag_context: "strong", tools_expected: "none", course_code: "MATH 320", source: "course_seed" },
  { id: "ts-105", prompt: "From COSC 211 pipeline notes: explain data hazards, control hazards, and how forwarding reduces stalls.", stratum: "hard", category: "rag_grounded", rag_context: "strong", tools_expected: "none", course_code: "COSC 211", source: "course_seed" },
  { id: "ts-106", prompt: "Write pseudocode for Dijkstra's algorithm and justify correctness for graphs with non-negative edge weights.", stratum: "hard", category: "problem_solving", rag_context: "none", tools_expected: "none", course_code: null, source: "course_seed" },
  { id: "ts-107", prompt: "This recursive Fibonacci code runs out of stack for n=10000—explain why and propose a fix with the same asymptotic cost as iterative: def fib(n): return n if n<2 else fib(n-1)+fib(n-2).", stratum: "hard", category: "debugging", rag_context: "none", tools_expected: "none", course_code: null, source: "synthetic" },
  { id: "ts-108", prompt: "Design a thread-safe LRU cache with O(1) get and put; specify data structures and synchronization approach.", stratum: "hard", category: "problem_solving", rag_context: "none", tools_expected: "none", course_code: null, source: "synthetic" },
  { id: "ts-109", prompt: "From BIOL 116 cell cycle materials, describe cyclin-CDK control of the G1/S transition.", stratum: "hard", category: "rag_grounded", rag_context: "strong", tools_expected: "none", course_code: "BIOL 116", source: "course_seed" },
  { id: "ts-110", prompt: "From HIST 210, describe two ways late-20th-century globalization differed from earlier global trade networks.", stratum: "hard", category: "rag_grounded", rag_context: "strong", tools_expected: "none", course_code: "HIST 210", source: "course_seed" },
  { id: "ts-111", prompt: "Using MATH 200 vector calculus notes, apply Green's theorem to evaluate a line integral around the unit circle for F = (-y, x).", stratum: "hard", category: "rag_grounded", rag_context: "strong", tools_expected: "none", course_code: "MATH 200", source: "course_seed" },
  { id: "ts-112", prompt: "Analyze time and space complexity of naive triple-loop matrix multiplication and suggest one practical optimization.", stratum: "hard", category: "problem_solving", rag_context: "none", tools_expected: "none", course_code: null, source: "course_seed" },
  { id: "ts-113", prompt: "A React component uses eight useEffect hooks with overlapping dependencies—outline a refactor strategy without changing behavior.", stratum: "hard", category: "code", rag_context: "none", tools_expected: "none", course_code: null, source: "synthetic" },
  { id: "ts-114", prompt: "Propose property-based tests for a min-heap priority queue implementation (insert and extract-min).", stratum: "hard", category: "problem_solving", rag_context: "none", tools_expected: "none", course_code: null, source: "synthetic" },
  { id: "ts-115", prompt: "From PHIL 220 applied ethics: compare utilitarian and deontological justifications for automated plagiarism detection in coursework.", stratum: "hard", category: "rag_grounded", rag_context: "weak", tools_expected: "none", course_code: "PHIL 220", source: "course_seed" },
  { id: "ts-116", prompt: "Construct an input that forces quicksort with last-element pivot into O(n^2) behavior and explain why.", stratum: "hard", category: "problem_solving", rag_context: "none", tools_expected: "none", course_code: null, source: "course_seed" },
  { id: "ts-117", prompt: "Multi-step: solve the predator-prey ODE system dx/dt = ax - by, dy/dt = cx - dy for small positive constants with given initial populations.", stratum: "hard", category: "problem_solving", rag_context: "none", tools_expected: "none", course_code: null, source: "benchmark_adapted" },
  { id: "ts-118", prompt: "Using available tools, find a current BC grid emissions factor (g CO2e/kWh), compare to EduAI defaults, and note key assumptions.", stratum: "hard", category: "tool_requiring", rag_context: "none", tools_expected: "webSearch", course_code: null, source: "synthetic" },
  { id: "ts-119", prompt: "From COSC 121 OOP materials: give an example that violates the Liskov substitution principle and show a corrected design.", stratum: "hard", category: "rag_grounded", rag_context: "strong", tools_expected: "none", course_code: "COSC 121", source: "course_seed" },
  { id: "ts-120", prompt: "Draft an integration test matrix for EduAI /api/chat covering Auto routing, strong RAG, tool calls, and image payloads.", stratum: "hard", category: "problem_solving", rag_context: "none", tools_expected: "none", course_code: null, source: "synthetic" },
];

const existing = readFileSync(PROMPTS_PATH, "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));

// Fix placeholder in ts-041
const ts041 = existing.find((r) => r.id === "ts-041");
if (ts041) {
  ts041.prompt =
    "Refactor this Java method to avoid NullPointerException while preserving behavior when profile or name is null: public String format(User u) { return u.getProfile().getName().toUpperCase(); }";
}

const existingIds = new Set(existing.map((r) => r.id));
for (const row of NEW_PROMPTS) {
  if (existingIds.has(row.id)) {
    throw new Error(`Duplicate id: ${row.id}`);
  }
}

const merged = [...existing, ...NEW_PROMPTS.map((r) => ({ ...r, split: "dev" }))];
writeFileSync(
  PROMPTS_PATH,
  merged.map((r) => JSON.stringify(r)).join("\n") + "\n",
  "utf8",
);

console.log(`Wrote ${merged.length} prompts (${existing.length} existing + ${NEW_PROMPTS.length} new)`);
