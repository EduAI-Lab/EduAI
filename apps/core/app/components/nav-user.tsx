import { useNavigate } from "react-router"
import {
  IconCreditCard,
  IconDotsVertical,
  IconLogout,
  IconNotification,
  IconUserCircle,
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
  DropdownMenuGroup,
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
import { signOut } from "~/lib/auth"
import type { User } from "~/lib/auth/types"

export function NavUser({ user }: { user: User }) {
  const { isMobile } = useSidebar()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    try {
      await signOut()
      navigate("/auth/login")
    } catch (error) {
      console.error("Sign out failed:", error)
    }
  }

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
          <Badge variant="outline" className="bg-red-500 text-white border-red-500 h-5 px-1.5 gap-1">
            <IconShield className="h-3 w-3" />
            <span className="text-xs">Admin</span>
          </Badge>
        )
      case "INSTRUCTOR":
        return (
          <Badge variant="outline" className="bg-blue-500 text-white border-blue-500 h-5 px-1.5 gap-1">
            <IconSchool className="h-3 w-3" />
            <span className="text-xs">Prof</span>
          </Badge>
        )
      case "TA":
        return (
          <Badge variant="outline" className="bg-green-500 text-white border-green-500 h-5 px-1.5 gap-1">
            <IconUsers className="h-3 w-3" />
            <span className="text-xs">TA</span>
          </Badge>
        )
      case "STUDENT":
        return (
          <Badge variant="outline" className="bg-gray-500 text-white border-gray-500 h-5 px-1.5 gap-1">
            <IconUser className="h-3 w-3" />
            <span className="text-xs">Student</span>
          </Badge>
        )
      default:
        return (
          <Badge variant="outline" className="bg-gray-500 text-white border-gray-500 h-5 px-1.5 gap-1">
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
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{user.name}</span>
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
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <IconUserCircle />
                Account
              </DropdownMenuItem>
              <DropdownMenuItem>
                <IconCreditCard />
                Billing
              </DropdownMenuItem>
              <DropdownMenuItem>
                <IconNotification />
                Notifications
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut}>
              <IconLogout />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
