/**
 * Header for the question bank list with add/upload actions and course context.
 * Shows counts and disables actions when appropriate.
 */
import { Button } from '../ui/button';
import { Tooltip } from '../ui/tooltip';
import { Plus, Upload } from 'lucide-react';

interface QuestionBankHeaderProps {
  questionCount: number;
  onAddQuestion: () => void;
  onUploadQuestions: () => void;
  courseName?: string;
  disableAdd?: boolean;
  disableUpload?: boolean;
}

export const QuestionBankHeader = ({
  questionCount,
  onAddQuestion,
  onUploadQuestions,
  courseName,
  disableAdd = false,
  disableUpload = false
}: QuestionBankHeaderProps) => {
  return (
    <div className="space-y-4">
      {/* Main Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">
            {courseName ? `Active Course: ${courseName}` : 'Select a course to view questions'}
          </h2>
          <p className="text-sm text-gray-600">Question Bank</p>
        </div>
        <div className="flex items-center gap-2">
          <Tooltip content="Upload a document of your questions to have it added to your question bank" side="bottom">
            <Button
              variant="outline"
              onClick={onUploadQuestions}
              className="flex items-center space-x-2"
              disabled={disableUpload}
              data-tour-id="upload-questions-btn"
            >
              <Upload className="h-4 w-4" />
              <span>Upload Questions</span>
            </Button>
          </Tooltip>
          <Tooltip content="Create a new question manually or with AI assistance" side="bottom">
            <Button
              onClick={onAddQuestion}
              className="flex items-center space-x-2"
              disabled={disableAdd}
              data-tour-id="add-question-btn"
            >
              <Plus className="h-4 w-4" />
              <span>Add Question</span>
            </Button>
          </Tooltip>
        </div>
      </div>

      {/* Question Count and Filter Status */}
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">
          Questions ({questionCount})
        </h3>
      </div>
    </div>
  );
};
