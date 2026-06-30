import { Link } from 'react-router';
import {
  IconBooks,
  IconExternalLink,
  IconReport,
} from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@eduai/ui';

import type { AuthUser } from '~/hooks/useLocalUser';
import { getEduAiAppUrl } from '~/lib/extension-urls';
import { getNavForUser } from '~/lib/rbac/nav';
import type { AtNavItemKey } from '~/lib/rbac/types';
import { AiTutorNavMain, type AiTutorNavMainItem } from './AiTutorNavMain';
import { AiTutorSidebarUser } from './AiTutorSidebarUser';
import TourButton from '../TourButton';

const NAV_ICONS: Record<AtNavItemKey, Icon> = {
  'my-courses': IconBooks,
  teaching: IconBooks,
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

export function AiTutorSidebar({ user, ...props }: AiTutorSidebarProps) {
  const eduAiUrl = getEduAiAppUrl();

  return (
    <Sidebar variant="sidebar" collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="data-[slot=sidebar-menu-button]:!p-1.5">
              <Link to="/" className="flex items-center gap-[9px]">
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
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <AiTutorNavMain items={toNavMainItems(user)} />
        <div className="px-2 py-2">
          <TourButton />
        </div>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="EduAI Core">
              <a href={eduAiUrl}>
                <IconExternalLink className="size-4" />
                <span>EduAI Core</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <AiTutorSidebarUser user={user} />
      </SidebarFooter>
    </Sidebar>
  );
}
