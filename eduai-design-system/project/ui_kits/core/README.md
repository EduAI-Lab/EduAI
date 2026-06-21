# EduAI Core — UI Kit

High-fidelity interactive prototype of the EduAI Core student portal.

## What's included

| Screen | File | Notes |
|---|---|---|
| Login | `Auth.jsx` | Email/password form, GitHub OAuth stub, validation |
| Dashboard | `Dashboard.jsx` | Student view — stat cards, quick action grid |
| Chat | `Chat.jsx` | Welcome + prompt suggestions, live conversation |
| Courses | `Courses.jsx` | Enrolled course cards, Canvas sync stub |
| Sidebar | `Sidebar.jsx` | Dark navy nav, NavUser footer with role badge |

## Running the prototype

Open `index.html` directly in a browser. Requires internet (Google Fonts + React CDN).

1. **Login screen** — enter any email + password, click Sign in
2. **Dashboard** — greeting, 4 stat cards, 4 quick action cards
3. **Sidebar** — click Dashboard / Courses / Chat to navigate
4. **Chat** — click a prompt card or type a message; AI responds after ~1.2s
5. **Courses** — 3 enrolled courses; "Chat with AI" opens the chat screen

## Design accuracy

This kit recreates the **new design direction** (not the current live implementation):
- Sidebar: dark navy UBC Blue (vs current white)
- Primary brand color: UBC Blue `#002145` (adjusted from current `#002B5C`)
- UBC Gold accent bar above the login card
- Font: Outfit (same as production)
- Icons: Tabler-style inline SVGs

## Scope / caveats

- Auth is simulated — no real Better Auth calls
- Chat responses are static fake content — no real AI / RAG
- Course data is hardcoded — no Prisma / API calls
- Settings, Analytics, Reports are stub pages (navigate safely does nothing)
- Admin views (User Management, AI Management) are not shown — kit focuses on student role

## Source reference

Codebase: https://github.com/EduAI-Lab/EduAI
