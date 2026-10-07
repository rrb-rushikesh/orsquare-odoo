import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { isPlatformDev } from '@/auth/surface';
import { IconHistory, IconGear, IconLogout, IconStore } from '@/components/icons';
import { Button, IconButton } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { ToastProvider } from '@/components/ui/Toast';
import { ICON } from '@/components/ui/tokens';
import { BrandLogo } from '@/components/shell/BrandLogo';
import { cx } from '@/lib/cx';
import { AuditPage } from './AuditPage';
import { FleetPage } from './FleetPage';
import { SystemPage } from './SystemPage';

const NAV = [
  { to: '/dev', label: 'Businesses', icon: IconStore, end: true },
  { to: '/dev/audit', label: 'Audit', icon: IconHistory, end: true },
  { to: '/dev/system', label: 'System', icon: IconGear, end: true },
] as const;

function DevLogin({ onSignedIn }: { onSignedIn: () => void }) {
  const { signIn } = useAuth();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signIn(login.trim().toLowerCase(), password, 'orsquare_platform', 'dev');
      onSignedIn();
    } catch (ex: any) {
      setError(ex instanceof Error ? ex.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-[380px] flex-col justify-center gap-16 px-16">
      <BrandLogo size={26} />
      <div>
        <h1 className="m-0 text-s20 font-normal">Developer Console</h1>
        <p className="m-0 text-s13 text-muted">Restricted. Every action is recorded.</p>
      </div>
      {error && (
        <div role="alert" className="border border-line border-l-4 border-l-err bg-layer px-14 py-10 text-s13 text-err-fg">
          {error}
        </div>
      )}
      <form onSubmit={submit} className="flex flex-col gap-16">
        <Field label="Developer login">
          <Input autoFocus autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} placeholder="dev@orsquare.com" required />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Button variant="primary" type="submit" block loading={busy}>
          Sign in
        </Button>
      </form>
    </div>
  );
}

function Shell({ me, onSignOut }: { me: any; onSignOut: () => void }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="flex h-44 items-center gap-16 border-b border-line bg-canvas px-16">
        <span className="flex items-center gap-8">
          <BrandLogo size={22} />
          <span className="text-s13 font-semibold narrow:hidden">Console</span>
        </span>
        <nav className="flex items-center gap-2" aria-label="Console">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              aria-label={label}
              title={label}
              className={({ isActive }) =>
                cx(
                  'flex h-28 items-center gap-6 px-10 text-s13h',
                  isActive ? 'bg-layer-accent font-semibold text-blue' : 'text-muted hover:bg-layer hover:text-ink',
                )
              }
            >
              <Icon size={ICON.md} />
              <span className="narrow:hidden">{label}</span>
            </NavLink>
          ))}
        </nav>
        <span className="ml-auto flex items-center gap-4 text-s12 text-muted">
          <span className="narrow:hidden">{me?.name || me?.login || 'Operator'}</span>
          <IconButton label="Sign out" variant="ghost" onClick={onSignOut}>
            <IconLogout size={ICON.md} />
          </IconButton>
        </span>
      </header>
      <main className="min-w-0 flex-1 p-16">
        <Outlet />
      </main>
    </div>
  );
}

export default function DevApp() {
  const { me, signOut, refreshUserProfile } = useAuth();

  useEffect(() => {
    const prev = document.documentElement.dataset.density;
    document.documentElement.dataset.density = 'compact';
    return () => {
      if (prev) document.documentElement.dataset.density = prev;
      else delete document.documentElement.dataset.density;
    };
  }, []);

  const isDev = isPlatformDev(me);

  if (!isDev) {
    return <DevLogin onSignedIn={() => void refreshUserProfile()} />;
  }

  return (
    <ToastProvider>
      <Routes>
        <Route element={<Shell me={me} onSignOut={() => void signOut()} />}>
          <Route index element={<FleetPage />} />
          <Route path="b/:slug" element={<FleetPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="system" element={<SystemPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/dev" replace />} />
      </Routes>
    </ToastProvider>
  );
}
