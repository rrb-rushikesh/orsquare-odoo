import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { isPlatformDev } from '@/auth/surface';
import { BrandLogo } from '@/components/Logo';
import { MfaCodeForm } from '@/components/MfaCodeForm';
import { Btn, Field, Modal, Tag } from '@/components/ui';
import { IconGear, IconHistory, IconLayers, IconUsers } from '@/components/icons';
import { MfaPanel } from '@/features/governance/MfaPanel';
import { ApiError } from '@/lib/api';
import { AuditTab } from './AuditTab';
import { FleetTab } from './FleetTab';
import { OperatorsTab } from './OperatorsTab';
import { PlansTab } from './PlansTab';
import { SystemTab } from './SystemTab';
import '@/features/governance/governance.css';
import './dev.css';

type DevTab = 'fleet' | 'plans' | 'operators' | 'audit' | 'system';

const TABS: { key: DevTab; label: string; icon: typeof IconLayers; adminOnly?: boolean }[] = [
  { key: 'fleet', label: 'Fleet', icon: IconLayers },
  { key: 'plans', label: 'Plans', icon: IconLayers },
  { key: 'operators', label: 'Operators', icon: IconUsers, adminOnly: true },
  { key: 'audit', label: 'Audit trail', icon: IconHistory },
  { key: 'system', label: 'System', icon: IconGear },
];

function DevLogin() {
  const { signIn, completeMfa } = useAuth();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      // The server resolves the platform database from surface 'dev'; the shop code is not asked of developers.
      const r = await signIn(login.trim().toLowerCase(), password, 'orsquare_platform', 'dev');
      if ('mfaRequired' in r) setAwaitingCode(true);
    } catch (ex: any) {
      setError(ex?.message || 'Developer sign-in failed. Please verify credentials.');
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(code: string) {
    setBusy(true);
    setError('');
    try {
      await completeMfa(code);
    } catch (ex: any) {
      if (ex instanceof ApiError && ex.code === 'mfa_expired') setAwaitingCode(false);
      setError(ex?.message || 'That code did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dev-login">
      <div className="dev-login-card">
        <BrandLogo size={28} />
        <div>
          <h1>Developer Console</h1>
          <p>Restricted platform surface. Every action is recorded.</p>
        </div>
        {awaitingCode ? (
          <MfaCodeForm onSubmit={submitCode} onCancel={() => { setAwaitingCode(false); setError(''); setPassword(''); }} error={error} busy={busy} />
        ) : (
          <>
            {error && <div className="dev-alert" role="alert">{error}</div>}
            <form onSubmit={submit} className="dev-form">
              <Field label="Developer email">
                <input className="field-control" autoFocus type="text" autoComplete="username" value={login}
                  onChange={(e) => setLogin(e.target.value)} placeholder="dev@orsquare.com" required />
              </Field>
              <Field label="Password">
                <input className="field-control" type="password" autoComplete="current-password" value={password}
                  onChange={(e) => setPassword(e.target.value)} required />
              </Field>
              <Btn variant="primary" type="submit" block disabled={busy}>{busy ? 'Signing in…' : 'Sign in to console'}</Btn>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

/** Operators must have an authenticator app. Until they do, nothing else in the console opens. */
function EnrolGate() {
  const { me, refreshUserProfile, signOut } = useAuth();
  return (
    <div className="dev-login">
      <div className="dev-login-card" style={{ maxWidth: 560 }}>
        <BrandLogo size={28} />
        <div>
          <h1>Set up your authenticator</h1>
          <p>Hello {me?.name}. Platform accounts need two-step sign-in before the console opens.</p>
        </div>
        <MfaPanel enabled={false} required onChanged={refreshUserProfile} />
        <Btn variant="ghost" onClick={() => void signOut()}>Sign out</Btn>
      </div>
    </div>
  );
}

function DevConsole() {
  const { me, signOut, refreshUserProfile } = useAuth();
  const [tab, setTab] = useState<DevTab>('fleet');
  const [account, setAccount] = useState(false);
  const admin = me?.platform_role !== 'support';
  const tabs = TABS.filter((t) => admin || !t.adminOnly);

  return (
    <div className="dev-shell">
      <header className="dev-bar">
        <div className="dev-brand">
          <BrandLogo size={22} />
          <span>DEV CONSOLE</span>
        </div>
        <div className="dev-tabs" role="tablist" aria-label="Console sections">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button key={key} type="button" role="tab" className="dev-tab" aria-selected={tab === key} onClick={() => setTab(key)}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
        <div className="dev-operator">
          <span>Operator: <strong>{me?.login ?? '—'}</strong> <Tag tone={admin ? 'blue' : 'gray'}>{admin ? 'Admin' : 'Support'}</Tag></span>
          <Btn variant="secondary" size="sm" onClick={() => setAccount(true)}>Security</Btn>
          <Btn variant="secondary" size="sm" onClick={() => void signOut()}>Sign out</Btn>
        </div>
      </header>

      <main className="dev-main">
        {tab === 'fleet' && <FleetTab canWrite={admin} />}
        {tab === 'plans' && <PlansTab canWrite={admin} />}
        {tab === 'operators' && admin && me && <OperatorsTab selfId={me.id} />}
        {tab === 'audit' && <AuditTab />}
        {tab === 'system' && <SystemTab canWrite={admin} />}
      </main>

      <Modal open={account} onClose={() => setAccount(false)} title="Your account" width={560}>
        <MfaPanel enabled={!!me?.mfa?.enabled} required={!!me?.mfa?.required} onChanged={refreshUserProfile} />
      </Modal>
    </div>
  );
}

/**
 * Route entry. Deliberately hook-light: it only decides WHICH screen to show, so the screens below own their
 * hooks and the hook order never changes when `me` flips on sign-in or sign-out.
 */
export default function DevApp() {
  const { me } = useAuth();
  if (!me) return <DevLogin />;
  if (!isPlatformDev(me)) return <Navigate to="/" replace />;
  if (me.mfa?.required && !me.mfa.enabled) return <EnrolGate />;
  return <DevConsole />;
}
