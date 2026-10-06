/**
 * Question Maker's page-level help copy for the header (?) button (#1754). One
 * entry per screen, plus one per course-workspace tab (the workspace is a
 * single route whose tab lives in `?tab=`). The full guide is an accordion
 * without hash deep links yet (#1055), so every entry links to `/help`.
 */
import { resolvePageHelp, type PageHelpContent, type PageHelpRoute } from "@eduai/ui";
import { resolveCourseTab, type ActiveTab } from "@/pages/course-detail/courseTabs";

const FALLBACK: PageHelpContent = {
  title: "Getting around Question Maker",
  summary:
    "Write and review questions, organize them into banks, and build assessments for your courses.",
  tips: ["Use the sidebar or ⌘K / Ctrl K to jump to any page or course."],
};

const COURSE_TABS = {
  overview: {
    title: "Course overview",
    summary: "A summary of this course's questions, banks and assessments.",
    tips: ["Use the tabs above to move between questions, banks and assessments."],
  },
  questions: {
    title: "Questions",
    summary: "Every question in this course. Add one by hand, with AI, or by uploading a PDF.",
    tips: [
      "New variants are drafts until you mark them reviewed. Drafts block exports.",
      "A question can have several variants — alternate versions of the same item.",
      "Upload Questions extracts questions from a PDF or image for you to review.",
    ],
  },
  banks: {
    title: "Question banks",
    summary: "Group questions into banks so you can reuse them across assessments.",
    tips: ["Open a bank to see and manage the questions in it."],
  },
  assessments: {
    title: "Assessments",
    summary: "Blueprints for quizzes and exams, built from sections of matching questions.",
    tips: [
      "Add Assessment starts a blueprint; open it to add sections and pick questions.",
      "Export to Canvas, Word or TXT once every question is reviewed (no drafts).",
    ],
  },
  canvas: {
    title: "Canvas",
    summary: "Move quizzes between this course and its linked Canvas course.",
    tips: ["Unsupported Canvas question types are skipped on import."],
  },
} satisfies Record<ActiveTab, PageHelpContent>;

const ROUTES: PageHelpRoute[] = [
  {
    match: "/dashboard",
    content: {
      title: "Dashboard",
      summary: "Your home base: your courses, key stats and recent activity.",
      tips: [
        "Courses you teach in Core are added automatically when you sign in.",
        "Take the tour below for a walkthrough of writing questions and building an assessment.",
      ],
    },
  },
  {
    match: "/courses",
    content: {
      title: "Courses",
      summary: "Every course you can write questions for. Open one to work in its question bank.",
      tips: ["Courses and their topics come from Core and stay in sync automatically."],
    },
  },
  {
    match: /\/questions\/new$/,
    content: {
      title: "New question",
      summary: "Write a question by hand, or describe what you need and let AI draft it.",
      tips: [
        "Tag the question's topics so assessments can find it later.",
        "Save with ⌘Enter (Ctrl Enter) when you're done.",
      ],
    },
  },
  {
    match: /\/questions\/[^/]+\/edit$/,
    content: {
      title: "Edit question",
      summary: "Update this question's wording, answers and topics.",
      tips: ["Save with ⌘Enter (Ctrl Enter) when you're done."],
    },
  },
  {
    match: /^\/courses\/[^/]+\/banks\/[^/]+$/,
    content: COURSE_TABS.banks,
  },
  {
    match:
      /^\/courses\/[^/]+\/assessments\/[^/]+\/variants$|^\/courses\/[^/]+\/assessments\/variants$/,
    content: {
      title: "Assessment variants",
      summary:
        "Build parallel versions of an assessment with the same structure but different question variants.",
      tips: ["Generate missing variants with AI where a section doesn't have enough."],
    },
  },
  {
    match: /^\/courses\/[^/]+\/assessments\/[^/]+$|^\/assessments\/[^/]+\/builder$/,
    content: {
      title: "Assessment builder",
      summary:
        "Add sections, set each one's question types, topics and difficulty, then pick matching questions.",
      tips: [
        "Save each section after picking its questions.",
        "Export is available once every question is reviewed (no drafts).",
      ],
    },
  },
  {
    match: "/library",
    content: {
      title: "Question library",
      summary: "Questions from every course you have access to, in one searchable place.",
      tips: [
        "Search, or filter by type, difficulty or draft status, to narrow the list.",
        "Authoring happens inside a course — click a row here for a read-only preview.",
      ],
    },
  },
  {
    match: "/settings",
    content: {
      title: "Settings",
      summary: "Your appearance and accessibility preferences, and your AI model API keys.",
      tips: ["You can also switch light and dark mode from the header on any page."],
    },
  },
  {
    match: "/help",
    content: {
      title: "Help",
      summary: "The full written guide to Question Maker. Search it or open any topic.",
      tips: ["The (?) button on every page shows help for just that page."],
    },
  },
  {
    match: "/admin/bug-reports",
    content: {
      title: "Bug reports",
      summary: "Reports submitted from Question Maker, with their screenshots and logs.",
    },
  },
];

/**
 * Page help for the current location. `search` is the URL query string, used
 * only to pick the course workspace's active tab.
 */
export function getQmPageHelp(pathname: string, search = ""): PageHelpContent {
  if (/^\/courses\/[^/]+$/.test(pathname)) {
    const tab = new URLSearchParams(search).get("tab");
    // Canvas linkage isn't known here; `null` keeps a requested canvas tab.
    return COURSE_TABS[resolveCourseTab(tab, null)];
  }
  return resolvePageHelp(pathname, ROUTES, FALLBACK);
}

/**
 * Help for the access-restricted shell (`QmAccessShell`). Every QM route —
 * `/help` included — renders that shell for a user without a QM role, so the
 * guide link points at Core's help page instead (set by the caller).
 */
export const QM_ACCESS_HELP: PageHelpContent = {
  title: "Access restricted",
  summary:
    "Question Maker is for instructors, administrators and assigned teaching assistants. Students use EduAI Core and AI Tutor for coursework.",
  tips: [
    "Use Back to EduAI in the sidebar to return to your dashboard.",
    "If you teach a course and expected access, ask an administrator to check your role.",
  ],
};
