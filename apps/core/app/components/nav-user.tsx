import { Form } from "react-router"
import {
  IconDotsVertical,
  IconLogout,
  IconShield,
  IconSchool,
  IconUsers,
  IconUser,
} from "@tabler/icons-react"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "~/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "~/components/ui/sidebar"
import { Badge } from "~/components/ui/badge"
import type { User } from "~/lib/auth/types"

export interface NavUserProps {
  user: User
}

export function NavUser({ user }: NavUserProps) {
  const { isMobile } = useSidebar()

  const getUserInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2)
  }

  const getRoleBadge = (role: string) => {
    switch (role) {
      case "ADMIN":
        return (
          <Badge variant="outline" className="bg-red-500 text-white border-red-500 h-5 px-1.5 gap-1 shrink-0">
            <IconShield className="h-3 w-3" />
            <span className="text-xs">Admin</span>
          </Badge>
        )
      case "UNIT_ADMIN":
        return (
          <Badge variant="outline" className="bg-orange-500 text-white border-orange-500 h-5 px-1.5 gap-1 shrink-0 whitespace-nowrap">
            <IconShield className="h-3 w-3" />
            <span className="text-xs">Unit Admin</span>
          </Badge>
        )
      case "INSTRUCTOR":
        return (
          <Badge variant="outline" className="bg-blue-500 text-white border-blue-500 h-5 px-1.5 gap-1 shrink-0">
            <IconSchool className="h-3 w-3" />
            <span className="text-xs">Instructor</span>
          </Badge>
        )
      case "TA":
        return (
          <Badge variant="outline" className="bg-green-500 text-white border-green-500 h-5 px-1.5 gap-1 shrink-0">
            <IconUsers className="h-3 w-3" />
            <span className="text-xs">TA</span>
          </Badge>
        )
      case "STUDENT":
        return (
          <Badge variant="outline" className="bg-gray-500 text-white border-gray-500 h-5 px-1.5 gap-1 shrink-0">
            <IconUser className="h-3 w-3" />
            <span className="text-xs">Student</span>
          </Badge>
        )
      default:
        return (
          <Badge variant="outline" className="bg-gray-500 text-white border-gray-500 h-5 px-1.5 gap-1 shrink-0">
            <IconUser className="h-3 w-3" />
            <span className="text-xs">Student</span>
          </Badge>
        )
    }
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarImage src={user.image || ""} alt={user.name} />
                <AvatarFallback className="rounded-lg">
                  {getUserInitials(user.name)}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="truncate font-medium min-w-0">{user.name}</span>
                  {getRoleBadge(user.role || "STUDENT")}
                </div>
                <span className="text-muted-foreground truncate text-xs">
                  {user.email}
                </span>
              </div>
              <IconDotsVertical className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage src={user.image || ""} alt={user.name} />
                  <AvatarFallback className="rounded-lg">
                    {getUserInitials(user.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{user.name}</span>
                    {getRoleBadge(user.role || "STUDENT")}
                  </div>
                  <span className="text-muted-foreground truncate text-xs">
                    {user.email}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Form method="post" action="/auth/logout" replace>
                <button type="submit" className="flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground">
                  <IconLogout />
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
