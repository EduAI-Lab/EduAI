import { useCallback, useEffect, useRef, useState } from "react";

export interface StudentCandidate {
  id: string;
  name: string;
  email: string;
}

const SEARCH_DEBOUNCE_MS = 250;

/**
 * The role set each picker asks for. #1840: the instructor picker asks for the
 * whole STAFF set, not platform-role INSTRUCTOR alone — an ADMIN account can
 * hold an INSTRUCTOR enrollment, and the INSTRUCTOR-only list is exactly why
 * Dr. Abdallah ended up running two accounts (#1782). The server pins each
 * mode to its own role set and gates the instructor mode at rank >= 3.
 */
const CANDIDATE_ROLES = {
  enrolled: "STUDENT",
  ta: "STUDENT",
  instructor: "ADMIN,UNIT_ADMIN,INSTRUCTOR",
} as const;

export type CandidateExclude = keyof typeof CANDIDATE_ROLES;

/**
 * Search-select backend for the "add student" / "add TA" / "add instructor"
 * pickers. It uses the paginated users API rather than preloading a
 * platform-wide user list in the course loader.
 */
export function useStudentCandidates(courseId: string | undefined, exclude: CandidateExclude) {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<StudentCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards against an in-flight request from a stale keystroke resolving after
  // a newer one and clobbering fresher results (#1042 review).
  const requestIdRef = useRef(0);

  const search = useCallback((next: string) => {
    setQuery(next);
  }, []);

  useEffect(() => {
    if (!courseId) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      try {
        const params = new URLSearchParams({
          courseId,
          exclude,
          page: "1",
          pageSize: "25",
          role: CANDIDATE_ROLES[exclude],
          isActive: "true",
        });
        if (query.trim()) params.set("search", query.trim());
        const res = await fetch(`/api/users?${params}`);
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as { data: StudentCandidate[] };
        if (requestId !== requestIdRef.current) return;
        setCandidates(data.data);
      } catch {
        if (requestId !== requestIdRef.current) return;
        setCandidates([]);
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [courseId, exclude, query]);

  return { candidates, loading, search };
}
