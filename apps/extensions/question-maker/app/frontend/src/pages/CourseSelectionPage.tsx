/**
 * Course selection page shown after login. User must select a course card to continue to Question Bank / Assessments.
 * Same header as homepage; content shows "Your Courses", "Add new course" card, and available course cards.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useAuth } from '@/contexts/AuthContext';
import { useQmPermissions } from '@/hooks/useQmPermissions';
import { useQmLayout } from '../components/layout/QmLayoutContext';
import { CoursesAdminView } from '@/components/courses/courses-admin-view';
import { CoursesInstructorView } from '@/components/courses/courses-instructor-view';
import { CoursesUnitAdminView } from '@/components/courses/courses-unit-admin-view';
import { useDisplayCourses } from '../hooks/useDisplayCourses';
import { Course } from '../types/question';
import { courseService } from '../services/courseService';
import { useGuidedTour } from '../contexts/GuidedTourContext';
import { assessmentService } from '../services/assessmentService';
import { isSandboxCourse, SANDBOX_COURSE_CODE } from '@/utils/courseDisplay';

const TEST_COURSE_CODE = SANDBOX_COURSE_CODE;
const TEST_COURSE_NAME = 'Sandbox Course';
const TOUR_COURSE_STORAGE_KEY = 'qm:tour-course-id';

function isTestCourse(course: Course): boolean {
  return isSandboxCourse(course);
}

function readTourCourseId(): number | null {
  try {
    const fromStorage = sessionStorage.getItem(TOUR_COURSE_STORAGE_KEY);
    if (fromStorage) {
      const parsed = Number(fromStorage);
      if (Number.isInteger(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

function writeTourCourseId(courseId: number) {
  try {
    sessionStorage.setItem(TOUR_COURSE_STORAGE_KEY, String(courseId));
  } catch {
    // ignore
  }
}

function clearTourCourseId() {
  try {
    sessionStorage.removeItem(TOUR_COURSE_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export const CourseSelectionPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { canLinkCourse } = useQmPermissions();
  const { displayCourses, isLoading: isCoursesLoading, fetchCourses } = useDisplayCourses();
  const [isStartingTour, setIsStartingTour] = useState(false);
  const [tourHighlightCourseId, setTourHighlightCourseId] = useState<number | null>(null);
  const { setGuidedTourHandler, openProfile } = useQmLayout();
  const { startTour, registerStepAction, isActive: isTourActive } = useGuidedTour();
  const coursesRef = useRef(displayCourses);
  coursesRef.current = displayCourses;

  const handleSelectCourse = (course: Course) => {
    navigate('/home', { state: { courseId: course.id }, replace: true });
  };

  const resolveTourCourseId = useCallback((): number | null => {
    const state = location.state as { returnCourseId?: number } | null;
    if (state?.returnCourseId != null) return state.returnCourseId;

    const stored = readTourCourseId();
    if (stored != null && displayCourses.some((c) => c.id === stored)) return stored;

    const sandbox = displayCourses.find(isTestCourse);
    if (sandbox) return sandbox.id;

    return displayCourses[0]?.id ?? null;
  }, [displayCourses, location.state]);

  const handleGuidedTourClick = useCallback(async () => {
    if (isStartingTour) return;
    setIsStartingTour(true);
    try {
      let tourCourse = displayCourses.find(isTestCourse);
      if (!tourCourse) {
        const created = await courseService.createCourse({
          name: TEST_COURSE_NAME,
          courseCode: TEST_COURSE_CODE,
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
        tourCourse = created;
      }

      if (tourCourse?.id) {
        writeTourCourseId(tourCourse.id);
        setTourHighlightCourseId(tourCourse.id);
      }

      startTour('main');
    } catch (err) {
      console.error('Failed to start guided tour', err);
    } finally {
      setIsStartingTour(false);
    }
  }, [displayCourses, fetchCourses, isStartingTour, startTour]);

  // Auto-start guided tour for new users (just registered and landed on /courses).
  useEffect(() => {
    try {
      if (sessionStorage.getItem('newUserTourPending') !== '1') return;
      if (isCoursesLoading) return;
      const tourCourseId = resolveTourCourseId();
      if (tourCourseId != null) {
        setTourHighlightCourseId(tourCourseId);
        writeTourCourseId(tourCourseId);
      }
      const t = window.setTimeout(() => {
        try {
          sessionStorage.removeItem('newUserTourPending');
          startTour('main');
        } catch {
          // ignore
        }
      }, 400);
      return () => window.clearTimeout(t);
    } catch {
      // ignore
    }
  }, [startTour, isCoursesLoading, resolveTourCourseId]);

  // When arriving from homepage guided tour, start here and remember which course to reopen.
  useEffect(() => {
    const state = location.state as { startGuidedTour?: boolean; returnCourseId?: number } | null;
    if (!state?.startGuidedTour) return;

    if (state.returnCourseId != null) {
      writeTourCourseId(state.returnCourseId);
      setTourHighlightCourseId(state.returnCourseId);
    }

    startTour('main');
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.pathname, location.state, navigate, startTour]);

  // Step 1: open the highlighted course on the questions tab (never blindly pick courses[0]).
  useEffect(() => {
    if (!isTourActive) return;

    const unregister = registerStepAction('course-select', async () => {
      const tourCourseId = resolveTourCourseId();
      if (tourCourseId != null) {
        clearTourCourseId();
        navigate('/home?tab=questions', {
          state: { courseId: tourCourseId, startGuidedTour: true },
          replace: true,
        });
        return;
      }

      if (coursesRef.current.length > 0) {
        openProfile();
        return;
      }

      try {
        const created = await courseService.createCourse({
          name: TEST_COURSE_NAME,
          courseCode: TEST_COURSE_CODE,
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
          state: { courseId: created.id, startGuidedTour: true },
          replace: true,
        });
      } catch (err) {
        console.error('Failed to ensure course for tour', err);
        openProfile();
      }
    });

    return unregister;
  }, [isTourActive, registerStepAction, navigate, resolveTourCourseId, fetchCourses, openProfile]);

  useEffect(() => {
    setGuidedTourHandler(handleGuidedTourClick);
    return () => setGuidedTourHandler(null);
  }, [handleGuidedTourClick, setGuidedTourHandler]);

  const gridProps = {
    courses: displayCourses,
    isLoading: isCoursesLoading,
    onSelectCourse: handleSelectCourse,
    onAddCourse: openProfile,
    showAddCourse: canLinkCourse,
    tourHighlightCourseId,
  };

  if (user?.role === 'ADMIN') {
    return <CoursesAdminView {...gridProps} />;
  }
  if (user?.role === 'UNIT_ADMIN') {
    return <CoursesUnitAdminView {...gridProps} />;
  }
  return <CoursesInstructorView {...gridProps} />;
};
