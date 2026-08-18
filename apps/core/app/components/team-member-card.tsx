import { useState } from "react";
import {
  Badge,
  Card,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@eduai/ui";
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
 * Clicking the card opens the same content, unclamped, in a dialog.
 */
export function TeamMemberCard({ member }: TeamMemberCardProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Card
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="flex cursor-pointer flex-col outline-none transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="aspect-[3/4] w-full overflow-hidden border-b border-border bg-muted">
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
            <pre className="rounded-[var(--radius-md)] border border-border bg-muted px-3 py-2">
              <code className="line-clamp-3 whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
                {member.codeSnippet}
              </code>
            </pre>
          </div>
        </div>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{member.name}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-5">
            <div className="aspect-[3/4] w-40 shrink-0 overflow-hidden rounded-[var(--radius-md)] border border-border bg-muted sm:w-48">
              <img
                src={member.image.replace("/public", "")}
                alt={member.name}
                className="h-full w-full object-cover object-top"
              />
            </div>

            <p className="text-sm leading-relaxed text-muted-foreground">{member.biography}</p>

            <div>
              <div className="mb-1.5 flex items-center gap-1.5">
                <IconBriefcase className="h-4 w-4 text-primary-text" />
                <h4 className="text-sm font-medium text-foreground">Contribution</h4>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">
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

            <div>
              <div className="mb-1.5 flex items-center gap-1.5">
                <IconSparkles className="h-4 w-4 text-primary-text" />
                <h4 className="text-sm font-medium text-foreground">Signature line</h4>
              </div>
              <pre className="overflow-x-auto rounded-[var(--radius-md)] border border-border bg-muted px-3 py-2">
                <code className="whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
                  {member.codeSnippet}
                </code>
              </pre>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
