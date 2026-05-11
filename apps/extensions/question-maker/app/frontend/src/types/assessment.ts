/**
 * Assessment type re-exports and helper interfaces to avoid circular imports from question.ts.
 */
// Import types from question.ts to avoid circular dependencies
import { 
  Assessment, 
  AssessmentType, 
  QuestionVariant, 
  ReasoningProfile, 
  ReasoningDataState,
  AssessmentBlueprintConfig,
  AssessmentGenerationParams
} from './question';

export { 
  Assessment, 
  AssessmentType, 
  QuestionVariant,
  ReasoningProfile,
  ReasoningDataState,
  AssessmentBlueprintConfig,
  AssessmentGenerationParams
};

export interface AssessmentCreate {
  type: AssessmentType;
  name: string;
  semester: string;
}

export interface AssessmentWithQuestions extends Assessment {
  questions: QuestionVariant[];
}
