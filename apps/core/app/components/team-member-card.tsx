import { Badge, Card } from "@eduai/ui";
import type { TeamMember } from "~/routes/team";
import { IconBriefcase, IconSparkles, IconTools } from "@tabler/icons-react";

export interface TeamMemberCardProps {
  member: TeamMember;
  index: number;
}

export function TeamMemberCard({ member, index }: TeamMemberCardProps) {
  return (
    <Card className="bg-card border border-border shadow-sm overflow-hidden group hover:border-primary/50 transition-colors duration-300">
      <div className="lg:flex items-center p-8 gap-8">
        <div className="lg:w-1/4 mb-6 lg:mb-0">
          <div className="relative w-63 h-82 mx-auto overflow-hidden rounded-lg border-2 border-border group-hover:border-primary/50 transition-colors duration-300">
            <img
              src={member.image.replace('/public', '')}
              alt={member.name}
              className="object-cover w-full h-full"
            />
          </div>
        </div>

        <div className="lg:w-3/4">
          <div className="flex items-center gap-2 mb-4">
            <h3 className="text-2xl font-bold text-foreground">{member.name}</h3>
          </div>

          <div className="pl-4 border-l-2 border-border mb-6">
            <p className="text-muted-foreground">{member.biography}</p>
          </div>

          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <IconBriefcase className="h-4 w-4 text-primary-text" />
              <h4 className="text-lg font-semibold text-foreground">Contribution</h4>
            </div>
            <div className="pl-6 text-muted-foreground">{member.contribution}</div>
          </div>

          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <IconTools className="h-4 w-4 text-primary-text" />
              <h4 className="text-lg font-semibold text-foreground">Tech stack</h4>
            </div>
            <div className="flex flex-wrap gap-2 pl-6">
              {member.techStack.map((tech) => (
                <Badge key={tech} variant="outline">
                  {tech}
                </Badge>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <IconSparkles className="h-4 w-4 text-primary-text" />
              <h4 className="text-lg font-semibold text-foreground">Signature line</h4>
            </div>
            <div className="pl-6">
              <pre className="overflow-x-auto rounded-lg border border-border bg-[#1e1e2e] px-4 py-3">
                <code className="font-mono text-sm text-[#cdd6f4]">{member.codeSnippet}</code>
              </pre>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
