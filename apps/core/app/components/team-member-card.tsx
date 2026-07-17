import { Card } from "@eduai/ui";
import type { TeamMember } from "~/routes/team";
import { IconTerminal, IconCode, IconBraces } from "@tabler/icons-react";

export interface TeamMemberCardProps {
  member: TeamMember;
  index: number;
}

export function TeamMemberCard({ member, index }: TeamMemberCardProps) {
  return (
    <Card className="relative bg-card/80 backdrop-blur-sm border border-border shadow-2xl overflow-hidden group hover:border-green-500/50 transition-all duration-300">


      <div className="lg:flex items-center p-8 gap-8">
        <div className="lg:w-1/4 mb-6 lg:mb-0">
          <div className="relative w-63 h-82 mx-auto overflow-hidden rounded-lg border-2 border-border group-hover:border-green-500/50 transition-all duration-300">
            <div className="absolute inset-0 bg-gradient-to-br from-green-500/20 to-blue-500/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            <img
              src={member.image.replace('/public', '')}
              alt={member.name}
              className="object-cover w-full h-full transform group-hover:scale-105 transition-transform duration-300"
            />
            <div className="absolute inset-0 bg-gradient-to-tr from-background/60 to-transparent"></div>
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-background p-2">

            </div>
          </div>
        </div>

        <div className="lg:w-3/4">
          <div className="flex items-center gap-2 mb-4">
            <IconTerminal className="h-5 w-5 text-green-400" />
            <h3 className="text-2xl font-bold text-foreground">{member.name}</h3>
          </div>

          <div className="pl-4 border-l-2 border-border mb-6">
            <p className="text-muted-foreground">{member.biography}</p>
          </div>

          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <IconCode className="h-4 w-4 text-blue-400" />
              <h4 className="text-lg font-semibold text-foreground">Contribution</h4>
            </div>
            <div className="pl-6 text-muted-foreground">{member.contribution}</div>
          </div>

          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <IconBraces className="h-4 w-4 text-purple-400" />
              <h4 className="text-lg font-semibold text-foreground">Tech stack</h4>
            </div>
            <div className="flex flex-wrap gap-2 pl-6">
              {member.techStack.map((tech) => (
                <span
                  key={tech}
                  className="px-3 py-1 rounded-md text-sm font-mono bg-muted text-green-400 border border-border hover:border-green-500/50 hover:bg-muted/70 transition-colors duration-200"
                >
                  {tech}
                </span>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <IconTerminal className="h-4 w-4 text-green-400" />
              <h4 className="text-lg font-semibold text-foreground">Signature element</h4>
            </div>
            <pre className="bg-muted p-4 rounded-lg overflow-x-auto border border-border group-hover:border-green-500/30 transition-colors duration-300">
              <code className="text-green-400 font-mono text-sm">{member.codeSnippet}</code>
            </pre>
          </div>
        </div>
      </div>

    </Card>
  );
}
