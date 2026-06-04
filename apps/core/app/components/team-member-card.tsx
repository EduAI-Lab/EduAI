import { Card } from "~/components/ui/card";
import type { TeamMember } from "~/routes/team";
import { Terminal, Code, Braces } from "lucide-react";

export interface TeamMemberCardProps {
  member: TeamMember;
  index: number;
}

export function TeamMemberCard({ member, index }: TeamMemberCardProps) {
  return (
    <Card className="relative bg-slate-800/80 backdrop-blur-sm border border-slate-700 shadow-2xl overflow-hidden group hover:border-green-500/50 transition-all duration-300">
      
      
      <div className="lg:flex items-center p-8 gap-8">
        <div className="lg:w-1/4 mb-6 lg:mb-0">
          <div className="relative w-63 h-82 mx-auto overflow-hidden rounded-lg border-2 border-slate-600 group-hover:border-green-500/50 transition-all duration-300">
            <div className="absolute inset-0 bg-gradient-to-br from-green-500/20 to-blue-500/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            <img
              src={member.image.replace('/public', '')}
              alt={member.name}
              className="object-cover w-full h-full transform group-hover:scale-105 transition-transform duration-300"
            />
            <div className="absolute inset-0 bg-gradient-to-tr from-slate-900/60 to-transparent"></div>
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-slate-900 p-2">
            
            </div>
          </div>
        </div>

        <div className="lg:w-3/4">
          <div className="flex items-center gap-2 mb-4">
            <Terminal className="h-5 w-5 text-green-400" />
            <h3 className="text-2xl font-bold text-white">{member.name}</h3>
          </div>
          
          <div className="pl-4 border-l-2 border-slate-700 mb-6">
            <p className="text-slate-300">{member.biography}</p>
          </div>

          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <Code className="h-4 w-4 text-blue-400" />
              <h4 className="text-lg font-semibold text-white">Contribution</h4>
            </div>
            <div className="pl-6 text-slate-300">{member.contribution}</div>
          </div>

          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <Braces className="h-4 w-4 text-purple-400" />
              <h4 className="text-lg font-semibold text-white">Tech Stack</h4>
            </div>
            <div className="flex flex-wrap gap-2 pl-6">
              {member.techStack.map((tech) => (
                <span
                  key={tech}
                  className="px-3 py-1 rounded-md text-sm font-mono bg-slate-700/50 text-green-400 border border-slate-600 hover:border-green-500/50 hover:bg-slate-700/70 transition-colors duration-200"
                >
                  {tech}
                </span>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <Terminal className="h-4 w-4 text-green-400" />
              <h4 className="text-lg font-semibold text-white">Signature Element</h4>
            </div>
            <pre className="bg-slate-900/90 p-4 rounded-lg overflow-x-auto border border-slate-700 group-hover:border-green-500/30 transition-colors duration-300">
              <code className="text-green-400 font-mono text-sm">{member.codeSnippet}</code>
            </pre>
          </div>
        </div>
      </div>
      
    </Card>
  );
}
