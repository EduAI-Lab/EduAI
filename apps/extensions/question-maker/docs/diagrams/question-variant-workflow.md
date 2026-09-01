# Question Variant Creation Workflow

This diagram covers the manual/AI-assisted variant flow through the full-page composer
(`pages/QuestionComposerPage.tsx`, route `/courses/:courseId/questions/new?variantOf=<questionId>`),
which replaced the old `AddQuestionDialog` modal. The same composer also handles plain "new question"
and "edit" modes; this diagram follows the `variant` mode specifically.

```mermaid
flowchart TD
    Start([User clicks 'Create Variant'<br/>on a question in the bank]) --> Navigate[Router navigates to<br/>/courses/:courseId/questions/new?variantOf=questionId<br/>QuestionComposerPage mode = 'variant']

    Navigate --> LoadSource[Load source question<br/>questionService.getQuestion(sourceQuestionId)<br/>prefill form from its first variant<br/>QuestionComposerPage.tsx]

    LoadSource --> AddParams[User adjusts:<br/>- generationPrompt<br/>- generationModel<br/>- difficulty / reasoningLevel<br/>- provider API key if needed]

    AddParams --> ClickGenerate[User clicks 'Generate'<br/>handleGenerateWithAI]

    ClickGenerate --> ValidateParams{Validate:<br/>courseId resolved,<br/>prompt not empty}

    ValidateParams -->|Invalid| ShowError[Inline error message]
    ValidateParams -->|Valid| BuildRequest[Build request:<br/>promptWithTopics + base-question context<br/>+ MCQ choice-count rule (variant mode)<br/>difficultyDistribution, reasoningDistribution,<br/>apiKeys via apiKeyStorage.buildApiKeysForModel]

    BuildRequest --> CallFrontendService[eduaiService.generateQuestions<br/>app/frontend/src/services/eduaiService.ts]

    CallFrontendService --> BackendRoute[POST /api/eduai/generate-questions<br/>routes/eduai.js]

    BackendRoute --> Admission{aiAdmission middleware:<br/>rate limit + provider-call budget<br/>+ prompt/course validation}

    Admission -->|Rejected| ReturnError[400 / 429 / 504]
    Admission -->|Admitted| ResolveCourse[Resolve course + TA-rank access<br/>resolveEduAiCourse]

    ResolveCourse --> CallBackendService[eduaiService.generateQuestions<br/>services/eduaiService.js]

    CallBackendService --> BuildSystemPrompt[Build generation system+user prompt<br/>numQuestions, difficultyDistribution,<br/>reasoningDistribution, MCQ choice-count rule]

    BuildSystemPrompt --> CallEduAIAPI[POST EDUAI_API_URL/api/completion<br/>systemPrompt + messages, stateless<br/>eduaiService.chat()]

    CallEduAIAPI --> ParseResponse[Parse JSON response:<br/>strip markdown fences, extract<br/>balanced JSON, one retry with a<br/>stricter JSON-only repair prompt]

    ParseResponse --> NormalizeQuestions[Normalize: content, description,<br/>difficulty, reasoning_level, type,<br/>answer, choices, primary/secondary<br/>topic ids]

    NormalizeQuestions --> ReturnToFrontend[Return normalized questions]

    ReturnToFrontend --> UpdateForm[Populate composer form state<br/>set isAiGenerated = true]

    UpdateForm --> UserReview[User reviews / edits the<br/>generated text, choices, answer]

    UserReview --> OptIn[Optional: 'Mark as reviewed'<br/>and 'Usable by other extensions'<br/>checkboxes — instructor/admin only]

    OptIn --> ClickSave[User clicks 'Add variant'<br/>handleSave]

    ClickSave --> ValidateSave{Client validation:<br/>questionText non-empty,<br/>MCQ has >=2 choices + a correct answer}

    ValidateSave -->|Invalid| ShowSaveError[Scroll to first invalid field]
    ValidateSave -->|Valid| CreateVariant[questionService.createVariant<br/>POST /api/questions/:id/variants]

    CreateVariant --> BackendCreate[routes/variants.js<br/>requireQuestionAccess('ta')<br/>services/questionService.createVariant]

    BackendCreate --> SaveToDB[(Prisma write)]

    SaveToDB --> VariantsRow[variants table row:<br/>questionText, difficulty, reasoningLevel,<br/>answer, choices, selectAllThatApply,<br/>correctAnswers, referenceId (base variant),<br/>isAiGenerated, isDraft, shareWithExtensions]

    VariantsRow --> MaybePublish{Created already reviewed<br/>(isDraft: false)?}

    MaybePublish -->|Yes| Publish[services/variant-publish.js<br/>push to Core as a Question,<br/>link coreQuestionId, roll back<br/>to draft on any Core failure]
    MaybePublish -->|No| SkipPublish[Stays a draft — no Core push]

    Publish --> ReturnVariant[201 response]
    SkipPublish --> ReturnVariant

    ReturnVariant --> NavigateBack[navigate back to<br/>/courses/:courseId?tab=questions]

    style Start fill:#e1f5ff
    style SaveToDB fill:#fff4e1
    style VariantsRow fill:#fff4e1
    style CallEduAIAPI fill:#ffe1f5
    style ParseResponse fill:#ffe1f5
    style NormalizeQuestions fill:#ffe1f5
    style Publish fill:#f0e1ff
    style NavigateBack fill:#e1ffe1
```

## Key Components

### Frontend
- **`pages/QuestionComposerPage.tsx`** — the full-page create/variant/edit composer; owns form state,
  AI generation, and save orchestration.
- **`components/questions/QuestionAIControls.tsx`**, **`QuestionOutputPanel.tsx`** — the prompt/model
  picker and the stem/choices/answer editor.
- **`services/questionService.ts`**, **`services/eduaiService.ts`** — frontend API clients.

### Backend
- **`routes/eduai.js`** — `POST /api/eduai/generate-questions`, admission-controlled.
- **`services/eduaiService.js`** — builds the generation prompt and calls Core's `POST /api/completion`.
- **`routes/variants.js`** → **`services/questionService.js`** (`createVariant`, inside
  `withQuestionMutationFence`) — persistence and the §16/§19 RBAC rules.
- **`services/variant-publish.js`** — the publish-to-Core path when a variant is created already
  reviewed.

### Data Flow
1. **User input** → composer form state.
2. **AI request** → frontend service → `/api/eduai/generate-questions` → admission control →
   `eduaiService.generateQuestions` → Core `/api/completion`.
3. **AI response** → JSON parse (with one repair retry) → normalization → form populated for review.
4. **Save** → `POST /api/questions/:id/variants` → Prisma write → optional immediate Core publish.

### Normalized generation payload (per question)

```json
{
  "content": "The question text only (MCQ choices are separate)",
  "description": "Brief summary (<= 15 words)",
  "difficulty": "easy|medium|hard",
  "reasoning_level": "factual|analytical|application",
  "type": "MCQ|SA|LA",
  "answer": "The correct answer",
  "primary_topic_id": "number|null",
  "secondary_topic_ids": ["number", "..."],
  "choices": [{ "letter": "A", "text": "Option A" }]
}
```

### `variants` fields written on save

`questionText`, `difficulty`, `reasoningLevel`, `answer`, `choices` (MCQ only), `selectAllThatApply`,
`correctAnswers`, `assessmentId`, `secondaryTopicsId`, `referenceId` (points at the base variant this
one branched from), `isAiGenerated`, `isDraft`, `shareWithExtensions`, `createdBy`.
