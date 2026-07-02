import { useCallback, useEffect, useState } from "react";

import {
  COURSE_CARD_PREFERENCES_KEY,
  mergeCourseCardPreference,
  readCourseCardPreferences,
  writeCourseCardPreferences,
  type CourseCardPreference,
  type CourseCardPreferencesMap,
} from "~/lib/courses/course-card-preferences";

export function useCourseCardPreferences() {
  const [prefs, setPrefs] = useState<CourseCardPreferencesMap>(() => readCourseCardPreferences());

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === COURSE_CARD_PREFERENCES_KEY) {
        setPrefs(readCourseCardPreferences());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setCoursePreference = useCallback(
    (courseId: string, update: CourseCardPreference | null) => {
      setPrefs((current) => {
        const next = mergeCourseCardPreference(current, courseId, update);
        writeCourseCardPreferences(next);
        return next;
      });
    },
    [],
  );

  const getCoursePreference = useCallback(
    (courseId: string) => prefs[courseId],
    [prefs],
  );

  return { prefs, setCoursePreference, getCoursePreference };
}
