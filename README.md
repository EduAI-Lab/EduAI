# EduAICore

Monorepo for the EduAI platform — a suite of AI-powered educational tools built for UBC course delivery.

## Repository structure

```
EduAICore/
├── apps/
│   ├── core/                        # EduAI Core — RAG chat platform and central API
│   └── extensions/
│       ├── ai-tutor/                # AI Tutor — two-agent tutoring with hierarchical course content
│       └── question-maker/          # Question Maker — question bank authoring, Canvas integration
├── pkg/                             # Shared packages (in progress)
│   ├── config/
│   ├── db/
│   ├── ui/
│   └── util/
├── docs/                            # System-wide architecture and planning docs
├── CHANGELOG.md                     # Unified changelog across all apps
└── .gitignore
```

## Apps

### [EduAI Core](apps/core/)

RAG-powered chat platform and the central API layer for the EduAI ecosystem. Handles AI provider routing, course-aware retrieval, auth, and exposes the API that AI Tutor and Question Maker integrate with.

### [AI Tutor](apps/extensions/ai-tutor/)

AI tutoring platform with a two-agent supervisor system (primary tutor + pedagogical reviewer). Manages course hierarchies (CourseOffering → Module → Lesson → Activity) and student/professor/TA roles.

### [Question Maker](apps/extensions/question-maker/)

Full-stack tool for building course question banks and assessments. Supports AI-assisted question authoring, OCR upload, Canvas import/export, and assessment variant workflows.

## Shared packages

`pkg/` is reserved for shared code to be extracted as the monorepo matures (config, DB utilities, UI components, general utilities). Currently empty — shared code consolidation is planned.

## Docs

System-wide architecture and planning documents live in [`docs/`](docs/). App-specific docs live alongside each app under their own `docs/` directory.

| Document | Description |
|----------|-------------|
| [`platform-centralization-architecture-plan.md`](docs/platform-centralization-architecture-plan.md) | How Core, AI Tutor, and Question Maker are being centralized under a single API and auth layer |
| [`user-management-and-roles-architecture-plan.md`](docs/user-management-and-roles-architecture-plan.md) | Role hierarchy, permissions, and naming decisions across the platform — **on hold pending Canvas integration** |

## Changelog

All notable changes across apps are recorded in [`CHANGELOG.md`](CHANGELOG.md) at the monorepo root.

## Getting started

Each app is independently runnable. Navigate to the app directory and follow its own README:

```bash
# EduAI Core
cd apps/core && npm install

# AI Tutor
cd apps/extensions/ai-tutor && bun install

# Question Maker
cd apps/extensions/question-maker/app/backend && npm install
cd apps/extensions/question-maker/app/frontend && npm install
# or use Docker Compose from the question-maker root
```

## Git hooks

> **WIP:** Git hooks (currently in `apps/extensions/ai-tutor/.githooks/`) are being migrated to the monorepo root. Hook strategy is not yet finalized.
