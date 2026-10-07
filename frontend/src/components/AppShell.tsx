import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, type Perm } from '@/auth/AuthContext';
import { setShopIdentity } from '@/lib/receipt';
import { BrandLogo } from '@/components/Logo';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { getSyncStatus, type SyncStatus } from '@/lib/sync';
import { loadPrefs } from '@/lib/prefs';
import { useData } from '@/data/DataProvider';
import { initials } from '@/lib/utils';
import { SURFACE_SHEET, SURFACE_AI, SURFACE_LEDGER, isGlobalAiEnabled } from '@/lib/experience';
import {
  IconBars,
  IconBook,
  IconBox,
  IconCal,
  IconChevronDown,
  IconDash,
  IconGear,
  IconLogout,
  IconMaximize,
  IconMinimize,
  IconPOS,
  IconRegisterSheet,
  IconSparkles,
  IconTag,
  IconTruck,
  IconUsers,
} from '@/components/icons';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  perm: Perm;
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: IconDash, perm: 'dashboard', end: true },
  { to: '/accounts', label: 'Accounts', icon: IconUsers, perm: 'accounts' },
  { to: '/ledger', label: 'Ledger', icon: IconBook, perm: 'accounts' },
  { to: '/purchases', label: 'Purchases', icon: IconTruck, perm: 'purchases' },
  { to: '/products', label: 'Products', icon: IconTag, perm: 'products' },
  { to: '/sales', label: 'Sales', icon: IconPOS, perm: 'sales' },
  { to: '/stock', label: 'Stock', icon: IconBox, perm: 'stock' },
  { to: '/sheet', label: 'Sheet', icon: IconRegisterSheet, perm: 'stock' },
  { to: '/cashflow', label: 'Cash Flow', icon: IconBars, perm: 'cashflow' },
  { to: '/daybook', label: 'Day book', icon: IconBook, perm: 'daybook' },
  { to: '/calendar', label: 'Calendar', icon: IconCal, perm: 'reports' },
  { to: '/ai', label: 'AI', icon: IconSparkles, perm: 'dashboard' },
  { to: '/settings', label: 'Settings', icon: IconGear, perm: 'settings' },
];

const TITLES: Record<string, [string, string]> = {
  '/': ['Home', 'Dashboard'],
  '/accounts': ['Masters', 'Accounts'],
  '/ledger': ['Accounting', 'Ledger'],
  '/purchases': ['Buy & stock', 'Purchase register'],
  '/products': ['Masters', 'Products'],
  '/sales': ['Sell', 'Sales'],
  '/stock': ['Buy & stock', 'Stock on hand'],
  '/sheet': ['Registers', 'Daily sheet'],
  '/daybook': ['Money', 'Day book'],
  '/cashflow': ['Money', 'Cash flow'],
  '/calendar': ['Insights', 'Calendar'],
  '/ai': ['Intelligence', 'AI Assistant'],
  '/settings': ['Insights', 'Settings'],
};

// Silent-printing status chip + QZ bridge: loaded only on devices set to QZ printing, so the QZ client and
// ESC/POS encoder stay out of every other device's bundle.
const PrinterStatus = lazy(() => import('@/components/PrinterStatus'));

export default function AppShell() {
  const { user, activeShop, signOut, can, isOwnerAccount, isMultiShop, sessionError, surfaceOn } = useAuth();
  const data = useData();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [qzPrinting, setQzPrinting] = useState(() => loadPrefs().print.backend === 'qz');
  // Receipts print the active shop's own name/phone unless Settings overrides them.
  useEffect(() => {
    setShopIdentity(activeShop ? { name: activeShop.name, phone: activeShop.phone } : null);
    return () => setShopIdentity(null);
  }, [activeShop?.id, activeShop?.name, activeShop?.phone]);
  useEffect(() => {
    const sync = () => setQzPrinting(loadPrefs().print.backend === 'qz');
    window.addEventListener('orsquare:print-settings', sync);
    return () => window.removeEventListener('orsquare:print-settings', sync);
  }, []);
  // Keep the printer connected, the queue recovered and backlog flushing for the whole session, on every page.
  useEffect(() => {
    if (qzPrinting) void import('@/lib/printing/service').then((m) => m.startPrinting());
  }, [qzPrinting]);
  const menuRef = useRef<HTMLDivElement>(null);

  // Full-screen toggle: gives the installed/standalone app a true "software"
  // window on desktop, and an edge-to-edge view on tablets/phones.
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void document.documentElement.requestFullscreen?.().catch(() => {});
    }
  };

  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    isOnline: navigator.onLine,
    isSyncing: false,
    pendingCount: 0,
    lastSyncedAt: null,
    lastError: null,
  });

  useEffect(() => {
    const updateStatus = () => {
      getSyncStatus().then(setSyncStatus).catch(() => {});
    };

    updateStatus();
    // Keep a reference to the exact function added, removing a DIFFERENT
    // wrapper left the listener attached forever (leak).
    const onSyncChange: EventListener = (e) => {
      setSyncStatus((e as CustomEvent<SyncStatus>).detail);
    };
    window.addEventListener('xpo_sync_change', onSyncChange);

    return () => {
      window.removeEventListener('xpo_sync_change', onSyncChange);
    };
  }, []);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  const key = location.pathname.replace(/\/$/, '') || '/'
  const [crumb, title] = TITLES[key] ?? ['', '']

  const [globalAiOn, setGlobalAiOn] = useState(isGlobalAiEnabled);
  useEffect(() => {
    const onAiChange = () => setGlobalAiOn(isGlobalAiEnabled());
    window.addEventListener('or2_global_ai_change', onAiChange);
    return () => window.removeEventListener('or2_global_ai_change', onAiChange);
  }, []);

  // In multi-shop mode, the dedicated Owner account oversees the network.
  // Cashier counter registers (/sales, /daybook and /sheet) belong strictly to the
  // independent retailer accounts so the owner does not accidentally bill into a shop's cash drawer.
  const visibleItems = NAV_ITEMS.filter((item) => {
    if (!can(item.perm)) return false;
    if (item.to === '/ledger' && !surfaceOn(SURFACE_LEDGER)) return false;
    if (item.to === '/sheet' && !surfaceOn(SURFACE_SHEET)) return false;
    if (item.to === '/ai' && (!globalAiOn || !surfaceOn(SURFACE_AI))) return false;
    if (isOwnerAccount && (item.to === '/daybook' || item.to === '/sales' || item.to === '/sheet')) return false;
    return true;
  });

  return (
    <div className="shell shell-topnav">
      <header className="navbar">
        <nav className="topnav" aria-label="Primary">
          {visibleItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={crumb}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Icon />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </header>

      {(() => {
        const isFullWidthPage = location.pathname === '/sheet';
        const isAccountsPage = location.pathname === '/accounts';
        return (
          <main className={`page ${isFullWidthPage ? 'page--fullwidth' : ''} ${isAccountsPage ? 'page--accounts' : ''}`.trim()}>
            {sessionError && (
              <div role="alert" className="alert" style={{ margin: '0 0 16px', borderLeft: '3px solid var(--err)' }}>
                <strong>Connection problem:</strong> {sessionError} Your session is kept. Retry after the connection returns.
              </div>
            )}
            {data.errors.length > 0 && <div role="alert" className="alert" style={{ marginBottom: 16 }}>{[...new Set(data.errors)].join(" ")} <button className="btn btn-ghost" onClick={data.refresh}>Retry</button></div>}
            <ErrorBoundary fallbackTitle="View interrupted">
              <Suspense fallback={<div className="skeleton" style={{ minHeight: 300, margin: '16px 0' }} />}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </main>
        );
      })()}

      <footer className="statusbar">
        <div className="statusbar-left">
          <span className="brand-mark" title="OR²">
            <BrandLogo size={22} />
          </span>
          <span
            className={`brand-env ${syncStatus.isOnline ? 'live' : 'offline'}`}
            title={syncStatus.isOnline ? 'Online · Live' : 'Offline · Local storage active'}
          >
            {syncStatus.isOnline ? 'LIVE' : 'OFFLINE'}
          </span>
          {qzPrinting && (
            <Suspense fallback={null}>
              <PrinterStatus />
            </Suspense>
          )}
        </div>

        <div className="statusbar-center" title={`${crumb} / ${title}`}>
          {title ? (
            <>
              <span className="statusbar-crumb">{crumb} /</span> {title}
            </>
          ) : (
            'Business operations'
          )}
        </div>

        <div className="statusbar-right">
          <button
            type="button"
            className="fs-btn"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit full screen' : 'Full screen'}
            aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
            aria-pressed={isFullscreen}
          >
            {isFullscreen ? <IconMinimize size={16} /> : <IconMaximize size={16} />}
          </button>
          <div ref={menuRef} style={{ position: 'relative' }}>
            <button className="user-chip" onClick={() => setMenuOpen((v) => !v)} aria-haspopup="menu" aria-expanded={menuOpen}>
              <span className="avatar">{initials(user?.name || user?.email || 'U')}</span>
              <span className="user-meta">
                <span className="user-name">
                  {user?.name || user?.email?.split('@')[0] || 'User'}
                  {activeShop && (
                    <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 400, color: 'var(--subtle)' }}>
                      {activeShop.name}
                    </span>
                  )}
                  {(() => {
                    if (!activeShop) return null;
                    if (activeShop.role !== 'owner') {
                      return <span className="member-role-tag">Employee</span>;
                    }
                    if (!isMultiShop) return null;
                    return isOwnerAccount ? (
                      <span className="member-role-tag" style={{ background: 'var(--blue)', borderColor: 'var(--blue)', color: '#ffffff', fontWeight: 600 }}>
                        OWNER
                      </span>
                    ) : (
                      <span className="member-role-tag" style={{ color: 'var(--ink-muted)', borderColor: 'var(--line)' }}>
                        RETAILER
                      </span>
                    );
                  })()}
                </span>
                <span className="user-mail">{user?.email}</span>
              </span>
              <IconChevronDown />
            </button>
            {menuOpen && (
              <div className="menu-pop up" style={{ minWidth: 264 }}>
                {/* Account isolation: no in-session shop switching. Each
                    login is pinned to its own shop; accessing another shop's
                    dashboard requires signing in with that account. */}
                <button
                  className="menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    navigate('/settings');
                  }}
                >
                  <IconGear /> Settings
                </button>
                <div className="menu-sep" />
                <button
                  className="menu-item danger"
                  onClick={async () => {
                    await signOut();
                    navigate('/login');
                  }}
                >
                  <IconLogout /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}