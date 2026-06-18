import { Link, useLocation } from 'react-router';
import type { Icon } from '@tabler/icons-react';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@eduai/ui';

export type AiTutorNavMainItem = {
  title: string;
  url: string;
  icon?: Icon;
  external?: boolean;
};

type AiTutorNavMainProps = {
  items: AiTutorNavMainItem[];
};

export function AiTutorNavMain({ items }: AiTutorNavMainProps) {
  const { pathname } = useLocation();

  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-0.5">
        <SidebarMenu>
          {items.map((item) => {
            const isActive =
              !item.external &&
              (pathname === item.url || pathname.startsWith(`${item.url}/`));
            const Icon = item.icon;

            return (
              <SidebarMenuItem key={item.url}>
                <SidebarMenuButton asChild isActive={isActive} tooltip={item.title}>
                  {item.external ? (
                    <a href={item.url} target="_blank" rel="noreferrer">
                      {Icon ? <Icon className="size-4" /> : null}
                      <span>{item.title}</span>
                    </a>
                  ) : (
                    <Link to={item.url}>
                      {Icon ? <Icon className="size-4" /> : null}
                      <span>{item.title}</span>
                    </Link>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
