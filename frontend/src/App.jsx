import { useEffect } from 'react';
import { loadStatus, loadData, waitWhileLoading, useAppState } from './state/store.js';
import { go, openFromHash } from './state/nav.js';
import { usePermissions } from './auth/auth.js';
import { NoAccess } from './auth/NoAccess.jsx';
import { Sidebar } from './components/Sidebar.jsx';
import { FilterBar } from './components/FilterBar.jsx';
import { Overview } from './components/Overview.jsx';
import { ComingSoon, DataManagement } from './components/Pages.jsx';
import { Admin } from './components/AdminUsers.jsx';
import { Popover } from './components/Popover.jsx';
import { DrillDrawer } from './components/DrillDrawer.jsx';
import { ChatWidget } from './components/ChatWidget.jsx';
import { LoadingIndicator } from './components/LoadingIndicator.jsx';

/** The application shell: sidebar, the module-aware sticky filter bar, the pages, and the shared overlays (popover, drill-down
    drawer, assistant). It only mounts once the user is signed in (AuthGate). Start-up order is the source's: status, then data, then
    route (a #product/… style hash opens its drill-down). Sales data is only requested for users who may open Sales, and every page,
    link and overlay is rendered only if the user holds the matching dashboard (the API enforces the same rules). */
export default function App() {
  const perms = usePermissions();
  const st = useAppState();
  const canSales = perms.canView('sales');
  const noDashboards = !perms.isSuperuser && perms.allowedDashboards.length === 0;

  useEffect(() => {
    const onHash = () => go(location.hash.slice(1), false);
    window.addEventListener('hashchange', onHash);
    (async function init() {
      await loadStatus();
      await waitWhileLoading();      // first load / newly closed months: the indicator below shows progress, then the data opens
      if (canSales) await loadData();
      const h = location.hash.slice(1);
      if (h.includes('/')) await openFromHash(h); else go(h || 'overview', false);
    })();
    return () => window.removeEventListener('hashchange', onHash);
  }, [canSales]);

  // permissions can change while the app is open (an administrator edits the user; /me is re-read on focus): never stay on a page
  // the user can no longer open
  useEffect(() => {
    if (!noDashboards && !perms.canViewRoute(st.page)) go(perms.firstAllowedRoute() || 'overview', false);
  }, [perms.user, st.page]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="app">
        <Sidebar />
        <main className="main">
          <div className="main-in">
            {noDashboards ? <NoAccess /> : (
              <>
                <FilterBar />
                <LoadingIndicator />
                {canSales ? <Overview /> : null}
                {perms.canViewRoute(st.page) ? <ComingSoon /> : null}
                {perms.canView('data_management') ? <DataManagement /> : null}
                {perms.isSuperuser ? <Admin /> : null}
              </>
            )}
          </div>
        </main>
      </div>
      <Popover />
      {canSales ? <DrillDrawer /> : null}
      {canSales ? <ChatWidget /> : null}
    </>
  );
}
