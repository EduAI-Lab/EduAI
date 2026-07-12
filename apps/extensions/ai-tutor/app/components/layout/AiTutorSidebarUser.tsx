import { Link, useNavigate } from 'react-router';
import { IconDotsVertical, IconLogout, IconSettings, IconUser } from '@tabler/icons-react';
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  RoleBadge,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@eduai/ui';

import { useLocalUser, type AuthUser } from '~/hooks/useLocalUser';
import { getEduAiAppUrl } from '~/lib/extension-urls';

type AiTutorSidebarUserProps = {
  user: AuthUser;
};

/**
 * Sidebar footer user menu — matches EduAI Core `nav-user.tsx`:
 * profile in the sidebar; sign out in the kebab dropdown (not in the header).
 */
export function AiTutorSidebarUser({ user }: AiTutorSidebarUserProps) {
  const { isMobile } = useSidebar();
  const { logout } = useLocalUser();
  const navigate = useNavigate();
  const eduAiUrl = getEduAiAppUrl();

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar name={user.name ?? 'User'} size={32} />
              <div className="min-w-0 flex-1 text-left leading-tight">
                <div className="flex min-w-0 items-center gap-[5px]">
                  <span className="truncate text-sm font-medium">{user.name}</span>
                  <RoleBadge role={user.role} />
                </div>
                <span className="block truncate text-xs text-sidebar-foreground/50">{user.email}</span>
              </div>
              <IconDotsVertical
                size={14}
                strokeWidth={1.75}
                className="ml-auto shrink-0 text-sidebar-foreground/50"
              />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56 w-[--radix-dropdown-menu-trigger-width] rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-3 py-2.5 text-left">
                <Avatar name={user.name ?? 'User'} size={32} />
                <div className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-sm font-medium">{user.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {user.role === 'ADMIN' ? (
              <DropdownMenuItem asChild>
                <Link to="/settings" className="flex cursor-pointer items-center gap-2">
                  <IconSettings size={15} strokeWidth={1.75} />
                  Settings
                </Link>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem asChild>
              <a
                href={`${eduAiUrl}/settings/account`}
                className="flex cursor-pointer items-center gap-2"
              >
                <IconUser size={15} strokeWidth={1.75} />
                Account
              </a>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => void handleLogout()}>
              <IconLogout size={15} strokeWidth={1.75} />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
