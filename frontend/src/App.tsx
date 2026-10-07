import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth, type Perm } from '@/auth/AuthContext';
import { NoAccess, ToastProvider } from '@/components/ui';
import { BRAND_CONFIG } from '@/config/brand';
import { DataProvider } from '@/data/DataProvider';

const LoginPage = lazy(() => import('@/pages/LoginPage'));
const AppShell = lazy(() => import('@/components/AppShell'));
const SalesPage = lazy(() => import('@/pages/SalesPage'));
const StockPage = lazy(() => import('@/pages/StockPage'));
const ProductsPage = lazy(() => import('@/pages/ProductsPage'));
const PurchasesPage = lazy(() => import('@/pages/PurchasesPage'));
const AccountsPage = lazy(() => import('@/pages/AccountsPage'));
const CashFlowPage = lazy(() => import('@/pages/CashFlowPage'));
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const ComingSoon = lazy(() => import('@/pages/ComingSoon'));
const LedgerPage = lazy(() => import('@/pages/LedgerPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const DevApp = lazy(() => import('@/features/dev/DevApp'));

/** Shown while the session is being restored. Never redirects: a refresh on /sales must stay on /sales. */
function Splash() {
  const { sessionError } = useAuth();
  return (
    <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--layer)' }}>
      <div style={{ textAlign: 'center', color: 'var(--ink)', fontFamily: 'var(--font)' }}>
        <div style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px' }}>{BRAND_CONFIG.name}</div>
        <div style={{ fontSize: '13px', color: 'var(--ink-2)' }}>{sessionError || 'Opening your shop...'}</div>
        {sessionError && <button className="btn" onClick={() => window.location.reload()}>Retry</button>}
      </div>
    </div>
  );
}

/** Only an explicit "not signed in" answer from the server sends anyone to /login. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { me, ready } = useAuth();
  if (!ready) return <Splash />;
  if (!me) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** An authenticated user must NEVER see /login: immediately routes them into their workspace. */
function RedirectIfAuth({ children }: { children: ReactNode }) {
  const { me, ready } = useAuth();
  if (me) return <Navigate to="/" replace />;
  if (!ready) return <Splash />;
  return <>{children}</>;
}

/** Guard for the Platform Developer Console (strictly platform developers only).
 * Retail shop staff (owners, cashiers, stockkeepers) must NEVER see this console:
 * they are immediately redirected to their retailer shop.
 * Unauthenticated guests are redirected to /login.
 */
function DevGuard({ children }: { children: ReactNode }) {
  const { me, ready } = useAuth();
  if (!ready) return <Splash />;
  if (!me) return <Navigate to="/login" replace />;

  // Retail shop staff (owners, cashiers, stockkeepers) or any user attached to a shop
  // must NEVER access the developer console. Redirect immediately to their retailer shop!
  const isRetailStaff = me.roles.includes('owner') || me.roles.includes('cashier') || me.roles.includes('stockkeeper') || Boolean(me.company);
  if (isRetailStaff) {
    return <Navigate to="/" replace />;
  }

  // Only verified platform developers (surface: 'dev' or developer role) are allowed
  const isPlatformDev = (me as any).surface === 'dev' || (me as any).roles?.includes('developer');
  if (!isPlatformDev) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function Guard({ perm, what, children }: { perm: Perm; what: string; children: ReactNode }) {
  const { can } = useAuth();
  return can(perm) ? <>{children}</> : <NoAccess what={what} />;
}

/** The first tab this person may open (after sign-in and for "/" when Dashboard is not granted). */
function Home() {
  const { can } = useAuth();
  const order: Perm[] = ['dashboard', 'sales', 'stock', 'purchases', 'products', 'accounts', 'cashflow', 'daybook', 'calendar', 'settings'];
  const first = order.find((p) => can(p));
  if (!first) return <NoAccess what="this shop" />;
  return first === 'dashboard' ? <DashboardPage /> : <Navigate to={`/${first}`} replace />;
}

const soon = (title: string, perm: Perm) => (
  <Guard perm={perm} what={title}><ComingSoon title={title} /></Guard>
);

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Suspense fallback={<Splash />}>
          <Routes>
            <Route path="/login" element={<RedirectIfAuth><LoginPage /></RedirectIfAuth>} />
            <Route path="/dev/*" element={<DevGuard><DevApp /></DevGuard>} />
            <Route path="/" element={<RequireAuth><DataProvider><AppShell /></DataProvider></RequireAuth>}>
              <Route index element={<Home />} />
              <Route path="sales" element={<Guard perm="sales" what="Sales"><SalesPage /></Guard>} />
              <Route path="purchases" element={<Guard perm="purchases" what="Purchases"><PurchasesPage /></Guard>} />
              <Route path="stock" element={<Guard perm="stock" what="Stock"><StockPage /></Guard>} />
              <Route path="products" element={<Guard perm="products" what="Products"><ProductsPage /></Guard>} />
              <Route path="accounts" element={<Guard perm="accounts" what="Accounts"><AccountsPage /></Guard>} />
              <Route path="cashflow" element={<Guard perm="cashflow" what="Cash Flow"><CashFlowPage /></Guard>} />
              <Route path="daybook" element={soon('Day book', 'daybook')} />
              <Route path="calendar" element={soon('Calendar', 'calendar')} />
              <Route path="ledger" element={<Guard perm="reports" what="Ledger"><LedgerPage /></Guard>} />
              <Route path="settings" element={<Guard perm="settings" what="Settings"><SettingsPage /></Guard>} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ToastProvider>
    </AuthProvider>
  );
}
