/**
 * Course selection page shown after login. User must select a course card to continue to Question Bank / Assessments.
 * Same header as homepage; content shows course cards and sandbox course option.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useAuth } from '@/contexts/AuthContext';
import { useQmLayout } from '../components/layout/QmLayoutContext';
import { CoursesAdminView } from '@/components/courses/courses-admin-view';
import { CoursesInstructorView } from '@/components/courses/courses-instructor-view';
import { CoursesUnitAdminView } from '@/components/courses/courses-unit-admin-view';
import { useCourses } from '../hooks/useCourses';
import { Course } from '../types/question';
import { courseService } from '../services/courseService';
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
  const { user } = useAuth();
  const { courses, isLoading: isCoursesLoading, fetchCourses } = useCourses();
  const [isStartingTour, setIsStartingTour] = useState(false);
  const { setGuidedTourHandler, openProfile } = useQmLayout();
  const { startTour, registerStepAction, isActive: isTourActive } = useGuidedTour();
  const coursesRef = useRef(courses);
  coursesRef.current = courses;

  const handleSelectCourse = (course: Course) => {
    navigate('/home', { state: { courseId: course.id }, replace: true });
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

  useEffect(() => {
    setGuidedTourHandler(handleGuidedTourClick);
    return () => setGuidedTourHandler(null);
  }, [handleGuidedTourClick, setGuidedTourHandler]);

  const gridProps = {
    courses,
    isLoading: isCoursesLoading,
    onSelectCourse: handleSelectCourse,
    onAddCourse: openProfile,
  };

  if (user?.role === 'ADMIN') {
    return <CoursesAdminView {...gridProps} />;
  }
  if (user?.role === 'UNIT_ADMIN') {
    return <CoursesUnitAdminView {...gridProps} />;
  }
  return <CoursesInstructorView {...gridProps} />;
};
