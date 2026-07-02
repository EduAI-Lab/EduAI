# Skills & Slash Commands

Available slash commands in this project. Type `/` in Claude Code to invoke any of these.

---

## Project commands

### `/eduai-summer-2026:make-pr`
Guides you through creating a PR that follows EduAI conventions — linked issue, tests, TESTS.md, CHANGELOG.md, README, and MEMORY.md — then opens the PR via `gh`. Run this before every PR.

Source: `.claude/commands/eduai-summer-2026/make-pr.md`

---

## Built-in Claude Code skills

### Code quality
| Command | What it does |
|---|---|
| `/code-review` | Reviews the current diff for bugs and cleanups. Add `--fix` to apply fixes, `--comment` to post as inline PR comments. Use `ultra` for a deep multi-agent cloud review. |
| `/simplify` | Reviews changed code for reuse, simplification, and efficiency — then applies the fixes. |
| `/security-review` | Security review of pending changes on the current branch. |

### Verification
| Command | What it does |
|---|---|
| `/verify` | Runs the app and observes behavior to confirm a change actually works. |
| `/run` | Launches the project app so you can see a change in the browser. |
| `/review` | Reviews a pull request. |

### Project setup
| Command | What it does |
|---|---|
| `/init` | Generates a CLAUDE.md for the current codebase. |
| `/update-config` | Edits `settings.json` — use for hooks, permissions, and env vars. |
| `/keybindings-help` | Customize keyboard shortcuts in `~/.claude/keybindings.json`. |
| `/fewer-permission-prompts` | Scans recent transcripts and adds an allowlist to reduce approval prompts. |

### Automation
| Command | What it does |
|---|---|
| `/loop [interval] [command]` | Runs a command on a recurring interval (e.g. `/loop 5m /verify`). Omit interval to let Claude self-pace. |
| `/schedule` | Creates or manages scheduled cloud agents (cron-based routines). |

### Reference
| Command | What it does |
|---|---|
| `/claude-api` | Reference for the Claude API — model IDs, pricing, streaming, tool use, caching. Always use this before answering questions about Anthropic models or the SDK; never answer from memory. |
