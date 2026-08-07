# Future work

Ideas and improvements we may tackle over time. Nothing here is promised on a fixed schedule—this list helps us remember what matters next.

- **Password help for users** — Let people reset a forgotten password instead of only signing in.
- **Uploads from tricky files** — Handle scanned PDFs and long assignment instructions more reliably when pulling questions from documents.
- **Reliable automatic updates** — Keep the scheduled “pull latest code” process on the server working so new fixes actually reach production without extra manual steps.
- **Broader walkthrough testing** — Eventually try key flows in a real browser against test systems, not only quick automated checks.
- **Topic lists from EduAI** — Topics are still loaded using a stand-in for now. The plan is to fetch them from EduAI so they stay in sync and update as things change. EduAI does not have the right API working yet; expect to hook this up when that is ready.
- **EduAI sign-in that lasts** — The EduAI API key expires about once a month. Until there is a more permanent link between this app and EduAI, update the EduAI key in your local and production environment files every month, or EduAI features will stop working. A long-term, stable connection between the two services would be much better than monthly key changes.

