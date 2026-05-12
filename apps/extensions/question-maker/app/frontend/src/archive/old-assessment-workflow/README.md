# Old Assessment Workflow (Archived)

These components were the previous assessment view/builder UI. They have been replaced by the new Assessment Builder flow (`AssessmentBuilderPage`, `AssessmentBuilder`, `AssessmentSectionCard`, `AssessmentQuestionPicker`).

**Archived files:**
- `AssessmentViewPage.tsx` – Full assessment detail page (sections, create section panel, matching questions)
- `SectionCard.tsx` – Section card used in the old view
- `CreateSectionPanel.tsx` – Panel for creating/editing sections with filters
- `MatchingQuestionsPanel.tsx` – Panel listing matching questions for a section
- `assessmentViewUtils.ts` – Helpers for topic normalization, filter construction, draft helpers

The active app now uses `/assessments/:id/builder` only; `/assessments/:id` redirects to the builder. Shared types and `defaultReasoningData` remain in `pages/assessments/assessmentViewTypes.ts`. `MultiSelectDropdown` remains in `pages/assessments/` for use by `AssessmentQuestionPicker`.
