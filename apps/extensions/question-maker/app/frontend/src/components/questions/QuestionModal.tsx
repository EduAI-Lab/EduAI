/**
 * Unified question modal. A single entry point that routes all modes to AddQuestionDialog.
 * `mode="view"` renders the detail/variant view; `mode="create"|"variant"` renders the editor.
 */
import type { ComponentProps } from 'react';
import { AddQuestionDialog } from './AddQuestionDialog';

export type QuestionModalProps = ComponentProps<typeof AddQuestionDialog>;

export function QuestionModal(props: QuestionModalProps) {
    return <AddQuestionDialog {...props} />;
}
