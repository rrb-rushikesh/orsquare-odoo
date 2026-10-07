import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, type Perm } from '@/auth/AuthContext';
import { setShopIdentity } from '@/lib/receipt';
import { BrandLogo } from '@/components/Logo';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { getSnapshot, subscribe } from '@/lib/sync';
import { initials } from '@/lib/utils';
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
  { to: '/sales', label: 'Sales', icon: IconPOS, perm: 'sales' },
  { to: '/purchases', label: 'Purchases', icon: IconTruck, perm: 'purchases' },
  { to: '/stock', label: 'Stock', icon: IconBox, perm: 'stock' },
  { to: '/products', label: 'Products', icon: IconTag, perm: 'products' },
  { to: '/accounts', label: 'Accounts', icon: IconUsers, perm: 'accounts' },
  { to: '/cashflow', label: 'Cash Flow', icon: IconBars, perm: 'cashflow' },
  { to: '/daybook', label: 'Day book', icon: IconBook, perm: 'daybook' },
  { to: '/calendar', label: 'Calendar', icon: IconCal, perm: 'calendar' },
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

export default function AppShell() {
  const { user, me, activeShop, signOut, can, sessionError } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const snap = useSyncExternalStore(subscribe, getSnapshot);
  // Receipts print the shop's own name unless Settings overrides it.
  useEffect(() => {
    setShopIdentity(activeShop ? { name: activeShop.name, phone: activeShop.phone } : null);
    return () => setShopIdentity(null);
  }, [activeShop?.id, activeShop?.name, activeShop?.phone]);
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

  const visibleItems = NAV_ITEMS.filter((item) => can(item.perm));

  return (
    <div className="shell shell-topnav">
      <header className="navbar">
        <nav className="topnav" aria-label="Primary">
          {visibleItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Icon />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </header>

      {(() => {
        const isFullWidthPage = false;
        const isAccountsPage = location.pathname === '/accounts';
        return (
          <main className={`page ${isFullWidthPage ? 'page--fullwidth' : ''} ${isAccountsPage ? 'page--accounts' : ''}`.trim()}>
            {sessionError && (
              <div role="alert" className="alert" style={{ margin: '0 0 16px', borderLeft: '3px solid var(--err)' }}>
                <strong>Connection problem:</strong> {sessionError} Your session is kept. Retry after the connection returns.
              </div>
            )}
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
            className={`brand-env ${snap.online ? 'live' : 'offline'}`}
            title={snap.online ? 'Online · Live' : 'Offline · Local storage active'}
          >
            {snap.online ? 'LIVE' : 'OFFLINE'}{snap.pending > 0 ? ` · ${snap.pending} to send` : ''}
          </span>
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
              <span className="avatar">{initials(user?.name || 'U')}</span>
              <span className="user-meta">
                <span className="user-name">
                  {user?.name || 'User'}
                  {activeShop && (
                    <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 400, color: 'var(--subtle)' }}>
                      {activeShop.name}
                    </span>
                  )}
                  {activeShop && activeShop.role !== 'owner' && <span className="member-role-tag">Employee</span>}
                </span>
                <span className="user-mail">{me?.login}</span>
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