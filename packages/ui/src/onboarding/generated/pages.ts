// Generated from docs/ONBOARDING.md by scripts/generate-onboarding.mjs.
// Do not edit; run npm run onboarding:generate.
export const ONBOARDING_PAGES = {
  "core.courses": {
    "title": "Find your course",
    "task": "Open an enrolled course",
    "staffTask": "Find your teaching course",
    "steps": [
      {
        "id": "core.courses.Choose a course",
        "title": "Choose a course",
        "body": "Search or filter the course list, then open the right course. Students need an active enrollment and a published course."
      },
      {
        "id": "core.courses.Create when permitted",
        "title": "Create when permitted",
        "body": "Instructors and administrators can use Create course when policy allows it. A new course starts as Draft; prepare it before publishing."
      }
    ]
  },
  "core.course": {
    "title": "Check your course",
    "task": "Find your course chat",
    "staffTask": "Review the course's materials and topics",
    "steps": [
      {
        "id": "core.course.Check the course",
        "title": "Check the course",
        "body": "Confirm the course code, section and instructors. Students use Chat about this course to ask about the learning materials."
      },
      {
        "id": "core.course.Prepare learning materials",
        "title": "Prepare learning materials",
        "body": "If you manage this course, upload learning materials and wait for Ready. Review topic matches and approve suggestions before students use them."
      },
      {
        "id": "core.course.Check access",
        "title": "Check access",
        "body": "Course staff manage enrollments and publishing according to their permissions. A course must be published before enrolled students can see it."
      }
    ]
  },
  "core.chat": {
    "title": "Try course chat",
    "task": "Ask a course-aware question",
    "staffTask": "Test a question against your course materials",
    "steps": [
      {
        "id": "core.chat.Choose the context",
        "title": "Choose the context",
        "body": "Select the course before asking a question. Course Chat uses processed learning materials; Course Assistant is a separate staff tool for course administration."
      },
      {
        "id": "core.chat.Ask and check",
        "title": "Ask and check",
        "body": "Ask one clear question, then follow up in the same conversation. AI can be wrong; check important answers with your instructor or trusted learning resources."
      },
      {
        "id": "core.chat.Attach when useful",
        "title": "Attach when useful",
        "body": "You can attach supported documents, code, spreadsheets or images to a message. Wait for extraction to finish; these attachments do not add files to the course library."
      }
    ]
  },
  "core.settings": {
    "title": "Set your preferences",
    "task": "Review account and accessibility settings",
    "staffTask": "Review account settings and connect Canvas if needed",
    "steps": [
      {
        "id": "core.settings.Account and accessibility",
        "title": "Account and accessibility",
        "body": "Use Account to change your password (students also link their student number) and Accessibility to set your Core preferences. Accessibility settings in the other apps are separate."
      },
      {
        "id": "core.settings.Optional connections",
        "title": "Optional connections",
        "body": "The available tabs depend on your role and platform policy. Instructors can connect Canvas when permitted. Keep provider keys and Canvas tokens private."
      }
    ]
  },
  "core.help": {
    "title": "Find help",
    "task": "Find a guide and learn how to report a bug",
    "staffTask": "Find the instructor guide and reporting tools",
    "steps": [
      {
        "id": "core.help.Read the guide",
        "title": "Read the guide",
        "body": "Use Help for instructions matched to your role. Penny, when enabled, answers platform how-to questions from the indexed guides."
      },
      {
        "id": "core.help.Report a problem",
        "title": "Report a problem",
        "body": "Use Report a bug in the header. Include the app, page, expected result and actual result; diagnostics are optional. Never include passwords or API keys."
      }
    ]
  },
  "ai-tutor.courses": {
    "title": "Open a course",
    "task": "Open a published course",
    "staffTask": "Find your teaching course",
    "steps": [
      {
        "id": "ai-tutor.courses.Find the course",
        "title": "Find the course",
        "body": "Courses come from Core. If one is missing, confirm access and publication there; allow time for sync before retrying."
      },
      {
        "id": "ai-tutor.courses.Choose your workspace",
        "title": "Choose your workspace",
        "body": "Open a course from the list. The learner view shows published learning content; teaching and administration tools depend on your course access."
      }
    ]
  },
  "ai-tutor.course": {
    "title": "Explore course content",
    "task": "Choose a module",
    "staffTask": "Review a module",
    "steps": [
      {
        "id": "ai-tutor.course.Follow the structure",
        "title": "Follow the structure",
        "body": "A course contains modules, each containing lessons and activities. Start with the module your instructor recommends."
      },
      {
        "id": "ai-tutor.course.Prepare and publish",
        "title": "Prepare and publish",
        "body": "Authors can add modules and publish content. Students see content only when the relevant course and parent content are published; TAs do not gain authoring permissions."
      }
    ]
  },
  "ai-tutor.module": {
    "title": "Open a lesson",
    "task": "Choose a lesson",
    "staffTask": "Review a lesson",
    "steps": [
      {
        "id": "ai-tutor.module.Choose a lesson",
        "title": "Choose a lesson",
        "body": "Lessons group activities within this module. Open a lesson to work through its activities or review its setup."
      },
      {
        "id": "ai-tutor.module.Check visibility",
        "title": "Check visibility",
        "body": "Authors should review the lesson and its activities before publishing. Students cannot see drafts; ask your instructor if expected content is missing."
      }
    ]
  },
  "ai-tutor.lesson": {
    "title": "Work through an activity",
    "task": "Submit an answer and try guided help",
    "staffTask": "Review an activity's question and hints",
    "steps": [
      {
        "id": "ai-tutor.lesson.Read the activity",
        "title": "Read the activity",
        "body": "Read the question and the instructions before answering. Staff can review the configured activity; instructors also choose its tutoring modes."
      },
      {
        "id": "ai-tutor.lesson.Use guided help",
        "title": "Use guided help",
        "body": "The tutor supports learning; it is not an answer key. Available modes depend on the activity and platform settings."
      },
      {
        "id": "ai-tutor.lesson.Check your submission",
        "title": "Check your submission",
        "body": "Submit your answer and check its status. Short answers without an answer key need staff review; an ungraded answer is not evidence that your response was wrong."
      }
    ]
  },
  "ai-tutor.help": {
    "title": "Find learning support",
    "task": "Find the guide and reporting tools",
    "staffTask": "Find authoring and grading guidance",
    "steps": [
      {
        "id": "ai-tutor.help.Read role-specific help",
        "title": "Read role-specific help",
        "body": "Help explains learner, authoring and grading workflows. Staff can use the course Submissions area when their access permits it."
      },
      {
        "id": "ai-tutor.help.Report a problem",
        "title": "Report a problem",
        "body": "Use Report a bug for broken behavior. Include the activity and what happened, without private student data or credentials."
      }
    ]
  },
  "question-maker.courses": {
    "title": "Find your course",
    "task": "Open a course workspace",
    "staffTask": "Open a course workspace",
    "steps": [
      {
        "id": "question-maker.courses.Choose the course",
        "title": "Choose the course",
        "body": "Your courses come from Core; select the right course before creating content."
      },
      {
        "id": "question-maker.courses.Check access",
        "title": "Check access",
        "body": "If a course is missing, confirm your Core course access and allow time for synchronization. TAs can add draft questions and variants; only staff can mark them reviewed or build assessments."
      }
    ]
  },
  "question-maker.course": {
    "title": "Explore the workspace",
    "task": "Review the course workspace",
    "staffTask": "Review the course workspace",
    "steps": [
      {
        "id": "question-maker.course.Choose a workspace tab",
        "title": "Choose a workspace tab",
        "body": "Overview summarizes the course. Questions and Banks hold its questions, Assessments groups them, and Canvas, shown when the course is linked to Canvas, offers supported import and export flows."
      },
      {
        "id": "question-maker.course.Keep topics aligned",
        "title": "Keep topics aligned",
        "body": "Use course topics when organizing questions. If approval fails after a topic changes, refresh the course data and check the mapping."
      }
    ]
  },
  "question-maker.question": {
    "title": "Create a question",
    "task": "Create and review a question",
    "staffTask": "Create and review a question",
    "steps": [
      {
        "id": "question-maker.question.Write the question",
        "title": "Write the question",
        "body": "Set the question text, type, difficulty, topics and the required answer details. Check the course and bank before saving."
      },
      {
        "id": "question-maker.question.Review AI drafts",
        "title": "Review AI drafts",
        "body": "AI-assisted content is a draft. Check correctness, reasoning and topic assignment before approving or sharing it."
      }
    ]
  },
  "question-maker.assessment": {
    "title": "Build an assessment",
    "task": "Build and review an assessment",
    "staffTask": "Build and review an assessment",
    "steps": [
      {
        "id": "question-maker.assessment.Choose the scope",
        "title": "Choose the scope",
        "body": "Set the assessment topics when you want to restrict its scope. Questions outside those topics cannot be added while the restriction is active."
      },
      {
        "id": "question-maker.assessment.Arrange and review",
        "title": "Arrange and review",
        "body": "Organize the sections and questions, then review the saved assessment and any generated variants."
      },
      {
        "id": "question-maker.assessment.Export deliberately",
        "title": "Export deliberately",
        "body": "Use an available export action only after human review. Canvas export requires a working connection and access to the destination course."
      }
    ]
  },
  "question-maker.library": {
    "title": "Find saved questions",
    "task": "Find your saved question in the library",
    "staffTask": "Find your saved question in the library",
    "steps": [
      {
        "id": "question-maker.library.Find reusable content",
        "title": "Find reusable content",
        "body": "The Question Library is a cross-course view. Search or filter to locate a question you can access."
      },
      {
        "id": "question-maker.library.Check before reuse",
        "title": "Check before reuse",
        "body": "Review the question, answer and course/topic context before using it in another assessment. Reuse does not replace a correctness check."
      }
    ]
  }
} as const;
