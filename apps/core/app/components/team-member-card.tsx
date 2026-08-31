import { useState } from "react";
import { Badge, Card, Dialog, DialogContent, DialogHeader, DialogTitle } from "@eduai/ui";
import { IconArrowRight, IconBriefcase, IconSparkles, IconTools } from "@tabler/icons-react";
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
 * The grid face is deliberately sleek: the portrait carries a subtle position
 * tag (the member's title) top-right and their name on a gradient scrim, with a
 * quiet "View profile" affordance so the whole card reads as clickable. The
 * biography, contribution, tech, and signature line live one click away in the
 * dialog. Every surface reads from the shared tokens (@eduai/ui base.css) so
 * the card follows the theme toggle.
 */
export function TeamMemberCard({ member }: TeamMemberCardProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* The card is NOT `role="button"`: that would make its subtree
          presentational, so the member's name would stop being reachable as a
          heading. The clickable surface is the real <button> at the bottom;
          the card only forwards a mouse click to it as a convenience. */}
      <Card
        onClick={() => setOpen(true)}
        className="group flex cursor-pointer flex-col overflow-hidden transition-colors hover:border-primary-text focus-within:ring-2 focus-within:ring-ring"
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

          <span className="absolute right-2.5 top-2.5 inline-flex max-w-[70%] items-center rounded-full bg-black/25 px-2 py-0.5 text-[10px] font-medium tracking-wide text-white/85 backdrop-blur-sm">
            {member.position}
          </span>

          <div className="absolute inset-x-3 bottom-3">
            <h3 className="text-[15.5px] font-bold leading-tight tracking-tight text-white drop-shadow-sm">
              {member.name}
            </h3>
            <p className="mt-0.5 text-xs font-medium text-white/80">{member.title}</p>
          </div>
        </div>

        {/* Twenty of these buttons sit on the page, so the member's name goes
            into the accessible name to keep them distinguishable in a list of
            links and buttons, without changing the visible label. */}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setOpen(true);
          }}
          aria-label={`View profile: ${member.name}`}
          className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-[12px] font-medium text-muted-foreground outline-none transition-colors group-hover:text-primary-text"
        >
          <span>View profile</span>
          <IconArrowRight
            aria-hidden="true"
            className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
          />
        </button>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] gap-0 overflow-hidden p-0 sm:max-w-4xl">
          <DialogHeader className="sr-only">
            <DialogTitle>{member.name}</DialogTitle>
          </DialogHeader>

          <div className="flex max-h-[85vh] flex-col sm:flex-row">
            {/* Portrait: full height down the left, content scrolls on the right. */}
            <div className="relative w-full shrink-0 bg-muted sm:w-2/5 sm:self-stretch">
              {member.image ? (
                <img
                  src={member.image.replace("/public", "")}
                  alt={member.name}
                  className={`h-56 w-full object-cover sm:h-full ${member.imagePosition ?? "object-top"}`}
                />
              ) : (
                <div className="flex h-56 w-full items-center justify-center bg-primary/10 text-5xl font-bold text-primary-text sm:h-full">
                  {initialsFor(member.name)}
                </div>
              )}
            </div>

            <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-foreground">{member.name}</h2>
                <p className="mt-0.5 text-sm font-medium text-primary-text">{member.title}</p>
                <p className="mt-0.5 text-sm font-medium text-primary-text">{member.position}</p>
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
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
