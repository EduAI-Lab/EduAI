# Course chat progress UI — visual QA (#1171)

Static gallery matching Core `ChatTypingIndicator` / `useChatProgress` stages for PR review.

The progress bar fills against an **expected response duration** (model / Assist / tools), with “About Xs left”, “Usually ~Ys”, and “Taking longer than usual” when past the estimate — so ADHD users can see how close they are without a fake exact %.

| File | State |
|------|--------|
| `01-routing.png` | Pre-token: Routing… + remaining estimate |
| `02-waiting-for-model.png` | Pre-token: Waiting for model… (timed fill) |
| `03-searching-materials.png` | Pre-token: Searching course materials… |
| `04-working-on-assist-reply.png` | Pre-token: Working on Assist reply… (longer estimate) |
| `05-streaming-tokens-no-status.png` | Tokens streaming — status hidden |
| `06-compact-searching-after-text.png` | Compact Searching… after earlier text |
| `07-compact-generating-post-tool.png` | Compact Generating… post-tool follow-up |
| `08-taking-longer-than-usual.png` | Past estimate — soft cap + longer-than-usual copy |
| `00-gallery-overview.png` | Full gallery overview |
| `qa-gallery.html` | Source HTML used to capture shots |

See PR #1204 / issue #1171.
