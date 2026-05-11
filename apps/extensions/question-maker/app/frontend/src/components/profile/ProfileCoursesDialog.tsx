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

interface ProfileCoursesDialogProps {
    open: boolean;
    onClose: () => void;
    existingCourses: Class[];
    onCoursesAdded?: () => Promise<void> | void;
}

const normalizeCourseCode = (value: string | null | undefined) =>
    value ? value.replace(/\s+/g, '').toLowerCase() : '';

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

                const entries = await Promise.all(
                    options.map(async (option) => {
                        // Pass both the course ID and code to help with topic lookup
                        const topics = await eduaiService.listCourseTopics(option.id, option.code);
                        return [option.id, topics] as const;
                    })
                );

                if (!isMounted) return;
                setTopicsByCourse(Object.fromEntries(entries));
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

    const toggleCourse = (courseId: string) => {
        setSelectedCourseIds((prev) =>
            prev.includes(courseId) ? prev.filter((id) => id !== courseId) : [...prev, courseId]
        );
    };

    const handleDialogChange = (value: boolean) => {
        if (!value && !isSaving) {
            onClose();
        }
    };

    const handleLogout = () => {
        logout();
        onClose();
        navigate('/login');
        toast({
            title: 'Logged out',
            description: 'You have been successfully logged out.'
        });
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
                subject: testCourseName,
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
                    subject: option.name,
                    courseCode: option.code
                });

                if (normalizedCode) {
                    updatedCodes.add(normalizedCode);
                }

                const topics = topicsByCourse[courseId] ?? [];
                for (const topic of topics) {
                    await courseService.createTopic(createdCourse.id, topic.name);
                }

                createdCount += 1;
            }

            if (createdCount > 0) {
                if (onCoursesAdded) {
                    await onCoursesAdded();
                }
                toast({
                    title: `Added ${createdCount} course${createdCount > 1 ? 's' : ''}`,
                    description: 'Courses and topics have been synced from the AI service.'
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

                                return (
                                    <label
                                        key={option.id}
                                        className={`flex cursor-pointer items-start gap-3 rounded-md border p-4 shadow-sm transition ${
                                            isAdded
                                                ? 'cursor-not-allowed border-muted bg-muted/40 opacity-80'
                                                : isSelected
                                                    ? 'border-blue-500 bg-blue-50'
                                                    : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50/40'
                                        }`}
                                    >
                                        <input
                                            type="checkbox"
                                            className="mt-1 h-4 w-4"
                                            checked={isSelected}
                                            onChange={() => toggleCourse(option.id)}
                                            disabled={isAdded || isSaving}
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
                                                {isAdded && <Badge variant="outline" data-tour-id="profile-added-badge">Already added</Badge>}
                                                {isSelected && !isAdded && !isSaving && (
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

                {user?.isBugReportAdmin && (
                    <div className="border-t px-6 py-2">
                        <Button
                            type="button"
                            variant="link"
                            className="h-auto p-0 text-sm text-blue-700"
                            onClick={() => {
                                navigate('/admin/bug-reports');
                                onClose();
                            }}
                        >
                            Bug reports (admin)
                        </Button>
                    </div>
                )}

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
                        <Button variant="ghost" onClick={onClose} disabled={isSaving}>
                            Cancel
                        </Button>
                        <Button onClick={handleSave} disabled={isSaving || isLoading} data-tour-id="profile-add-button">
                            {isSaving ? 'Linking…' : 'Add selected courses'}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
