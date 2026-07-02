import type { ReactNode } from "react";

import { ScrollReveal } from "~/components/motion/scroll-reveal";

interface CourseCardScrollItemProps {
  index: number;
  children: ReactNode;
}

/** Course grid wrapper — uses shared scroll reveal motion. */
export function CourseCardScrollItem({ index, children }: CourseCardScrollItemProps) {
  return <ScrollReveal index={index}>{children}</ScrollReveal>;
}
