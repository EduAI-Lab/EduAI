import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  buildCourseScopePromptBlock,
  buildScopeConversationContext,
  buildScopeRefusalMessage,
  evaluateCourseScope,
  hasConversationCourseContext,
  hasCourseMetadataOverlap,
  hasCourseIntentSignals,
  hasScopeAffinityRagHits,
  isCourseScopeGateEnabled,
  isAnalogyOrConceptQuestion,
  isCareerOrPlatformTopic,
  isDirectOffTopicRequest,
  isEllipsisCourseFollowUp,
  isLearningIntentQuestion,
  isOffTopicDomain,
  isScopeAllowlisted,
  isSubstantiveForScope,
  shouldHardRefuseOffTopic,
} from "~/lib/ai/course-scope";

const COURSE = {
  code: "COSC 121",
  name: "Introduction to Programming",
  description: "First-year CS.",
  aiInstructions: "Be concise.",
  topics: ["loops", "arrays"],
};

const COSC101 = {
  code: "COSC 101",
  name: "Computer Studies",
  description: "Introductory computer science.",
  topics: ["computational thinking"],
};

const COSC121_SCREENSHOT_COURSE = {
  code: "COSC 121",
  name: "Computer Programming II",
  description: "Second-year programming course.",
  aiInstructions: null,
  topics: ["loops", "arrays", "functions"],
};

const IMAGE_COURSE = {
  code: "COSC 425",
  name: "Image Processing",
  description: "Filters, convolution, and vision pipelines.",
  aiInstructions: null,
  topics: ["convolution", "filters", "frequency domain"],
};

describe("isCourseScopeGateEnabled", () => {
  const original = process.env.CHAT_SCOPE_ZERO_CHUNK_GATE;

  afterEach(() => {
    if (original === undefined) delete process.env.CHAT_SCOPE_ZERO_CHUNK_GATE;
    else process.env.CHAT_SCOPE_ZERO_CHUNK_GATE = original;
  });

  it("defaults to enabled", () => {
    delete process.env.CHAT_SCOPE_ZERO_CHUNK_GATE;
    expect(isCourseScopeGateEnabled()).toBe(true);
  });

  it("disables when CHAT_SCOPE_ZERO_CHUNK_GATE=0", () => {
    process.env.CHAT_SCOPE_ZERO_CHUNK_GATE = "0";
    expect(isCourseScopeGateEnabled()).toBe(false);
  });
});

describe("isScopeAllowlisted", () => {
  it("allows greetings and thanks", () => {
    expect(isScopeAllowlisted("hi")).toBe(true);
    expect(isScopeAllowlisted("Hello there")).toBe(true);
    expect(isScopeAllowlisted("thanks!")).toBe(true);
  });

  it("allows meta questions", () => {
    expect(isScopeAllowlisted("What can you help me with?")).toBe(true);
  });
});

describe("hasCourseMetadataOverlap", () => {
  it("detects overlap with course topics when course intent is present", () => {
    expect(
      hasCourseMetadataOverlap("What does the lecture say about convolution?", IMAGE_COURSE),
    ).toBe(true);
  });

  it("detects overlap with explicit course code", () => {
    expect(hasCourseMetadataOverlap("Is COSC 121 hard?", COURSE)).toBe(true);
  });

  it("returns false for bare topic tokens without course intent", () => {
    expect(hasCourseMetadataOverlap("Tell me about arrays in music", COURSE)).toBe(false);
    expect(hasCourseMetadataOverlap("loops in roller coasters", COURSE)).toBe(false);
  });
});

describe("hasScopeAffinityRagHits", () => {
  it("accepts weak-but-present affinity hits (lower bar than inject)", () => {
    expect(
      hasScopeAffinityRagHits([
        { content: "binary notes", similarity: 0.38, materialTitle: "Lecture 1" },
      ]),
    ).toBe(true);
  });

  it("ignores very weak noise hits", () => {
    expect(
      hasScopeAffinityRagHits([
        { content: "noise", similarity: 0.15, materialTitle: "Syllabus" },
      ]),
    ).toBe(false);
  });
});

describe("hasConversationCourseContext", () => {
  it("allows follow-ups when prior assistant answered substantively", () => {
    expect(
      hasConversationCourseContext(
        {
          priorAssistantText:
            "Chapter 1 covers binary and ASCII data representation in computers.",
          priorUserText: "what is chapter 1 about?",
        },
        COSC101,
      ),
    ).toBe(true);
  });

  it("does not continue after a scope refusal", () => {
    expect(
      hasConversationCourseContext(
        {
          priorAssistantText:
            "I'm the assistant for COSC 101. I can't help with unrelated topics.",
          priorUserText: "recipe for cookies",
        },
        COSC101,
      ),
    ).toBe(false);
  });
});

describe("buildScopeConversationContext", () => {
  it("extracts prior user and assistant from thread", () => {
    const ctx = buildScopeConversationContext(
      [
        { role: "user", content: "what is chapter 1 about?" },
        {
          role: "assistant",
          content: "Chapter 1 introduces binary and ASCII.",
        },
        { role: "user", content: "why was ascii created?" },
      ],
      (m) => (typeof m?.content === "string" ? m.content : ""),
    );
    expect(ctx.priorUserText).toBe("what is chapter 1 about?");
    expect(ctx.priorAssistantText).toContain("binary");
  });
});

const COSC101_STUDY = {
  code: "COSC 101",
  name: "Computer Studies",
  description: "Introductory computer science.",
  topics: ["algorithms", "computational thinking", "data representation", "digital literacy"],
};

describe("isCareerOrPlatformTopic (#729 v2.3)", () => {
  it("detects career and LinkedIn pivots", () => {
    expect(isCareerOrPlatformTopic("can it help me get jobs")).toBe(true);
    expect(isCareerOrPlatformTopic("how can i network on linkedin")).toBe(true);
    expect(isCareerOrPlatformTopic("help me write a resume")).toBe(true);
  });

  it("does not flag CS networking vocabulary", () => {
    expect(isCareerOrPlatformTopic("what is a computer network protocol?")).toBe(false);
    expect(isCareerOrPlatformTopic("how does tcp/ip networking work?")).toBe(false);
  });
});

describe("isEllipsisCourseFollowUp (#729 v2.3)", () => {
  it("allows short conceptual follow-ups", () => {
    expect(isEllipsisCourseFollowUp("why was ascii created?")).toBe(true);
    expect(isEllipsisCourseFollowUp("who created binary?")).toBe(true);
    expect(isEllipsisCourseFollowUp("how does binary work?")).toBe(true);
  });

  it("rejects topic pivots even when phrased as questions", () => {
    expect(isEllipsisCourseFollowUp("how can i network on linkedin")).toBe(false);
    expect(isEllipsisCourseFollowUp("can it help me get jobs")).toBe(false);
  });
});

describe("crescendo drift regression (#729 v2.3)", () => {
  const studyThread = {
    priorAssistantText:
      "To get better at COSC 101, focus on algorithms, computational thinking, data representation, and digital literacy.",
    priorUserText: "how can i get better at this course",
  };

  beforeEach(() => {
    delete process.env.CHAT_SCOPE_ZERO_CHUNK_GATE;
  });

  it("allows the initial course-framed study question", () => {
    const result = evaluateCourseScope({
      message: "how can i get better at this course",
      hasCourse: true,
      hits: [],
      course: COSC101_STUDY,
    });
    expect(result.decision).toBe("allow");
  });

  it("refuses jobs pivot after a legitimate course thread", () => {
    const result = evaluateCourseScope({
      message: "can it help me get jobs",
      hasCourse: true,
      hits: [],
      course: COSC101_STUDY,
      conversation: studyThread,
    });
    expect(result.decision).toBe("refuse");
    expect(result.reason).toBe("off_course_career_platform");
  });

  it("refuses LinkedIn networking pivot after a legitimate course thread", () => {
    const jobsThread = {
      priorAssistantText:
        "Mastering computational thinking can enhance your job prospects in tech roles.",
      priorUserText: "can it help me get jobs",
    };
    const result = evaluateCourseScope({
      message: "how can i network on linkedin",
      hasCourse: true,
      hits: [],
      course: COSC101_STUDY,
      conversation: jobsThread,
    });
    expect(result.decision).toBe("refuse");
    expect(result.reason).toBe("off_course_career_platform");
  });

  it("still allows ascii/binary ellipsis follow-ups", () => {
    const chapterThread = {
      priorAssistantText:
        "Chapter 1 covers binary representation and ASCII encoding for characters.",
      priorUserText: "what is chapter 1 about?",
    };
    const result = evaluateCourseScope({
      message: "why was ascii created?",
      hasCourse: true,
      hits: [],
      course: COSC101_STUDY,
      conversation: chapterThread,
    });
    expect(result.decision).toBe("allow");
    expect(result.reason).toBe("conversation_continuity");
  });
});

describe("isLearningIntentQuestion", () => {
  it("detects why/who/how questions without keyword lists", () => {
    expect(isLearningIntentQuestion("why was ascii created?")).toBe(true);
    expect(isLearningIntentQuestion("who created binary?")).toBe(true);
    expect(isLearningIntentQuestion("what is binary")).toBe(true);
  });
});

describe("shouldHardRefuseOffTopic", () => {
  it("refuses deny-list topics with no course framing", () => {
    expect(
      shouldHardRefuseOffTopic({
        message: "How do I bake chocolate chip cookies?",
        hasCourse: true,
        hits: [],
        course: COURSE,
      }),
    ).toBe(true);
  });

  it("does not refuse same-topic follow-ups that are not on the deny-list", () => {
    expect(
      shouldHardRefuseOffTopic({
        message: "why was ascii created?",
        hasCourse: true,
        hits: [],
        course: COSC101,
        conversation: {
          priorAssistantText: "Chapter 1 covers binary and ASCII representation.",
          priorUserText: "what is chapter 1 about?",
        },
      }),
    ).toBe(false);
  });

  it("refuses direct recipe requests even when conversation is active (#729 v2.1)", () => {
    const digitalLiteracyThread = {
      priorAssistantText:
        "Digital literacy includes evaluating online information critically and using technology responsibly.",
      priorUserText:
        "so if im helping grandma use an ipad to find cookie recipes, is that like digital literacy?",
    };
    expect(
      shouldHardRefuseOffTopic({
        message: "tell me how to bake cookies",
        hasCourse: true,
        hits: [],
        course: COSC101,
        conversation: digitalLiteracyThread,
      }),
    ).toBe(true);
  });

  it("does not refuse analogy questions that mention deny-list terms", () => {
    expect(
      shouldHardRefuseOffTopic({
        message:
          "so if im helping grandma use an ipad to find cookie recipes, is that like digital literacy?",
        hasCourse: true,
        hits: [],
        course: COSC101,
      }),
    ).toBe(false);
  });
});

describe("isDirectOffTopicRequest", () => {
  it("detects recipe and how-to payload requests", () => {
    expect(isDirectOffTopicRequest("tell me how to bake cookies")).toBe(true);
    expect(isDirectOffTopicRequest("give me a chocolate chip cookie recipe")).toBe(true);
    expect(isDirectOffTopicRequest("Tell me about World War 2")).toBe(true);
  });

  it("returns false for analogy questions", () => {
    expect(
      isDirectOffTopicRequest(
        "is finding cookie recipes online an example of digital literacy?",
      ),
    ).toBe(false);
  });
});

describe("isAnalogyOrConceptQuestion", () => {
  it("detects comparison framing with deny-list terms", () => {
    expect(
      isAnalogyOrConceptQuestion(
        "so if im helping grandma use an ipad to find cookie recipes, is that like digital literacy?",
      ),
    ).toBe(true);
  });

  it("returns false for direct payload requests", () => {
    expect(isAnalogyOrConceptQuestion("tell me how to bake cookies")).toBe(false);
  });
});

describe("evaluateCourseScope — deny-list default (#729 v2)", () => {
  beforeEach(() => {
    delete process.env.CHAT_SCOPE_ZERO_CHUNK_GATE;
  });

  it("hard-refuses clearly off-topic deny-list prompts", () => {
    for (const message of [
      "How do I bake chocolate chip cookies?",
      "Tell me about World War 2",
      "What is the capital of France?",
      "How do I invest in stocks?",
      "i need to know how i can limit social media time",
    ]) {
      const result = evaluateCourseScope({
        message,
        hasCourse: true,
        hits: [],
        course: COURSE,
      });
      expect(result.decision).toBe("refuse");
      expect(["clearly_off_topic", "direct_off_topic_payload"]).toContain(result.reason);
    }
  });

  it("allows concept questions with zero RAG hits (fail-open)", () => {
    for (const message of [
      "why was ascii created?",
      "why does binary exist?",
      "who created binary?",
      "what is binary",
      "What is linear algebra?",
      "What is gradient descent?",
    ]) {
      const result = evaluateCourseScope({
        message,
        hasCourse: true,
        hits: [],
        course: COSC101,
      });
      expect(result.decision).toBe("allow");
    }
  });

  it("allows ascii/binary follow-ups via conversation continuity", () => {
    const conversation = {
      priorAssistantText:
        "Chapter 1 covers binary representation and ASCII encoding for characters.",
      priorUserText: "what is chapter 1 about?",
    };
    for (const message of ["why was ascii created?", "why does binary exist?"]) {
      const result = evaluateCourseScope({
        message,
        hasCourse: true,
        hits: [],
        course: COSC101,
        conversation,
      });
      expect(result.decision).toBe("allow");
      expect(result.reason).toBe("conversation_continuity");
    }
  });

  it("hard-refuses recipe payload after digital-literacy topic laundering (#729 v2.1)", () => {
    const conversation = {
      priorAssistantText:
        "Digital literacy includes evaluating online information and using technology responsibly.",
      priorUserText:
        "so if im helping grandma use an ipad to find cookie recipes, is that like digital literacy?",
    };
    const result = evaluateCourseScope({
      message: "tell me how to bake cookies",
      hasCourse: true,
      hits: [],
      course: COSC101,
      conversation,
    });
    expect(result.decision).toBe("refuse");
    expect(result.reason).toBe("direct_off_topic_payload");
  });

  it("allows analogy questions that mention deny-list terms", () => {
    const result = evaluateCourseScope({
      message:
        "so if im helping grandma use an ipad to find cookie recipes, is that like digital literacy?",
      hasCourse: true,
      hits: [],
      course: COSC101,
    });
    expect(result.decision).toBe("allow");
  });

  it("allows course-material intent without RAG hits", () => {
    const result = evaluateCourseScope({
      message: "What did chapter 3 say about trees?",
      hasCourse: true,
      hits: [],
      course: COURSE,
    });
    expect(result.decision).toBe("allow");
    expect(result.reason).toBe("course_material_intent");
  });

  it("allows generic coding requests without course keywords (Layer A handles scope)", () => {
    const result = evaluateCourseScope({
      message: "Write Python code to sort countries by population",
      hasCourse: true,
      hits: [],
      course: COURSE,
    });
    expect(result.decision).toBe("allow");
  });

  it("allows weak RAG affinity for grey-area questions", () => {
    const result = evaluateCourseScope({
      message: "why does binary exist?",
      hasCourse: true,
      hits: [{ content: "bits", similarity: 0.38, materialTitle: "Lecture 1" }],
      course: COSC101,
    });
    expect(result.decision).toBe("allow");
    expect(result.reason).toBe("scope_rag_affinity");
  });

  it("allowlists greetings without checking hits", () => {
    const result = evaluateCourseScope({
      message: "hello",
      hasCourse: true,
      hits: [],
      course: COURSE,
    });
    expect(result.decision).toBe("allow");
    expect(result.reason).toBe("allowlisted");
  });

  it("skips gate when disabled via env", () => {
    process.env.CHAT_SCOPE_ZERO_CHUNK_GATE = "0";
    const result = evaluateCourseScope({
      message: "How do I bake cookies?",
      hasCourse: true,
      hits: [],
      course: COURSE,
    });
    expect(result.decision).toBe("allow");
    expect(result.reason).toBe("gate_disabled");
  });
});

describe("superbolt08 screenshot regression (#729)", () => {
  const screenshotPrompts = [
    "i need to know how i can limit social media time",
    "why is it that walking everyday improves overall health?",
    "where was world war II held?",
    "how many people attended world war ii",
  ];

  beforeEach(() => {
    delete process.env.CHAT_SCOPE_ZERO_CHUNK_GATE;
  });

  it("flags screenshot prompts as off-topic domains", () => {
    for (const message of screenshotPrompts) {
      expect(isOffTopicDomain(message)).toBe(true);
    }
  });

  it("hard-refuses screenshot prompts with zero RAG hits", () => {
    for (const message of screenshotPrompts) {
      const result = evaluateCourseScope({
        message,
        hasCourse: true,
        hits: [],
        course: COSC121_SCREENSHOT_COURSE,
      });
      expect(result.decision).toBe("refuse");
      expect(result.reason).toBe("clearly_off_topic");
    }
  });

  it("hard-refuses screenshot prompts even when RAG returns moderate hits", () => {
    for (const message of screenshotPrompts) {
      const result = evaluateCourseScope({
        message,
        hasCourse: true,
        hits: [{ content: "noise", similarity: 0.62, materialTitle: "Syllabus" }],
        course: COSC121_SCREENSHOT_COURSE,
      });
      expect(result.decision).toBe("refuse");
      expect(result.reason).toBe("clearly_off_topic");
    }
  });
});

describe("buildCourseScopePromptBlock", () => {
  it("includes course identity, topics, instructions, and scope policy", () => {
    const block = buildCourseScopePromptBlock(COURSE);
    expect(block).toContain("COSC 121");
    expect(block).toContain("Introduction to Programming");
    expect(block).toContain("loops, arrays");
    expect(block).toContain("Be concise");
    expect(block).toContain("SCOPE POLICY");
    expect(block).toContain("foundational");
    expect(block).toContain("everyday example");
  });
});

describe("buildScopeRefusalMessage", () => {
  it("names the course and suggests course-aligned questions", () => {
    const msg = buildScopeRefusalMessage(COURSE);
    expect(msg).toContain("**COSC 121**");
    expect(msg).toContain("unrelated topics");
    expect(msg).toContain("lecture");
  });
});
