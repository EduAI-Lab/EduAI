/**
 * Course selection page shown after login. User must select a course card to continue to Question Bank / Assessments.
 * Same header as homepage; content shows "Your Courses", "Add new course" card, and available course cards.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { TopNavigation } from '../components/navigation/TopNavigation';
import { useCourses } from '../hooks/useCourses';
import { Course } from '../types/question';
import { ProfileCoursesDialog } from '../components/profile/ProfileCoursesDialog';
import { courseService } from '../services/courseService';
import { GraduationCap, Plus } from 'lucide-react';
import { Card, CardContent } from '../components/ui/card';
import { Tooltip } from '../components/ui/tooltip';
import { useGuidedTour } from '../contexts/GuidedTourContext';
import { assessmentService } from '../services/assessmentService';

const TEST_COURSE_CODE = 'SANDBOX';
const TEST_COURSE_NAME = 'Sandbox Course';

function isTestCourse(course: Course): boolean {
  const code = (course.code ?? '').toUpperCase();
  const name = (course.name ?? '').toLowerCase();
  return code === TEST_COURSE_CODE || name.includes('test course');
}

export const CourseSelectionPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { courses, isLoading: isCoursesLoading, fetchCourses } = useCourses();
  const [profileOpen, setProfileOpen] = useState(false);
  const [isStartingTour, setIsStartingTour] = useState(false);
  const { startTour, registerStepAction, isActive: isTourActive } = useGuidedTour();
  const coursesRef = useRef(courses);
  coursesRef.current = courses;

  const handleSelectCourse = (course: Course) => {
    navigate('/home', { state: { courseId: course.id }, replace: true });
  };

  const handleProfileClick = () => {
    setProfileOpen(true);
  };

  const handleGuidedTourClick = useCallback(async () => {
    if (isStartingTour) return;
    setIsStartingTour(true);
    try {
      let testCourse: Course | undefined = courses.find(isTestCourse);
      if (!testCourse) {
        const created = await courseService.createCourse({
          name: TEST_COURSE_NAME,
          courseCode: TEST_COURSE_CODE
        });
        try {
          await courseService.createTopic(created.id, 'General');
        } catch {
          // ignore topic creation failure
        }
        try {
          await assessmentService.createPracticeExamForCourse(created.id);
        } catch {
          // ignore practice exam creation failure
        }
        await fetchCourses();
        testCourse = created;
      }

      startTour('main');
    } catch (err) {
      console.error('Failed to start guided tour', err);
    } finally {
      setIsStartingTour(false);
    }
  }, [courses, fetchCourses, isStartingTour, startTour]);

  // Auto-start guided tour for new users (just registered and landed on /courses).
  // Wait for courses to finish loading so the first step's target (course-select) exists in the DOM and the highlight can render.
  useEffect(() => {
    try {
      if (sessionStorage.getItem('newUserTourPending') !== '1') return;
      if (isCoursesLoading) return;
      const t = setTimeout(() => {
        try {
          sessionStorage.removeItem('newUserTourPending');
          startTour('main');
        } catch (_) {}
      }, 400);
      return () => clearTimeout(t);
    } catch (_) {}
  }, [startTour, isCoursesLoading]);

  // When arriving from homepage (e.g. user clicked Guided tour on Assessments tab), start the tour here and register step 1 to return to their course on questions tab.
  useEffect(() => {
    const state = location.state as { startGuidedTour?: boolean; returnCourseId?: number } | null;
    if (!state?.startGuidedTour || state.returnCourseId == null) return;

    const returnCourseId = state.returnCourseId;
    startTour('main');
    const unregister = registerStepAction('course-select', () => {
      navigate('/home?tab=questions', {
        state: { courseId: returnCourseId },
        replace: true
      });
    });
    return unregister;
  }, [location.state, startTour, registerStepAction, navigate]);

  // When tour is active on this page (e.g. auto-started for new user), register step 1 to navigate to homepage with a course so steps 2+ show the correct targets and highlights.
  useEffect(() => {
    if (!isTourActive) return;

    const unregister = registerStepAction('course-select', () => {
      const state = location.state as { startGuidedTour?: boolean; returnCourseId?: number } | null;
      if (state?.startGuidedTour && state?.returnCourseId != null) {
        navigate('/home?tab=questions', { state: { courseId: state.returnCourseId }, replace: true });
        return;
      }
      const currentCourses = coursesRef.current;
      if (currentCourses.length > 0) {
        navigate('/home?tab=questions', {
          state: { courseId: currentCourses[0].id },
          replace: true
        });
        return;
      }
      (async () => {
        try {
          const created = await courseService.createCourse({
            name: TEST_COURSE_NAME,
            courseCode: TEST_COURSE_CODE
          });
          try {
            await courseService.createTopic(created.id, 'General');
          } catch {
            // ignore
          }
          try {
            await assessmentService.createPracticeExamForCourse(created.id);
          } catch {
            // ignore
          }
          await fetchCourses();
          navigate('/home?tab=questions', {
            state: { courseId: created.id },
            replace: true
          });
        } catch (err) {
          console.error('Failed to ensure course for tour', err);
        }
      })();
    });
    return unregister;
  }, [isTourActive, registerStepAction, navigate, location.state, fetchCourses]);

  return (
    <div className="min-h-screen bg-background">
      <TopNavigation
        variant="course-selection"
        courses={courses}
        isLoadingCourses={isCoursesLoading}
        onProfileClick={handleProfileClick}
        onGuidedTourClick={handleGuidedTourClick}
      />

      <div className="max-w-4xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold text-foreground mb-6">Your Courses</h1>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-stretch">
          {/* Add new course card - used as tour target when there are no courses yet */}
          <Tooltip content="Add or link a course from the AI service to get started" side="top">
            <Card
              className="border-2 border-dashed border-muted-foreground/30 bg-muted/30 hover:border-primary hover:bg-muted/50 cursor-pointer transition-colors flex min-h-[140px]"
              data-tour-id={courses.length === 0 ? 'course-select' : undefined}
              onClick={() => setProfileOpen(true)}
            >
              <CardContent className="flex flex-col items-center justify-center flex-1 p-6">
              <div className="rounded-full bg-muted p-3 mb-2">
                <Plus className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">Add new course</p>
            </CardContent>
            </Card>
          </Tooltip>

          {/* Available course cards */}
          {courses.map((course, index) => (
            <Tooltip key={course.id} content={`Open question bank and assessments for ${course.name}`} side="top">
              <Card
                className="cursor-pointer transition-shadow hover:shadow-md border bg-card text-card-foreground flex min-h-[140px]"
                data-tour-id={index === 0 ? 'course-select' : undefined}
                onClick={() => handleSelectCourse(course)}
              >
                <CardContent className="flex flex-col flex-1 p-6 justify-center">
                <div className="flex items-center gap-2 min-w-0">
                  <GraduationCap className="h-5 w-5 text-primary shrink-0" />
                  <span className="font-semibold truncate">{course.name}</span>
                </div>
                {course.code && (
                  <p className="text-sm text-muted-foreground mt-1">{course.code}</p>
                )}
                <p className="text-xs text-muted-foreground/80 mt-2">Click to open</p>
              </CardContent>
              </Card>
            </Tooltip>
          ))}
        </div>

        {!isCoursesLoading && courses.length === 0 && (
          <p className="text-sm text-muted-foreground mt-4">
            No courses yet. Add a course from your profile to get started.
          </p>
        )}
      </div>

      <ProfileCoursesDialog
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        existingCourses={courses}
        onCoursesAdded={fetchCourses}
      />
    </div>
  );
};
