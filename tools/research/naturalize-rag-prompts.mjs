#!/usr/bin/env node
/**
 * Rewrites RAG prompts to natural student language (no course codes in text).
 * course_code metadata is set by the experiment runner / UI course selection.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_PATH = join(__dirname, "../../../docs/research/data/task-suite/prompts.v1.jsonl");

const PROMPT_BY_ID = {
  "ts-020": "What's the time complexity of linear search on an unsorted list?",
  "ts-021": "When should I prefer a vector over a list in C++?",
  "ts-022": "Can you summarize the key ideas from the recursion unit?",
  "ts-023": "Explain the power rule for derivatives with an example.",
  "ts-024": "What is the chain rule and how do I apply it?",
  "ts-025": "Explain Type I vs Type II errors.",
  "ts-033": "Explain train/validation/test splits and why we use all three.",
  "ts-036": "Summarize classical vs operant conditioning.",
  "ts-044": "Walk through Dijkstra's algorithm on a small 5-node graph example.",
  "ts-047": "For the pendulum lab, how do I propagate uncertainty when calculating g from period and length?",
  "ts-068": "Explain test-driven development and when unit tests are written.",
  "ts-069": "Compare RISC and CISC instruction set architectures.",
  "ts-070": "What is the role of the TLB in virtual memory?",
  "ts-071": "Why do branch mispredictions hurt more in very deep pipelines?",
  "ts-072": "State the definition of a partial derivative at a point (a, b).",
  "ts-073": "When can I switch the order of integration in a double integral?",
  "ts-074": "When is a vector field conservative on a simply connected domain?",
  "ts-075": "Define an unbiased estimator and give a short example.",
  "ts-076": "What does R-squared represent in ordinary least squares regression?",
  "ts-077": "Why do we need both a validation set and a test set?",
  "ts-078": "For imbalanced binary classification, which single metric is least informative on its own?",
  "ts-079": "Describe encoding, storage, and retrieval with one failure example for each.",
  "ts-080": "Name two distinct functions of the endoplasmic reticulum.",
  "ts-081": "State the work-energy theorem and give a one-line application example.",
  "ts-082": "Why is momentum conserved in a sticky collision but kinetic energy is not?",
  "ts-083": "Which factor was NOT a driver of Britain's early Industrial Revolution?",
  "ts-084": "List two short-term and one long-term cause of World War I.",
  "ts-085": "What makes evidence use strong versus weak in an argument essay?",
  "ts-086": "Summarize utilitarianism and one standard objection.",
  "ts-087": "What are three considerations for evaluating trustworthiness of an online source?",
  "ts-096": "Compare k-means and hierarchical clustering—when would you prefer each?",
  "ts-104": "Outline why every continuous function on a closed bounded interval is Riemann integrable.",
  "ts-105": "Explain data hazards, control hazards, and how forwarding reduces pipeline stalls.",
  "ts-109": "Describe how cyclin-CDK complexes control the G1/S transition.",
  "ts-110": "Describe two ways late-20th-century globalization differed from earlier global trade networks.",
  "ts-111": "Apply Green's theorem to evaluate the line integral around the unit circle for F = (-y, x).",
  "ts-115": "Compare utilitarian and deontological justifications for using automated plagiarism detection in coursework.",
  "ts-119": "Give an example that violates the Liskov substitution principle and show a corrected design.",
};

const rows = readFileSync(PROMPTS_PATH, "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));

let updated = 0;
for (const row of rows) {
  const next = PROMPT_BY_ID[row.id];
  if (next) {
    row.prompt = next;
    updated++;
  }
}

writeFileSync(PROMPTS_PATH, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
console.log(`Naturalized ${updated} RAG prompts`);
