import { PageHeading } from "@eduai/ui";
import { teamMembers } from "~/config/team";
import { TeamMemberCard } from "~/components/team-member-card";

/**
 * The research team roster, formerly the standalone /team page. Now a section
 * of the single-scroll landing page, anchored by the header's "Team" link.
 */
export function TeamSection() {
  return (
    <section id="team" className="scroll-mt-20 py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <PageHeading
          heading="Meet our research team"
          className="mb-12 text-center [&>div]:mx-auto"
          headingClassName="text-3xl lg:text-4xl font-bold text-foreground"
          subheading={
            <span className="mx-auto block max-w-3xl text-lg">
              We are an enthusiastic crew of UBC undergrads, graduate researchers, and faculty
              members passionate about making learning more engaging and accessible. Here are the
              people writing the code, training the models, and building EduAI.
            </span>
          }
        />

        <div className="space-y-12">
          <div>
            <h3 className="mb-5 text-xl font-semibold text-foreground">Faculty</h3>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {teamMembers
                .filter((member) => member.role === "professor")
                .map((member) => (
                  <TeamMemberCard key={member.id} member={member} />
                ))}
            </div>
          </div>

          <div>
            <h3 className="mb-5 text-xl font-semibold text-foreground">Students</h3>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {teamMembers
                .filter((member) => member.role === "student")
                .map((member) => (
                  <TeamMemberCard key={member.id} member={member} />
                ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
