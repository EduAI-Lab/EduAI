/**
 * Login/Registration page with 50/50 split: left = form, right = description + video.
 * Uses same dark background and FloatingLetters animation. Redirects authenticated users to the homepage.
 */
import React, { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardHeader, CardDescription, CardContent, CardFooter } from '../components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Tooltip } from '../components/ui/tooltip';
import { useAuth } from '../contexts/AuthContext';
import { FloatingLetters } from '../components/FloatingLetters';

const VIDEO_URL = 'https://www.youtube.com/embed/zaKLdf8DmfU';

const CAROUSEL_LINES = [
  'Store and organize questions with topics and metadata.',
  'Create new question variants without rewriting.',
  'Build exams from your question bank and export to Canvas.',
  'Import your existing assesments from canvas.',
  'Manage drafts and review status.',
];

export const LoginPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [displayIndex, setDisplayIndex] = useState(0);
  const [carouselVisible, setCarouselVisible] = useState(true);
  const { login, register, isAuthenticated, isLoading: authLoading } = useAuth();

  useEffect(() => {
    const id = setInterval(() => {
      setCarouselIndex((i) => (i + 1) % CAROUSEL_LINES.length);
    }, 6000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (carouselIndex === displayIndex) return;
    setCarouselVisible(false);
    const t = setTimeout(() => {
      setDisplayIndex(carouselIndex);
      setCarouselVisible(true);
    }, 350);
    return () => clearTimeout(t);
  }, [carouselIndex, displayIndex]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#10151c]">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/courses" replace />;
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const result = isLogin
        ? await login(email, password)
        : await register(email, password);

      if (!result.success) {
        setError(result.error || 'An error occurred');
      }
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="relative min-h-screen bg-[#10151c] overflow-hidden">
      <FloatingLetters letterClassName="text-slate-500 font-mono" />

      <div className="relative z-10 grid min-h-screen grid-cols-1 lg:grid-cols-2">
        {/* Left: Login / Register form */}
        <section className="flex flex-col items-center justify-center bg-white px-6 py-12 lg:px-12">
          <div className="w-full max-w-sm origin-center scale-[1.15]">
            <Card className="w-full border border-gray-200 rounded-lg bg-white shadow-sm">
            <CardHeader className="space-y-1.5 text-center">
              <div className="text-2xl font-bold text-blue-600">Question Maker</div>
              <CardDescription className="text-gray-500">
                {isLogin
                  ? 'Enter your email below to login to your account'
                  : 'Enter your email below to create your account'}
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleSubmit}>
              <CardContent className="mt-6 space-y-4">
                {error && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <div className="space-y-2">
                  <label htmlFor="email" className="text-sm font-medium text-gray-700">
                    Email
                  </label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                    disabled={isLoading}
                    className="border-gray-300 bg-gray-100 text-gray-900 placeholder:text-gray-500 focus-visible:ring-gray-400"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor="password" className="text-sm font-medium text-gray-700">
                      Password
                    </label>
                    <Tooltip content="Coming soon" side="top">
                      <span className="cursor-not-allowed text-xs text-gray-400 no-underline">
                        Forgot your password?
                      </span>
                    </Tooltip>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                    disabled={isLoading}
                    minLength={6}
                    className="border-gray-300 bg-gray-100 text-gray-900 placeholder:text-gray-500 focus-visible:ring-gray-400"
                    required
                  />
                </div>
                {isLogin && (
                  <div className="flex items-center space-x-2">
                    <input
                      id="remember-me"
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      disabled={isLoading}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <label htmlFor="remember-me" className="text-sm text-gray-700">
                      Remember me
                    </label>
                  </div>
                )}
              </CardContent>
              <CardFooter className="mt-6 flex flex-col gap-3">
                <Button
                  type="submit"
                  className="w-full bg-[#384654] text-white hover:bg-[#455563]"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  {isLogin ? 'Login' : 'Register'}
                </Button>
                <p className="text-center text-sm text-gray-600">
                  {isLogin ? (
                    <>
                      Don&apos;t have an account?{' '}
                      <button
                        type="button"
                        onClick={() => setIsLogin(false)}
                        className="font-medium text-gray-900 underline hover:no-underline"
                      >
                        Sign up
                      </button>
                    </>
                  ) : (
                    <>
                      Have an account?{' '}
                      <button
                        type="button"
                        onClick={() => setIsLogin(true)}
                        className="font-medium text-gray-900 underline hover:no-underline"
                      >
                        Login
                      </button>
                    </>
                  )}
                </p>
              </CardFooter>
            </form>
          </Card>
          </div>
        </section>

        {/* Right: Welcome, tagline, carousel, video — subtle gradient so FloatingLetters stand out */}
        <section className="relative flex flex-col items-center justify-center overflow-y-auto bg-gradient-to-b from-[#10151c]/20 via-transparent to-[#10151c]/30 px-6 py-12 lg:px-12">
          <div className="mx-auto flex max-w-lg flex-col items-center justify-center space-y-6 text-center">
            <h1 className="text-2xl font-bold text-slate-100 lg:text-3xl">
              Welcome to Question Maker
            </h1>

            <p className="text-slate-300 text-base lg:text-lg pb-5">
              AI-Powered Question and Assessment Management
            </p>

            <div className="w-full max-w-sm min-h-[4.5rem] flex flex-col justify-center">
              <p
                className="text-slate-300 text-sm leading-relaxed text-center transition-opacity duration-300 ease-in-out"
                style={{ opacity: carouselVisible ? 1 : 0 }}
              >
                {CAROUSEL_LINES[displayIndex]}
              </p>
            </div>

            <div className="w-full max-w-xl overflow-hidden rounded-lg border border-slate-700/50 bg-slate-900/50 aspect-video">
              <iframe
                src={VIDEO_URL}
                title="Question Maker Demo Video"
                className="h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
};
