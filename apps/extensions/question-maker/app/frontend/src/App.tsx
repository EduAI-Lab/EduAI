/**
 * Root app component: wires theme/auth providers, router, and top-level pages.
 * Defines navigation for login, homepage, assessments, help, and an optional API test route.
 */
import { BrowserRouter as Router, Routes, Route, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { Toaster } from './components/ui/toaster';
import { ThemeProvider } from './components/theme-provider';
import { AuthProvider } from './contexts/AuthContext';
import { LoginPage } from './pages/LoginPage';
import { CourseSelectionPage } from './pages/CourseSelectionPage';
import { Homepage } from './pages/Homepage';
import { ApiTestPage } from './pages/ApiTestPage';
import AssessmentBuilderPage from './pages/AssessmentBuilderPage';
import { HelpPage } from './pages/HelpPage';
import { AssessmentVariantPage } from './pages/AssessmentVariantPage';
import { GuidedTourProvider } from './contexts/GuidedTourContext';
import { BugReportProvider } from './contexts/BugReportContext';
import { BugReportsAdminPage } from './pages/BugReportsAdminPage';

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
    <ThemeProvider defaultTheme="light" storageKey="eduquery-theme">
      <AuthProvider>
        <GuidedTourProvider>
          <Router>
            <BugReportProvider>
              <div className="min-h-screen bg-background">
                <Routes>
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/courses" element={<CourseSelectionPage />} />
                  <Route path="/home" element={<Homepage />} />
                  <Route path="/landing" element={<Navigate to="/home" replace />} />
                  {process.env.NODE_ENV === 'development' && (
                    <Route path="/api-test" element={<ApiTestPage />} />
                  )}
                  <Route path="/assessments/:id" element={<RedirectAssessmentToBuilder />} />
                  <Route path="/assessments/:id/builder" element={<AssessmentBuilderPage />} />
                  <Route path="/help" element={<HelpPage />} />
                  <Route path="/assessment-variant" element={<AssessmentVariantPage />} />
                  <Route path="/study" element={<RedirectLegacyStudyRoute />} />
                  <Route path="/admin/bug-reports" element={<BugReportsAdminPage />} />
                  <Route path="/" element={<Navigate to="/login" replace />} />
                </Routes>
                <Toaster />
              </div>
            </BugReportProvider>
          </Router>
        </GuidedTourProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
