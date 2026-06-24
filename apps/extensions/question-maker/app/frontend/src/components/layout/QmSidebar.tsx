import { Link, useLocation } from 'react-router';
import {
  BookOpen,
  BugOff,
  ClipboardList,
  ExternalLink,
  HelpCircle,
  LayoutGrid,
  ListChecks,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { getFooterNavForUser, getNavForUser, type QmNavItem, type QmNavItemKey } from '@/lib/rbac';
import { QmSidebarUser } from '@/components/layout/QmSidebarUser';

const NAV_ICONS: Record<
  QmNavItemKey,
  React.ComponentType<{ className?: string; size?: number; strokeWidth?: number }>
> = {
  courses: BookOpen,
  questions: ListChecks,
  assessments: ClipboardList,
  variants: Sparkles,
  help: HelpCircle,
  'bug-reports': BugOff,
  'back-to-eduai': ExternalLink,
};

type QmSidebarProps = {
  className?: string;
  onNavigate?: () => void;
};

function NavButton({
  item,
  pathname,
  search,
  onNavigate,
}: {
  item: QmNavItem;
  pathname: string;
  search: string;
  onNavigate?: () => void;
}) {
  const Icon = NAV_ICONS[item.key];
  const isActive =
    !item.external && (item.match?.(pathname, search) ?? false);
  const linkClassName =
    'relative flex items-center gap-[10px] w-full px-[14px] py-[9px] rounded-[7px] text-[13.5px] outline-none select-none';
  const linkStyle = {
    background: isActive ? 'oklch(0.248 0.055 259)' : 'transparent',
    color: isActive ? '#fff' : 'rgba(255,255,255,0.82)',
    fontWeight: isActive ? 500 : 400,
    transition: 'background 120ms',
    paddingLeft: '16px',
  } as const;

  const linkBody = (
    <>
      {isActive && (
        <span
          aria-hidden
          className="absolute left-0 rounded-[0_2px_2px_0] pointer-events-none"
          style={{
            top: '8px',
            bottom: '8px',
            width: '3px',
            background: 'var(--gold)',
          }}
        />
      )}
      <Icon size={16} strokeWidth={1.75} />
      <span className="flex-1">{item.title}</span>
    </>
  );

  const hoverHandlers = {
    onMouseEnter: (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (!isActive) e.currentTarget.style.background = 'oklch(0.218 0.050 259)';
    },
    onMouseLeave: (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (!isActive) e.currentTarget.style.background = 'transparent';
    },
  };

  if (item.external) {
    return (
      <a
        href={item.href}
        className={linkClassName}
        style={linkStyle}
        rel="noopener noreferrer"
        onClick={onNavigate}
        {...hoverHandlers}
      >
        {linkBody}
      </a>
    );
  }

  return (
    <Link
      to={item.href}
      className={linkClassName}
      style={linkStyle}
      onClick={onNavigate}
      aria-current={isActive ? 'page' : undefined}
      data-tour-id={item.key === 'assessments' ? 'assessment-tab' : undefined}
      {...hoverHandlers}
    >
      {linkBody}
    </Link>
  );
}

export function QmSidebar({ className, onNavigate }: QmSidebarProps) {
  const { pathname, search } = useLocation();
  const { user } = useAuth();
  const qmUser = user
    ? { id: user.id, role: user.role, authorizedUnits: user.authorizedUnits }
    : null;
  const mainNav = getNavForUser(qmUser);
  const footerNav = getFooterNavForUser(qmUser);

  return (
    <aside
      className={cn(
        'flex h-full min-h-0 w-72 shrink-0 flex-col bg-sidebar text-sidebar-foreground',
        className,
      )}
    >
      <div className="border-b border-sidebar-border px-4 py-4">
        <Link
          to="/courses"
          className="flex items-center gap-[9px] font-bold text-white"
          style={{ letterSpacing: '-0.01em' }}
          onClick={onNavigate}
        >
          <div
            className="flex shrink-0 items-center justify-center"
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              background: 'var(--gold)',
            }}
          >
            <LayoutGrid className="size-4 text-[var(--sidebar)]" strokeWidth={1.75} />
          </div>
          <span className="text-base">Question Maker</span>
        </Link>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-3 py-4">
        {mainNav.map((item) => (
          <NavButton
            key={item.key}
            item={item}
            pathname={pathname}
            search={search}
            onNavigate={onNavigate}
          />
        ))}
      </nav>

      <div className="mt-auto space-y-1 border-t border-sidebar-border px-3 py-4">
        {footerNav.map((item) => (
          <NavButton
            key={item.key}
            item={item}
            pathname={pathname}
            search={search}
            onNavigate={onNavigate}
          />
        ))}
        <QmSidebarUser />
      </div>
    </aside>
  );
}
