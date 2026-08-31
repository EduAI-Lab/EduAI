# Working memory

- The Question Maker new-question URL uses `QuestionComposerPage` and `ComposerMetadataFields`; changes to the older add-question dialog do not affect that route.
- Course topics created from AI Tutor and Question Maker authoring controls are written through the Core-backed topic API, then selected in the current form.
- Question Maker's shared `Toaster` has a dismiss button, and its app-level placement is top-right so it does not cover the sticky save actions.
- RAG/AI source of truth: `docs/rag-ai/README.md` indexes current chat/RAG, embeddings, routing, vLLM, testing, performance, and development-server guidance; HELPME references in `FUTURE_WORK.md` describe potential upgrades, not shipped behavior.
- Deployment source of truth: `docs/DEPLOYMENT.md` is the index for local, s378, production, inference, backup, health, and rollback guidance; `infra/inference/cmps01.md`, `cmps02.md`, and `cmps03.md` are dated host snapshots and must be revalidated after infrastructure changes.
