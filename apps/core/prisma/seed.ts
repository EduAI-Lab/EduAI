import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient, Prisma } from '@prisma/client';
import { hashPassword } from 'better-auth/crypto';
import { clearStudentIdStorage, prepareStudentIdStorage } from '../app/lib/canvas/student-id.server';
// Canonical UBC term code + academic-year attribution (source of truth: packages/ui/src/lib/term.ts).
import { termInfoFromDate, type TermCode } from '@eduai/ui/term';

export const prisma = new PrismaClient();

/**
 * Deterministic IDs for cross-app linking. AI Tutor's `coreOfferingId` /
 * `coreTopicId` and Question Maker's `core_course_id` / `core_topic_id` /
 * `core_question_id` reference the values below. Seeding all three apps
 * produces a fully linked dataset.
 *
 * Exported (via the JSON dump at the end of seed) so extension seeds can
 * import these without duplicating the source of truth.
 */
export const SEED_IDS = {
  users: {
    admin: 'seed_user_admin',
    unitAdminCosc: 'seed_user_unitadmin_cosc',
    unitAdminMulti: 'seed_user_unitadmin_multi',
    instructorCS: 'seed_user_instructor_cs',
    instructorMath: 'seed_user_instructor_math',
    instructorSci: 'seed_user_instructor_sci',
    instructorHum: 'seed_user_instructor_hum',
    taCS: 'seed_user_ta_cs',
    taMath: 'seed_user_ta_math',
    student1: 'seed_user_student_01',
    student2: 'seed_user_student_02',
    student3: 'seed_user_student_03',
    student4: 'seed_user_student_04',
    student5: 'seed_user_student_05',
  },
  /** Canvas-compatible sis_user_id values for seeded students (matches mock roster + local Canvas seed). UBC format: 8 digits (#818). */
  studentNumbers: {
    student1: '10000001',
    student2: '10000002',
    student3: '10000003',
    student4: '10000004',
    student5: '10000005',
  },
  courses: {
    cosc101: 'seed_course_cosc101',
    cosc121: 'seed_course_cosc121',
    cosc211: 'seed_course_cosc211',
    math200: 'seed_course_math200',
    math320: 'seed_course_math320',
    stat300: 'seed_course_stat300',
    data310: 'seed_course_data310',
    psyo121: 'seed_course_psyo121',
    biol116: 'seed_course_biol116',
    phys121: 'seed_course_phys121',
    hist210: 'seed_course_hist210',
    engl110: 'seed_course_engl110',
    phil220: 'seed_course_phil220',
  },
} as const;

function topicId(courseSlug: string, topicSlug: string) {
  return `seed_topic_${courseSlug}_${topicSlug}`;
}

function questionId(courseSlug: string, n: number) {
  return `seed_question_${courseSlug}_${String(n).padStart(2, '0')}`;
}

type SeedCourse = {
  id: string;
  code: string;
  section: string;
  name: string;
  description: string;
  term: TermCode;
  year: number;
  startDate: Date;
  endDate: Date;
  department: string;
  isPublished: boolean;
  aiInstructions: string;
  instructorId: string;
  taIds?: string[];
  studentIds: string[];
  topics: { slug: string; name: string }[];
  /** Each question references a topic slug declared in `topics` above. */
  questions: {
    n: number;
    topicSlug: string;
    secondaryTopicSlugs?: string[];
    type: 'MCQ' | 'SA' | 'LA';
    content: string;
    difficulty: 'EASY' | 'MEDIUM' | 'HARD';
    reasoningLevel: 'FACTUAL' | 'ANALYTICAL' | 'APPLICATION';
    choices?: { letter: string; text: string }[];
    answer: string;
    testable: boolean;
    createdBy: string;
  }[];
};

const u = SEED_IDS.users;
const c = SEED_IDS.courses;

const COURSES: SeedCourse[] = [
  {
    id: c.cosc101,
    code: 'COSC 101',
    section: '001',
    name: 'Computer Studies',
    description: 'Introductory course covering computational thinking and digital literacy.',
    term: 'W1',
    year: 2026,
    startDate: new Date('2026-09-08'),
    endDate: new Date('2026-12-12'),
    department: 'COSC',
    isPublished: true,
    aiInstructions: 'Use plain-language analogies. Prefer concrete examples over formal definitions.',
    instructorId: u.instructorCS,
    taIds: [u.taCS],
    studentIds: [u.student1, u.student2, u.student3],
    topics: [
      { slug: 'computational_thinking', name: 'Computational Thinking' },
      { slug: 'digital_literacy', name: 'Digital Literacy' },
      { slug: 'data_representation', name: 'Data Representation' },
      { slug: 'algorithms_basics', name: 'Algorithms (Basics)' },
    ],
    questions: [
      {
        n: 1, topicSlug: 'computational_thinking', type: 'MCQ',
        content: 'Which of the following best describes "decomposition" in computational thinking?',
        difficulty: 'EASY', reasoningLevel: 'FACTUAL',
        choices: [
          { letter: 'A', text: 'Combining many small problems into one' },
          { letter: 'B', text: 'Breaking a complex problem into smaller, manageable parts' },
          { letter: 'C', text: 'Ignoring irrelevant details' },
          { letter: 'D', text: 'Repeating a process many times' },
        ],
        answer: 'B', testable: true, createdBy: u.instructorCS,
      },
      {
        n: 2, topicSlug: 'data_representation', type: 'MCQ',
        content: 'How many bits are required to represent 256 distinct values?',
        difficulty: 'EASY', reasoningLevel: 'ANALYTICAL',
        choices: [
          { letter: 'A', text: '4' },
          { letter: 'B', text: '6' },
          { letter: 'C', text: '8' },
          { letter: 'D', text: '16' },
        ],
        answer: 'C', testable: true, createdBy: u.instructorCS,
      },
      {
        n: 3, topicSlug: 'algorithms_basics', type: 'SA', secondaryTopicSlugs: ['computational_thinking'],
        content: 'Briefly explain why algorithm efficiency matters even when computers are fast.',
        difficulty: 'MEDIUM', reasoningLevel: 'ANALYTICAL',
        answer: 'As inputs grow, inefficient algorithms scale poorly. A poor algorithm on a fast machine is still beaten by a good algorithm on a slow machine for large inputs.',
        testable: true, createdBy: u.instructorCS,
      },
      {
        n: 4, topicSlug: 'digital_literacy', type: 'LA',
        content: 'Describe three considerations when evaluating the trustworthiness of an online source.',
        difficulty: 'MEDIUM', reasoningLevel: 'APPLICATION',
        answer: 'Authorship and credentials, primary vs secondary sourcing, recency of publication, presence of citations, peer review status, and consistency with corroborating sources.',
        testable: false, createdBy: u.instructorCS,
      },
      {
        n: 5, topicSlug: 'algorithms_basics', type: 'MCQ',
        content: 'Which operation typically dominates the cost of a simple linear search over n items?',
        difficulty: 'EASY', reasoningLevel: 'FACTUAL',
        choices: [
          { letter: 'A', text: 'Constant-time comparison repeated n times' },
          { letter: 'B', text: 'A single hash lookup' },
          { letter: 'C', text: 'Sorting the list first' },
          { letter: 'D', text: 'Logarithmic partitioning' },
        ],
        answer: 'A', testable: true, createdBy: u.instructorCS,
      },
    ],
  },
  {
    id: c.cosc121,
    code: 'COSC 121',
    section: '001',
    name: 'Computer Programming II',
    description: 'Object-oriented design, data structures, algorithms, and testing.',
    term: 'W2',
    year: 2025,
    startDate: new Date('2026-01-05'),
    endDate: new Date('2026-04-24'),
    department: 'COSC',
    isPublished: true,
    aiInstructions: 'Encourage students to reason through complexity analysis before optimizing code.',
    instructorId: u.instructorCS,
    taIds: [u.taCS],
    studentIds: [u.student1, u.student2, u.student4],
    topics: [
      { slug: 'oop', name: 'Object-Oriented Design' },
      { slug: 'ds_fundamentals', name: 'Data Structures Fundamentals' },
      { slug: 'algorithm_analysis', name: 'Algorithm Analysis' },
      { slug: 'testing', name: 'Testing and Debugging' },
      { slug: 'recursion', name: 'Recursion Patterns' },
    ],
    questions: [
      {
        n: 1, topicSlug: 'ds_fundamentals', type: 'SA',
        content: 'Compare arrays and linked lists. When would you choose a linked list over an array?',
        difficulty: 'MEDIUM', reasoningLevel: 'ANALYTICAL',
        answer: 'Arrays offer O(1) random access; linked lists offer O(1) insertion/removal at known positions and dynamic size. Choose linked lists when frequent insert/remove dominates and random access is rare.',
        testable: true, createdBy: u.instructorCS,
      },
      {
        n: 2, topicSlug: 'recursion', type: 'SA', secondaryTopicSlugs: ['algorithm_analysis'],
        content: 'Describe a recursive implementation of binary search. State the base case.',
        difficulty: 'MEDIUM', reasoningLevel: 'APPLICATION',
        answer: 'Base case: empty range (low > high) returns not-found. Recursive case: compare target to midpoint; recurse left or right. Runs in O(log n).',
        testable: true, createdBy: u.instructorCS,
      },
      {
        n: 3, topicSlug: 'testing', type: 'MCQ',
        content: 'In test-driven development, when are unit tests written?',
        difficulty: 'EASY', reasoningLevel: 'FACTUAL',
        choices: [
          { letter: 'A', text: 'After the code is complete' },
          { letter: 'B', text: 'Before writing the implementation' },
          { letter: 'C', text: 'Only for bug fixes' },
          { letter: 'D', text: 'Only for public APIs' },
        ],
        answer: 'B', testable: true, createdBy: u.instructorCS,
      },
      {
        n: 4, topicSlug: 'algorithm_analysis', type: 'MCQ',
        content: 'Average time complexity of searching an unsorted array of n elements?',
        difficulty: 'EASY', reasoningLevel: 'FACTUAL',
        choices: [
          { letter: 'A', text: 'O(1)' },
          { letter: 'B', text: 'O(log n)' },
          { letter: 'C', text: 'O(n)' },
          { letter: 'D', text: 'O(n log n)' },
        ],
        answer: 'C', testable: true, createdBy: u.instructorCS,
      },
      {
        n: 5, topicSlug: 'oop', type: 'LA',
        content: 'Explain encapsulation and give an example where breaking it leads to a bug.',
        difficulty: 'HARD', reasoningLevel: 'APPLICATION',
        answer: 'Encapsulation hides internal state behind a stable interface. Example: exposing a mutable internal list lets external code modify it without invariants being preserved (e.g. a Set whose internal array is leaked, allowing duplicates).',
        testable: false, createdBy: u.instructorCS,
      },
    ],
  },
  {
    id: c.cosc211,
    code: 'COSC 211',
    section: '001',
    name: 'Machine Architecture',
    description: 'Instruction sets, pipelining, memory hierarchy, and performance.',
    term: 'W1',
    year: 2026,
    startDate: new Date('2026-09-08'),
    endDate: new Date('2026-12-12'),
    department: 'COSC',
    isPublished: false,
    aiInstructions: 'Use timing diagrams when discussing pipelining; avoid vendor-specific jargon.',
    instructorId: u.instructorCS,
    studentIds: [u.student2, u.student4],
    topics: [
      { slug: 'isa', name: 'Instruction Set Architectures' },
      { slug: 'pipeline', name: 'Pipeline Design' },
      { slug: 'memory', name: 'Memory Hierarchy' },
      { slug: 'parallel', name: 'Parallel Execution Models' },
    ],
    questions: [
      {
        n: 1, topicSlug: 'isa', type: 'SA',
        content: 'What is the main difference between RISC and CISC instruction set architectures?',
        difficulty: 'MEDIUM', reasoningLevel: 'ANALYTICAL',
        answer: 'RISC: small, fixed-size, load-store instructions; simpler pipelining. CISC: variable-length, complex instructions; denser code.',
        testable: true, createdBy: u.instructorCS,
      },
      {
        n: 2, topicSlug: 'pipeline', type: 'LA', secondaryTopicSlugs: ['isa'],
        content: 'Explain pipeline hazards (data and control). How does data forwarding reduce stalls?',
        difficulty: 'HARD', reasoningLevel: 'ANALYTICAL',
        answer: 'Data hazards arise when a later instruction needs a not-yet-written result. Control hazards arise on branches. Forwarding routes a result from a later stage directly into a dependent instruction in an earlier stage, avoiding the wait for write-back.',
        testable: true, createdBy: u.instructorCS,
      },
      {
        n: 3, topicSlug: 'memory', type: 'MCQ',
        content: 'What is the role of the TLB in virtual memory?',
        difficulty: 'MEDIUM', reasoningLevel: 'FACTUAL',
        choices: [
          { letter: 'A', text: 'Stores the full page table' },
          { letter: 'B', text: 'Caches recent virtual-to-physical translations' },
          { letter: 'C', text: 'Replaces the page table' },
          { letter: 'D', text: 'Holds swapped-out pages' },
        ],
        answer: 'B', testable: true, createdBy: u.instructorCS,
      },
      {
        n: 4, topicSlug: 'pipeline', type: 'MCQ',
        content: 'A drawback of very deep pipelines is:',
        difficulty: 'MEDIUM', reasoningLevel: 'ANALYTICAL',
        choices: [
          { letter: 'A', text: 'Clock frequency must decrease' },
          { letter: 'B', text: 'ILP is reduced' },
          { letter: 'C', text: 'Branch mispredictions become more expensive' },
          { letter: 'D', text: 'Structural hazards disappear' },
        ],
        answer: 'C', testable: false, createdBy: u.instructorCS,
      },
    ],
  },
  {
    id: c.math200,
    code: 'MATH 200',
    section: '001',
    name: 'Calculus III',
    description: 'Multivariable calculus: partial derivatives, multiple integrals, vector calculus.',
    term: 'W1',
    year: 2026,
    startDate: new Date('2026-09-08'),
    endDate: new Date('2026-12-12'),
    department: 'MATH',
    isPublished: true,
    aiInstructions: 'Emphasize geometric intuition; favor diagrams over algebraic manipulation when possible.',
    instructorId: u.instructorMath,
    taIds: [u.taMath],
    studentIds: [u.student1, u.student3, u.student5],
    topics: [
      { slug: 'partials', name: 'Partial Derivatives' },
      { slug: 'multiple_integrals', name: 'Multiple Integrals' },
      { slug: 'vector_fields', name: 'Vector Fields' },
      { slug: 'greens_stokes', name: 'Greens, Stokes, and Divergence' },
    ],
    questions: [
      {
        n: 1, topicSlug: 'partials', type: 'SA',
        content: 'State the definition of the partial derivative of f(x, y) with respect to x at a point (a, b).',
        difficulty: 'EASY', reasoningLevel: 'FACTUAL',
        answer: 'f_x(a,b) = lim_{h->0} [f(a+h, b) - f(a, b)] / h, treating y = b as constant.',
        testable: true, createdBy: u.instructorMath,
      },
      {
        n: 2, topicSlug: 'multiple_integrals', type: 'LA',
        content: 'Explain when Fubini\'s theorem allows switching the order of integration in a double integral.',
        difficulty: 'HARD', reasoningLevel: 'ANALYTICAL',
        answer: 'When the integrand is absolutely integrable over the region (e.g. continuous on a bounded closed region), the iterated integrals in either order are equal.',
        testable: true, createdBy: u.instructorMath,
      },
      {
        n: 3, topicSlug: 'vector_fields', type: 'MCQ',
        content: 'A vector field F is conservative if and only if:',
        difficulty: 'MEDIUM', reasoningLevel: 'ANALYTICAL',
        choices: [
          { letter: 'A', text: 'div F = 0' },
          { letter: 'B', text: 'F = grad(phi) for some scalar phi (on a simply connected domain)' },
          { letter: 'C', text: 'curl F is nonzero' },
          { letter: 'D', text: 'F has constant magnitude' },
        ],
        answer: 'B', testable: true, createdBy: u.instructorMath,
      },
      {
        n: 4, topicSlug: 'greens_stokes', type: 'MCQ',
        content: 'Greens theorem relates a line integral around a simple closed curve to:',
        difficulty: 'MEDIUM', reasoningLevel: 'FACTUAL',
        choices: [
          { letter: 'A', text: 'A surface integral over an arbitrary surface' },
          { letter: 'B', text: 'A double integral over the enclosed region' },
          { letter: 'C', text: 'A volume integral over the enclosed solid' },
          { letter: 'D', text: 'Another line integral over the same curve' },
        ],
        answer: 'B', testable: true, createdBy: u.instructorMath,
      },
    ],
  },
  {
    id: c.math320,
    code: 'MATH 320',
    section: '001',
    name: 'Real Analysis',
    description: 'Rigorous treatment of limits, continuity, differentiation, and Riemann integration.',
    term: 'W2',
    year: 2025,
    startDate: new Date('2026-01-05'),
    endDate: new Date('2026-04-24'),
    department: 'MATH',
    isPublished: true,
    aiInstructions: 'Insist on epsilon-delta rigor; avoid hand-waving.',
    instructorId: u.instructorMath,
    studentIds: [u.student3, u.student5],
    topics: [
      { slug: 'sequences', name: 'Sequences and Series' },
      { slug: 'continuity', name: 'Continuity' },
      { slug: 'differentiation', name: 'Differentiation' },
      { slug: 'integration', name: 'Riemann Integration' },
    ],
    questions: [
      {
        n: 1, topicSlug: 'continuity', type: 'SA',
        content: 'Give the epsilon-delta definition of continuity of f at a point a.',
        difficulty: 'MEDIUM', reasoningLevel: 'FACTUAL',
        answer: 'For every eps > 0 there exists delta > 0 such that |x - a| < delta implies |f(x) - f(a)| < eps.',
        testable: true, createdBy: u.instructorMath,
      },
      {
        n: 2, topicSlug: 'sequences', type: 'MCQ',
        content: 'Every bounded sequence in R has:',
        difficulty: 'MEDIUM', reasoningLevel: 'FACTUAL',
        choices: [
          { letter: 'A', text: 'A limit' },
          { letter: 'B', text: 'A convergent subsequence (Bolzano-Weierstrass)' },
          { letter: 'C', text: 'An unbounded subsequence' },
          { letter: 'D', text: 'No accumulation points' },
        ],
        answer: 'B', testable: true, createdBy: u.instructorMath,
      },
      {
        n: 3, topicSlug: 'integration', type: 'LA',
        content: 'Sketch a proof that every continuous function on a closed bounded interval is Riemann integrable.',
        difficulty: 'HARD', reasoningLevel: 'ANALYTICAL',
        answer: 'Continuous on a compact set implies uniformly continuous. Given eps, choose a partition with mesh small enough that the oscillation on each subinterval is below eps/(b-a). Then upper minus lower Riemann sums is < eps. Apply the Riemann criterion.',
        testable: false, createdBy: u.instructorMath,
      },
    ],
  },
  {
    id: c.stat300,
    code: 'STAT 300',
    section: '001',
    name: 'Intermediate Statistics',
    description: 'Estimation, hypothesis testing, regression, and resampling.',
    term: 'W1',
    year: 2026,
    startDate: new Date('2026-09-08'),
    endDate: new Date('2026-12-12'),
    department: 'STAT',
    isPublished: true,
    aiInstructions: 'Always interpret results in plain language after stating the formal conclusion.',
    instructorId: u.instructorMath,
    studentIds: [u.student2, u.student3],
    topics: [
      { slug: 'estimation', name: 'Estimation' },
      { slug: 'hypothesis', name: 'Hypothesis Testing' },
      { slug: 'regression', name: 'Regression' },
      { slug: 'resampling', name: 'Bootstrap and Resampling' },
    ],
    questions: [
      {
        n: 1, topicSlug: 'hypothesis', type: 'MCQ',
        content: 'A p-value of 0.03 at significance level 0.05 means:',
        difficulty: 'EASY', reasoningLevel: 'ANALYTICAL',
        choices: [
          { letter: 'A', text: 'Fail to reject the null' },
          { letter: 'B', text: 'Reject the null' },
          { letter: 'C', text: 'The null is true' },
          { letter: 'D', text: 'The alternative is true' },
        ],
        answer: 'B', testable: true, createdBy: u.instructorMath,
      },
      {
        n: 2, topicSlug: 'estimation', type: 'SA',
        content: 'Define an unbiased estimator and give a one-line example.',
        difficulty: 'MEDIUM', reasoningLevel: 'FACTUAL',
        answer: 'An estimator T of theta is unbiased if E[T] = theta. Example: the sample mean is unbiased for the population mean.',
        testable: true, createdBy: u.instructorMath,
      },
      {
        n: 3, topicSlug: 'regression', type: 'MCQ',
        content: 'In ordinary least squares regression, R^2 represents:',
        difficulty: 'EASY', reasoningLevel: 'FACTUAL',
        choices: [
          { letter: 'A', text: 'The slope of the regression line' },
          { letter: 'B', text: 'The proportion of variance in y explained by the model' },
          { letter: 'C', text: 'The standard error of the residuals' },
          { letter: 'D', text: 'A measure of statistical significance' },
        ],
        answer: 'B', testable: true, createdBy: u.instructorMath,
      },
      {
        n: 4, topicSlug: 'resampling', type: 'LA',
        content: 'Explain the bootstrap procedure for estimating the standard error of a statistic.',
        difficulty: 'HARD', reasoningLevel: 'APPLICATION',
        answer: 'Resample with replacement from the observed data B times. Compute the statistic on each resample. The standard deviation of the B values approximates the standard error.',
        testable: false, createdBy: u.instructorMath,
      },
    ],
  },
  {
    id: c.data310,
    code: 'DATA 310',
    section: '001',
    name: 'Applied Machine Learning',
    description: 'Supervised and unsupervised learning, model selection, and evaluation.',
    term: 'W2',
    year: 2025,
    startDate: new Date('2026-01-05'),
    endDate: new Date('2026-04-24'),
    department: 'DATA',
    isPublished: true,
    aiInstructions: 'Always distinguish training, validation, and test data when discussing model evaluation.',
    instructorId: u.instructorMath,
    studentIds: [u.student1, u.student2, u.student3, u.student4, u.student5],
    topics: [
      { slug: 'supervised', name: 'Supervised Learning' },
      { slug: 'unsupervised', name: 'Unsupervised Learning' },
      { slug: 'model_selection', name: 'Model Selection' },
      { slug: 'evaluation', name: 'Evaluation Metrics' },
    ],
    questions: [
      {
        n: 1, topicSlug: 'evaluation', type: 'MCQ',
        content: 'For an imbalanced binary classifier, which metric is least informative on its own?',
        difficulty: 'MEDIUM', reasoningLevel: 'ANALYTICAL',
        choices: [
          { letter: 'A', text: 'Accuracy' },
          { letter: 'B', text: 'Precision' },
          { letter: 'C', text: 'Recall' },
          { letter: 'D', text: 'F1 score' },
        ],
        answer: 'A', testable: true, createdBy: u.instructorMath,
      },
      {
        n: 2, topicSlug: 'model_selection', type: 'SA',
        content: 'Why do we use a separate validation set in addition to a test set?',
        difficulty: 'MEDIUM', reasoningLevel: 'ANALYTICAL',
        answer: 'The validation set tunes hyperparameters during training; the test set provides an unbiased estimate of generalization on data not used in any training decisions.',
        testable: true, createdBy: u.instructorMath,
      },
      {
        n: 3, topicSlug: 'supervised', type: 'MCQ',
        content: 'Which model is most prone to high variance on small training sets?',
        difficulty: 'MEDIUM', reasoningLevel: 'APPLICATION',
        choices: [
          { letter: 'A', text: 'Linear regression with two predictors' },
          { letter: 'B', text: 'A deep decision tree with no depth limit' },
          { letter: 'C', text: 'Naive Bayes' },
          { letter: 'D', text: 'Logistic regression with L2 regularization' },
        ],
        answer: 'B', testable: true, createdBy: u.instructorMath,
      },
      {
        n: 4, topicSlug: 'unsupervised', type: 'LA',
        content: 'Compare k-means and hierarchical clustering. When would you prefer each?',
        difficulty: 'HARD', reasoningLevel: 'APPLICATION',
        answer: 'k-means is fast and scales well but requires choosing k and assumes roughly spherical clusters. Hierarchical clustering is parameter-free in k and produces a dendrogram but scales poorly to large n. Prefer k-means at scale with known k; prefer hierarchical when structure matters and n is moderate.',
        testable: false, createdBy: u.instructorMath,
      },
    ],
  },
  {
    id: c.psyo121,
    code: 'PSYO 121',
    section: '001',
    name: 'Introduction to Psychology',
    description: 'Survey of major topics in psychology.',
    term: 'W1',
    year: 2026,
    startDate: new Date('2026-09-08'),
    endDate: new Date('2026-12-12'),
    department: 'PSYO',
    isPublished: true,
    aiInstructions: 'Distinguish empirical findings from interpretive frameworks.',
    instructorId: u.instructorHum,
    studentIds: [u.student2, u.student5],
    topics: [
      { slug: 'brain', name: 'Brain and Behavior' },
      { slug: 'learning', name: 'Learning' },
      { slug: 'memory', name: 'Memory' },
      { slug: 'social', name: 'Social Psychology' },
    ],
    questions: [
      {
        n: 1, topicSlug: 'learning', type: 'SA',
        content: 'Distinguish classical conditioning from operant conditioning with one example each.',
        difficulty: 'MEDIUM', reasoningLevel: 'FACTUAL',
        answer: 'Classical: a neutral stimulus paired with an unconditioned stimulus elicits a learned response (Pavlovs dog). Operant: behavior is shaped by consequences (rat pressing a lever for food).',
        testable: true, createdBy: u.instructorHum,
      },
      {
        n: 2, topicSlug: 'brain', type: 'MCQ',
        content: 'Which brain structure is most associated with the consolidation of long-term memories?',
        difficulty: 'EASY', reasoningLevel: 'FACTUAL',
        choices: [
          { letter: 'A', text: 'Cerebellum' },
          { letter: 'B', text: 'Hippocampus' },
          { letter: 'C', text: 'Brainstem' },
          { letter: 'D', text: 'Pineal gland' },
        ],
        answer: 'B', testable: true, createdBy: u.instructorHum,
      },
      {
        n: 3, topicSlug: 'social', type: 'MCQ',
        content: 'Banduras social learning theory emphasizes that learning can occur through:',
        difficulty: 'EASY', reasoningLevel: 'FACTUAL',
        choices: [
          { letter: 'A', text: 'Reinforcement only' },
          { letter: 'B', text: 'Observation and imitation without direct reinforcement' },
          { letter: 'C', text: 'Classical conditioning only' },
          { letter: 'D', text: 'Biological maturation only' },
        ],
        answer: 'B', testable: true, createdBy: u.instructorHum,
      },
      {
        n: 4, topicSlug: 'memory', type: 'LA',
        content: 'Describe the difference between encoding, storage, and retrieval, and give an example of a failure of each.',
        difficulty: 'MEDIUM', reasoningLevel: 'APPLICATION',
        answer: 'Encoding converts perception into a memory trace; failure is inattention. Storage maintains the trace; failure is decay. Retrieval accesses the trace; failure is tip-of-the-tongue.',
        testable: false, createdBy: u.instructorHum,
      },
    ],
  },
  {
    id: c.biol116,
    code: 'BIOL 116',
    section: '001',
    name: 'Cell Biology',
    description: 'Structure and function of eukaryotic and prokaryotic cells.',
    term: 'W1',
    year: 2026,
    startDate: new Date('2026-09-08'),
    endDate: new Date('2026-12-12'),
    department: 'BIOL',
    isPublished: true,
    aiInstructions: 'Distinguish mechanistic explanations from teleological shorthand.',
    instructorId: u.instructorSci,
    studentIds: [u.student4, u.student5],
    topics: [
      { slug: 'membranes', name: 'Membranes and Transport' },
      { slug: 'organelles', name: 'Organelles' },
      { slug: 'cell_cycle', name: 'Cell Cycle' },
      { slug: 'signaling', name: 'Cell Signaling' },
    ],
    questions: [
      {
        n: 1, topicSlug: 'membranes', type: 'MCQ',
        content: 'Which process moves solute against its concentration gradient using ATP?',
        difficulty: 'EASY', reasoningLevel: 'FACTUAL',
        choices: [
          { letter: 'A', text: 'Simple diffusion' },
          { letter: 'B', text: 'Facilitated diffusion' },
          { letter: 'C', text: 'Active transport' },
          { letter: 'D', text: 'Osmosis' },
        ],
        answer: 'C', testable: true, createdBy: u.instructorSci,
      },
      {
        n: 2, topicSlug: 'organelles', type: 'SA',
        content: 'State two distinct functions of the endoplasmic reticulum.',
        difficulty: 'EASY', reasoningLevel: 'FACTUAL',
        answer: 'Rough ER synthesizes secreted/membrane proteins via ribosomes; smooth ER synthesizes lipids and detoxifies certain compounds.',
        testable: true, createdBy: u.instructorSci,
      },
      {
        n: 3, topicSlug: 'cell_cycle', type: 'LA',
        content: 'Describe the role of cyclin-dependent kinases in the G1/S transition.',
        difficulty: 'HARD', reasoningLevel: 'ANALYTICAL',
        answer: 'Cyclin-CDK complexes phosphorylate Rb, releasing E2F to drive transcription of S-phase genes. CDK activity is gated by cyclin availability and inhibitor proteins.',
        testable: false, createdBy: u.instructorSci,
      },
    ],
  },
  {
    id: c.phys121,
    code: 'PHYS 121',
    section: '001',
    name: 'Mechanics',
    description: 'Newtonian mechanics: kinematics, dynamics, energy, and momentum.',
    term: 'W1',
    year: 2026,
    startDate: new Date('2026-09-08'),
    endDate: new Date('2026-12-12'),
    department: 'PHYS',
    isPublished: true,
    aiInstructions: 'Always draw a free-body diagram before applying Newtons second law.',
    instructorId: u.instructorSci,
    studentIds: [u.student1, u.student4],
    topics: [
      { slug: 'kinematics', name: 'Kinematics' },
      { slug: 'dynamics', name: 'Dynamics' },
      { slug: 'energy', name: 'Energy' },
      { slug: 'momentum', name: 'Momentum' },
    ],
    questions: [
      {
        n: 1, topicSlug: 'dynamics', type: 'MCQ',
        content: 'A block on a frictionless incline of angle theta experiences an acceleration of:',
        difficulty: 'MEDIUM', reasoningLevel: 'ANALYTICAL',
        choices: [
          { letter: 'A', text: 'g' },
          { letter: 'B', text: 'g sin(theta)' },
          { letter: 'C', text: 'g cos(theta)' },
          { letter: 'D', text: 'g tan(theta)' },
        ],
        answer: 'B', testable: true, createdBy: u.instructorSci,
      },
      {
        n: 2, topicSlug: 'energy', type: 'SA',
        content: 'State the work-energy theorem in one sentence.',
        difficulty: 'EASY', reasoningLevel: 'FACTUAL',
        answer: 'The net work done on an object equals its change in kinetic energy.',
        testable: true, createdBy: u.instructorSci,
      },
      {
        n: 3, topicSlug: 'momentum', type: 'LA',
        content: 'Two carts collide and stick together. Explain why momentum is conserved but kinetic energy is not.',
        difficulty: 'MEDIUM', reasoningLevel: 'APPLICATION',
        answer: 'Momentum conservation follows from Newtons third law (no external impulse). KE is not conserved because deformation and heat absorb some KE — the collision is inelastic.',
        testable: false, createdBy: u.instructorSci,
      },
    ],
  },
  {
    id: c.hist210,
    code: 'HIST 210',
    section: '001',
    name: 'World History: 1500 to Present',
    description: 'Major themes in global history from the early modern period.',
    term: 'W2',
    year: 2025,
    startDate: new Date('2026-01-05'),
    endDate: new Date('2026-04-24'),
    department: 'HIST',
    isPublished: true,
    aiInstructions: 'Encourage analysis of primary sources; flag anachronistic framings.',
    instructorId: u.instructorHum,
    studentIds: [u.student3, u.student5],
    topics: [
      { slug: 'exploration', name: 'Age of Exploration' },
      { slug: 'industrial', name: 'Industrial Revolution' },
      { slug: 'world_wars', name: 'World Wars' },
      { slug: 'globalization', name: 'Globalization' },
    ],
    questions: [
      {
        n: 1, topicSlug: 'industrial', type: 'MCQ',
        content: 'Which of the following was NOT a major driver of the early Industrial Revolution in Britain?',
        difficulty: 'MEDIUM', reasoningLevel: 'ANALYTICAL',
        choices: [
          { letter: 'A', text: 'Access to coal and iron ore' },
          { letter: 'B', text: 'Colonial markets and raw materials' },
          { letter: 'C', text: 'Electrical power generation' },
          { letter: 'D', text: 'Enclosure of agricultural land' },
        ],
        answer: 'C', testable: true, createdBy: u.instructorHum,
      },
      {
        n: 2, topicSlug: 'world_wars', type: 'SA',
        content: 'List two short-term and one long-term cause of World War I.',
        difficulty: 'MEDIUM', reasoningLevel: 'ANALYTICAL',
        answer: 'Short-term: assassination of Archduke Franz Ferdinand; July Crisis alliance escalations. Long-term: arms race / militarism, or imperial rivalries.',
        testable: true, createdBy: u.instructorHum,
      },
      {
        n: 3, topicSlug: 'globalization', type: 'LA',
        content: 'Describe two ways late-20th-century globalization differed from earlier global trade networks.',
        difficulty: 'HARD', reasoningLevel: 'APPLICATION',
        answer: 'Volume and speed of capital flows enabled by digital communications; integration of global supply chains across many jurisdictions versus the bilateral trade patterns dominant earlier.',
        testable: false, createdBy: u.instructorHum,
      },
    ],
  },
  {
    id: c.engl110,
    code: 'ENGL 110',
    section: '001',
    name: 'Composition',
    description: 'Academic writing and argumentation.',
    term: 'W1',
    year: 2026,
    startDate: new Date('2026-09-08'),
    endDate: new Date('2026-12-12'),
    department: 'ENGL',
    isPublished: true,
    aiInstructions: 'Focus on structural feedback over surface-level edits; ask for thesis statements early.',
    instructorId: u.instructorHum,
    studentIds: [u.student1, u.student2, u.student5],
    topics: [
      { slug: 'thesis', name: 'Thesis Development' },
      { slug: 'evidence', name: 'Using Evidence' },
      { slug: 'style', name: 'Style and Voice' },
    ],
    questions: [
      {
        n: 1, topicSlug: 'thesis', type: 'SA',
        content: 'What distinguishes a debatable thesis from a topic sentence?',
        difficulty: 'EASY', reasoningLevel: 'ANALYTICAL',
        answer: 'A debatable thesis takes an arguable position that a reasonable person could disagree with; a topic sentence introduces a single paragraph and need not be contestable.',
        testable: true, createdBy: u.instructorHum,
      },
      {
        n: 2, topicSlug: 'evidence', type: 'MCQ',
        content: 'Which of the following is the strongest use of evidence?',
        difficulty: 'EASY', reasoningLevel: 'APPLICATION',
        choices: [
          { letter: 'A', text: 'A long quotation followed by no analysis' },
          { letter: 'B', text: 'A statistic without a source' },
          { letter: 'C', text: 'A short quotation followed by analysis tying it to the thesis' },
          { letter: 'D', text: 'A paraphrase contradicted by the cited source' },
        ],
        answer: 'C', testable: true, createdBy: u.instructorHum,
      },
    ],
  },
  {
    id: c.phil220,
    code: 'PHIL 220',
    section: '001',
    name: 'Introduction to Ethics',
    description: 'Major ethical theories and contemporary applied problems.',
    term: 'W2',
    year: 2025,
    startDate: new Date('2026-01-05'),
    endDate: new Date('2026-04-24'),
    department: 'PHIL',
    isPublished: false,
    aiInstructions: 'Distinguish first-order moral claims from meta-ethical claims about them.',
    instructorId: u.instructorHum,
    studentIds: [u.student3],
    topics: [
      { slug: 'consequentialism', name: 'Consequentialism' },
      { slug: 'deontology', name: 'Deontology' },
      { slug: 'virtue', name: 'Virtue Ethics' },
      { slug: 'applied', name: 'Applied Ethics' },
    ],
    questions: [
      {
        n: 1, topicSlug: 'consequentialism', type: 'SA',
        content: 'State the basic principle of utilitarianism and one common objection to it.',
        difficulty: 'EASY', reasoningLevel: 'FACTUAL',
        answer: 'Maximize overall utility (well-being). Common objection: it can justify harming individuals to benefit a majority, conflicting with rights-based intuitions.',
        testable: true, createdBy: u.instructorHum,
      },
      {
        n: 2, topicSlug: 'deontology', type: 'MCQ',
        content: 'Kants categorical imperative tells us to act:',
        difficulty: 'MEDIUM', reasoningLevel: 'FACTUAL',
        choices: [
          { letter: 'A', text: 'According to whatever maximizes happiness' },
          { letter: 'B', text: 'Only on maxims we could will to be universal laws' },
          { letter: 'C', text: 'In accordance with our character traits' },
          { letter: 'D', text: 'Based on divine command' },
        ],
        answer: 'B', testable: true, createdBy: u.instructorHum,
      },
    ],
  },
];

// ---------------------------------------------------------------------------

/** Qwen3.5 fleet candidates. Energy constants remain unset until v3 meter validation. */
const ROUTING_TIER_ASSIGNMENTS = [
  {
    providerName: 'vllm',
    modelId: 'qwen3.5-2b',
    routerTier: 'TIER_1' as const,
    estEnergyJoulesPerToken: null,
    averageCarbonGramsPerToken: null,
  },
  {
    providerName: 'vllm',
    modelId: 'qwen3.5-27b',
    routerTier: 'TIER_3' as const,
    estEnergyJoulesPerToken: null,
    averageCarbonGramsPerToken: null,
  },
];

async function applyRoutingTierAssignments() {
  console.log('Applying routing tier and energy constants...');

  for (const row of ROUTING_TIER_ASSIGNMENTS) {
    const provider = await prisma.aIProvider.findUnique({
      where: { name: row.providerName },
    });
    if (!provider) {
      console.warn(`   Skip tier row (unknown provider): ${row.providerName}`);
      continue;
    }

    const result = await prisma.aIModel.updateMany({
      where: { providerId: provider.id, modelId: row.modelId },
      data: {
        routerTier: row.routerTier,
        estEnergyJoulesPerToken: row.estEnergyJoulesPerToken,
        averageCarbonGramsPerToken: row.averageCarbonGramsPerToken,
      },
    });

    if (result.count === 0) {
      console.warn(`   No AIModel row for ${row.providerName}:${row.modelId}`);
    }
  }

  const google = await prisma.aIProvider.findUnique({ where: { name: "google" } });
  if (google) {
    await prisma.aIModel.updateMany({
      where: { providerId: google.id, routerTier: { not: null } },
      data: { routerTier: null },
    });
  }
}

async function seedAIProvidersAndModels() {
  const openai = await prisma.aIProvider.upsert({
    where: { name: 'openai' },
    update: {},
    create: {
      name: 'openai',
      displayName: 'OpenAI',
      description: 'GPT family of models',
      requiresApiKey: true,
      envVarName: 'OPENAI_API_KEY',
      isActive: true,
    },
  });

  const google = await prisma.aIProvider.upsert({
    where: { name: 'google' },
    update: {},
    create: {
      name: 'google',
      displayName: 'Google AI',
      description: 'Gemini models',
      requiresApiKey: true,
      envVarName: 'GOOGLE_GENERATIVE_AI_API_KEY',
      isActive: true,
    },
  });

  await prisma.aIProvider.upsert({
    where: { name: 'ollama' },
    update: {},
    create: {
      name: 'ollama',
      displayName: 'Ollama',
      description: 'Local AI models',
      requiresApiKey: false,
      defaultBaseUrl: 'http://localhost:11434/api',
      envVarName: 'OLLAMA_BASE_URL',
      isActive: true,
    },
  });

  const vllm = await prisma.aIProvider.upsert({
    where: { name: 'vllm' },
    update: {},
    create: {
      name: 'vllm',
      displayName: 'vLLM',
      description: 'Local OpenAI-compatible inference (vLLM on cmps01 or tunnel)',
      requiresApiKey: false,
      defaultBaseUrl: 'http://localhost:8001/v1',
      envVarName: 'VLLM_BASE_URL',
      isActive: true,
    },
  });

  const openaiModels = [
    { modelId: 'gpt-4.1', name: 'GPT-4.1', description: 'Advanced GPT-4.1', maxTokens: 128000, inputPricing: 5, outputPricing: 15 },
    { modelId: 'gpt-4o', name: 'GPT-4o', description: 'Multimodal flagship', maxTokens: 128000, inputPricing: 2.5, outputPricing: 10 },
    { modelId: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast and cheap', maxTokens: 128000, inputPricing: 0.15, outputPricing: 0.6 },
  ];

  for (const m of openaiModels) {
    await prisma.aIModel.upsert({
      where: { providerId_modelId: { providerId: openai.id, modelId: m.modelId } },
      update: {},
      create: { ...m, type: 'CHAT', supportsImages: true, supportsTools: true, supportsStreaming: true, providerId: openai.id },
    });
  }

  const googleModels = [
    { modelId: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Advanced multimodal', maxTokens: 2097152, inputPricing: 1.25, outputPricing: 5 },
    { modelId: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Fast multimodal', maxTokens: 1048576, inputPricing: 0.075, outputPricing: 0.3 },
  ];

  for (const m of googleModels) {
    await prisma.aIModel.upsert({
      where: { providerId_modelId: { providerId: google.id, modelId: m.modelId } },
      update: {},
      create: { ...m, type: 'CHAT', supportsImages: true, supportsTools: true, supportsStreaming: true, providerId: google.id },
    });
  }

  const vllmModels = [
    {
      modelId: 'qwen3.5-2b',
      name: 'Qwen 3.5 2B (vLLM)',
      description: 'Qwen3.5 fleet small-tier candidate',
      maxTokens: 16384,
      supportsTools: false,
    },
    {
      modelId: 'qwen3.5-27b',
      name: 'Qwen 3.5 27B FP8 (vLLM)',
      description: 'Qwen3.5 fleet large-tier candidate with Qwen tool parsing',
      maxTokens: 16384,
      supportsTools: true,
    },
  ];

  for (const m of vllmModels) {
    await prisma.aIModel.upsert({
      where: { providerId_modelId: { providerId: vllm.id, modelId: m.modelId } },
      update: { maxTokens: m.maxTokens, supportsTools: m.supportsTools, supportsImages: false },
      create: {
        ...m,
        type: 'CHAT',
        supportsImages: false,
        supportsStreaming: true,
        providerId: vllm.id,
      },
    });
  }

  await prisma.aIModel.updateMany({
    where: {
      providerId: vllm.id,
      modelId: { in: ['qwen2.5-7b-instruct', 'qwen2.5-32b-instruct'] },
    },
    data: { isActive: false, routerTier: null },
  });

  await applyRoutingTierAssignments();
}

async function releaseStudentIdClaim(
  studentNumber: string,
  keepUserId: string,
  lookup: string,
) {
  await prisma.user.updateMany({
    where: {
      OR: [
        { studentIdLookup: lookup },
        { studentId: studentNumber, studentIdLookup: null },
      ],
      NOT: { id: keepUserId },
    },
    data: clearStudentIdStorage(),
  });
}

export async function seedUsers() {
  type SeededUser = {
    id: string;
    email: string;
    name: string;
    role: 'ADMIN' | 'INSTRUCTOR' | 'STUDENT' | 'UNIT_ADMIN';
    authorizedUnits?: string[];
    studentNumber?: string;
  };

  const sn = SEED_IDS.studentNumbers;

  const users: SeededUser[] = [
    { id: u.admin, email: 'admin@eduai.local', name: 'EduAI Admin', role: 'ADMIN' },
    { id: u.unitAdminCosc, email: 'unitadmin.cosc@eduai.local', name: 'COSC Unit Admin', role: 'UNIT_ADMIN', authorizedUnits: ['COSC'] },
    { id: u.unitAdminMulti, email: 'unitadmin.multi@eduai.local', name: 'Multi-Unit Admin', role: 'UNIT_ADMIN', authorizedUnits: ['MATH', 'STAT', 'DATA'] },
    { id: u.instructorCS, email: 'instructor.cs@eduai.local', name: 'Dr. Ada Lovelace', role: 'INSTRUCTOR' },
    { id: u.instructorMath, email: 'instructor.math@eduai.local', name: 'Dr. Emmy Noether', role: 'INSTRUCTOR' },
    { id: u.instructorSci, email: 'instructor.sci@eduai.local', name: 'Dr. Marie Curie', role: 'INSTRUCTOR' },
    { id: u.instructorHum, email: 'instructor.hum@eduai.local', name: 'Dr. Hannah Arendt', role: 'INSTRUCTOR' },
    // TAs are STUDENT-platform users; their TA status is the Enrollment(role=TA)
    // created from course.taIds below.
    { id: u.taCS, email: 'ta.cs@eduai.local', name: 'Sam Carter', role: 'STUDENT' },
    { id: u.taMath, email: 'ta.math@eduai.local', name: 'Riley Chen', role: 'STUDENT' },
    { id: u.student1, email: 'student1@eduai.local', name: 'Alex Patel', role: 'STUDENT', studentNumber: sn.student1 },
    { id: u.student2, email: 'student2@eduai.local', name: 'Brooke Kim', role: 'STUDENT', studentNumber: sn.student2 },
    { id: u.student3, email: 'student3@eduai.local', name: 'Cameron Lee', role: 'STUDENT', studentNumber: sn.student3 },
    { id: u.student4, email: 'student4@eduai.local', name: 'Devon Singh', role: 'STUDENT', studentNumber: sn.student4 },
    { id: u.student5, email: 'student5@eduai.local', name: 'Erin Walsh', role: 'STUDENT', studentNumber: sn.student5 },
  ];

  for (const user of users) {
    const studentIdFields = user.studentNumber
      ? prepareStudentIdStorage(user.studentNumber)
      : clearStudentIdStorage();

    if (user.studentNumber && studentIdFields.studentIdLookup) {
      await releaseStudentIdClaim(
        user.studentNumber,
        user.id,
        studentIdFields.studentIdLookup,
      );
    }

    await prisma.user.upsert({
      where: { id: user.id },
      update: {
        email: user.email,
        name: user.name,
        role: user.role,
        authorizedUnits: user.authorizedUnits ?? [],
        isActive: true,
        emailVerified: true,
        ...studentIdFields,
      },
      create: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        authorizedUnits: user.authorizedUnits ?? [],
        isActive: true,
        emailVerified: true,
        ...studentIdFields,
      },
    });
  }
}

const SEED_PASSWORD = 'EduAI2026!';

async function seedPasswords() {
  const hashed = await hashPassword(SEED_PASSWORD);
  const userIds = Object.values(SEED_IDS.users);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, email: true },
  });
  for (const user of users) {
    await prisma.account.upsert({
      where: { providerId_accountId: { providerId: 'credential', accountId: user.email } },
      update: { password: hashed },
      create: {
        providerId: 'credential',
        accountId: user.email,
        userId: user.id,
        password: hashed,
      },
    });
  }
}

/**
 * Seed the UBCO discipline registry from prisma/data/disciplines.csv (the
 * Workday export, §541). Idempotent upsert by code. Must run before seedCourses
 * since courses.department is a FK into disciplines.code.
 */
/**
 * Split a single CSV line, honouring RFC-4180 double-quoted fields so a name
 * containing commas (e.g. "Design, Innovation, Creativity, Entrepreneurship")
 * stays one field with its surrounding quotes stripped.
 */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } // escaped "" inside quotes
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

async function seedDisciplines(): Promise<number> {
  const csvPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'disciplines.csv');
  const lines = readFileSync(csvPath, 'utf8').trim().split('\n').slice(1); // drop header
  for (const line of lines) {
    const parts = parseCsvLine(line);
    if (parts.length < 4) continue;
    const id = parts[0];
    const code = parts[1];
    const createdAt = parts[parts.length - 1];
    const name = parts[2]; // quoted comma-bearing names already kept whole
    await prisma.discipline.upsert({
      where: { code },
      update: { name },
      create: { id, code, name, createdAt: new Date(createdAt) },
    });
  }
  return lines.length;
}

/**
 * Invariant: each seeded course's literal `term` AND `year` must agree with
 * the canonical UBC academic-year derivation from its `startDate` (mirrors
 * `packages/ui/src/lib/term.ts` `termInfoFromDate`, the single source of
 * truth shared by Core's `CreateCourseSchema` and every app). `year` is the
 * academic-year label, not the calendar year — a W2 course starting Jan–Apr
 * derives the PREVIOUS year (#1088). Throws — rather than silently seeding
 * mismatched data — if a literal and its date ever drift.
 */
function assertCanonicalTerms(courses: SeedCourse[]) {
  for (const course of courses) {
    const derived = termInfoFromDate(course.startDate);
    if (course.term !== derived.term || course.year !== derived.year) {
      throw new Error(
        `Seed course ${course.id} has term '${course.term}' year ${course.year} but startDate ` +
          `${course.startDate.toISOString()} derives '${derived.term}' year ${derived.year} via ` +
          `termInfoFromDate (packages/ui/src/lib/term.ts). Fix the literal to match.`,
      );
    }
  }
}

async function seedCourses() {
  for (const course of COURSES) {
    await prisma.course.upsert({
      where: { id: course.id },
      update: {
        code: course.code,
        section: course.section,
        name: course.name,
        description: course.description,
        term: course.term,
        year: course.year,
        startDate: course.startDate,
        endDate: course.endDate,
        department: course.department,
        isPublished: course.isPublished,
        aiInstructions: course.aiInstructions,
      },
      create: {
        id: course.id,
        code: course.code,
        section: course.section,
        name: course.name,
        description: course.description,
        term: course.term,
        year: course.year,
        startDate: course.startDate,
        endDate: course.endDate,
        department: course.department,
        isPublished: course.isPublished,
        aiInstructions: course.aiInstructions,
      },
    });

    const courseSlug = course.id.replace(/^seed_course_/, '');

    for (const topic of course.topics) {
      await prisma.courseTopic.upsert({
        where: { id: topicId(courseSlug, topic.slug) },
        update: { name: topic.name, courseId: course.id },
        create: { id: topicId(courseSlug, topic.slug), name: topic.name, courseId: course.id },
      });
    }

    await prisma.enrollment.upsert({
      where: { courseId_userId: { courseId: course.id, userId: course.instructorId } },
      update: { role: 'INSTRUCTOR', isActive: true },
      create: { courseId: course.id, userId: course.instructorId, role: 'INSTRUCTOR', isActive: true },
    });

    for (const taId of course.taIds ?? []) {
      await prisma.enrollment.upsert({
        where: { courseId_userId: { courseId: course.id, userId: taId } },
        update: { role: 'TA', isActive: true },
        create: { courseId: course.id, userId: taId, role: 'TA', isActive: true },
      });
    }

    for (const studentId of course.studentIds) {
      await prisma.enrollment.upsert({
        where: { courseId_userId: { courseId: course.id, userId: studentId } },
        update: { role: 'STUDENT', isActive: true },
        create: { courseId: course.id, userId: studentId, role: 'STUDENT', isActive: true },
      });
    }

    for (const q of course.questions) {
      const qId = questionId(courseSlug, q.n);
      const primaryTopicId = topicId(courseSlug, q.topicSlug);

      await prisma.question.upsert({
        where: { id: qId },
        update: {
          content: q.content,
          type: q.type,
          difficulty: q.difficulty,
          reasoningLevel: q.reasoningLevel,
          choices: q.choices ?? undefined,
          answer: q.answer,
          testable: q.testable,
          topicId: primaryTopicId,
          createdBy: q.createdBy,
          courseId: course.id,
        },
        create: {
          id: qId,
          courseId: course.id,
          topicId: primaryTopicId,
          createdBy: q.createdBy,
          content: q.content,
          type: q.type,
          difficulty: q.difficulty,
          reasoningLevel: q.reasoningLevel,
          choices: q.choices ?? undefined,
          answer: q.answer,
          testable: q.testable,
        },
      });

      // Reset and rewrite secondary topics for idempotency.
      await prisma.questionSecondaryTopic.deleteMany({ where: { questionId: qId } });
      for (const secSlug of q.secondaryTopicSlugs ?? []) {
        await prisma.questionSecondaryTopic.create({
          data: { questionId: qId, topicId: topicId(courseSlug, secSlug) },
        });
      }
    }
  }
}

async function seedBugReports() {
  type SeedBug = {
    id: string;
    source: 'CORE' | 'AI_TUTOR' | 'QUESTION_MAKER';
    userId: string | null;
    isAnonymous?: boolean;
    description: string;
    status?: 'UNHANDLED' | 'IN_PROGRESS' | 'RESOLVED';
    pageUrl?: string;
    userAgent?: string;
    context?: Record<string, unknown>;
  };

  const bugs: SeedBug[] = [
    {
      id: 'seed_bug_01', source: 'CORE', userId: u.student1,
      description: 'Chat sidebar collapses unexpectedly when switching courses.',
      status: 'UNHANDLED', pageUrl: '/chat', userAgent: 'Mozilla/5.0 (Macintosh)',
    },
    {
      id: 'seed_bug_02', source: 'AI_TUTOR', userId: u.student2,
      description: 'Activity submission button greyed out on second attempt.',
      status: 'IN_PROGRESS', pageUrl: '/courses/1/lessons/3',
      context: { courseOfferingId: 1, lessonId: 3, activityId: 12 },
    },
    {
      id: 'seed_bug_03', source: 'QUESTION_MAKER', userId: u.instructorCS,
      description: 'OCR step skips images larger than 2 MB without an error message.',
      status: 'IN_PROGRESS', pageUrl: '/questions/extract',
    },
    {
      id: 'seed_bug_04', source: 'CORE', userId: null, isAnonymous: true,
      description: 'Login page does not return focus to email field after CAPTCHA.',
      status: 'UNHANDLED',
    },
    {
      id: 'seed_bug_05', source: 'AI_TUTOR', userId: u.student3,
      description: 'Tutor sometimes replies in JSON instead of prose.',
      status: 'RESOLVED', context: { activityId: 7, mode: 'teach' },
    },
    {
      id: 'seed_bug_06', source: 'QUESTION_MAKER', userId: u.instructorHum,
      isAnonymous: true,
      description: 'Canvas export silently truncates LA-type variants longer than 4000 chars.',
      status: 'IN_PROGRESS',
    },
    {
      id: 'seed_bug_07', source: 'CORE', userId: u.taCS,
      description: 'Material upload progress bar resets to 0% near the end.',
      status: 'UNHANDLED', pageUrl: '/courses/cosc101/materials',
    },
    {
      id: 'seed_bug_08', source: 'AI_TUTOR', userId: u.student4,
      description: 'Pedagogical reviewer flagged tutor incorrectly on first iteration.',
      status: 'RESOLVED', context: { aiChatSessionId: 42, iterationCount: 1 },
    },
    {
      id: 'seed_bug_09', source: 'QUESTION_MAKER', userId: u.instructorMath,
      description: 'Bulk topic rename fails if any topic name contains a colon.',
      status: 'UNHANDLED',
    },
    {
      id: 'seed_bug_10', source: 'CORE', userId: u.admin,
      description: 'AI Models admin page shows duplicate rows after enabling/disabling a provider.',
      status: 'IN_PROGRESS',
    },
    {
      id: 'seed_bug_11', source: 'AI_TUTOR', userId: u.student5,
      description: 'Long-press on activity card triggers context menu twice on Safari iOS.',
      status: 'UNHANDLED',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5)',
    },
    {
      id: 'seed_bug_12', source: 'QUESTION_MAKER', userId: null, isAnonymous: true,
      description: 'Assessment assembler hangs when total variants exceeds 200.',
      status: 'UNHANDLED',
    },
  ];

  for (const b of bugs) {
    await prisma.bugReport.upsert({
      where: { id: b.id },
      update: {
        source: b.source,
        userId: b.userId,
        isAnonymous: b.isAnonymous ?? false,
        description: b.description,
        status: b.status ?? 'UNHANDLED',
        pageUrl: b.pageUrl,
        userAgent: b.userAgent,
        context: b.context as object | undefined,
      },
      create: {
        id: b.id,
        source: b.source,
        userId: b.userId,
        isAnonymous: b.isAnonymous ?? false,
        description: b.description,
        status: b.status ?? 'UNHANDLED',
        pageUrl: b.pageUrl,
        userAgent: b.userAgent,
        context: b.context as object | undefined,
      },
    });
  }
}

async function seedChats() {
  type SeedChat = {
    id: string;
    /** Chat owner — always a student so instructor/unit-admin visibility is meaningful. */
    userId: string;
    /**
     * Course the chat is tagged to (RBAC policy expansion §5). `null` = a
     * general chat that course/unit chat views must exclude. Course chats use a
     * course the owner is actually enrolled in, so resolved access is real.
     */
    courseId: string | null;
    title: string;
    messages: { role: 'user' | 'assistant'; text: string }[];
  };

  // Coverage map:
  //   - COSC unit-admin (unitadmin.cosc, scope COSC): COSC 101 + COSC 121 → aggregate spans 2 courses.
  //   - Multi-unit admin (unitadmin.multi, scope MATH/STAT/DATA): MATH 200, STAT 300, DATA 310.
  //   - PSYO 121: out-of-unit for both admins (proves unit scoping excludes it).
  //   - One null-course chat: proves course/unit views exclude general chats.
  // Every owner below is enrolled in the tagged course (see COURSES above).
  const chats: SeedChat[] = [
    {
      id: 'seed_chat_cosc101_s1',
      userId: u.student1,
      courseId: c.cosc101,
      title: 'Understanding decomposition',
      messages: [
        { role: 'user', text: 'Can you explain what "decomposition" means in computational thinking?' },
        { role: 'assistant', text: 'Decomposition is breaking a complex problem into smaller, more manageable parts you can tackle one at a time. For example, building a website breaks into layout, content, and styling sub-problems.' },
        { role: 'user', text: 'So it is like splitting a big assignment into steps?' },
      ],
    },
    {
      id: 'seed_chat_cosc101_s2',
      userId: u.student2,
      courseId: c.cosc101,
      title: 'How many bits for 256 values?',
      messages: [
        { role: 'user', text: 'Why do I need 8 bits to represent 256 different values?' },
        { role: 'assistant', text: 'Each bit doubles the number of representable values: n bits give 2^n combinations. 2^8 = 256, so 8 bits cover exactly 256 distinct values (0–255).' },
      ],
    },
    {
      id: 'seed_chat_cosc121_s1',
      userId: u.student1,
      courseId: c.cosc121,
      title: 'Arrays vs linked lists',
      messages: [
        { role: 'user', text: 'When should I pick a linked list over an array?' },
        { role: 'assistant', text: 'Choose a linked list when you do frequent insertions/removals at known positions and rarely need random access. Arrays win when you need O(1) indexing and predictable memory locality.' },
      ],
    },
    {
      id: 'seed_chat_cosc121_s4',
      userId: u.student4,
      courseId: c.cosc121,
      title: 'When are TDD tests written?',
      messages: [
        { role: 'user', text: 'In test-driven development, do I write tests before or after the code?' },
        { role: 'assistant', text: 'Before. In TDD you write a failing unit test first, then write just enough implementation to make it pass, then refactor — the red/green/refactor loop.' },
        { role: 'user', text: 'That feels backwards but I think I get it.' },
      ],
    },
    {
      id: 'seed_chat_math200_s3',
      userId: u.student3,
      courseId: c.math200,
      title: 'Partial derivative intuition',
      messages: [
        { role: 'user', text: 'What does the partial derivative of f(x, y) with respect to x actually measure?' },
        { role: 'assistant', text: 'It measures how f changes as you nudge x while holding y fixed — the slope of the surface in the x-direction at that point. Geometrically, slice the surface with a plane y = const and take the ordinary derivative of that curve.' },
      ],
    },
    {
      id: 'seed_chat_stat300_s2',
      userId: u.student2,
      courseId: c.stat300,
      title: 'Interpreting a p-value',
      messages: [
        { role: 'user', text: 'If my p-value is 0.03 at alpha = 0.05, what do I conclude?' },
        { role: 'assistant', text: 'Since 0.03 < 0.05, you reject the null hypothesis at the 5% level. Note this does not mean the null is "0.03 likely" — it means data this extreme would occur only 3% of the time if the null were true.' },
      ],
    },
    {
      id: 'seed_chat_data310_s3',
      userId: u.student3,
      courseId: c.data310,
      title: 'k-means vs hierarchical clustering',
      messages: [
        { role: 'user', text: 'When would I prefer hierarchical clustering over k-means?' },
        { role: 'assistant', text: 'Prefer hierarchical clustering when you do not know the number of clusters up front and want a dendrogram to inspect structure, and when n is moderate. Prefer k-means at scale when k is known and clusters are roughly spherical.' },
      ],
    },
    {
      id: 'seed_chat_psyo121_s2',
      userId: u.student2,
      courseId: c.psyo121,
      title: 'Classical vs operant conditioning',
      messages: [
        { role: 'user', text: 'What is the difference between classical and operant conditioning?' },
        { role: 'assistant', text: 'Classical conditioning pairs a neutral stimulus with one that already triggers a response (Pavlov\'s dog salivating to a bell). Operant conditioning shapes behavior through consequences — reinforcement or punishment after the behavior (a rat pressing a lever for food).' },
      ],
    },
    {
      id: 'seed_chat_general_s1',
      userId: u.student1,
      courseId: null,
      title: 'General study tips',
      messages: [
        { role: 'user', text: 'Any general advice for studying across multiple courses this term?' },
        { role: 'assistant', text: 'Space your review sessions instead of cramming, mix topics within a session (interleaving), and self-test rather than re-reading. A short weekly plan per course keeps things from piling up.' },
      ],
    },
  ];

  for (const chat of chats) {
    await prisma.chat.upsert({
      where: { id: chat.id },
      update: { userId: chat.userId, courseId: chat.courseId, title: chat.title },
      create: { id: chat.id, userId: chat.userId, courseId: chat.courseId, title: chat.title },
    });

    // Rewrite messages for idempotency (mirrors the secondary-topics pattern).
    // Array order is preserved by the autoincrement `position`, which the
    // chat-detail read orders by.
    await prisma.chatMessage.deleteMany({ where: { chatId: chat.id } });
    await prisma.chatMessage.createMany({
      data: chat.messages.map((m, i) => {
        const messageId = `${chat.id}_m${i + 1}`;
        return {
          chatId: chat.id,
          messageId,
          role: m.role,
          // Stored shape mirrors chat.ts `serializeMessage` (AI-SDK message):
          // the frontend renders `parts[].text` with a `content` fallback.
          content: {
            id: messageId,
            role: m.role,
            parts: [{ type: 'text', text: m.text }],
          } as Prisma.InputJsonValue,
        };
      }),
    });
  }
}

async function seedMaterials() {
  // Data-driven off COURSES so EVERY course gets materials — no matter which
  // account logs in, the courses it can see have materials. Each course gets:
  //   1. an instructor-owned overview, and
  //   2. a topic-notes file owned by the course TA when one exists (exercises
  //      the own-TA delete carve-out, `isOwnTa`), else by the instructor.
  // Bare rows (no chunks/embeddings — those are RAG-only and need an embedding
  // API key); listing and every materials RBAC gate read only the
  // CourseMaterial row. status READY so they appear fully processed.
  type SeedMaterial = { id: string; courseId: string; title: string; uploadedBy: string; rawText: string };

  // Clear prior seed materials (incl. legacy ids from earlier seed versions) so
  // re-seeds stay idempotent and never leave orphans. Chunks cascade; seed
  // materials have none.
  await prisma.courseMaterial.deleteMany({ where: { id: { startsWith: 'seed_material_' } } });

  for (const course of COURSES) {
    const courseSlug = course.id.replace(/^seed_course_/, '');
    const taId = course.taIds?.[0];
    const firstTopic = course.topics[0];
    const topicNames = course.topics.map((t) => t.name).join(', ');

    const materials: SeedMaterial[] = [
      {
        id: `seed_material_${courseSlug}_overview`,
        courseId: course.id,
        title: `${course.code} — Course Overview`,
        uploadedBy: course.instructorId,
        rawText: `${course.name}. ${course.description} Topics covered: ${topicNames}.`,
      },
      {
        id: `seed_material_${courseSlug}_notes`,
        courseId: course.id,
        title: `${course.code} — ${firstTopic.name} Notes`,
        // TA-owned when the course has a TA, else instructor-owned.
        uploadedBy: taId ?? course.instructorId,
        rawText: `Lecture notes on ${firstTopic.name} for ${course.code} (${course.name}). ${course.aiInstructions}`,
      },
    ];

    for (const m of materials) {
      const fileSize = Buffer.byteLength(m.rawText, 'utf8');
      // Deterministic checksum keyed by material id — unique within the
      // course (courseId, checksum) constraint and stable across re-seeds.
      const checksum = `seed-${m.id}`;
      const data = {
        courseId: m.courseId,
        title: m.title,
        mimeType: 'text/plain',
        fileSize,
        checksum,
        rawText: m.rawText,
        status: 'READY' as const,
        uploadedBy: m.uploadedBy,
        processedAt: new Date(),
      };
      await prisma.courseMaterial.upsert({
        where: { id: m.id },
        update: data,
        create: { id: m.id, ...data },
      });
    }
  }
}

async function main() {
  console.log('Seeding Core...');

  const disciplineCount = await seedDisciplines();
  console.log(`  ${disciplineCount} disciplines seeded (Workday units registry)`);

  await seedAIProvidersAndModels();
  console.log('  AI providers and models seeded');

  await seedUsers();
  await seedPasswords();
  console.log(
    '  Users seeded (admin, 2 unit admins, 4 instructors, 2 TAs, 5 students with 8-digit IDs 10000001–10000005) with default password',
  );

  // Fail fast BEFORE any course row is written — a bad term literal must not
  // leave the DB partially seeded.
  assertCanonicalTerms(COURSES);
  await seedCourses();
  console.log(`  ${COURSES.length} courses seeded with topics, enrollments, and questions`);

  await seedBugReports();
  console.log('  Bug reports seeded');

  await seedChats();
  console.log('  Course-tagged + general chats seeded (instructor/unit-admin chat visibility)');

  await seedMaterials();
  console.log('  Course materials seeded (student view + TA manage gates)');

  // Sanity counts so the operator can see what they got.
  const [userCount, courseCount, topicCount, questionCount, enrollmentCount, bugCount, chatCount, materialCount] = await Promise.all([
    prisma.user.count(),
    prisma.course.count(),
    prisma.courseTopic.count(),
    prisma.question.count(),
    prisma.enrollment.count(),
    prisma.bugReport.count(),
    prisma.chat.count(),
    prisma.courseMaterial.count(),
  ]);

  console.log(
    `Seed complete — ${userCount} users, ${courseCount} courses, ${topicCount} topics, ` +
      `${questionCount} questions, ${enrollmentCount} enrollments, ${bugCount} bug reports, ` +
      `${chatCount} chats, ${materialCount} materials`,
  );
  console.log(`Cross-app links exported via SEED_IDS in apps/core/prisma/seed.ts`);
}

const isMainModule =
  process.argv[1] != null &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isMainModule) {
  main()
    .then(async () => {
      await prisma.$disconnect();
    })
    .catch(async (e) => {
      console.error('Seed failed:', e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
