import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth, type Perm } from '@/auth/AuthContext';
import { devGate, homeFor, isPlatformDev } from '@/auth/surface';
import { NoAccess, ToastProvider } from '@/components/ui';
import { BRAND_CONFIG } from '@/config/brand';
import { DataProvider } from '@/data/DataProvider';

const LoginPage = lazy(() => import('@/pages/LoginPage'));
const AppShell = lazy(() => import('@/components/AppShell'));
const SalesPage = lazy(() => import('@/pages/SalesPage'));
const StockPage = lazy(() => import('@/pages/StockPage'));
const WineStockPage = lazy(() => import('@/pages/WineStockPage'));
const ProductsPage = lazy(() => import('@/pages/ProductsPage'));
const PurchasesPage = lazy(() => import('@/pages/PurchasesPage'));
const AccountsPage = lazy(() => import('@/pages/AccountsPage'));
const AdvancedAccountsPage = lazy(() => import('@/pages/AdvancedAccountsPage'));
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
  if (isPlatformDev(me)) return <Navigate to="/dev" replace />;
  return <>{children}</>;
}

/** An authenticated user must NEVER see /login: immediately routes them into their workspace. */
function RedirectIfAuth({ children }: { children: ReactNode }) {
  const { me, ready } = useAuth();
  if (me) return <Navigate to={homeFor(me)} replace />;
  if (!ready) return <Splash />;
  return <>{children}</>;
}

/** Guard for the Platform Developer Console (strictly platform developers only).
 * Retail shop staff must NEVER see it: they go straight to their shop. A visitor who is not signed in gets the
 * developer sign-in screen (rendered by DevApp). Nothing redirects while the session is still restoring.
 * The decision is `devGate` and depends only on the server-stated surface/roles, never on `me.company`.
 */
function DevGuard({ children }: { children: ReactNode }) {
  const { me, ready } = useAuth();
  const gate = devGate(me, ready);
  if (gate === 'wait') return <Splash />;
  if (gate === 'shop') return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** The same tab in the presentation the shop chose in Business Studio (the data underneath is identical). */
function StockRoute() {
  const { variant } = useAuth();
  return variant('stock') === 'wine' ? <WineStockPage /> : <StockPage />;
}

function AccountsRoute() {
  const { variant } = useAuth();
  return variant('accounts') === 'advanced' ? <AdvancedAccountsPage /> : <AccountsPage />;
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
              <Route path="stock" element={<Guard perm="stock" what="Stock"><StockRoute /></Guard>} />
              <Route path="products" element={<Guard perm="products" what="Products"><ProductsPage /></Guard>} />
              <Route path="accounts" element={<Guard perm="accounts" what="Accounts"><AccountsRoute /></Guard>} />
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
