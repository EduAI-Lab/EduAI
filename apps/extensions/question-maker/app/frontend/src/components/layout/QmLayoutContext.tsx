import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/** A course's Canvas link as its page last saw it: `null` while still resolving. */
export type CanvasLinkStatus = boolean | null;

type QmLayoutContextValue = {
  profileOpen: boolean;
  openProfile: () => void;
  closeProfile: () => void;
  /**
   * What each visited course page learned about its Canvas link. The shell's
   * course menu only lists Canvas for a linked course, but the link is
   * resolved by the course page, so the page reports it here.
   */
  canvasLinks: Readonly<Record<number, CanvasLinkStatus>>;
  reportCanvasLink: (courseId: number, status: CanvasLinkStatus) => void;
};

const QmLayoutContext = createContext<QmLayoutContextValue | null>(null);

export function QmLayoutProvider({ children }: { children: ReactNode }) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [canvasLinks, setCanvasLinks] = useState<Record<number, CanvasLinkStatus>>({});

  const openProfile = useCallback(() => setProfileOpen(true), []);
  const closeProfile = useCallback(() => setProfileOpen(false), []);
  const reportCanvasLink = useCallback((courseId: number, status: CanvasLinkStatus) => {
    setCanvasLinks((prev) =>
      courseId in prev && prev[courseId] === status ? prev : { ...prev, [courseId]: status },
    );
  }, []);

  const value = useMemo(
    () => ({
      profileOpen,
      openProfile,
      closeProfile,
      canvasLinks,
      reportCanvasLink,
    }),
    [profileOpen, openProfile, closeProfile, canvasLinks, reportCanvasLink],
  );

  return <QmLayoutContext.Provider value={value}>{children}</QmLayoutContext.Provider>;
}

export function useQmLayout() {
  const ctx = useContext(QmLayoutContext);
  if (!ctx) {
    throw new Error("useQmLayout must be used within QmLayoutProvider");
  }
  return ctx;
}

/** A course's last reported Canvas link; `undefined` until its page reports. */
export function useCanvasLinkStatus(courseId: number | null): CanvasLinkStatus | undefined {
  const ctx = useContext(QmLayoutContext);
  return courseId == null ? undefined : ctx?.canvasLinks[courseId];
}

/**
 * Called by the course page with its resolved Canvas link. A no-op outside the
 * layout (page tests render the page on its own).
 */
export function useReportCanvasLink(
  courseId: number | null | undefined,
  status: CanvasLinkStatus,
): void {
  const report = useContext(QmLayoutContext)?.reportCanvasLink;
  useEffect(() => {
    if (report && courseId != null) report(courseId, status);
  }, [report, courseId, status]);
}
