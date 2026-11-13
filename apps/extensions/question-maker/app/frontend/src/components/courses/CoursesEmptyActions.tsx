import { Button } from "@eduai/ui";
import { IconArrowRight, IconPlus } from "@tabler/icons-react";
import { getCoreCoursesUrl } from "@/lib/coreUrl";
import { useOpenProfile } from "@/components/layout/QmLayoutContext";

/** Way out of an empty course list: Core's courses, or the Add Courses dialog. */
export function CoursesEmptyActions() {
  const openProfile = useOpenProfile();

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <Button asChild>
        <a href={getCoreCoursesUrl()}>
          Go to my courses in Core
          <IconArrowRight className="size-4" />
        </a>
      </Button>
      {openProfile && (
        <Button variant="outline" onClick={openProfile}>
          <IconPlus className="size-4" />
          Add course
        </Button>
      )}
    </div>
  );
}
