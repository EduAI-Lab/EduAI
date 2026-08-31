# Working memory

- The Question Maker new-question URL uses `QuestionComposerPage` and `ComposerMetadataFields`; changes to the older add-question dialog do not affect that route.
- Course topics created from AI Tutor and Question Maker authoring controls are written through the Core-backed topic API, then selected in the current form.
- Question Maker's shared `Toaster` has a dismiss button, and its app-level placement is top-right so it does not cover the sticky save actions.
