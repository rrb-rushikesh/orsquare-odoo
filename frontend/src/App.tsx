import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth, type Perm } from '@/auth/AuthContext';
import { NoAccess, ToastProvider } from '@/components/ui';
import { BRAND_CONFIG } from '@/config/brand';

const LoginPage = lazy(() => import('@/pages/LoginPage'));
const AppShell = lazy(() => import('@/components/AppShell'));
const SalesPage = lazy(() => import('@/pages/SalesPage'));
const StockPage = lazy(() => import('@/pages/StockPage'));
const ComingSoon = lazy(() => import('@/pages/ComingSoon'));

/** Shown while the session is being restored. Never redirects: a refresh on /sales must stay on /sales. */
function Splash() {
  return (
    <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--layer)' }}>
      <div style={{ textAlign: 'center', color: 'var(--ink)', fontFamily: 'var(--font)' }}>
        <div style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px' }}>{BRAND_CONFIG.name}</div>
        <div style={{ fontSize: '13px', color: 'var(--ink-2)' }}>Opening your shop...</div>
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
  return first === 'dashboard' ? <ComingSoon title="Dashboard" /> : <Navigate to={`/${first}`} replace />;
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
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<RequireAuth><AppShell /></RequireAuth>}>
              <Route index element={<Home />} />
              <Route path="sales" element={<Guard perm="sales" what="Sales"><SalesPage /></Guard>} />
              <Route path="purchases" element={soon('Purchases', 'purchases')} />
              <Route path="stock" element={<Guard perm="stock" what="Stock"><StockPage /></Guard>} />
              <Route path="products" element={soon('Products', 'products')} />
              <Route path="accounts" element={soon('Accounts', 'accounts')} />
              <Route path="cashflow" element={soon('Cash Flow', 'cashflow')} />
              <Route path="daybook" element={soon('Day book', 'daybook')} />
              <Route path="calendar" element={soon('Calendar', 'calendar')} />
              <Route path="settings" element={soon('Settings', 'settings')} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ToastProvider>
    </AuthProvider>
  );
}
