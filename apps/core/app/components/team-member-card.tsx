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

/** Initials for the portrait fallback, dropping an honorific like "Dr.". */
function initialsFor(name: string) {
  return name
    .replace(/^Dr\.?\s+/i, "")
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * One roster entry in the homepage team grid.
 *
 * The grid face is deliberately compact: the portrait carries a specialty chip
 * (the member's headline tech) and their name + title on a gradient scrim, so
 * the short body below only needs their focus line and the rest of the stack.
 * The full biography, contribution, tech, and signature line live one click
 * away in the dialog. Every surface reads from the shared tokens
 * (@eduai/ui base.css) so the card follows the theme toggle.
 */
export function TeamMemberCard({ member }: TeamMemberCardProps) {
  const [open, setOpen] = useState(false);

  const specialty = member.techStack[0];
  const restStack = member.techStack.slice(1);
  const visibleStack = restStack.slice(0, 3);
  const overflowCount = restStack.length - visibleStack.length;

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
        className="flex cursor-pointer flex-col overflow-hidden outline-none transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="relative aspect-[4/5] w-full bg-muted">
          {member.image ? (
            <img
              src={member.image.replace("/public", "")}
              alt={member.name}
              loading="lazy"
              className={`h-full w-full object-cover ${member.imagePosition ?? "object-top"}`}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-primary/10 text-4xl font-bold text-primary-text">
              {initialsFor(member.name)}
            </div>
          )}

          {/* Scrim so the overlaid name stays legible over any portrait. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent"
          />

          {specialty ? (
            <span className="absolute left-2.5 top-2.5 inline-flex items-center rounded-full bg-[var(--gold)] px-2.5 py-1 text-[10.5px] font-semibold tracking-wide text-[#2a2100] shadow-sm">
              {specialty}
            </span>
          ) : null}

          <div className="absolute inset-x-3 bottom-3">
            <h3 className="text-[15.5px] font-bold leading-tight tracking-tight text-white drop-shadow-sm">
              {member.name}
            </h3>
            <p className="mt-0.5 text-xs font-medium text-white/80">{member.title}</p>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-2.5 px-3.5 py-3">
          <p className="line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground">
            {member.contribution.trim()}
          </p>

          {restStack.length > 0 ? (
            <div className="mt-auto flex flex-wrap gap-1.5 pt-0.5">
              {visibleStack.map((tech) => (
                <Badge key={tech} variant="outline">
                  {tech}
                </Badge>
              ))}
              {overflowCount > 0 ? (
                <Badge variant="outline" className="border-dashed text-primary-text">
                  +{overflowCount}
                </Badge>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{member.name}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-5">
            <div className="aspect-[3/4] w-40 shrink-0 overflow-hidden rounded-[var(--radius-md)] border border-border bg-muted sm:w-48">
              {member.image ? (
                <img
                  src={member.image.replace("/public", "")}
                  alt={member.name}
                  className={`h-full w-full object-cover ${member.imagePosition ?? "object-top"}`}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-primary/10 text-4xl font-bold text-primary-text">
                  {initialsFor(member.name)}
                </div>
              )}
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
