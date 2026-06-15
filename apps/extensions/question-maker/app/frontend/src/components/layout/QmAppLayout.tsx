import { useState, type ReactNode } from 'react';
import { Outlet } from 'react-router';
import { cn } from '@/lib/utils';
import { ProfileCoursesDialog } from '@/components/profile/ProfileCoursesDialog';
import { useCourses } from '@/hooks/useCourses';
import { QmLayoutProvider, useQmLayout } from '@/components/layout/QmLayoutContext';
import { QmSidebar } from '@/components/layout/QmSidebar';
import { QmSiteHeader } from '@/components/layout/QmSiteHeader';

function QmAppLayoutInner() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { profileOpen, closeProfile } = useQmLayout();
  const { courses, fetchCourses } = useCourses();

  const closeMobileNav = () => setMobileNavOpen(false);

  return (
    <div className="flex min-h-screen bg-background">
      <QmSidebar className="hidden md:flex" />

      {mobileNavOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            aria-label="Close navigation"
            onClick={closeMobileNav}
          />
          <QmSidebar className="fixed inset-y-0 left-0 z-50 md:hidden" onNavigate={closeMobileNav} />
        </>
      )}

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <QmSiteHeader
          onMenuClick={() => setMobileNavOpen((open) => !open)}
          mobileNavOpen={mobileNavOpen}
        />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>

      <ProfileCoursesDialog
        open={profileOpen}
        onClose={closeProfile}
        existingCourses={courses}
        onCoursesAdded={fetchCourses}
      />
    </div>
  );
}

export function QmAppLayout() {
  return (
    <QmLayoutProvider>
      <QmAppLayoutInner />
    </QmLayoutProvider>
  );
}

/** Sidebar shell for access-denied and other minimal states. */
export function QmAccessShell({ children }: { children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const closeMobileNav = () => setMobileNavOpen(false);

  return (
    <QmLayoutProvider>
      <div className={cn('flex min-h-screen bg-background')}>
        <QmSidebar className="hidden md:flex" />
        {mobileNavOpen && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-40 bg-black/50 md:hidden"
              aria-label="Close navigation"
              onClick={closeMobileNav}
            />
            <QmSidebar className="fixed inset-y-0 left-0 z-50 md:hidden" onNavigate={closeMobileNav} />
          </>
        )}
        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <QmSiteHeader
            onMenuClick={() => setMobileNavOpen((open) => !open)}
            mobileNavOpen={mobileNavOpen}
          />
          <main className="flex flex-1 items-center justify-center p-4">{children}</main>
        </div>
      </div>
    </QmLayoutProvider>
  );
}
