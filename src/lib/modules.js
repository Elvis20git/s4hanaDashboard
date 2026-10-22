/* The module registry — the single source of truth the sidebar, the router and the sticky filter bar all read from.
   Plain script (no modules), loaded before app.js; test-modules.js loads this very file.

   route     the hash route (#production) and the page-section key for live modules
   group     'modules' (above the sidebar divider) or 'governance' (below it)
   label     sidebar text            icon   name of an icon in app.js's ICONS
   title     the filter bar's title  subtitle the line under it
   status    'live' | 'soon'         filters which controls the bar shows for this module:
               period      the period toggle + FROM/TO
               dataThrough the "Data through <month>" pill (only where the module has period data)
               statusDots  the orange / red status dots (Sales-specific)
   A 'soon' module shows its own title and subtitle with a "Coming soon" badge and no controls, whatever its filters say. */
export const MODULES = [
  { route: 'overview', group: 'modules', label: 'Sales', icon: 'trendingUp', status: 'live',
    title: 'Sales', subtitle: 'Volume, revenue and contribution margin from S/4HANA',
    filters: { period: true, dataThrough: true, statusDots: true } },
  { route: 'production', group: 'modules', label: 'Production', icon: 'factory', status: 'soon',
    title: 'Production', subtitle: 'Production volumes and orders from S/4HANA',
    description: 'Production orders, output and yield by line and shift.',
    filters: { period: true, dataThrough: false, statusDots: false } },
  { route: 'ar-ap-aging', group: 'modules', label: 'AR & AP aging', icon: 'clock', status: 'soon',
    title: 'AR & AP aging', subtitle: 'Receivables and payables aging from S/4HANA',
    description: 'Outstanding receivables and payables by age band and party.',
    filters: { period: true, dataThrough: false, statusDots: false } },
  { route: 'inventory', group: 'modules', label: 'Inventory', icon: 'layers', status: 'soon',
    title: 'Inventory', subtitle: 'Stock levels and valuation from S/4HANA',
    description: 'Stock levels, valuation and movements by plant and material.',
    filters: { period: true, dataThrough: false, statusDots: false } },
  { route: 'goods-in-transit', group: 'modules', label: 'Goods in transit', icon: 'truck', status: 'soon',
    title: 'Goods in transit', subtitle: 'Shipments in transit from S/4HANA',
    description: 'Shipments on the way, with expected arrival and status.',
    filters: { period: true, dataThrough: false, statusDots: false } },
  { route: 'tax', group: 'modules', label: 'Tax', icon: 'fileText', status: 'soon',
    title: 'Tax', subtitle: 'Tax reporting from S/4HANA',
    description: 'Tax postings and exposure by jurisdiction and period.',
    filters: { period: true, dataThrough: false, statusDots: false } },
  { route: 'data', group: 'governance', label: 'Data Management', icon: 'database', status: 'live',
    title: 'Data Management', subtitle: 'Data sources, sync status and validation',
    filters: { period: false, dataThrough: false, statusDots: false } },
  { route: 'admin', group: 'governance', label: 'Administration', icon: 'shield', status: 'live',
    title: 'Administration', subtitle: 'Users, roles and settings',
    filters: { period: false, dataThrough: false, statusDots: false } },
];
export const APP_NAME = 'AIF Analytics';
