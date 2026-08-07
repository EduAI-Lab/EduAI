/**
 * Course selection page shown after login. User must select a course card to continue to Question Bank / Assessments.
 * Same header as homepage; content shows "Your Courses", "Add new course" card, and available course cards.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useAuth } from '@/contexts/AuthContext';
import { useQmLayout } from '../components/layout/QmLayoutContext';
import { CoursesRoleView } from '@/components/courses/courses-role-view';
import { CoursesUnitAdminView } from '@/components/courses/courses-unit-admin-view';
import { useDisplayCourses } from '../hooks/useDisplayCourses';
import { Course } from '../types/question';
import { useGuidedTour } from '../contexts/GuidedTourContext';

const TOUR_COURSE_STORAGE_KEY = 'qm:tour-course-id';

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
  const { displayCourses, isLoading: isCoursesLoading } = useDisplayCourses();
  const [isStartingTour, setIsStartingTour] = useState(false);
  const [tourHighlightCourseId, setTourHighlightCourseId] = useState<number | null>(null);
  const { setGuidedTourHandler, openProfile } = useQmLayout();
  const { startTour, registerStepAction, isActive: isTourActive } = useGuidedTour();

  const handleSelectCourse = (course: Course) => {
    // Push (not replace) so the browser Back button returns to the dashboard.
    navigate(`/courses/${course.id}?tab=overview`);
  };

  const resolveTourCourseId = useCallback((): number | null => {
    const state = location.state as { returnCourseId?: number } | null;
    if (state?.returnCourseId != null) return state.returnCourseId;

    const stored = readTourCourseId();
    if (stored != null && displayCourses.some((c) => c.id === stored)) return stored;

    return displayCourses[0]?.id ?? null;
  }, [displayCourses, location.state]);

  const handleGuidedTourClick = useCallback(async () => {
    if (isStartingTour) return;
    setIsStartingTour(true);
    try {
      // Course creation is owned by EduAI Core; the tour uses an existing course.
      // With no courses, guide the user to link one from Core via the profile flow.
      const tourCourse = displayCourses[0];
      if (tourCourse?.id) {
        writeTourCourseId(tourCourse.id);
        setTourHighlightCourseId(tourCourse.id);
      } else {
        openProfile();
      }
      startTour('main');
    } catch (err) {
      console.error('Failed to start guided tour', err);
    } finally {
      setIsStartingTour(false);
    }
  }, [displayCourses, isStartingTour, startTour, openProfile]);

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
        navigate(`/courses/${tourCourseId}?tab=questions`, { replace: true });
        return;
      }
      // No course to open — courses come from Core, so open the link flow.
      openProfile();
    });

    return unregister;
  }, [isTourActive, registerStepAction, navigate, resolveTourCourseId, openProfile]);

  useEffect(() => {
    setGuidedTourHandler(handleGuidedTourClick);
    return () => setGuidedTourHandler(null);
  }, [handleGuidedTourClick, setGuidedTourHandler]);

  const gridProps = {
    courses: displayCourses,
    isLoading: isCoursesLoading,
    onSelectCourse: handleSelectCourse,
    tourHighlightCourseId,
  };

  if (user?.role === 'ADMIN') {
    return <CoursesRoleView role="admin" {...gridProps} />;
  }
  if (user?.role === 'UNIT_ADMIN') {
    return <CoursesUnitAdminView {...gridProps} />;
  }
  return <CoursesRoleView role="instructor" {...gridProps} />;
};
