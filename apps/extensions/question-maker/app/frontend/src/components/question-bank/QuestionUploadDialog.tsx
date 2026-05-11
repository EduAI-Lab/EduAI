/**
 * Dialog for uploading PDF, image, or TXT files; runs OCR for PDF/image or uses text as-is for TXT, then extracts questions via the AI service.
 * Manages draft review, topic selection, optional assessment creation, and save flows.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Tesseract from 'tesseract.js';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/legacy/build/pdf';
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker?url';
import { UploadCloud, FileText, Loader2, Trash2, Copy as CopyIcon, RefreshCcw, ChevronDown, ChevronUp, History } from 'lucide-react';

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '../ui/dialog';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '../ui/alert-dialog';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { ScrollArea } from '../ui/scroll-area';
import { Progress } from '../ui/progress';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Tooltip } from '../ui/tooltip';
import { useToast } from '../ui/use-toast';
import { useEduAIStatus } from '../../hooks/useEduAIStatus';
import { EduAIStatusBadge } from '../eduai/EduAIStatusBadge';

import { ExtractedQuestion, MCQChoice, Question, QuestionDifficulty, QuestionType } from '../../types/question';
import { MCQChoicesField } from '../questions/MCQChoicesField';
import { Topic } from '../../types/topic';
import { questionService } from '../../services/questionService';
import { eduaiService, EduAIModelOption } from '../../services/eduaiService';
import { apiKeyStorage } from '../../services/apiKeyStorage';
import { useOCRHistory } from '../../hooks/use-ocr-history';
import { OCRHistoryPanel } from '../ocr/OCRHistoryPanel';
import { UnsavedChangesDialog } from '../ocr/UnsavedChangesDialog';
import type { OCRJob, StoredQuestion } from '../../types/ocr';

// Configure PDF.js worker
// In production, use CDN to avoid issues with worker file path resolution
// In development, use the local worker file
// This fixes the "Failed to fetch dynamically imported module" error in production
const isProduction = typeof window !== 'undefined' && 
    (window.location.hostname !== 'localhost' && !window.location.hostname.startsWith('127.0.0.1'));

if (isProduction) {
    // Use jsDelivr CDN in production for reliability
    // Version 4.10.38 matches the installed pdfjs-dist package version
    GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
} else {
    // Use local worker in development
    GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
}

type DraftQuestion = Required<Pick<ExtractedQuestion, 'question'>> &
    Omit<ExtractedQuestion, 'question'> & {
        id: string;
        instructions?: string;
        difficulty: QuestionDifficulty;
        answer?: string | null;
        type: QuestionType;
        summary: string;
        primaryTopicId: number | null;
        secondaryTopicIds: number[];
        include: boolean;
    };

const difficultyOptions: QuestionDifficulty[] = ['easy', 'medium', 'hard'];
const questionTypes: QuestionType[] = ['SA', 'MCQ', 'LA'];
const questionTypeLabels: Record<QuestionType, string> = {
    MCQ: 'Multiple Choice',
    SA: 'Short Answer',
    LA: 'Long Answer'
};
const assessmentTypes = ['Assignment', 'Lab', 'Quiz', 'Midterm', 'Final'] as const;

/** Callback when background extraction finishes (so the parent can update OCR job status). */
export type OnExtractionComplete = (
    status: 'success' | 'error',
    extras?: { error?: string; questionsCount?: number }
) => void;

/** Params for starting extraction in the background (modal closes, parent runs API and shows toasts). */
export interface BackgroundExtractionParams {
    text: string;
    courseId: number;
    model: string;
    apiKeys: Record<string, unknown>;
    /** OCR history job id — parent should call onExtractionComplete so the job is marked success/error. */
    jobId: string;
    /** Called with outcome so the dialog can update the job (e.g. mark failed when API errors). */
    onExtractionComplete?: OnExtractionComplete;
}

interface QuestionUploadDialogProps {
    open: boolean;
    onClose: () => void;
    courseId: number | null;
    courseName?: string;
    topics: Topic[];
    onEnsureTopics: (courseId: number) => Promise<Topic[]>;
    onQuestionsSaved: (questions: Question[], meta?: { assessmentId: number | null }) => void;
    /** When set, extraction runs in parent; modal closes and toasts show progress/result. */
    onExtractInBackground?: (params: BackgroundExtractionParams) => void;
    /** Pre-filled drafts when opening for review after background extraction (e.g. from toast "View"). */
    initialDraftQuestions?: DraftQuestion[] | null;
    /** `bank` = save questions to the question bank only (no assessment). `assessment` = default behavior. */
    saveTarget?: 'bank' | 'assessment';
}

const generateId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return Math.random().toString(36).slice(2, 11);
};

/** Maps API extracted questions to draft shape. Used by dialog and by parent for background extraction. */
export function mapExtractedToDraftQuestions(items: ExtractedQuestion[]): DraftQuestion[] {
    return items
        .filter((item): item is ExtractedQuestion & { summary: string } =>
            Boolean(
                item.question?.trim() &&
                item.summary?.trim()
            )
        )
        .map((item) => {
            const primaryCandidate = item.primaryTopicId !== undefined && item.primaryTopicId !== null
                ? Number(item.primaryTopicId)
                : null;
            const primaryTopicId = Number.isInteger(primaryCandidate) ? primaryCandidate : null;
            const secondaryTopicIds = Array.isArray(item.secondaryTopicIds)
                ? Array.from(
                    new Set(
                        item.secondaryTopicIds
                            .map((v) => Number(v))
                            .filter((v) => Number.isInteger(v) && v !== primaryTopicId)
                    )
                )
                : [];
            const isMCQ = item.type === 'MCQ';
            const defaultChoices: MCQChoice[] = [{ letter: 'A', text: '' }, { letter: 'B', text: '' }, { letter: 'C', text: '' }, { letter: 'D', text: '' }];
            const normalizedChoices: MCQChoice[] | null =
                isMCQ && Array.isArray(item.choices) && item.choices.length >= 2
                    ? item.choices.map((c: { letter?: string; text?: string }) => ({
                        letter: typeof c.letter === 'string' ? c.letter.trim().toUpperCase() || 'A' : 'A',
                        text: typeof c.text === 'string' ? c.text.trim() : String(c.text ?? '')
                    })).filter((c: MCQChoice) => c.text.length > 0)
                    : null;
            const choices: MCQChoice[] | null = isMCQ ? (normalizedChoices && normalizedChoices.length >= 2 ? normalizedChoices : defaultChoices) : null;
            return {
                id: (item as { id?: string }).id ?? generateId(),
                question: item.question.trim(),
                instructions: item.instructions?.trim() ?? '',
                difficulty: item.difficulty && ['easy', 'medium', 'hard'].includes(item.difficulty) ? (item.difficulty as QuestionDifficulty) : 'medium',
                answer: item.answer ?? '',
                type: item.type && ['MCQ', 'SA', 'LA'].includes(item.type) ? (item.type as QuestionType) : 'SA',
                summary: item.summary.trim(),
                primaryTopicId,
                secondaryTopicIds,
                choices,
                include: (item as { include?: boolean }).include !== false
            };
        });
}

const isPdfFile = (file: File) =>
    file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

const isImageFile = (file: File) =>
    file.type.startsWith('image/') ||
    /\.(png|jpg|jpeg|gif|bmp|webp)$/i.test(file.name);

const isTextFile = (file: File) =>
    file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt');

/** PDF.js text item: str and optional hasEOL, transform (matrix with x=transform[4], y=transform[5]). */
type PdfTextItem = { str?: string; hasEOL?: boolean; transform?: number[] };

/**
 * Converts PDF.js getTextContent() items to plain text with line breaks preserved.
 * Uses hasEOL when present; otherwise groups by Y position so "Question 1" and "(a)" stay on separate lines.
 */
function pdfItemsToTextWithLineBreaks(items: PdfTextItem[]): string {
    if (!items?.length) return '';
    const parts: string[] = [];
    let hadEOL = false;
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const str = typeof item?.str === 'string' ? item.str : '';
        if (str) parts.push(str);
        const useEOL = Boolean(item?.hasEOL);
        if (useEOL) {
            parts.push('\n');
            hadEOL = true;
        } else if (str) {
            parts.push(' ');
        }
    }
    if (hadEOL) return parts.join('').replace(/\n+/g, '\n').replace(/\s+$/gm, '').trim();
    return pdfItemsToTextByPosition(items);
}

function pdfItemsToTextByPosition(items: PdfTextItem[]): string {
    const withPos = items
        .filter((item) => typeof item?.str === 'string' && item.str.length > 0)
        .map((item) => {
            const y = Array.isArray(item.transform) && item.transform.length >= 6 ? item.transform[5] : 0;
            const x = Array.isArray(item.transform) && item.transform.length >= 5 ? item.transform[4] : 0;
            return { str: (item as { str: string }).str, x, y };
        });
    if (withPos.length === 0) return '';
    const tol = 2;
    const lines: { y: number; chunks: { x: number; str: string }[] }[] = [];
    for (const { str, x, y } of withPos) {
        const line = lines.find((l) => Math.abs(l.y - y) <= tol);
        if (line) {
            line.chunks.push({ x, str });
        } else {
            lines.push({ y, chunks: [{ x, str }] });
        }
    }
    lines.sort((a, b) => b.y - a.y);
    return lines
        .map((line) => {
            line.chunks.sort((a, b) => a.x - b.x);
            return line.chunks.map((c) => c.str).join(' ');
        })
        .join('\n');
}

export const QuestionUploadDialog = ({
    open,
    onClose,
    courseId,
    courseName,
    topics: providedTopics,
    onEnsureTopics,
    onQuestionsSaved,
    onExtractInBackground,
    initialDraftQuestions,
    saveTarget = 'assessment'
}: QuestionUploadDialogProps) => {
    const { toast } = useToast();

    const [topics, setTopics] = useState<Topic[]>(providedTopics);
    const [primaryTopicId, setPrimaryTopicId] = useState<string>('');
    const [newTopicName, setNewTopicName] = useState('Uploaded Questions');
    const [draftQuestions, setDraftQuestions] = useState<DraftQuestion[]>([]);
    const [processingStage, setProcessingStage] = useState<'idle' | 'ocr' | 'extracting' | 'review' | 'saving'>('idle');
    const [progress, setProgress] = useState<number>(0);
    const [error, setError] = useState<string | null>(null);
    const [lastFileName, setLastFileName] = useState<string>('');
    const [assessmentType, setAssessmentType] = useState<typeof assessmentTypes[number]>('Assignment');
    const [assessmentName, setAssessmentName] = useState('Uploaded Assessment');
    const [assessmentSemester, setAssessmentSemester] = useState(() => {
        const now = new Date();
        const year = now.getFullYear();
        return `Fall ${year}`;
    });
    const [availableModels, setAvailableModels] = useState<EduAIModelOption[]>([]);
    const [aiModel, setAiModel] = useState('ollama:gpt-oss:120b');
    const [providerApiKey, setProviderApiKey] = useState('');
    const [uploadSectionCollapsed, setUploadSectionCollapsed] = useState(true);
    const [showHistoryPanel, setShowHistoryPanel] = useState(false);
    const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
    const [showClearHistoryConfirm, setShowClearHistoryConfirm] = useState(false);
    const [pendingRestoreJob, setPendingRestoreJob] = useState<OCRJob | null>(null);
    const [currentJobId, setCurrentJobId] = useState<string | null>(null);

    const {
        jobs: ocrJobs,
        addJob,
        updateJobStatus,
        removeJob,
        clearHistory,
    } = useOCRHistory();

    const eduaiStatus = useEduAIStatus();
    const selectedModel = useMemo(
        () => availableModels.find((model) => model.id === aiModel),
        [aiModel, availableModels]
    );
    const isExternalModel = useMemo(
        () => (selectedModel ? selectedModel.provider !== 'ollama' : !aiModel.startsWith('ollama')),
        [aiModel, selectedModel]
    );

    useEffect(() => {
        if (!open) {
            return;
        }

        setTopics(providedTopics);
        if (providedTopics.length > 0) {
            setPrimaryTopicId(String(providedTopics[0].id));
            setNewTopicName('');
        } else {
            setPrimaryTopicId('');
            setNewTopicName('Uploaded Questions');
        }
        setError(null);
        setAssessmentType('Assignment');
        setAssessmentName('Assignment 1');

        if (initialDraftQuestions && initialDraftQuestions.length > 0) {
            setDraftQuestions(initialDraftQuestions);
            setProcessingStage('review');
            setProgress(100);
            setLastFileName('');
        } else {
            setDraftQuestions([]);
            setProcessingStage('idle');
            setProgress(0);
            setLastFileName('');
        }
        setAssessmentSemester(() => {
            const now = new Date();
            const year = now.getFullYear();
            return `Fall ${year}`;
        });
    }, [open, providedTopics, initialDraftQuestions]);

    useEffect(() => {
        if (!open || !courseId) return;
        if (providedTopics.length > 0) return;

        const ensureTopics = async () => {
            try {
                const refreshed = await onEnsureTopics(courseId);
                setTopics(refreshed);
                if (refreshed.length > 0) {
                    setPrimaryTopicId(String(refreshed[0].id));
                    setNewTopicName('');
                } else {
                    setPrimaryTopicId('');
                    setNewTopicName('Uploaded Questions');
                }
            } catch (err) {
                console.error('Failed to refresh topics', err);
                setTopics([]);
                setPrimaryTopicId('');
                setNewTopicName('Uploaded Questions');
            }
        };

        void ensureTopics();
    }, [open, courseId, providedTopics.length, onEnsureTopics]);

    useEffect(() => {
        if (!open) return;
        if (topics.length > 0) {
            setPrimaryTopicId((prev) => (prev ? prev : String(topics[0].id)));
            setNewTopicName('');
        } else {
            setPrimaryTopicId('');
            setNewTopicName('Uploaded Questions');
        }
    }, [open, topics]);

    // No auto-start; keep a single tour entry point.

    useEffect(() => {
        if (!open) return;

        const fetchModels = async () => {
            try {
                const models = await eduaiService.listModels();
                setAvailableModels(models);
            } catch (error) {
                console.error('Failed to fetch AI models:', error);
                setAvailableModels([]);
            }
        };

        void fetchModels();
    }, [open]);

    // Load API key when model changes
    useEffect(() => {
        if (!aiModel) return;

        const loadApiKey = async () => {
            const provider = apiKeyStorage.getProviderFromModel(aiModel);
            if (provider) {
                const savedKey = await apiKeyStorage.getApiKey(provider);
                setProviderApiKey(savedKey || '');
            } else {
                setProviderApiKey('');
            }
        };

        void loadApiKey();
    }, [aiModel]);

    const performPdfOcr = useCallback(async (file: File, onProgress: (value: number) => void) => {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await getDocument({ data: arrayBuffer }).promise;
        const pageTexts: string[] = [];

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
            const page = await pdf.getPage(pageNumber);
            const content = await page.getTextContent();
            const pageText = pdfItemsToTextWithLineBreaks(content.items);
            pageTexts.push(pageText);
            onProgress(Math.round((pageNumber / pdf.numPages) * 70));
        }

        return pageTexts.join('\n');
    }, []);

    const performImageOcr = useCallback(async (file: File, onProgress: (value: number) => void) => {
        const result = await Tesseract.recognize(file, 'eng', {
            logger: (message) => {
                if (message.status === 'recognizing text') {
                    onProgress(10 + Math.round(message.progress * 60));
                }
            }
        });
        return result.data.text;
    }, []);

    const performOcr = useCallback(async (file: File) => {
        setProcessingStage('ocr');
        setProgress(5);

        let text = '';
        if (isTextFile(file)) {
            text = await file.text();
            setProgress(70);
        } else if (isPdfFile(file)) {
            text = await performPdfOcr(file, setProgress);
        } else if (isImageFile(file)) {
            text = await performImageOcr(file, setProgress);
        } else {
            throw new Error('Unsupported file type. Please upload a PDF, image, or TXT file.');
        }

        if (!text.trim()) {
            throw new Error('No text detected in the uploaded file.');
        }

        return text;
    }, [performImageOcr, performPdfOcr]);

    const handleExtractQuestions = useCallback(async (text: string) => {
        if (!courseId) {
            throw new Error('Select a course before extracting questions.');
        }

        setProcessingStage('extracting');
        setProgress(85);
        console.log('QuestionUploadDialog: Extracting questions with model:', aiModel);

        const apiKeys = await apiKeyStorage.buildApiKeysForModel(aiModel);
        const response = await questionService.extractQuestionsFromText({
            text,
            courseId,
            model: aiModel,
            apiKeys
        });
        const drafts = mapExtractedToDraftQuestions(response || []);

        if (drafts.length === 0) {
            throw new Error('No questions could be extracted from the provided text.');
        }

        setDraftQuestions(drafts);
        setProcessingStage('review');
        setProgress(100);

        toast({
            title: 'Questions extracted',
            description: `Parsed ${drafts.length} question${drafts.length === 1 ? '' : 's'} from the upload.`,
            duration: Number.POSITIVE_INFINITY,
        });
    }, [courseId, toast, aiModel]);

    const processFile = useCallback(async (file: File) => {
        setError(null);
        setDraftQuestions([]);
        setLastFileName(file.name);

        const jobId = addJob({
            fileName: file.name,
            fileSize: file.size,
            courseId: courseId!,
            courseName: courseName ?? 'Unknown Course',
            model: aiModel,
            status: 'pending',
            assessmentDetails: {
                type: assessmentType,
                name: assessmentName,
                semester: assessmentSemester,
            },
        });
        setCurrentJobId(jobId);

        try {
            updateJobStatus(jobId, 'processing');
            const text = await performOcr(file);
            if (onExtractInBackground && courseId) {
                const apiKeys = await apiKeyStorage.buildApiKeysForModel(aiModel);
                onExtractInBackground({
                    text,
                    courseId,
                    model: aiModel,
                    apiKeys,
                    jobId,
                    onExtractionComplete: (status, extras) => {
                        updateJobStatus(jobId, status === 'error' ? 'error' : 'success', {
                            error: extras?.error,
                            questionsCount: extras?.questionsCount,
                        });
                    },
                });
                onClose();
                return;
            }
            await handleExtractQuestions(text);
        } catch (err: any) {
            console.error('Question extraction failed', err);
            const message = err?.response?.data?.error || err?.message || 'Failed to extract questions.';
            setError(message);
            setProcessingStage('idle');
            setProgress(0);
            updateJobStatus(jobId, 'error', { error: message });
            toast({
                variant: 'destructive',
                title: 'Question extraction failed',
                description: message,
                duration: Number.POSITIVE_INFINITY,
            });
        }
    }, [courseId, courseName, handleExtractQuestions, performOcr, toast, onExtractInBackground, onClose, aiModel, addJob, updateJobStatus, assessmentType, assessmentName, assessmentSemester]);

    const handleFileChange = useCallback(
        (event: React.ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            if (file) {
                void processFile(file);
            }
        },
        [processFile]
    );

    const updateDraft = useCallback((id: string, updates: Partial<DraftQuestion>) => {
        setDraftQuestions((prev) =>
            prev.map((draft) => (draft.id === id ? { ...draft, ...updates } : draft))
        );
    }, []);

    const removeDraft = useCallback((id: string) => {
        setDraftQuestions((prev) => prev.filter((draft) => draft.id !== id));
    }, []);

    const setPrimaryTopicForDraft = useCallback((id: string, topicId: number | null) => {
        const normalizedTopicId = typeof topicId === 'number' && Number.isInteger(topicId) ? topicId : null;
        setDraftQuestions((prev) =>
            prev.map((draft) => {
                if (draft.id !== id) {
                    return draft;
                }
                const cleanedSecondary = normalizedTopicId === null
                    ? draft.secondaryTopicIds
                    : draft.secondaryTopicIds.filter((value) => value !== normalizedTopicId);
                return {
                    ...draft,
                    primaryTopicId: normalizedTopicId,
                    secondaryTopicIds: cleanedSecondary
                };
            })
        );
    }, []);

    const toggleSecondaryTopicForDraft = useCallback((id: string, topicId: number) => {
        setDraftQuestions((prev) =>
            prev.map((draft) => {
                if (draft.id !== id) {
                    return draft;
                }

                if (draft.primaryTopicId === topicId) {
                    return draft;
                }

                const exists = draft.secondaryTopicIds.includes(topicId);
                const nextSecondary = exists
                    ? draft.secondaryTopicIds.filter((value) => value !== topicId)
                    : [...draft.secondaryTopicIds, topicId];

                return {
                    ...draft,
                    secondaryTopicIds: nextSecondary
                };
            })
        );
    }, []);

    const includedDrafts = useMemo(
        () => draftQuestions.filter((draft) => draft.include && draft.question.trim().length > 0),
        [draftQuestions]
    );

    const canSave = useMemo(() => {
        if (processingStage === 'saving') return false;
        if (!courseId) return false;
        if (includedDrafts.length === 0) return false;
        if (saveTarget === 'bank') return true;
        if (!assessmentType || !assessmentName.trim() || !assessmentSemester.trim()) return false;
        return true;
    }, [
        assessmentName,
        assessmentSemester,
        assessmentType,
        courseId,
        includedDrafts.length,
        processingStage,
        saveTarget
    ]);

    const getDisabledReason = (): string | null => {
        if (processingStage === 'saving') return null; // Don't show tooltip while saving
        if (!canSave) {
            const reasons: string[] = [];
            if (!courseId) reasons.push('course');
            if (includedDrafts.length === 0) reasons.push('at least one question selected');
            if (saveTarget === 'assessment') {
                if (!assessmentType) reasons.push('assessment type');
                if (!assessmentName.trim()) reasons.push('assessment name');
                if (!assessmentSemester.trim()) reasons.push('assessment semester');
            }

            if (reasons.length > 0) {
                return `Missing required: ${reasons.join(', ')}`;
            }
        }
        return null;
    };

    const disabledReason = getDisabledReason();

    // Update OCR job when drafts change (after successful extraction)
    useEffect(() => {
        if (currentJobId && draftQuestions.length > 0 && processingStage === 'review') {
            const storedQuestions: StoredQuestion[] = draftQuestions.map((draft) => ({
                id: draft.id,
                text: draft.question.slice(0, 200),
                type: draft.type === 'MCQ' ? 'mcq' : draft.type === 'SA' ? 'short_answer' : 'fill_in_blank',
                summary: draft.summary,
                ...(draft.type === 'MCQ' && draft.choices && draft.choices.length >= 2 && { choices: draft.choices }),
                ...(draft.answer != null && draft.answer !== '' && { answer: draft.answer }),
            }));
            updateJobStatus(currentJobId, 'success', {
                questionsCount: draftQuestions.length,
                storedQuestions,
            });
        }
    }, [currentJobId, draftQuestions, processingStage, updateJobStatus]);

    const handleCloseAttempt = useCallback(() => {
        if (draftQuestions.length > 0 && processingStage === 'review') {
            setShowUnsavedDialog(true);
        } else {
            onClose();
        }
    }, [draftQuestions.length, processingStage, onClose]);

    const handleDiscardUnsaved = useCallback(() => {
        if (currentJobId) {
            const storedQuestions: StoredQuestion[] = draftQuestions.map((draft) => ({
                id: draft.id,
                text: draft.question.slice(0, 200),
                type: draft.type === 'MCQ' ? 'mcq' : draft.type === 'SA' ? 'short_answer' : 'fill_in_blank',
                summary: draft.summary,
                ...(draft.type === 'MCQ' && draft.choices && draft.choices.length >= 2 && { choices: draft.choices }),
                ...(draft.answer != null && draft.answer !== '' && { answer: draft.answer }),
            }));
            updateJobStatus(currentJobId, 'discarded', {
                questionsCount: draftQuestions.length,
                storedQuestions,
            });
        }
        setShowUnsavedDialog(false);
        onClose();
        toast({
            title: 'Questions discarded',
            description: 'You can restore them later from the History panel in the upload dialog.',
            duration: 10000,
        });
    }, [currentJobId, draftQuestions, updateJobStatus, onClose, toast]);

    const performRestoreFromJob = useCallback((job: OCRJob) => {
        if (!job.storedQuestions || job.storedQuestions.length === 0) return;
        const defaultMcqChoices: MCQChoice[] = [
            { letter: 'A', text: '' },
            { letter: 'B', text: '' },
            { letter: 'C', text: '' },
            { letter: 'D', text: '' },
        ];
        const restoredDrafts: DraftQuestion[] = job.storedQuestions.map((sq) => ({
            id: sq.id,
            question: sq.text,
            summary: sq.summary ?? '',
            difficulty: 'medium' as QuestionDifficulty,
            type: (sq.type === 'mcq' ? 'MCQ' : sq.type === 'short_answer' ? 'SA' : 'LA') as QuestionType,
            primaryTopicId: null,
            secondaryTopicIds: [],
            include: true,
            choices: sq.type === 'mcq'
                ? (sq.choices && sq.choices.length >= 2 ? sq.choices as MCQChoice[] : defaultMcqChoices)
                : null,
            instructions: '',
            answer: sq.answer ?? null,
        }));
        setDraftQuestions(restoredDrafts);
        setProcessingStage('review');
        setProgress(100);
        setLastFileName(job.fileName);
        setCurrentJobId(job.id);
        if (job.assessmentDetails) {
            setAssessmentType(job.assessmentDetails.type as typeof assessmentTypes[number]);
            setAssessmentName(job.assessmentDetails.name);
            setAssessmentSemester(job.assessmentDetails.semester);
        }
        toast({
            title: 'Questions restored',
            description: `Restored ${restoredDrafts.length} question(s) from history. Choices and answers are included.`,
            duration: 10000,
        });
    }, [toast]);

    const handleSelectHistoryJob = useCallback((job: OCRJob) => {
        if (job.courseId !== courseId) {
            toast({
                title: 'Different course',
                description: `This upload was for "${job.courseName}". Switch to that course to restore these questions.`,
                variant: 'destructive',
                duration: Number.POSITIVE_INFINITY,
            });
            return;
        }
        if (!job.storedQuestions || job.storedQuestions.length === 0) return;
        const hasUnsavedDrafts = draftQuestions.length > 0 && processingStage === 'review';
        if (hasUnsavedDrafts) {
            setPendingRestoreJob(job);
            return;
        }
        performRestoreFromJob(job);
    }, [courseId, draftQuestions.length, processingStage, performRestoreFromJob, toast]);

    const handleConfirmRestoreFromHistory = useCallback(() => {
        if (pendingRestoreJob) {
            performRestoreFromJob(pendingRestoreJob);
            setPendingRestoreJob(null);
        }
    }, [pendingRestoreJob, performRestoreFromJob]);

    const handleCancelRestoreFromHistory = useCallback(() => {
        setPendingRestoreJob(null);
    }, []);

    const handleCopyAll = useCallback(async () => {
        const lines = draftQuestions.map((draft, index) => {
            const base = [`${index + 1}. ${draft.question.trim()}`];
            if (draft.summary?.trim()) {
                base.splice(1, 0, `Summary: ${draft.summary.trim()}`);
            }
            if (draft.instructions?.trim()) {
                base.push(`Instructions: ${draft.instructions.trim()}`);
            }
            if (draft.answer?.trim()) {
                base.push(`Answer: ${draft.answer.trim()}`);
            }
            base.push(`Difficulty: ${draft.difficulty}`);
            return base.join('\n');
        });

        try {
            await navigator.clipboard.writeText(lines.join('\n\n'));
            toast({
                title: 'Copied',
                description: 'Extracted questions copied to clipboard.',
                duration: Number.POSITIVE_INFINITY,
            });
        } catch (err) {
            toast({
                variant: 'destructive',
                title: 'Copy failed',
                description: 'Could not copy questions to clipboard.',
                duration: Number.POSITIVE_INFINITY,
            });
        }
    }, [draftQuestions, toast]);

    const handleSave = useCallback(async () => {
        if (!canSave || !courseId) return;

        const payloadQuestions = includedDrafts.map((draft) => ({
            question: draft.question.trim(),
            instructions: draft.instructions?.trim(),
            difficulty: draft.difficulty,
            answer: draft.answer?.trim() || null,
            type: draft.type,
            summary: draft.summary.trim(),
            primaryTopicId: draft.primaryTopicId ?? undefined,
            secondaryTopicIds: draft.secondaryTopicIds,
            ...(draft.type === 'MCQ' && draft.choices && draft.choices.length >= 2 && {
                choices: draft.choices.filter((c) => c.text.trim().length > 0)
            })
        }));

        if (payloadQuestions.length === 0) {
            setError('Select at least one question to create.');
            return;
        }

        const missingSummary = payloadQuestions.find((item) => !item.summary);
        if (missingSummary) {
            setError('Each question must include the AI-generated summary before saving.');
            return;
        }
        if (saveTarget === 'assessment' && (!assessmentType || !assessmentName.trim() || !assessmentSemester.trim())) {
            setError('Assessment type, name, and semester are required.');
            return;
        }
        setProcessingStage('saving');
        setProgress(100);
        setError(null);

        try {
            const fallbackPrimaryTopicId =
                topics.length > 0 && primaryTopicId ? Number(primaryTopicId) : undefined;
            const fallbackTopicName =
                topics.length === 0 ? (newTopicName.trim() || 'Uploaded Questions') : undefined;

            const result = await questionService.saveExtractedQuestions({
                courseId,
                primaryTopicId: fallbackPrimaryTopicId,
                topicName: fallbackTopicName,
                questions: payloadQuestions,
                ...(saveTarget === 'assessment'
                    ? {
                          assessment: {
                              type: assessmentType,
                              name: assessmentName.trim(),
                              semester: assessmentSemester.trim()
                          }
                      }
                    : {})
            });

            onQuestionsSaved(result.questions, { assessmentId: result.assessmentId ?? null });
            toast({
                title: 'Questions added',
                description: `${result.questions.length} question${result.questions.length === 1 ? '' : 's'} saved successfully.`,
                duration: 10000,
            });
            onClose();
        } catch (err: any) {
            console.error('Failed to save extracted questions', err);
            const message = err?.response?.data?.error || err?.message || 'Failed to save questions.';
            setError(message);
            toast({
                variant: 'destructive',
                title: 'Save failed',
                description: message,
                duration: Number.POSITIVE_INFINITY,
            });
            setProcessingStage('review');
        }
    }, [
        assessmentName,
        assessmentSemester,
        assessmentType,
        canSave,
        courseId,
        includedDrafts,
        newTopicName,
        onClose,
        onQuestionsSaved,
        primaryTopicId,
        toast,
        topics.length,
        saveTarget
    ]);

    const handleReset = useCallback(() => {
        setDraftQuestions([]);
        setProcessingStage('idle');
        setProgress(0);
        setError(null);
        setLastFileName('');
        setPrimaryTopicId(topics.length > 0 ? String(topics[0].id) : '');
        setNewTopicName(topics.length > 0 ? '' : 'Uploaded Questions');
        setAssessmentType('Assignment');
        setAssessmentName('Assignment 1');
        setAssessmentSemester(() => {
            const now = new Date();
            const year = now.getFullYear();
            return `Fall ${year}`;
        });
    }, [topics]);

    if (!courseId) {
        return (
            <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>No course selected</DialogTitle>
                        <DialogDescription>Select a course before uploading questions.</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button onClick={onClose}>Close</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        );
    }

    return (
        <>
        <Dialog open={open} onOpenChange={(value) => { if (!value) handleCloseAttempt(); }}>
            <DialogContent className={`max-h-[92vh] overflow-y-auto transition-all duration-200 ${showHistoryPanel ? 'max-w-[95vw] sm:max-w-[1400px]' : 'max-w-6xl sm:max-w-7xl w-[95vw]'}`}>
                <DialogHeader>
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <DialogTitle>Upload Questions</DialogTitle>
                            <DialogDescription>
                                Upload a PDF, image, or TXT file containing questions for{' '}
                                <span className="font-medium text-foreground">{courseName ?? 'the selected course'}</span>.
                                {' '}
                                We&apos;ll extract them with OCR (or use text as-is for TXT) and AI so you can review before saving.
                            </DialogDescription>
                        </div>
                        <Tooltip
                            content={showHistoryPanel ? 'Hide upload history' : 'View past uploads. Unsaved questions are kept in History when you close.'}
                            side="left"
                        >
                            <Button
                                variant={showHistoryPanel ? 'secondary' : 'outline'}
                                size="sm"
                                onClick={() => setShowHistoryPanel(!showHistoryPanel)}
                                className="shrink-0"
                            >
                                <History className="h-4 w-4 mr-1.5" />
                                History
                                {ocrJobs.filter((j) => j.status === 'processing' || j.status === 'pending').length > 0 && (
                                    <span className="ml-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-[10px] font-medium text-white">
                                        {ocrJobs.filter((j) => j.status === 'processing' || j.status === 'pending').length}
                                    </span>
                                )}
                            </Button>
                        </Tooltip>
                    </div>
                </DialogHeader>

                <div className="flex gap-6 py-2 min-h-[70vh]">
                    {/* Left: Assessment details — narrow, vertical fields */}
                    {saveTarget === 'bank' ? (
                        <Card className="flex-shrink-0 w-[280px] border-dashed border-blue-200 bg-blue-50/50">
                            <CardHeader className="space-y-1">
                                <CardTitle className="text-base font-semibold">Question bank only</CardTitle>
                                <p className="text-xs text-muted-foreground">
                                    Questions are saved to the course bank. No assessment is created.
                                </p>
                            </CardHeader>
                        </Card>
                    ) : (
                        <Card data-tour-id="upload-assessment-meta" className="flex-shrink-0 w-[280px]">
                            <CardHeader className="space-y-1">
                                <CardTitle className="text-base font-semibold">Assessment details</CardTitle>
                                <p className="text-xs text-muted-foreground">
                                    A new assessment will be created for these questions.
                                </p>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="assessment-type">Type</Label>
                                    <Select
                                        value={assessmentType}
                                        onValueChange={(value) => setAssessmentType(value as typeof assessmentTypes[number])}
                                    >
                                        <SelectTrigger id="assessment-type">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {assessmentTypes.map((type) => (
                                                <SelectItem key={type} value={type}>
                                                    {type}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="assessment-name">Name</Label>
                                    <Input
                                        id="assessment-name"
                                        placeholder="e.g. Midterm Review Set"
                                        value={assessmentName}
                                        onChange={(event) => setAssessmentName(event.target.value)}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="assessment-semester">Semester</Label>
                                    <Input
                                        id="assessment-semester"
                                        placeholder="e.g. Fall 2024"
                                        value={assessmentSemester}
                                        onChange={(event) => setAssessmentSemester(event.target.value)}
                                    />
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Right: Upload + Review — majority of space; when drafts exist, upload/model is collapsible */}
                    <div className="flex-1 min-w-0 flex flex-col gap-6 min-h-0">
                    {draftQuestions.length > 0 ? (
                        <>
                            <div className="flex-shrink-0">
                                <button
                                    type="button"
                                    onClick={() => setUploadSectionCollapsed((c) => !c)}
                                    className="flex items-center justify-between w-full rounded-lg border bg-card px-4 py-3 text-left text-sm font-medium hover:bg-muted/50 transition-colors"
                                >
                                    <span>Upload & model</span>
                                    {uploadSectionCollapsed ? (
                                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                    ) : (
                                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                                    )}
                                </button>
                                {!uploadSectionCollapsed && (
                                    <Card className="mt-2">
                                        <CardHeader className="space-y-1">
                                            <div className="flex items-center justify-between">
                                                <CardTitle className="text-base font-semibold">Upload a file</CardTitle>
                                                <EduAIStatusBadge
                                                    status={eduaiStatus.status}
                                                    message={eduaiStatus.message}
                                                    onRefresh={eduaiStatus.refresh}
                                                    questionGenerationPhase={eduaiStatus.questionGenerationPhase}
                                                    className="z-50"
                                                />
                                            </div>
                                            <p className="text-xs text-muted-foreground">
                                                Questions will be saved to <span className="font-medium text-foreground">{courseName ?? 'the selected course'}</span>.
                                                {' '}Topics are assigned automatically after extraction—you can adjust them in the review step.
                                            </p>
                                        </CardHeader>
                                        <CardContent className="space-y-4">
                                            <div className="space-y-2" data-tour-id="upload-model">
                                                <Label htmlFor="ai-model-expanded">AI model</Label>
                                                <Select value={aiModel} onValueChange={setAiModel}>
                                                    <SelectTrigger id="ai-model-expanded">
                                                        <SelectValue placeholder="Select a model" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {availableModels.length === 0 ? (
                                                            <SelectItem value="__no_models" disabled>
                                                                No models available yet
                                                            </SelectItem>
                                                        ) : (
                                                            <>
                                                                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">UBC Hosted</div>
                                                                {availableModels
                                                                    .filter((option) => option.provider === 'ollama')
                                                                    .map((option) => (
                                                                        <SelectItem key={option.id} value={option.id}>
                                                                            {option.label}
                                                                        </SelectItem>
                                                                    ))}
                                                                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground mt-2">External</div>
                                                                {availableModels
                                                                    .filter((option) => option.provider !== 'ollama')
                                                                    .map((option) => (
                                                                        <SelectItem key={option.id} value={option.id}>
                                                                            {option.label} ({option.provider})
                                                                        </SelectItem>
                                                                    ))}
                                                            </>
                                                        )}
                                                    </SelectContent>
                                                </Select>
                                                {isExternalModel && (
                                                    <div className="w-full rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                                        <span className="font-semibold">Warning:</span> External models send your prompts and course data to that provider. UBC-hosted models keep data within UBC systems.
                                                    </div>
                                                )}
                                            </div>
                                            {apiKeyStorage.requiresApiKey(aiModel) && (
                                                <div className="space-y-2">
                                                    <Label htmlFor="provider-api-key-expanded">
                                                        {apiKeyStorage.getProviderFromModel(aiModel)?.toUpperCase()} API Key
                                                    </Label>
                                                    {providerApiKey ? (
                                                        <div className="flex items-center gap-2">
                                                            <Input
                                                                id="provider-api-key-expanded"
                                                                type="text"
                                                                value={`${providerApiKey.substring(0, 8)}${'•'.repeat(Math.max(0, providerApiKey.length - 8))}`}
                                                                disabled
                                                                className="flex-1"
                                                            />
                                                            <Button
                                                                type="button"
                                                                variant="outline"
                                                                size="sm"
                                                                onClick={() => {
                                                                    const provider = apiKeyStorage.getProviderFromModel(aiModel);
                                                                    if (provider) {
                                                                        apiKeyStorage.removeApiKey(provider);
                                                                        setProviderApiKey('');
                                                                    }
                                                                }}
                                                            >
                                                                Change
                                                            </Button>
                                                        </div>
                                                    ) : (
                                                        <Input
                                                            id="provider-api-key-expanded"
                                                            type="password"
                                                            placeholder={`Enter your ${apiKeyStorage.getProviderFromModel(aiModel)?.toUpperCase()} API key`}
                                                            value={providerApiKey}
                                                            onChange={(e) => {
                                                                const value = e.target.value;
                                                                setProviderApiKey(value);
                                                                const provider = apiKeyStorage.getProviderFromModel(aiModel);
                                                                if (provider && value) {
                                                                    void apiKeyStorage.setApiKey(provider, value);
                                                                }
                                                            }}
                                                        />
                                                    )}
                                                    <p className="text-xs text-muted-foreground">
                                                        Your API key is stored locally in your browser and never sent to our servers.
                                                    </p>
                                                </div>
                                            )}
                                            {lastFileName && (
                                                <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm">
                                                    <FileText className="h-4 w-4 text-muted-foreground" />
                                                    <span className="truncate">{lastFileName}</span>
                                                    <Button variant="ghost" size="icon" className="ml-auto" onClick={handleReset}>
                                                        <RefreshCcw className="h-4 w-4" />
                                                        <span className="sr-only">Reset</span>
                                                    </Button>
                                                </div>
                                            )}
                                        </CardContent>
                                    </Card>
                                )}
                            </div>
                            <Card data-tour-id="upload-review" className="flex-1 min-h-0 flex flex-col">
                                <CardHeader className="flex flex-row items-center justify-between flex-shrink-0">
                                    <CardTitle className="text-base font-semibold">
                                        Review extracted questions ({draftQuestions.length})
                                    </CardTitle>
                                    <div className="flex items-center gap-2" />
                                </CardHeader>
                                <CardContent className="flex-1 min-h-0 flex flex-col p-0 px-6 pb-6">
                                    <ScrollArea className="flex-1 min-h-0 rounded-md border">
                                        <div className="divide-y p-4 pt-0">
                                            {draftQuestions.map((draft, index) => (
                                                <div key={draft.id} className="space-y-4 p-4">
                                                    <div className="flex items-start justify-between gap-2">
                                                        <div className="space-y-1">
                                                            <p className="text-sm font-semibold">Question {index + 1}</p>
                                                            <p className="text-xs text-muted-foreground">
                                                                Toggle include to skip saving a specific question.
                                                            </p>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <Button
                                                                variant={draft.include ? 'secondary' : 'outline'}
                                                                size="sm"
                                                                onClick={() => updateDraft(draft.id, { include: !draft.include })}
                                                            >
                                                                {draft.include ? 'Included' : 'Excluded'}
                                                            </Button>
                                                            <Button variant="ghost" size="icon" onClick={() => removeDraft(draft.id)}>
                                                                <Trash2 className="h-4 w-4" />
                                                                <span className="sr-only">Remove question</span>
                                                            </Button>
                                                        </div>
                                                    </div>
                                                    <div className="space-y-2">
                                                        <Label>Question summary</Label>
                                                        <Input
                                                            value={draft.summary}
                                                            placeholder="One sentence describing the question"
                                                            onChange={(event) => updateDraft(draft.id, { summary: event.target.value })}
                                                        />
                                                    </div>
                                                    <div className="space-y-2">
                                                        <Label>Question text</Label>
                                                        <Textarea
                                                            rows={3}
                                                            value={draft.question}
                                                            onChange={(event) => updateDraft(draft.id, { question: event.target.value })}
                                                        />
                                                    </div>
                                                    <div className="grid gap-4 sm:grid-cols-2">
                                                        <div className="space-y-2">
                                                            <Label>Primary topic</Label>
                                                            <Select
                                                                value={draft.primaryTopicId !== null ? String(draft.primaryTopicId) : 'none'}
                                                                onValueChange={(value) => {
                                                                    if (value === 'none') {
                                                                        setPrimaryTopicForDraft(draft.id, null);
                                                                        return;
                                                                    }
                                                                    const parsed = Number.parseInt(value, 10);
                                                                    setPrimaryTopicForDraft(
                                                                        draft.id,
                                                                        Number.isNaN(parsed) ? null : parsed
                                                                    );
                                                                }}
                                                                disabled={topics.length === 0}
                                                            >
                                                                <SelectTrigger>
                                                                    <SelectValue placeholder={topics.length === 0 ? 'No topics available' : 'Select topic'} />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="none">Unassigned</SelectItem>
                                                                    {topics.map((topic) => (
                                                                        <SelectItem key={topic.id} value={String(topic.id)}>
                                                                            {topic.name}
                                                                        </SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label>Secondary topics</Label>
                                                            {topics.length === 0 ? (
                                                                <p className="text-xs text-muted-foreground">No topics available. A new topic will be created automatically.</p>
                                                            ) : (
                                                                <div className="flex flex-wrap gap-2">
                                                                    {topics.map((topic) => (
                                                                        <label key={topic.id} className="flex items-center gap-1 text-xs">
                                                                            <input
                                                                                type="checkbox"
                                                                                className="h-4 w-4"
                                                                                checked={draft.secondaryTopicIds.includes(topic.id)}
                                                                                onChange={() => toggleSecondaryTopicForDraft(draft.id, topic.id)}
                                                                                disabled={draft.primaryTopicId === topic.id}
                                                                            />
                                                                            <span>{topic.name}</span>
                                                                        </label>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="grid gap-4 sm:grid-cols-3">
                                                        <div className="space-y-2">
                                                            <Label>Difficulty</Label>
                                                            <Select
                                                                value={draft.difficulty}
                                                                onValueChange={(value) =>
                                                                    updateDraft(draft.id, { difficulty: value as QuestionDifficulty })
                                                                }
                                                            >
                                                                <SelectTrigger>
                                                                    <SelectValue />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {difficultyOptions.map((difficulty) => (
                                                                        <SelectItem key={difficulty} value={difficulty}>
                                                                            {difficulty}
                                                                        </SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label>Type</Label>
                                                            <Select
                                                                value={draft.type}
                                                                onValueChange={(value) =>
                                                                    updateDraft(draft.id, { type: value as QuestionType })
                                                                }
                                                            >
                                                                <SelectTrigger>
                                                                    <SelectValue />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {questionTypes.map((type) => (
                                                                        <SelectItem key={type} value={type}>
                                                                            {questionTypeLabels[type]}
                                                                        </SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                    </div>
                                                    {draft.type === 'MCQ' && (
                                                        <div className="space-y-2">
                                                            <MCQChoicesField
                                                                choices={draft.choices ?? [{ letter: 'A', text: '' }, { letter: 'B', text: '' }, { letter: 'C', text: '' }, { letter: 'D', text: '' }]}
                                                                onChoicesChange={(newChoices) => updateDraft(draft.id, { choices: newChoices })}
                                                                answer={draft.answer ?? ''}
                                                                onAnswerChange={(letter) => updateDraft(draft.id, { answer: letter || null })}
                                                                idPrefix={`upload-draft-${draft.id}`}
                                                            />
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </ScrollArea>
                                    <p className="pt-3 text-xs text-muted-foreground flex-shrink-0">
                                        The AI extraction is a starting point—adjust the question text, instructions, difficulty, or answers before saving.
                                    </p>
                                </CardContent>
                            </Card>
                        </>
                    ) : (
                    <Card>
                        <CardHeader className="space-y-1">
                            <div className="flex items-center justify-between">
                                <CardTitle className="text-base font-semibold">Upload a file</CardTitle>
                                <EduAIStatusBadge
                                    status={eduaiStatus.status}
                                    message={eduaiStatus.message}
                                    onRefresh={eduaiStatus.refresh}
                                    questionGenerationPhase={eduaiStatus.questionGenerationPhase}
                                    className="z-50"
                                />
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Questions will be saved to <span className="font-medium text-foreground">{courseName ?? 'the selected course'}</span>.
                                {' '}Topics are assigned automatically after extraction—you can adjust them in the review step.
                            </p>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2" data-tour-id="upload-model">
                                <Label htmlFor="ai-model">AI model</Label>
                                <Select value={aiModel} onValueChange={setAiModel}>
                                    <SelectTrigger id="ai-model">
                                        <SelectValue placeholder="Select a model" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {availableModels.length === 0 ? (
                                            <SelectItem value="__no_models" disabled>
                                                No models available yet
                                            </SelectItem>
                                        ) : (
                                            <>
                                                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">UBC Hosted</div>
                                                {availableModels
                                                    .filter((option) => option.provider === 'ollama')
                                                    .map((option) => (
                                                        <SelectItem key={option.id} value={option.id}>
                                                            {option.label}
                                                        </SelectItem>
                                                    ))}
                                                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground mt-2">External</div>
                                                {availableModels
                                                    .filter((option) => option.provider !== 'ollama')
                                                    .map((option) => (
                                                        <SelectItem key={option.id} value={option.id}>
                                                            {option.label} ({option.provider})
                                                        </SelectItem>
                                                    ))}
                                            </>
                                        )}
                                    </SelectContent>
                                </Select>
                                {isExternalModel && (
                                    <div className="w-full rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                        <span className="font-semibold">Warning:</span> External models send your prompts and course data to that provider. UBC-hosted models keep data within UBC systems.
                                    </div>
                                )}
                            </div>

                            {apiKeyStorage.requiresApiKey(aiModel) && (
                                <div className="space-y-2">
                                    <Label htmlFor="provider-api-key">
                                        {apiKeyStorage.getProviderFromModel(aiModel)?.toUpperCase()} API Key
                                    </Label>
                                    {providerApiKey ? (
                                        <div className="flex items-center gap-2">
                                            <Input
                                                id="provider-api-key"
                                                type="text"
                                                value={`${providerApiKey.substring(0, 8)}${'•'.repeat(Math.max(0, providerApiKey.length - 8))}`}
                                                disabled
                                                className="flex-1"
                                            />
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() => {
                                                    const provider = apiKeyStorage.getProviderFromModel(aiModel);
                                                    if (provider) {
                                                        apiKeyStorage.removeApiKey(provider);
                                                        setProviderApiKey('');
                                                    }
                                                }}
                                            >
                                                Change
                                            </Button>
                                        </div>
                                    ) : (
                                        <Input
                                            id="provider-api-key"
                                            type="password"
                                            placeholder={`Enter your ${apiKeyStorage.getProviderFromModel(aiModel)?.toUpperCase()} API key`}
                                            value={providerApiKey}
                                            onChange={(e) => {
                                                const value = e.target.value;
                                                setProviderApiKey(value);
                                                const provider = apiKeyStorage.getProviderFromModel(aiModel);
                                                if (provider && value) {
                                                    void apiKeyStorage.setApiKey(provider, value);
                                                }
                                            }}
                                        />
                                    )}
                                    <p className="text-xs text-muted-foreground">
                                        Your API key is stored locally in your browser and never sent to our servers.
                                    </p>
                                </div>
                            )}

                            {(!lastFileName && draftQuestions.length === 0) && (
                                <label
                                    htmlFor="question-upload"
                                    data-tour-id="upload-file"
                                    className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/30 p-6 text-center transition hover:border-primary hover:bg-muted/50 cursor-pointer"
                                >
                                    <UploadCloud className="h-10 w-10 text-muted-foreground" />
                                    <div className="space-y-1">
                                        <p className="text-sm font-medium">Drop PDF, image, or TXT file here</p>
                                        <p className="text-xs text-muted-foreground">We support PDF, PNG, JPG, TXT and other common formats.</p>
                                    </div>
                                    <input
                                        id="question-upload"
                                        type="file"
                                        accept=".pdf,image/*,.txt,text/plain"
                                        className="hidden"
                                        onChange={handleFileChange}
                                        disabled={processingStage === 'ocr' || processingStage === 'extracting' || processingStage === 'saving'}
                                    />
                                </label>
                            )}
                            {lastFileName && (
                                <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm">
                                    <FileText className="h-4 w-4 text-muted-foreground" />
                                    <span className="truncate">{lastFileName}</span>
                                    <Button variant="ghost" size="icon" className="ml-auto" onClick={handleReset}>
                                        <RefreshCcw className="h-4 w-4" />
                                        <span className="sr-only">Reset</span>
                                    </Button>
                                </div>
                            )}
                            {(processingStage === 'ocr' || processingStage === 'extracting' || processingStage === 'saving') && (
                                <div className="space-y-3">
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        <span>
                                            {processingStage === 'ocr' && 'Running OCR...'}
                                            {processingStage === 'extracting' && 'Extracting questions with AI...'}
                                            {processingStage === 'saving' && 'Saving questions to the database...'}
                                        </span>
                                    </div>
                                    <Progress value={progress} />
                                </div>
                            )}
                            {error && (
                                <p className="text-sm text-red-600">
                                    {error}
                                </p>
                            )}
                        </CardContent>
                    </Card>
                    )}
                    </div>

                    <OCRHistoryPanel
                        jobs={ocrJobs}
                        currentCourseId={courseId}
                        isOpen={showHistoryPanel}
                        onToggle={() => setShowHistoryPanel(false)}
                        onSelectJob={handleSelectHistoryJob}
                        onRemoveJob={removeJob}
                        onClearHistory={() => setShowClearHistoryConfirm(true)}
                    />
                </div>

                <DialogFooter className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="text-sm text-muted-foreground">
                        {includedDrafts.length} question{includedDrafts.length === 1 ? '' : 's'} ready to save.
                    </div>
                    <div className="flex gap-2">
                        <Tooltip
                            content={draftQuestions.length > 0 && processingStage === 'review' ? 'Close will ask you to save or discard your current questions.' : 'Close this dialog.'}
                            side="top"
                        >
                            <Button variant="outline" onClick={handleCloseAttempt}>
                                Cancel
                            </Button>
                        </Tooltip>
                        {disabledReason ? (
                            <Tooltip content={disabledReason} multiline>
                                <span className="inline-block">
                                    <Button onClick={() => void handleSave()} disabled={!canSave} data-tour-id="upload-create">
                                        {processingStage === 'saving' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                        Create Questions
                                    </Button>
                                </span>
                            </Tooltip>
                        ) : (
                            <Tooltip
                                content={
                                    canSave
                                        ? saveTarget === 'bank'
                                            ? 'Save selected questions to the question bank only.'
                                            : 'Save selected questions and create a new assessment.'
                                        : 'Select at least one question and fill assessment details to save.'
                                }
                            >
                                <span className="inline-block">
                                    <Button onClick={() => void handleSave()} disabled={!canSave} data-tour-id="upload-create">
                                        {processingStage === 'saving' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                        Create Questions
                                    </Button>
                                </span>
                            </Tooltip>
                        )}
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        <UnsavedChangesDialog
            open={showUnsavedDialog}
            questionsCount={draftQuestions.length}
            canSave={canSave}
            isSaving={processingStage === 'saving'}
            onSave={() => {
                setShowUnsavedDialog(false);
                void handleSave();
            }}
            onDiscard={handleDiscardUnsaved}
            onCancel={() => setShowUnsavedDialog(false)}
        />

        {/* Confirm replace current questions when restoring from history */}
        <AlertDialog open={!!pendingRestoreJob} onOpenChange={(open) => { if (!open) setPendingRestoreJob(null); }}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Replace current questions?</AlertDialogTitle>
                    <AlertDialogDescription>
                        You have unsaved questions in this session. Restoring from history will replace them. Your current set will remain in History as discarded so you can switch back later if needed.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel onClick={handleCancelRestoreFromHistory}>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleConfirmRestoreFromHistory}>Replace</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>

        {/* Confirm clear upload history */}
        <AlertDialog open={showClearHistoryConfirm} onOpenChange={(open) => { if (!open) setShowClearHistoryConfirm(false); }}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Clear upload history?</AlertDialogTitle>
                    <AlertDialogDescription>
                        This removes all jobs from the History list. Questions you already saved are unaffected. You will no longer be able to restore past uploads from this list.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => setShowClearHistoryConfirm(false)}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={() => {
                            clearHistory();
                            setShowClearHistoryConfirm(false);
                            toast({
                                title: 'History cleared',
                                description: 'Upload history has been cleared. Saved questions are unchanged.',
                                duration: Number.POSITIVE_INFINITY,
                            });
                        }}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                        Clear History
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
        </>
    );
};
