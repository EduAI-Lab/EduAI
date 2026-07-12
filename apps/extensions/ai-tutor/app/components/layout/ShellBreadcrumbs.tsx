import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@eduai/ui';
import { Link } from 'react-router';
import type { ReactNode } from 'react';

type ShellBreadcrumbsProps = {
  /** `node` renders custom content (e.g. a course switcher) in place of the label. */
  items: Array<{ label: string; href?: string; node?: ReactNode; title?: string }>;
};

/**
 * Header breadcrumb trail. Text crumbs are width-capped and truncated so long
 * course/module/lesson titles ellipsize (with a native `title` tooltip for the
 * full text) instead of clipping the header — matching how QM keeps its
 * `WorkspaceBreadcrumb` compact. `node` crumbs (e.g. the CourseSwitcher) own
 * their own width and render untouched.
 */
export function ShellBreadcrumbs({ items }: ShellBreadcrumbsProps) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <span key={`${item.label}-${index}`} className="contents">
              {index > 0 ? <BreadcrumbSeparator /> : null}
              <BreadcrumbItem>
                {item.node ? (
                  item.node
                ) : isLast || !item.href ? (
                  <BreadcrumbPage
                    className="inline-block max-w-[24ch] truncate align-bottom"
                    title={item.title ?? item.label}
                  >
                    {item.label}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link
                      to={item.href}
                      className="inline-block max-w-[16ch] truncate align-bottom"
                      title={item.title ?? item.label}
                    >
                      {item.label}
                    </Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </span>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
