import { ChevronDown, LogOut, Moon, Sun, User } from 'lucide-react';
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  RoleBadge,
  useTheme,
} from '@eduai/ui';
import { useAuth } from '@/contexts/AuthContext';
import { useQmLayout } from '@/components/layout/QmLayoutContext';

export function QmSidebarUser() {
  const { user, logout } = useAuth();
  const { openProfile } = useQmLayout();
  const { resolvedTheme, setTheme } = useTheme();

  if (!user) return null;

  const toggleTheme = () => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="flex w-full items-center gap-2 rounded-[7px] px-[14px] py-[9px] text-left outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <Avatar name={user.name ?? user.email} src={user.image} size={32} />
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-white">
            {user.name ?? user.email}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-sidebar-foreground/50" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" sideOffset={8} className="w-56">
        <DropdownMenuLabel className="p-0 font-normal">
          <div className="flex items-center gap-3 px-3 py-2.5">
            <Avatar name={user.name ?? user.email} src={user.image} size={32} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user.name ?? user.email}</p>
              <div className="mt-1">
                <RoleBadge role={user.role} />
              </div>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={openProfile} data-tour-id="profile-courses-button">
          <User className="h-4 w-4" />
          Profile &amp; courses
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={toggleTheme}>
          {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {resolvedTheme === 'dark' ? 'Light mode' : 'Dark mode'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => void logout()}>
          <LogOut className="h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
