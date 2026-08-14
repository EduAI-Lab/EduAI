/**
 * Root app component: wires auth providers, router, and top-level pages.
 * Defines navigation for login, homepage, assessments, help, and an optional API test route.
 */
import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useSearchParams } from 'react-router';
import { Toaster, ThemeProvider, ThemeSyncInitializer } from '@eduai/ui';
import { AuthProvider } from './contexts/AuthContext';
import { QmAppGate } from './components/auth/QmAppGate';
import { QmAppLayout } from './components/layout/QmAppLayout';
import { GuidedTourProvider } from './contexts/GuidedTourContext';
import { BugReportProvider } from './contexts/BugReportContext';

// Pages are lazy so each route becomes its own chunk. Importing them statically
// collapsed the whole app into a single entry chunk, which is what everyone
// downloaded before rendering the dashboard — including the question bank's OCR
// stack and the assessment builder's Word export. Nothing here is above the fold
// on more than one route, so there is no reason to ship them together.
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const QuestionBankPage = lazy(() => import('./pages/QuestionBankPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const AssessmentBuilderPage = lazy(() => import('./pages/AssessmentBuilderPage'));
const CourseSelectionPage = lazy(() =>
  import('./pages/CourseSelectionPage').then((m) => ({ default: m.CourseSelectionPage }))
);
const CourseDetailPage = lazy(() =>
  import('./pages/CourseDetailPage').then((m) => ({ default: m.CourseDetailPage }))
);
const QuestionComposerPage = lazy(() =>
  import('./pages/QuestionComposerPage').then((m) => ({ default: m.QuestionComposerPage }))
);
const ApiTestPage = lazy(() => import('./pages/ApiTestPage').then((m) => ({ default: m.ApiTestPage })));
const HelpPage = lazy(() => import('./pages/HelpPage').then((m) => ({ default: m.HelpPage })));
const BugReportsAdminPage = lazy(() =>
  import('./pages/BugReportsAdminPage').then((m) => ({ default: m.BugReportsAdminPage }))
);
const AssessmentVariantPage = lazy(() =>
  import('./pages/AssessmentVariantPage').then((m) => ({ default: m.AssessmentVariantPage }))
);
const BankDetailPage = lazy(() => import('./pages/BankDetailPage'));

/** Shown while a route chunk is in flight. Deliberately plain — it is visible for a few hundred ms at most. */
function RouteFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-label="Loading">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
    </div>
  );
}

/** Legacy `/home` route: redirect to the default course's course detail page, falling back to /courses */
function RedirectHomeRoute() {
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') || 'overview';

  // Try to read the old localStorage preference for back-compat
  let preferredCourseId: number | null = null;
  try {
    const stored = localStorage.getItem('home:last-selected-course');
    if (stored) {
      const parsed = Number(stored);
      if (Number.isInteger(parsed)) {
        preferredCourseId = parsed;
      }
    }
  } catch {
    // ignore localStorage errors
  }

  if (preferredCourseId) {
    return <Navigate to={`/courses/${preferredCourseId}?tab=${tabParam}`} replace />;
  }
  return <Navigate to="/courses" replace />;
}

/** Legacy `/study` URLs forward to the assessment variant workflow, preserving query string. */
function RedirectLegacyStudyRoute() {
  const [searchParams] = useSearchParams();
  const baselineAssessmentId = searchParams.get('baselineAssessmentId');
  const courseId = searchParams.get('courseId');

  // If both courseId and baselineAssessmentId are present, redirect to nested variant route
  if (courseId && baselineAssessmentId) {
    return <Navigate to={`/courses/${courseId}/assessments/${baselineAssessmentId}/variants`} replace />;
  }

  // If only courseId is present, redirect to nested variant route without baseline
  if (courseId) {
    return <Navigate to={`/courses/${courseId}/assessments/variants`} replace />;
  }

  // Fallback to courses page
  return <Navigate to="/courses" replace />;
}

/** Legacy `/assessment-variant` route redirects to the course-scoped variants route */
function RedirectLegacyVariantRoute() {
  const [searchParams] = useSearchParams();
  const courseId = searchParams.get('courseId');
  const baselineAssessmentId = searchParams.get('baselineAssessmentId');

  // If both courseId and baselineAssessmentId are present, redirect to nested variant route
  if (courseId && baselineAssessmentId) {
    return <Navigate to={`/courses/${courseId}/assessments/${baselineAssessmentId}/variants`} replace />;
  }

  // If only courseId is present, redirect to nested variant route
  if (courseId) {
    return <Navigate to={`/courses/${courseId}/assessments/variants`} replace />;
  }

  // Fallback to courses page
  return <Navigate to="/courses" replace />;
}

function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="theme">
      <ThemeSyncInitializer />
      <AuthProvider>
        <Router>
          <GuidedTourProvider>
            <QmAppGate>
              <BugReportProvider>
                <div className="min-h-screen bg-background">
                  <Suspense fallback={<RouteFallback />}>
                  <Routes>
                    <Route element={<QmAppLayout />}>
                      <Route path="/dashboard" element={<DashboardPage />} />
                      <Route path="/library" element={<QuestionBankPage />} />
                      <Route path="/settings" element={<SettingsPage />} />
                      <Route path="/help" element={<HelpPage />} />
                      <Route path="/admin/bug-reports" element={<BugReportsAdminPage />} />

                      {/* Course-centric workspace */}
                      <Route path="/courses" element={<CourseSelectionPage />} />
                      <Route path="/courses/:courseId" element={<CourseDetailPage />} />
                      <Route path="/courses/:courseId/questions/new" element={<QuestionComposerPage />} />
                      <Route path="/courses/:courseId/questions/:questionId/edit" element={<QuestionComposerPage />} />
                      <Route path="/courses/:courseId/banks/:bankId" element={<BankDetailPage />} />
                      <Route path="/courses/:courseId/assessments/:assessmentId" element={<AssessmentBuilderPage />} />
                      <Route path="/courses/:courseId/assessments/:assessmentId/variants" element={<AssessmentVariantPage />} />
                      <Route path="/courses/:courseId/assessments/variants" element={<AssessmentVariantPage />} />

                      {/* Legacy redirects → course-centric IA */}
                      <Route path="/question-bank" element={<Navigate to="/library" replace />} />
                      <Route path="/assessments" element={<Navigate to="/courses" replace />} />
                      <Route path="/assessments/:id/builder" element={<Navigate to="/courses" replace />} />
                      <Route path="/home" element={<RedirectHomeRoute />} />
                      <Route path="/assessment-variant" element={<RedirectLegacyVariantRoute />} />
                      <Route path="*" element={<Navigate to="/dashboard" replace />} />
                    </Route>
                    <Route path="/landing" element={<Navigate to="/dashboard" replace />} />
                    {import.meta.env.DEV && (
                      <Route path="/api-test" element={<ApiTestPage />} />
                    )}
                    <Route path="/assessments/:id" element={<Navigate to="/courses" replace />} />
                    <Route path="/study" element={<RedirectLegacyStudyRoute />} />
                    <Route path="/" element={<Navigate to="/dashboard" replace />} />
                  </Routes>
                  </Suspense>
                  <Toaster />
                </div>
              </BugReportProvider>
            </QmAppGate>
          </GuidedTourProvider>
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
