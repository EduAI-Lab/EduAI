/**
 * QM dashboard container (#2119). Wires auth, courses, question/assessment data,
 * bug reports and AI status into the per-role model, then renders the presentational view.
 */
import { useEffect, useMemo, useState } from "react";
import { Badge, type ServiceState } from "@eduai/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useDisplayCourses } from "@/hooks/useDisplayCourses";
import { useQuestionStats } from "@/hooks/useQuestionStats";
import { useAllQuestions } from "@/hooks/useAllQuestions";
import { useAllAssessments } from "@/hooks/useAllAssessments";
import { useQmPermissions } from "@/hooks/useQmPermissions";
import { useAiServicesStatus } from "@/hooks/useAiServicesStatus";
import { useCanvasLinks } from "@/hooks/useCanvasLinks";
import { bugReportApi } from "@/services/bugReportApi";
import { qmCourseLinks } from "@/components/courses/QmCourseCard";
import { QmDashboardView, type QmGlanceCell } from "@/components/dashboard/QmDashboardView";
import {
  buildAttentionRows,
  buildGlanceStats,
  buildSections,
  dashboardRole,
  firstNameOf,
  heroCopy,
  type QmDashboardInput,
} from "@/components/dashboard/qmDashboardModel";

const BUG_LIST_LIMIT = 100;

const WORD = {
  operational: "OK",
  degraded: "DEGRADED",
  outage: "FAILED",
  loading: "CHECKING",
  unknown: "UNKNOWN",
} satisfies Record<ServiceState, string>;

function pill(state: ServiceState): "success" | "warning" | "destructive" | "muted" {
  if (state === "operational") return "success";
  if (state === "degraded") return "warning";
  if (state === "outage") return "destructive";
  return "muted";
}

type BugSummary = { unhandled: number; capped: boolean } | null;

export default function DashboardPage() {
  const { user } = useAuth();
  const { displayCourses, isLoading: coursesLoading } = useDisplayCourses();
  const { stats: questionStats } = useQuestionStats();
  const { questions, isLoading: questionsLoading, error: questionsError } = useAllQuestions();
  const {
    assessments,
    isLoading: assessmentsLoading,
    error: assessmentsError,
  } = useAllAssessments();
  const { canTriageBugReports, canManageCanvas } = useQmPermissions();
  const ai = useAiServicesStatus();
  const [bugs, setBugs] = useState<BugSummary>(null);

  useEffect(() => {
    if (!canTriageBugReports) return;
    let cancelled = false;
    bugReportApi
      .list({ source: "QUESTION_MAKER" })
      .then((rows) => {
        if (cancelled) return;
        setBugs({
          unhandled: rows.filter((r) => r.status === "unhandled").length,
          capped: rows.length >= BUG_LIST_LIMIT,
        });
      })
      .catch(() => {
        if (!cancelled) setBugs(null);
      });
    return () => {
      cancelled = true;
    };
  }, [canTriageBugReports]);

  const role = dashboardRole(user?.questionMakerRole ?? user?.role);
  const input = useMemo<QmDashboardInput>(
    () => ({
      role,
      authorizedUnits: user?.authorizedUnits ?? [],
      courses: displayCourses,
      questions,
      questionsFailed: questionsError !== null,
      questionTotal: questionStats?.totalQuestions ?? null,
      assessments,
      assessmentsFailed: assessmentsError !== null,
      unhandledBugReports: bugs?.unhandled ?? null,
      bugReportsCapped: bugs?.capped ?? false,
    }),
    [
      role,
      user?.authorizedUnits,
      displayCourses,
      questions,
      questionsError,
      questionStats,
      assessments,
      assessmentsError,
      bugs,
    ],
  );

  const { sections, courseTotal } = useMemo(() => buildSections(input), [input]);
  const attentionRows = useMemo(() => buildAttentionRows(input), [input]);
  const stats = useMemo<QmGlanceCell[]>(() => {
    const cells: QmGlanceCell[] = buildGlanceStats(input);
    if (role === "ADMIN") {
      cells.push({
        label: "AI models",
        value: (
          <div className="flex flex-col items-start gap-1">
            <Badge size="sm" variant={pill(ai.ubc.state)}>
              UBC {WORD[ai.ubc.state]}
            </Badge>
            <Badge size="sm" variant={pill(ai.cloud.state)}>
              CLOUD {WORD[ai.cloud.state]}
            </Badge>
          </div>
        ),
      });
    }
    return cells;
  }, [input, role, ai.ubc.state, ai.cloud.state]);

  const shownIds = useMemo(() => sections.flatMap((s) => s.courses.map((c) => c.id)), [sections]);
  const linked = useCanvasLinks(shownIds, canManageCanvas);
  const { heading, subheading } = heroCopy(role, firstNameOf(user?.name));

  return (
    <QmDashboardView
      heading={heading}
      subheading={subheading}
      sections={sections}
      courseTotal={courseTotal}
      coursesLoading={coursesLoading}
      sideLoading={coursesLoading || questionsLoading || assessmentsLoading}
      attentionRows={attentionRows}
      stats={stats}
      linksFor={(c) => qmCourseLinks(c, linked.has(c.id))}
    />
  );
}
