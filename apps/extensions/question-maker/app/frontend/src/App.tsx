/**
 * Root app component: wires auth providers, router, and top-level pages.
 * Defines navigation for login, homepage, assessments, help, and an optional API test route.
 */
import { BrowserRouter as Router, Routes, Route, Navigate, useSearchParams } from 'react-router';
import { Toaster, ThemeProvider, ThemeSyncInitializer } from '@eduai/ui';
import { AuthProvider } from './contexts/AuthContext';
import { QmAppGate } from './components/auth/QmAppGate';
import { QmAppLayout } from './components/layout/QmAppLayout';
import { CourseSelectionPage } from './pages/CourseSelectionPage';
import { CourseDetailPage } from './pages/CourseDetailPage';
import DashboardPage from './pages/DashboardPage';
import QuestionBankPage from './pages/QuestionBankPage';
import SettingsPage from './pages/SettingsPage';
import { QuestionComposerPage } from './pages/QuestionComposerPage';
import { ApiTestPage } from './pages/ApiTestPage';
import AssessmentBuilderPage from './pages/AssessmentBuilderPage';
import BankDetailPage from './pages/BankDetailPage';
import { HelpPage } from './pages/HelpPage';
import { BugReportsAdminPage } from './pages/BugReportsAdminPage';
import { AssessmentVariantPage } from './pages/AssessmentVariantPage';
import { GuidedTourProvider } from './contexts/GuidedTourContext';
import { BugReportProvider } from './contexts/BugReportContext';

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
