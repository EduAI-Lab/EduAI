# EduAI: Monorepo Migration Proposal

> **This is a living document.** It is a work in progress and should be treated as a starting point, not a final answer. Any section can be revised, restructured, or replaced entirely as the team learns more and makes decisions together.

**Epic:** EduAICore #58  
**Last Updated:** May 10, 2026

---

## Summary

As EduAI scales, our current distributed repository structure consisting of **EduAI-Core**, **EduAI-Website**, **AI-Tutor**, and **Question-Maker** will introduce significant development and maintenance overhead. Code duplication, disjoint UI elements, and fragmented UI components make the project feel disconnected and introduce significant dependency issues for large pull requests.

I propose migrating to a **monorepo architecture** using **Turborepo** and separate package manager workspaces. Given our future plans for a nearly unified tech stack, this transition is highly feasible. My proposed "lift and shift" migration strategy will not block concurrent feature development.

---

## Current Architecture & Pain Points

Currently, EduAI relies on a polyrepo pattern. While this provided initial separation of concerns, it has created several critical bottlenecks:

* **Code Redundancy:** Project information, team data, and marketing copy are duplicated across *EduAI-Core* and *EduAI-Website*. Fixing a simple typo requires two separate pull requests and deployment pipelines.
* **UI Inconsistency:** Changes to foundational components (e.g., a Button or Dialog) in the Core application do not propagate to the Tutor or Question Maker apps, leading to visual drift.
* **Dependency Hell:** Maintaining synchronized versions of critical dependencies (like `react-router`, `better-auth`, and `prisma`) across four separate repositories is a major maintenance burden. Currently, we utilize both `better-auth` and JWT for authentication; these should be consolidated into a single auth endpoint in Core.
* **AI Context Walls:** Local AI development models cannot easily iterate and test across multiple disjoint repos and lack the necessary context for seamless integration.

---

## Proposed Architecture: The Monorepo

By consolidating into a single repository managed by **Turborepo**, we can establish isolated applications that securely consume shared internal packages.

### Key Benefits
1.  **Single Source of Truth:** A unified package can house the Prisma schema and client. All applications will query the exact same database definitions with guaranteed TypeScript type safety.
2.  **Shared UI Component Library:** We can extract our Tailwind components into a shared UI package. Building a component once allows it to be reused instantly across Core, Tutor, and Question Maker.
3.  **Atomic Commits:** A backend API change in Core and the corresponding frontend consumption in AI-Tutor can be submitted, reviewed, tested in CI, and deployed in a single atomic pull request.
4.  **Unified Tooling:** ESLint, Prettier, TypeScript, and Vite configurations can be managed at the root level, ensuring perfectly consistent code standards across all projects.

---

## Migration Strategy

To ensure the team is never blocked from working on features, we execute the migration incrementally:

### Phase 1: "Lift and Shift"
* Initialize the `EduAI-Monorepo` shell using Turborepo.
* Move the existing repositories directly into an `apps/` directory (`apps/core`, `apps/tutor`, `apps/question-maker`).
* **No logic changes are made.** Apps retain their individual `package.json` files and build processes. The team immediately switches to pushing code to the new repository.

This whole process should be extremely quick, to ensure minimal blockages. We'd decide on and allocate a small window of time to complete the migration.

### Phase 2: Unify Tooling
* Create a `packages/config` directory.
* Extract root `tsconfig.json`, Prettier, and ESLint configurations.
* Update all four apps to extend these shared configurations via atomic, non-breaking PRs.

### Phase 3: Core Infrastructure Extraction
* Create `packages/db` and migrate the `schema.prisma` from EduAI-Core.
* Create `packages/auth` to centralize our auth implementation.
* Refactor apps one-by-one to drop local DB/Auth logic and import shared internal packages.

### Phase 4: Shared UI Library
* Create `packages/ui`.
* Incrementally move common UI wrappers and Tailwind elements out of `apps/core/components` into the shared library.
* Update app imports to use the new unified design system.

---

## Conclusion

Migrating to a monorepo at this stage of development addresses our current pain points of code duplication and UI disconnects while setting a scalable foundation for future extensions. By using a phased approach, we can achieve this architectural upgrade without halting development.

### Further Reading

* [Monorepo.tools](https://monorepo.tools/)
* [Turborepo.dev](https://turborepo.dev/)