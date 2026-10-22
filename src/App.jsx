import { useEffect } from 'react';
import { loadStatus, loadData } from './state/store.js';
import { go, openFromHash } from './state/nav.js';
import { Sidebar } from './components/Sidebar.jsx';
import { FilterBar } from './components/FilterBar.jsx';
import { Overview } from './components/Overview.jsx';
import { ComingSoon, DataManagement, Admin } from './components/Pages.jsx';
import { Popover } from './components/Popover.jsx';
import { DrillDrawer } from './components/DrillDrawer.jsx';
import { ChatWidget } from './components/ChatWidget.jsx';

/** The application shell: sidebar, the module-aware sticky filter bar, the pages, and the shared overlays (popover, drill-down
    drawer, assistant). Start-up order is the source's: status, then data, then route (a #product/… style hash opens its drill-down). */
export default function App() {
  useEffect(() => {
    const onHash = () => go(location.hash.slice(1), false);
    window.addEventListener('hashchange', onHash);
    (async function init() {
      await loadStatus();
      await loadData();
      const h = location.hash.slice(1);
      if (h.includes('/')) await openFromHash(h); else go(h || 'overview', false);
    })();
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <>
      <div className="app">
        <Sidebar />
        <main className="main">
          <div className="main-in">
            <FilterBar />
            <Overview />
            <ComingSoon />
            <DataManagement />
            <Admin />
          </div>
        </main>
      </div>
      <Popover />
      <DrillDrawer />
      <ChatWidget />
    </>
  );
}
