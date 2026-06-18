import { useNavigate } from 'react-router';
import { IconDotsVertical, IconLogout, IconMoon, IconSun } from '@tabler/icons-react';
import { useTheme } from 'next-themes';
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

import type { User } from '~/lib/types';
import { useLocalUser } from '~/hooks/useLocalUser';

type AiTutorSidebarUserProps = {
  user: User;
};

export function AiTutorSidebarUser({ user }: AiTutorSidebarUserProps) {
  const { isMobile } = useSidebar();
  const { logout } = useLocalUser();
  const navigate = useNavigate();
  const { resolvedTheme, setTheme } = useTheme();

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
                <div className="flex min-w-0 items-center gap-1">
                  <span className="truncate text-sm font-medium">{user.name}</span>
                  <RoleBadge role={user.role} />
                </div>
                <span className="block truncate text-xs text-sidebar-foreground/50">{user.email}</span>
              </div>
              <IconDotsVertical className="ml-auto size-3.5 shrink-0 opacity-50" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56 w-[--radix-dropdown-menu-trigger-width] rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-3 py-2.5">
                <Avatar name={user.name ?? 'User'} size={32} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{user.name}</p>
                  <RoleBadge role={user.role} />
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            >
              {resolvedTheme === 'dark' ? <IconSun className="size-4" /> : <IconMoon className="size-4" />}
              {resolvedTheme === 'dark' ? 'Light mode' : 'Dark mode'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => void handleLogout()}>
              <IconLogout className="size-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
