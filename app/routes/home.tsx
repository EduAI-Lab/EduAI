import { redirect } from "react-router"
import type { Route } from "./+types/home"
import { Link } from "react-router"
import { auth } from "~/lib/auth/server"

export function meta({}: Route.MetaArgs) {
  return [
    { title: "EduAI Core Learning" },
    { name: "description", content: "AI-powered learning platform" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await auth.api.getSession(request);

  if (session?.user) {
    return redirect("/dashboard");
  }

  return {};
}

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h1 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
          EduAI Core Learning
        </h1>
        <p className="mt-2 text-center text-sm text-gray-600">
          AI-powered learning platform for students and educators
        </p>

        <div className="mt-8 space-y-6">
          <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
            <div className="text-center">
              <h2 className="text-xl font-medium text-gray-900">
                Get Started
              </h2>
              <p className="mt-2 text-sm text-gray-600">
                Sign in to access your courses and AI-powered learning tools.
              </p>
            </div>

            <div className="mt-6 space-y-3">
              <Link
                to="/auth/login"
                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                Sign In
              </Link>
              <Link
                to="/auth/register"
                className="w-full flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                Create Account
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
