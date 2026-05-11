# Canvas Import Assessment - Feasibility Analysis

## Executive Summary

The existing export infrastructure provides a solid foundation for implementing the reverse operation. The Canvas API supports fetching assignments/quizzes and their questions, and the conversion logic can be reversed.

---

## Current Export Logic Analysis

### Export Flow

1. **Data Source**: Assessment → Sections → SectionVariants → Variants → QuestionMetadata
2. **Canvas Target**: Quiz (quiz_type: 'assignment') → Questions
3. **API Endpoints Used**:
   - `POST /api/v1/courses/{course_id}/quizzes` - Creates quiz
   - `POST /api/v1/courses/{course_id}/quizzes/{quiz_id}/questions` - Creates questions

### Export Conversion Logic

The `convertVariantToCanvasQuestion` function maps:
- **MCQ Questions** → `multiple_choice_question` with parsed options (A, B, C, D format)
- **Short Answer Questions** → `short_answer_question` 
- **Long Answer Questions** → `essay_question`

Key details:
- Question text includes options in format: `"Question text\nA) Option A\nB) Option B..."`
- Answer field contains correct answer (e.g., "B" or "B) Option B")
- Questions maintain position/order
- Section names are included in question names

---

## Import Feasibility Assessment

### ✅ **Infrastructure Already Exists**

1. **Canvas Integration**: 
   - `makeCanvasRequest()` function handles API calls
   - Supports both real API and test mode
   - Authentication/authorization already configured

2. **Data Models**:
   - All required models exist: `Assessments`, `AssessmentSections`, `SectionVariants`, `Variants`, `Question_Metadata`
   - Service functions exist for creating these entities

3. **API Infrastructure**:
   - Canvas routes already set up
   - Error handling patterns established

### ✅ **Canvas API Support**

Canvas API provides the following endpoints for import:

1. **Get Assignments/Quizzes**:
   - `GET /api/v1/courses/{course_id}/assignments` - Lists all assignments
   - `GET /api/v1/courses/{course_id}/quizzes` - Lists all quizzes
   - Both support filtering by type

2. **Get Quiz Questions**:
   - `GET /api/v1/courses/{course_id}/quizzes/{quiz_id}/questions` - Gets all questions in a quiz

3. **Get Assignment Details**:
   - `GET /api/v1/courses/{course_id}/assignments/{id}` - Gets assignment details

### ✅ **Reverse Conversion is Possible**

The conversion logic can be reversed:

| Canvas Question Type | → | Project Question Type |
|---------------------|---|----------------------|
| `multiple_choice_question` | → | `MCQ` |
| `short_answer_question` | → | `SA` (Short Answer) |
| `essay_question` | → | `LA` (Long Answer) |
| `true_false_question` | → | `MCQ` (with 2 options) |
| `fill_in_multiple_blanks_question` | → | `SA` (with parsing) |

---

## Implementation Approach

### Required Components

#### 1. **Backend Service Functions** (`canvasService.js`)

```javascript
// New functions needed:
- getCanvasQuizzes(userId, canvasCourseId) 
  // GET /api/v1/courses/{course_id}/quizzes

- getCanvasQuizQuestions(userId, canvasCourseId, quizId)
  // GET /api/v1/courses/{course_id}/quizzes/{quiz_id}/questions

- importQuizFromCanvas(userId, canvasCourseId, quizId, localCourseId, options)
  // Main import function

- convertCanvasQuestionToVariant(canvasQuestion, position)
  // Reverse of convertVariantToCanvasQuestion
```

#### 2. **Data Structure Mapping**

**Canvas Quiz → Local Assessment:**
- `quiz.title` → `assessment.name`
- `quiz.description` → `assessment.description`
- `quiz.quiz_type` → Used to determine assessment type
- Quiz questions → Assessment sections → Variants

**Canvas Question → Local Variant:**
- `question.question_text` → `variant.questionText`
- `question.question_type` → `questionMetadata.type`
- `question.answers` → Parsed for MCQ options or answer text
- `question.position` → `sectionVariant.displayOrder`

#### 3. **Conversion Logic**

**For MCQ Questions:**
```javascript
// Canvas format:
{
  question_type: 'multiple_choice_question',
  answers: [
    { answer_text: 'Option A', answer_weight: 0 },
    { answer_text: 'Option B', answer_weight: 100 }, // Correct
    { answer_text: 'Option C', answer_weight: 0 },
    { answer_text: 'Option D', answer_weight: 0 }
  ]
}

// Convert to:
questionText: "Question text\nA) Option A\nB) Option B\nC) Option C\nD) Option D"
answer: "B) Option B" // or just "B"
```

**For Short/Essay Questions:**
```javascript
// Canvas format:
{
  question_type: 'short_answer_question',
  answers: [{ answer_text: 'Correct answer', answer_weight: 100 }]
}

// Convert to:
questionText: "Question text"
answer: "Correct answer"
```

#### 4. **API Routes** (`routes/canvas.js`)

```javascript
// New routes needed:
GET  /api/canvas/courses/:canvasCourseId/quizzes
GET  /api/canvas/courses/:canvasCourseId/quizzes/:quizId/questions
POST /api/canvas/import/:canvasCourseId/quizzes/:quizId
```

#### 5. **Frontend Components**

- `CanvasImportDialog.tsx` - Similar to `CanvasExportDialog.tsx`
  - Course selection
  - Quiz/Assignment selection
  - Import options (create new assessment vs. add to existing)
  - Progress indicators

- Update `canvasService.ts` with import functions

---

## Challenges & Considerations

### 1. **Data Loss During Round-Trip**

Some information may be lost when exporting then importing:
- **Section structure**: Canvas doesn't have sections, so all questions go into one section
- **Question metadata**: Topics, difficulty settings, reasoning levels not preserved
- **Variant relationships**: Reference links between variants lost
- **Blueprint config**: Assessment blueprint configuration not in Canvas

**Mitigation**: 
- Store metadata in Canvas quiz description or question comments
- Use Canvas custom fields if available
- Accept that some data will need manual re-entry

### 2. **Question Type Mapping**

Not all Canvas question types map cleanly:
- `true_false_question` → Can map to MCQ with 2 options
- `fill_in_multiple_blanks_question` → Complex, may need special handling
- `matching_question` → No direct equivalent
- `numerical_question` → May map to SA

**Solution**: Support most common types, warn about unsupported types

### 3. **MCQ Option Format**

Export embeds options in question text. Import needs to:
- Extract options from Canvas `answers` array
- Reconstruct question text with options
- Determine correct answer from `answer_weight`

**Solution**: Reverse the `parseMCQOptions` logic

### 4. **Course Mapping**

Need to map Canvas course to local course:
- Use existing `CanvasCourseMapping` table
- Allow user to select target local course during import
- Handle case where mapping doesn't exist

### 5. **Assessment Type Determination**

Canvas quizzes don't have explicit "assessment type" field:
- Could infer from quiz settings (timed, attempts, etc.)
- Could use quiz description metadata
- Default to a generic type or let user specify

### 6. **Question Ordering**

Canvas questions have `position` field, which can be used to maintain order.

### 7. **Test Mode Support**

Should support test mode with mock data for development.

---

## Recommended Implementation Plan

### Phase 1: Core Import Functionality
1. Add `getCanvasQuizzes()` function
2. Add `getCanvasQuizQuestions()` function  
3. Add `convertCanvasQuestionToVariant()` function
4. Add `importQuizFromCanvas()` main function
5. Add API routes

### Phase 2: Frontend Integration
1. Create `CanvasImportDialog` component
2. Add import button to assessments page
3. Add import functions to `canvasService.ts`
4. Handle import options (new assessment vs. existing)

### Phase 3: Edge Cases & Polish
1. Handle unsupported question types gracefully
2. Add validation and error messages
3. Support test mode
4. Add import history/tracking
5. Handle duplicate imports

### Phase 4: Advanced Features (Optional)
1. Import assignments (not just quizzes)
2. Batch import multiple quizzes
3. Preserve metadata in Canvas description/comments
4. Two-way sync tracking

---

## Data Flow Comparison

### Export Flow (Current)
```
Local Assessment
  ↓
Sections → SectionVariants → Variants
  ↓
convertVariantToCanvasQuestion()
  ↓
Canvas Quiz → Canvas Questions
```

### Import Flow (Proposed)
```
Canvas Quiz → Canvas Questions
  ↓
getCanvasQuizQuestions()
  ↓
convertCanvasQuestionToVariant()
  ↓
Create: Assessment → Section → SectionVariants → Variants → QuestionMetadata
```

---

## Conclusion

**Import functionality is highly feasible** because:

1. ✅ Canvas API fully supports fetching quizzes and questions
2. ✅ Existing infrastructure (API client, models, services) can be reused
3. ✅ Conversion logic is reversible
4. ✅ Data models support the required structure

**Main challenges:**
- Some data loss (sections, metadata) - acceptable trade-off
- Question type mapping for edge cases
- Need to handle course mapping

**Recommendation**: Proceed with implementation. Start with Phase 1 to validate the approach, then iterate based on user feedback.

---

## Next Steps

1. Review this assessment with the team
2. Prioritize which Canvas question types to support initially
3. Decide on metadata preservation strategy
4. Create detailed technical specification
5. Begin Phase 1 implementation

