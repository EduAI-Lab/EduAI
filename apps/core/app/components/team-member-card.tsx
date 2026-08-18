import { Badge, Card } from "@eduai/ui";
import { IconBriefcase, IconSparkles, IconTools } from "@tabler/icons-react";
import type { TeamMember } from "~/config/team";

export interface TeamMemberCardProps {
  member: TeamMember;
}

/**
 * One roster entry in the homepage team grid.
 *
 * Sized for a 2–3 column grid rather than the full-bleed row it used on the old
 * /team page: the portrait is a fixed-ratio banner and the biography clamps to
 * four lines so cards in a row stay close in height. Every surface reads from
 * the shared tokens (@eduai/ui base.css) so the card follows the theme toggle.
 */
export function TeamMemberCard({ member }: TeamMemberCardProps) {
  return (
    <Card hoverable className="flex flex-col">
      <div className="aspect-[4/3] w-full overflow-hidden border-b border-border bg-muted">
        <img
          src={member.image.replace("/public", "")}
          alt={member.name}
          loading="lazy"
          className="h-full w-full object-cover object-top"
        />
      </div>

      <div className="flex flex-1 flex-col gap-4 px-5 py-5">
        <h3 className="text-lg font-semibold leading-none tracking-normal text-card-foreground">
          {member.name}
        </h3>

        <p className="line-clamp-4 text-sm leading-relaxed text-muted-foreground">
          {member.biography}
        </p>

        <div>
          <div className="mb-1.5 flex items-center gap-1.5">
            <IconBriefcase className="h-4 w-4 text-primary-text" />
            <h4 className="text-sm font-medium text-foreground">Contribution</h4>
          </div>
          <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">
            {member.contribution}
          </p>
        </div>

        <div>
          <div className="mb-1.5 flex items-center gap-1.5">
            <IconTools className="h-4 w-4 text-primary-text" />
            <h4 className="text-sm font-medium text-foreground">Tech stack</h4>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {member.techStack.map((tech) => (
              <Badge key={tech} variant="outline">
                {tech}
              </Badge>
            ))}
          </div>
        </div>

        <div className="mt-auto pt-1">
          <div className="mb-1.5 flex items-center gap-1.5">
            <IconSparkles className="h-4 w-4 text-primary-text" />
            <h4 className="text-sm font-medium text-foreground">Signature line</h4>
          </div>
          <pre className="overflow-x-auto rounded-[var(--radius-md)] border border-border bg-muted px-3 py-2">
            <code className="font-mono text-xs text-muted-foreground">{member.codeSnippet}</code>
          </pre>
        </div>
      </div>
    </Card>
  );
}
