/**
 * Dialog for linking AI service courses into the local library, fetching topics, and handling logout.
 * Lets users select courses from the AI service, skip ones already added, and persist them via courseService.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Loader2, LogOut, Plus } from 'lucide-react';
import { Class } from '../../types/class';
import { eduaiService, EduAICourseOption, EduAITopicOption } from '../../services/eduaiService';
import { courseService } from '../../services/courseService';
import { assessmentService } from '../../services/assessmentService';
import { useToast } from '../ui/use-toast';
import { useAuth } from '../../contexts/AuthContext';
import { useEduAIStatus } from '../../hooks/useEduAIStatus';
import { EduAIStatusBadge } from '../eduai/EduAIStatusBadge';
import { useGuidedTour } from '../../contexts/GuidedTourContext';
import { normalizeCourseCode } from '../../utils/courseDisplay';

interface ProfileCoursesDialogProps {
    open: boolean;
    onClose: () => void;
    existingCourses: Class[];
    onCoursesAdded?: () => Promise<void> | void;
}

export const ProfileCoursesDialog = ({
    open,
    onClose,
    existingCourses,
    onCoursesAdded
}: ProfileCoursesDialogProps) => {
    const [courseOptions, setCourseOptions] = useState<EduAICourseOption[]>([]);
    const [topicsByCourse, setTopicsByCourse] = useState<Record<string, EduAITopicOption[]>>({});
    const [selectedCourseIds, setSelectedCourseIds] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [resyncingCoreId, setResyncingCoreId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const { toast } = useToast();
    const { logout, user } = useAuth();
    const navigate = useNavigate();
    const eduaiStatus = useEduAIStatus();
    const { startTour } = useGuidedTour();

    const existingCourseCodeSet = useMemo(() => {
        const codes = new Set<string>();
        existingCourses.forEach((course) => {
            const candidates = [
                course.courseCode,
                course.code,
                course.subject,
                course.name
            ];
            candidates.forEach((candidate) => {
                const normalized = normalizeCourseCode(candidate ?? '');
                if (normalized) {
                    codes.add(normalized);
                }
            });
        });
        return codes;
    }, [existingCourses]);

    useEffect(() => {
        if (!open) {
            setSelectedCourseIds([]);
            setCourseOptions([]);
            setTopicsByCourse({});
            setError(null);
            return;
        }

        let isMounted = true;

        const loadCourses = async () => {
            try {
                setIsLoading(true);
                setError(null);
                const options = await eduaiService.listCourses();
                if (!isMounted) return;
                setCourseOptions(options);
            } catch (err) {
                console.error('Failed to load AI service courses', err);
                if (isMounted) {
                    setError('Failed to load AI service courses. Please try again.');
                }
            } finally {
                if (isMounted) {
                    setIsLoading(false);
                }
            }
        };

        void loadCourses();

        return () => {
            isMounted = false;
        };
    }, [open]);

    useEffect(() => {
        if (!open || selectedCourseIds.length === 0) return;
        for (const coreCourseId of selectedCourseIds) {
            void loadTopicsForCourse(coreCourseId);
        }
    }, [open, selectedCourseIds]);

    const toggleCourse = (courseId: string) => {
        setSelectedCourseIds((prev) =>
            prev.includes(courseId) ? prev.filter((id) => id !== courseId) : [...prev, courseId]
        );
    };

    const handleDialogChange = (value: boolean) => {
        if (!value && !isSaving && !resyncingCoreId) {
            onClose();
        }
    };

    const findLocalCourseByCode = (code: string | null | undefined) => {
        const normalized = normalizeCourseCode(code);
        if (!normalized) return undefined;
        return existingCourses.find((course) => {
            const candidates = [course.code, course.courseCode, course.subject, course.name];
            return candidates.some(
                (candidate) => normalizeCourseCode(candidate ?? '') === normalized
            );
        });
    };

    const loadTopicsForCourse = async (coreCourseId: string) => {
        if (topicsByCourse[coreCourseId]) return;
        const topics = await eduaiService.listCoreCourseTopics(coreCourseId);
        setTopicsByCourse((prev) => ({ ...prev, [coreCourseId]: topics }));
    };

    const handleResyncCourse = async (option: EduAICourseOption) => {
        const localCourse = findLocalCourseByCode(option.code);
        if (!localCourse?.id) {
            toast({
                title: 'Local course not found',
                description: 'Could not match this Core course to a Question Maker course by code.',
                variant: 'destructive'
            });
            return;
        }

        setResyncingCoreId(option.id);
        setError(null);
        try {
            await courseService.linkAndSyncFromCore(localCourse.id, option.id);
            if (onCoursesAdded) {
                await onCoursesAdded();
            }
            toast({
                title: 'Course re-synced',
                description: `${option.code} is linked to Core and topics are updated.`
            });
        } catch (err) {
            console.error('Failed to re-sync course from Core', err);
            setError('Unable to re-sync this course from Core. Check EDUAI_API_KEY and try again.');
        } finally {
            setResyncingCoreId(null);
        }
    };

    const handleLogout = () => {
        onClose();
        logout();
    };

    const handleCreateTestCourse = async () => {
        setIsSaving(true);
        setError(null);
        try {
            // Generate a unique test course code (only after confirming no test course exists)
            const testCourseCode = 'TEST';
            const testCourseName = 'Test Course';
            const normalizedTestCourseName = normalizeCourseCode(testCourseName);

            // Check if a test course already exists by checking:
            // 1. Any course with a code starting with "test-"
            // 2. Any course with the name "TEST- - Test Course"
            const hasTestCourse = existingCourses.some((course) => {
                const courseCode = normalizeCourseCode(course.courseCode || course.code || '');
                const courseName = normalizeCourseCode(course.name || '');
                return (
                    courseCode.startsWith('test-') ||
                    courseName === normalizedTestCourseName
                );
            });

            if (hasTestCourse) {
                toast({
                    title: 'Test course already exists',
                    description: 'You already have a test course. You can use it to create questions and assessments.',
                    variant: 'default'
                });
                setIsSaving(false);
                return;
            }

            const createdCourse = await courseService.createCourse({
                name: testCourseName,
                courseCode: testCourseCode
            });

            // Create a default topic so users can immediately start creating questions
            try {
                await courseService.createTopic(createdCourse.id, 'General');
            } catch (topicError) {
                console.warn('Failed to create default topic for test course', topicError);
                // Continue even if topic creation fails - users can add topics manually
            }

            try {
                await assessmentService.createPracticeExamForCourse(createdCourse.id);
            } catch (practiceExamError) {
                console.warn('Failed to create Practice Exam for test course', practiceExamError);
            }

            if (onCoursesAdded) {
                await onCoursesAdded();
            }

            toast({
                title: 'Test course created',
                description: 'You can now use this course to create questions and assessments without connecting to the AI service.'
            });

            onClose();
        } catch (err) {
            console.error('Failed to create test course', err);
            setError('Unable to create test course. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleSave = async () => {
        const targetCourseIds = selectedCourseIds.filter((id) => {
            const option = courseOptions.find((item) => item.id === id);
            if (!option) {
                return false;
            }
            const normalized = normalizeCourseCode(option.code);
            return normalized && !existingCourseCodeSet.has(normalized);
        });

        if (targetCourseIds.length === 0) {
            toast({
                title: 'No new courses selected',
                description: 'Select at least one AI service course that is not already in your library.'
            });
            return;
        }

        setIsSaving(true);
        try {
            const updatedCodes = new Set(existingCourseCodeSet);
            let createdCount = 0;

            for (const courseId of targetCourseIds) {
                const option = courseOptions.find((item) => item.id === courseId);
                if (!option) continue;

                const normalizedCode = normalizeCourseCode(option.code);
                if (normalizedCode && updatedCodes.has(normalizedCode)) {
                    continue;
                }

                const createdCourse = await courseService.createCourse({
                    name: option.name,
                    courseCode: option.code
                });

                try {
                    await courseService.linkAndSyncFromCore(createdCourse.id, courseId);
                } catch (linkError) {
                    await courseService.deleteCourse(createdCourse.id).catch(() => undefined);
                    throw linkError;
                }

                if (normalizedCode) {
                    updatedCodes.add(normalizedCode);
                }

                try {
                    await assessmentService.createPracticeExamForCourse(createdCourse.id);
                } catch (practiceExamError) {
                    console.warn('Failed to create Practice Exam for linked course', practiceExamError);
                }

                createdCount += 1;
            }

            if (createdCount > 0) {
                if (onCoursesAdded) {
                    await onCoursesAdded();
                }
                toast({
                    title: `Added ${createdCount} course${createdCount > 1 ? 's' : ''}`,
                    description: 'Courses linked to Core and topics synced.'
                });
            } else {
                toast({
                    title: 'Courses already linked',
                    description: 'The selected courses were already in your library.'
                });
            }

            onClose();
        } catch (err) {
            console.error('Failed to add courses', err);
            setError('Unable to add selected courses. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleDialogChange}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <DialogTitle>Add Courses</DialogTitle>
                            <DialogDescription>
                                Link courses from the AI service or create a test course to get started without connecting to it.
                            </DialogDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            <EduAIStatusBadge
                                status={eduaiStatus.status}
                                message={eduaiStatus.message}
                                onRefresh={eduaiStatus.refresh}
                                questionGenerationPhase={eduaiStatus.questionGenerationPhase}
                                className="z-50"
                            />
                        </div>
                    </div>
                </DialogHeader>

                {error && (
                    <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        {error}
                    </div>
                )}

                <div className="mt-4 space-y-4">
                    {/* Test Course Option - Always visible */}
                    <div className="rounded-md border-2 border-dashed border-blue-300 bg-blue-50/50 p-4">
                        <div className="flex items-center justify-between">
                            <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="text-sm font-semibold text-foreground">Sandbox Course</span>
                                    <Badge variant="outline" className="text-xs">No AI service required</Badge>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Create a test course to start making questions and assessments without connecting to the AI service.
                                </p>
                            </div>
                            <Button
                                onClick={handleCreateTestCourse}
                                disabled={isSaving || isLoading}
                                variant="default"
                                className="ml-4"
                            >
                                {isSaving ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Creating...
                                    </>
                                ) : (
                                    <>
                                        <Plus className="mr-2 h-4 w-4" />
                                        Create Test Course
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>

                    {/* AI service courses section */}
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <div className="h-px flex-1 bg-border"></div>
                            <span className="text-xs text-muted-foreground font-medium">OR LINK FROM AI SERVICE</span>
                            <div className="h-px flex-1 bg-border"></div>
                        </div>
                    </div>

                    {isLoading ? (
                        <div className="flex items-center justify-center py-12 text-muted-foreground">
                            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                            Loading courses from AI service...
                        </div>
                    ) : (
                        <div className="max-h-80 space-y-3 overflow-y-auto pr-1" data-tour-id="profile-course-list">
                            {courseOptions.map((option) => {
                                const normalized = normalizeCourseCode(option.code);
                                const isAdded = normalized ? existingCourseCodeSet.has(normalized) : false;
                                const isSelected = selectedCourseIds.includes(option.id);
                                const topics = topicsByCourse[option.id] ?? [];
                                const isResyncing = resyncingCoreId === option.id;

                                return (
                                    <div
                                        key={option.id}
                                        className={`flex items-start gap-3 rounded-md border p-4 shadow-sm transition ${
                                            isAdded
                                                ? 'border-muted bg-muted/40'
                                                : isSelected
                                                    ? 'border-blue-500 bg-blue-50'
                                                    : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50/40'
                                        }`}
                                    >
                                        {!isAdded ? (
                                            <label className="flex cursor-pointer items-start gap-3 flex-1">
                                                <input
                                                    type="checkbox"
                                                    className="mt-1 h-4 w-4"
                                                    checked={isSelected}
                                                    onChange={() => toggleCourse(option.id)}
                                                    disabled={isSaving || !!resyncingCoreId}
                                                />
                                                <div className="flex-1 space-y-2">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="text-sm font-semibold text-foreground">
                                                            {option.code} · {option.name}
                                                        </span>
                                                        {option.term && option.year && (
                                                            <Badge variant="outline" className="text-xs">
                                                                {option.term} {option.year}
                                                            </Badge>
                                                        )}
                                                        {isSelected && !isSaving && (
                                                            <Badge variant="secondary">Selected</Badge>
                                                        )}
                                                    </div>
                                                    {option.description && (
                                                        <p className="text-xs text-muted-foreground">{option.description}</p>
                                                    )}
                                                    {topics.length > 0 && (
                                                        <div className="flex flex-wrap gap-2">
                                                            {topics.map((topic) => (
                                                                <Badge key={topic.id} variant="outline" className="text-xs">
                                                                    {topic.name}
                                                                </Badge>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </label>
                                        ) : (
                                            <div className="flex flex-1 items-start justify-between gap-3">
                                                <div className="space-y-2">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="text-sm font-semibold text-foreground">
                                                            {option.code} · {option.name}
                                                        </span>
                                                        <Badge variant="outline" data-tour-id="profile-added-badge">
                                                            Already added
                                                        </Badge>
                                                    </div>
                                                    <p className="text-xs text-muted-foreground">
                                                        Re-sync to link this QM course to Core and refresh topics.
                                                    </p>
                                                </div>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={isSaving || !!resyncingCoreId}
                                                    onClick={() => void handleResyncCourse(option)}
                                                >
                                                    {isResyncing ? (
                                                        <>
                                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                            Syncing…
                                                        </>
                                                    ) : (
                                                        'Re-sync from Core'
                                                    )}
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}

                            {courseOptions.length === 0 && !isLoading && (
                                <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                                    {error 
                                        ? 'Unable to load courses from the AI service. You can still create a test course above.'
                                        : 'No courses available from the AI service right now. You can create a test course above to get started.'}
                                </div>
                            )}
                        </div>
                    )}
                </div>

<DialogFooter className="flex items-center justify-between">
                    <Button
                        variant="outline"
                        onClick={handleLogout}
                        className="flex items-center gap-2 text-destructive hover:text-destructive"
                    >
                        <LogOut className="h-4 w-4" />
                        <span>Logout</span>
                    </Button>
                    <div className="flex gap-2">
                        <Button variant="ghost" onClick={onClose} disabled={isSaving || !!resyncingCoreId}>
                            Cancel
                        </Button>
                        <Button onClick={handleSave} disabled={isSaving || isLoading || !!resyncingCoreId} data-tour-id="profile-add-button">
                            {isSaving ? 'Linking…' : 'Add selected courses'}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
