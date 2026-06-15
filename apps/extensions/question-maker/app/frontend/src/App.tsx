/**
 * Root app component: wires auth providers, router, and top-level pages.
 * Defines navigation for login, homepage, assessments, help, and an optional API test route.
 */
import { BrowserRouter as Router, Routes, Route, Navigate, useParams, useSearchParams } from 'react-router';
import { Toaster } from '@eduai/ui';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './components/theme-provider';
import { QmAppGate } from './components/auth/QmAppGate';
import { QmAppLayout } from './components/layout/QmAppLayout';
import { CourseSelectionPage } from './pages/CourseSelectionPage';
import { Homepage } from './pages/Homepage';
import { ApiTestPage } from './pages/ApiTestPage';
import AssessmentBuilderPage from './pages/AssessmentBuilderPage';
import { HelpPage } from './pages/HelpPage';
import { BugReportsAdminPage } from './pages/BugReportsAdminPage';
import { AssessmentVariantPage } from './pages/AssessmentVariantPage';
import { GuidedTourProvider } from './contexts/GuidedTourContext';
import { BugReportProvider } from './contexts/BugReportContext';

function RedirectAssessmentToBuilder() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={id ? `/assessments/${id}/builder` : '/home'} replace />;
}

/** Legacy `/study` URLs forward to the assessment variant workflow, preserving query string. */
function RedirectLegacyStudyRoute() {
  const [searchParams] = useSearchParams();
  const qs = searchParams.toString();
  return <Navigate to={qs ? `/assessment-variant?${qs}` : '/assessment-variant'} replace />;
}

function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="theme">
      <AuthProvider>
      <QmAppGate>
        <GuidedTourProvider>
          <Router>
            <BugReportProvider>
              <div className="min-h-screen bg-background">
                <Routes>
                  <Route element={<QmAppLayout />}>
                    <Route path="/courses" element={<CourseSelectionPage />} />
                    <Route path="/home" element={<Homepage />} />
                    <Route path="/assessments/:id/builder" element={<AssessmentBuilderPage />} />
                    <Route path="/help" element={<HelpPage />} />
                    <Route path="/admin/bug-reports" element={<BugReportsAdminPage />} />
                    <Route path="/assessment-variant" element={<AssessmentVariantPage />} />
                  </Route>
                  <Route path="/landing" element={<Navigate to="/home" replace />} />
                  {process.env.NODE_ENV === 'development' && (
                    <Route path="/api-test" element={<ApiTestPage />} />
                  )}
                  <Route path="/assessments/:id" element={<RedirectAssessmentToBuilder />} />
                  <Route path="/study" element={<RedirectLegacyStudyRoute />} />
                  <Route path="/" element={<Navigate to="/courses" replace />} />
                </Routes>
                <Toaster />
              </div>
            </BugReportProvider>
          </Router>
        </GuidedTourProvider>
      </QmAppGate>
    </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
