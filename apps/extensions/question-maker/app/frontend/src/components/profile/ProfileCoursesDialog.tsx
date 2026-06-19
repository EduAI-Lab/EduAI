/**
 * Dialog for creating a sandbox course and logging out.
 * Core-linked courses are mirrored automatically on sign-in and course list loads.
 */
import { useState } from 'react';
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
import { courseService } from '../../services/courseService';
import { assessmentService } from '../../services/assessmentService';
import { useToast } from '../ui/use-toast';
import { useAuth } from '../../contexts/AuthContext';
import { useEduAIStatus } from '../../hooks/useEduAIStatus';
import { EduAIStatusBadge } from '../eduai/EduAIStatusBadge';
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
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { toast } = useToast();
    const { logout } = useAuth();
    const eduaiStatus = useEduAIStatus();

    const handleDialogChange = (value: boolean) => {
        if (!value && !isSaving) {
            onClose();
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
            const testCourseCode = 'TEST';
            const testCourseName = 'Test Course';
            const normalizedTestCourseName = normalizeCourseCode(testCourseName);

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
                    description: 'You already have a sandbox course you can use for practice.',
                    variant: 'default'
                });
                setIsSaving(false);
                return;
            }

            const createdCourse = await courseService.createCourse({
                name: testCourseName,
                courseCode: testCourseCode
            });

            try {
                await courseService.createTopic(createdCourse.id, 'General');
            } catch (topicError) {
                console.warn('Failed to create default topic for test course', topicError);
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
                title: 'Sandbox course created',
                description: 'Use it to draft questions without linking to Core.'
            });

            onClose();
        } catch (err) {
            console.error('Failed to create test course', err);
            setError('Unable to create sandbox course. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleDialogChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <DialogTitle>Courses</DialogTitle>
                            <DialogDescription>
                                Courses you teach in Core appear automatically. Create a sandbox
                                course here for local practice only.
                            </DialogDescription>
                        </div>
                        <EduAIStatusBadge
                            status={eduaiStatus.status}
                            message={eduaiStatus.message}
                            onRefresh={eduaiStatus.refresh}
                            questionGenerationPhase={eduaiStatus.questionGenerationPhase}
                            className="z-50 shrink-0"
                        />
                    </div>
                </DialogHeader>

                {error && (
                    <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        {error}
                    </div>
                )}

                <div className="mt-2">
                    <div className="rounded-md border-2 border-dashed border-blue-300 bg-blue-50/50 p-4">
                        <div className="flex items-center justify-between gap-4">
                            <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="text-sm font-semibold text-foreground">Sandbox course</span>
                                    <Badge variant="outline" className="text-xs">No Core link</Badge>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Create a local practice course for drafting questions without Core.
                                </p>
                            </div>
                            <Button
                                onClick={() => void handleCreateTestCourse()}
                                disabled={isSaving}
                                variant="default"
                            >
                                {isSaving ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Creating…
                                    </>
                                ) : (
                                    <>
                                        <Plus className="mr-2 h-4 w-4" />
                                        Create
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>
                </div>

                <DialogFooter className="flex items-center justify-between sm:justify-between">
                    <Button
                        variant="outline"
                        onClick={handleLogout}
                        className="flex items-center gap-2 text-destructive hover:text-destructive"
                    >
                        <LogOut className="h-4 w-4" />
                        <span>Logout</span>
                    </Button>
                    <Button variant="ghost" onClick={onClose} disabled={isSaving}>
                        Close
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
