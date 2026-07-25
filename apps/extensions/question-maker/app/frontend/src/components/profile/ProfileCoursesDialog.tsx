/**
 * Dialog for linking AI service courses into the local library, fetching topics, and handling logout.
 * Lets users select courses from the AI service, skip ones already added, and persist them via courseService.
 */
import { useEffect, useMemo, useState } from 'react';
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@eduai/ui';
import { Button, Badge } from '@eduai/ui';
import { IconLoader2, IconLogout } from '@tabler/icons-react';
import { Class } from '../../types/class';
import { eduaiService, EduAICourseOption, EduAITopicOption } from '../../services/eduaiService';
import { courseService } from '../../services/courseService';
import { assessmentService } from '../../services/assessmentService';
import { useAuth } from '../../contexts/AuthContext';
import { useEduAIStatus } from '../../hooks/useEduAIStatus';
import { AIServiceIndicators } from '../eduai/AIServiceIndicators';
import { toast } from 'sonner';

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
    const { logout, user } = useAuth();
    const eduaiStatus = useEduAIStatus();

    // Identity for "already added" is the Core course id (#1072 §4 step 6 — no
    // code-matching). Every QM course is created already linked, so a course
    // the caller has added always carries the same `coreCourseId` as the Core
    // option it was created from.
    const existingCoreCourseIdSet = useMemo(() => {
        const ids = new Set<string>();
        existingCourses.forEach((course) => {
            if (course.coreCourseId) {
                ids.add(course.coreCourseId);
            }
        });
        return ids;
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

    const findLocalCourseByCoreId = (coreCourseId: string) =>
        existingCourses.find((course) => course.coreCourseId === coreCourseId);

    const loadTopicsForCourse = async (coreCourseId: string) => {
        if (topicsByCourse[coreCourseId]) return;
        const topics = await eduaiService.listCoreCourseTopics(coreCourseId);
        setTopicsByCourse((prev) => ({ ...prev, [coreCourseId]: topics }));
    };

    const handleResyncCourse = async (option: EduAICourseOption) => {
        const localCourse = findLocalCourseByCoreId(option.id);
        if (!localCourse?.id) {
            toast.error('Local course not found', {
                description: 'Could not find the Question Maker course linked to this Core course.',
            });
            return;
        }

        setResyncingCoreId(option.id);
        setError(null);
        try {
            // Already linked (matched by coreCourseId above) — just refresh topics.
            await courseService.syncTopicsFromCore(localCourse.id);
            if (onCoursesAdded) {
                await onCoursesAdded();
            }
            toast('Course re-synced', { description: `${option.code} topics are updated from Core.` });
        } catch (err) {
            console.error('Failed to re-sync course from Core', err);
            setError('Unable to re-sync this course. Please try again.');
        } finally {
            setResyncingCoreId(null);
        }
    };

    const handleLogout = () => {
        onClose();
        logout();
    };

    const handleSave = async () => {
        // Selected ids are already unique (checkbox toggle) and already
        // Core-course ids, so identity is just a set-membership check —
        // no code matching needed (#1072 §4 step 6).
        const targetCourseIds = selectedCourseIds.filter(
            (id) => !existingCoreCourseIdSet.has(id)
        );

        if (targetCourseIds.length === 0) {
            toast('No new courses selected', {
                description: 'Select at least one AI service course that is not already in your library.',
            });
            return;
        }

        setIsSaving(true);
        try {
            let createdCount = 0;

            for (const courseId of targetCourseIds) {
                const option = courseOptions.find((item) => item.id === courseId);
                if (!option) continue;

                // `name`/`code` are Core-owned and never sent to create — the
                // anchor row is just the Core link (#1072 §4 step 10).
                const createdCourse = await courseService.createCourse({
                    coreCourseId: courseId
                });

                try {
                    await courseService.linkAndSyncFromCore(createdCourse.id, courseId);
                } catch (linkError) {
                    await courseService.deleteCourse(createdCourse.id).catch(() => undefined);
                    throw linkError;
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
                toast(`Added ${createdCount} course${createdCount > 1 ? 's' : ''}`, {
                    description: 'Courses linked to Core and topics synced.',
                });
            } else {
                toast('Courses already linked', {
                    description: 'The selected courses were already in your library.',
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
                                Link courses from the AI service to your question bank.
                            </DialogDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            <AIServiceIndicators
                                status={eduaiStatus.status}
                                message={eduaiStatus.message}
                                provider={eduaiStatus.provider}
                                onRefresh={eduaiStatus.refresh}
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

                    {isLoading ? (
                        <div className="flex items-center justify-center py-12 text-muted-foreground">
                            <IconLoader2 className="mr-2 h-5 w-5 animate-spin" />
                            Loading courses from AI service...
                        </div>
                    ) : (
                        <div className="max-h-80 space-y-3 overflow-y-auto pr-1" data-tour-id="profile-course-list">
                            {courseOptions.map((option) => {
                                const isAdded = existingCoreCourseIdSet.has(option.id);
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
                                                    ? 'border-primary bg-primary/10'
                                                    : 'border-border hover:border-primary/40 hover:bg-primary/10'
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
                                                            <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
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
                                        ? 'Unable to load courses from the AI service. Please try again.'
                                        : 'No courses available from the AI service right now. Ask an administrator to enroll you in a course.'}
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
                        <IconLogout className="h-4 w-4" />
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
