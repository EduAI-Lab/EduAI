import { Form } from "react-router"
import { IconDotsVertical, IconLogout, IconSettings, IconUser } from "@tabler/icons-react"
import { RoleBadge, Avatar as EduAvatar } from "@eduai/ui"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@eduai/ui"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@eduai/ui"
import type { User } from "~/lib/auth/types"

export interface NavUserProps {
  user: User
}

export function NavUser({ user }: NavUserProps) {
  const { isMobile } = useSidebar()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <EduAvatar name={user.name} src={user.image} size={32} radius={8} />
              {/* name + role badge row — name truncates, badge never shrinks */}
              <div className="flex-1 min-w-0 text-left leading-tight">
                <div className="flex items-center gap-[5px] min-w-0">
                  <span className="truncate min-w-0 font-medium text-sm">{user.name}</span>
                  <RoleBadge role={user.role || "STUDENT"} />
                </div>
                <span className="block truncate text-xs text-sidebar-foreground/50">
                  {user.email}
                </span>
              </div>
              <IconDotsVertical size={14} strokeWidth={1.75} className="ml-auto shrink-0 text-sidebar-foreground/50" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            {/* Popup header: name + email */}
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-3 py-2.5 text-left">
                <EduAvatar name={user.name} src={user.image} size={32} radius={8} />
                <div className="flex-1 min-w-0 leading-tight">
                  <span className="block truncate font-medium text-sm">{user.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {/* Account / Settings */}
            {/* TODO: REMOVE ACCOUNT MENU ITEM */}
            <DropdownMenuItem asChild>
              <a href="/settings" className="flex items-center gap-2 cursor-pointer">
                <IconSettings size={15} strokeWidth={1.75} />
                Settings
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href="/settings/account" className="flex items-center gap-2 cursor-pointer">
                <IconUser size={15} strokeWidth={1.75} />
                Account
              </a>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {/* Log out */}
            <DropdownMenuItem asChild>
              <Form method="post" action="/auth/logout" replace className="w-full">
                <button
                  type="submit"
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none text-destructive hover:bg-destructive/10 focus:bg-destructive/10"
                >
                  <IconLogout size={15} strokeWidth={1.75} />
                  Log out
                </button>
              </Form>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
