import { Github } from "lucide-react";
import { Link } from "react-router";
import { projectInfo, siteConfig } from "~/config/site";

export function SiteFooter() {
  return (
    <footer className="bg-slate-900/50 backdrop-blur-sm border-t border-slate-800">
      <div className="max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <h3 className="text-lg font-semibold text-white mb-4">About</h3>
            <p className="text-slate-300 text-sm leading-relaxed">
              {projectInfo.description}
            </p>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white mb-4">Quick Links</h3>
            <ul className="space-y-2">
              {Object.entries(siteConfig.navigation).map(([name, path]) => (
                <li key={name}>
                  <Link
                    to={path}
                    className="text-slate-300 hover:text-white transition-colors capitalize"
                  >
                    {name.replace("-", " ")}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-8 pt-8 border-t border-slate-800">
          <p className="text-center text-slate-400 text-sm">
            © {new Date().getFullYear()} {projectInfo.title}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
