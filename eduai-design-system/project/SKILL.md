---
name: eduai-design
description: Use this skill to generate well-branded interfaces and assets for EduAI — a UBC course-aware AI tutoring platform. Contains UBC brand guidelines, design tokens (oklch colors, Outfit typography, spacing/shadow scales), reusable UI components (Button, Badge, Input, Card, Avatar, Tabs), and a full interactive UI kit of the EduAI Core student portal.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.

Key files to read first:
- `readme.md` — full brand guide, visual foundations, content voice, iconography, accessibility rules
- `styles.css` — root import; link this in any prototype
- `tokens/colors.css` — all color tokens including UBC Blue, Gold, semantic and role colors
- `tokens/typography.css` — Outfit font, type scale
- `ui_kits/core/index.html` — interactive EduAI Core prototype (login → dashboard → chat → courses)

Critical design rules:
1. UBC Blue (`var(--primary)` = `oklch(0.198 0.060 259)` ≈ `#002145`) is the primary brand color — use for nav, primary buttons, headings
2. UBC Gold (`var(--gold)` = `oklch(0.882 0.188 89)` ≈ `#FFD100`) is DECORATIVE ONLY — never as text, never with white text on top (WCAG fail)
3. Sidebar should be dark navy (UBC Blue background, white text)
4. Font is Outfit (Google Fonts) — load via `@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap')`
5. Icons: @tabler/icons-react (primary); lucide-react (to be deprecated)
6. All colors in `oklch()` format for shadcn/ui compatibility
7. Minimum touch target: 44×44px (`--touch-target: 2.75rem`)
8. Assistive Mode (`[data-assistive] .reading-surface`) is a BREB-approved research feature — never break its CSS

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.
