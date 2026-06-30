import * as React from "react"
import { IconDotsVertical, IconLogout, IconSettings, IconUser } from "@tabler/icons-react"
import { Avatar as EduAvatar } from "./avatar"
import { RoleBadge } from "./role-badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "./ui/sidebar"

export interface NavUserItem {
  label: string
  icon?: React.ReactNode
  href?: string
  onSelect?: () => void
  destructive?: boolean
}

export interface NavUserProps {
  user: { name: string; email: string; image?: string | null; role?: string | null }
  /** Link component for href items (default "a"). */
  LinkComponent?: React.ElementType
  /** Menu items rendered between the header and the logout row. */
  items?: NavUserItem[]
  /** Default logout row: renders a destructive button calling onLogout. */
  onLogout?: () => void
  /** Overrides the default logout row entirely (e.g. Core passes a react-router <Form>). */
  logoutElement?: React.ReactNode
  logoutLabel?: string
}

export function NavUser({
  user,
  LinkComponent = "a",
  items = [],
  onLogout,
  logoutElement,
  logoutLabel = "Log out",
}: NavUserProps) {
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
            {/* Custom menu items */}
            {items.map((item) => (
              <DropdownMenuItem
                key={item.label}
                asChild={!!item.href}
                onSelect={item.onSelect}
                className={item.destructive ? "text-destructive" : ""}
              >
                {item.href ? (
                  <LinkComponent
                    to={item.href}
                    href={item.href}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    {item.icon && <span>{item.icon}</span>}
                    {item.label}
                  </LinkComponent>
                ) : (
                  <div className="flex items-center gap-2 cursor-pointer">
                    {item.icon && <span>{item.icon}</span>}
                    {item.label}
                  </div>
                )}
              </DropdownMenuItem>
            ))}
            {items.length > 0 && <DropdownMenuSeparator />}
            {/* Logout row */}
            {logoutElement ? (
              <DropdownMenuItem asChild>{logoutElement}</DropdownMenuItem>
            ) : onLogout ? (
              <DropdownMenuItem asChild>
                <button
                  type="button"
                  onClick={onLogout}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none text-destructive hover:bg-destructive/10 focus:bg-destructive/10 cursor-pointer"
                >
                  <IconLogout size={15} strokeWidth={1.75} />
                  {logoutLabel}
                </button>
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
