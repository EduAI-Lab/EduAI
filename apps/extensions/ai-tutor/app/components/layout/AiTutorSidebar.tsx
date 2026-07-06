import { Link } from 'react-router';
import {
  IconBooks,
  IconReport,
} from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';
import {
  BrandSwitcher,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from '@eduai/ui';

import type { AuthUser } from '~/hooks/useLocalUser';
import { CURRENT_APP_ID, getLauncherApps } from '~/lib/apps';
import { getNavForUser } from '~/lib/rbac/nav';
import type { AtNavItemKey } from '~/lib/rbac/types';
import { AiTutorNavMain, type AiTutorNavMainItem } from './AiTutorNavMain';
import { AiTutorSidebarUser } from './AiTutorSidebarUser';
import TourButton from '../TourButton';

const NAV_ICONS: Record<AtNavItemKey, Icon> = {
  'my-courses': IconBooks,
  teaching: IconBooks,
  'admin-courses': IconBooks,
  'admin-bug-reports': IconReport,
  enrollments: IconBooks,
  analytics: IconBooks,
};

function toNavMainItems(user: AuthUser): AiTutorNavMainItem[] {
  return getNavForUser(user).map((item) => ({
    title: item.title,
    url: item.href,
    icon: NAV_ICONS[item.key],
  }));
}

type AiTutorSidebarProps = React.ComponentProps<typeof Sidebar> & {
  user: AuthUser;
};

const AI_TUTOR_BRAND = (
  <>
    <div
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
      style={{ background: 'var(--primary)' }}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="white"
        strokeWidth="1.75"
        strokeLinecap="round"
        aria-hidden
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3a9 9 0 0 1 0 18" />
        <path d="M3 12h18" />
      </svg>
    </div>
    <div className="flex flex-col leading-none">
      <span className="text-sm font-bold tracking-tight">AI Tutor</span>
      <span className="text-[10px] font-medium uppercase tracking-widest text-sidebar-foreground/60">
        EduAI
      </span>
    </div>
  </>
);

export function AiTutorSidebar({ user, ...props }: AiTutorSidebarProps) {
  return (
    <Sidebar variant="sidebar" collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <BrandSwitcher
          logo={AI_TUTOR_BRAND}
          logoHref="/"
          LinkComponent={Link}
          apps={getLauncherApps()}
          currentAppId={CURRENT_APP_ID}
          role={user.role}
        />
      </SidebarHeader>

      <SidebarContent>
        <AiTutorNavMain items={toNavMainItems(user)} />
        <div className="px-2 py-2">
          <TourButton />
        </div>
      </SidebarContent>

      <SidebarFooter>
        <AiTutorSidebarUser user={user} />
      </SidebarFooter>
    </Sidebar>
  );
}
