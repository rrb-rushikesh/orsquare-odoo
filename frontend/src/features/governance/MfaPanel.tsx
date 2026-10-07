import { useState, type FormEvent } from 'react';
import { Btn, Field, Tag, useToast } from '@/components/ui';
import { session, type MfaSetup } from '@/lib/api';
import './governance.css';

/**
 * Two-step sign-in for the signed-in person: scan a code with any authenticator app, confirm with a 6-digit code, and
 * from then on sign-in asks for the password and the code. Removing it needs the password again.
 * `required` (platform operators) hides the remove option and explains why.
 */
export function MfaPanel({ enabled, required = false, onChanged }: { enabled: boolean; required?: boolean; onChanged: () => void | Promise<void> }) {
  const toast = useToast();
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function begin() {
    setBusy(true);
    setError('');
    try { setSetup(await session.mfaBegin()); } catch (e: any) { setError(e?.message || 'Could not start the setup.'); } finally { setBusy(false); }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (!setup) return;
    setBusy(true);
    setError('');
    try {
      await session.mfaEnable(setup.secret, code.replace(/\s/g, ''));
      setSetup(null);
      setCode('');
      toast('Two-step sign-in is on.', 'ok');
      await onChanged();
    } catch (ex: any) {
      setError(ex?.message || 'That code did not work.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await session.mfaDisable(password);
      setRemoving(false);
      setPassword('');
      toast('Two-step sign-in removed.', 'ok');
      await onChanged();
    } catch (ex: any) {
      setError(ex?.message || 'Could not remove it.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="gv-section" aria-label="Two-step sign-in">
      <header>
        <h3>Two-step sign-in</h3>
        {enabled ? <Tag tone="green">On</Tag> : <Tag tone="gray">Off</Tag>}
      </header>
      <div className="gv-body">
        {error && <div className="gv-banner err" role="alert">{error}</div>}

        {!enabled && !setup && (
          <>
            <p style={{ margin: 0, fontSize: 13 }}>
              {required
                ? 'This account must use an authenticator app. Set it up to continue.'
                : 'Add a second step to your sign-in: a 6-digit code from an authenticator app on your phone. Anyone who learns your password still cannot get in.'}
            </p>
            <div><Btn variant="primary" onClick={() => void begin()} disabled={busy}>{busy ? 'Preparing…' : 'Set up authenticator'}</Btn></div>
          </>
        )}

        {setup && (
          <form onSubmit={confirm} className="stack" style={{ gap: 14 }}>
            <div className="gv-qr">
              <img src={`data:image/png;base64,${setup.qrcode}`} alt="QR code to scan with your authenticator app" />
              <div className="stack" style={{ gap: 8, flex: 1, minWidth: 220 }}>
                <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
                  <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password …).</li>
                  <li>Scan this code, or type the key below.</li>
                  <li>Enter the 6-digit code the app shows.</li>
                </ol>
                <div className="gv-hint">Key (if you cannot scan)</div>
                <div className="gv-secret">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</div>
              </div>
            </div>
            <Field label="6-digit code">
              <input className="field-control num" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={7}
                style={{ maxWidth: 200, letterSpacing: '0.3em', fontSize: 18 }} value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^\d\s]/g, ''))} aria-label="6-digit code" />
            </Field>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn variant="primary" type="submit" disabled={busy || !/^\d{6}$/.test(code.replace(/\s/g, ''))}>{busy ? 'Checking…' : 'Turn on'}</Btn>
              <Btn variant="secondary" type="button" onClick={() => { setSetup(null); setCode(''); setError(''); }} disabled={busy}>Cancel</Btn>
            </div>
          </form>
        )}

        {enabled && !removing && (
          <>
            <p style={{ margin: 0, fontSize: 13 }}>
              Sign-in asks for your password and then a code from your authenticator app.
              {required && ' Platform accounts must keep this on.'}
            </p>
            {!required && <div><Btn variant="secondary" onClick={() => setRemoving(true)}>Remove two-step sign-in</Btn></div>}
          </>
        )}

        {enabled && removing && (
          <form onSubmit={remove} className="stack" style={{ gap: 12 }}>
            <Field label="Your password" hint="Confirm it is you before removing the extra protection.">
              <input className="field-control" type="password" autoFocus autoComplete="current-password" style={{ maxWidth: 320 }}
                value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn variant="danger" type="submit" disabled={busy || !password}>{busy ? 'Removing…' : 'Remove'}</Btn>
              <Btn variant="secondary" type="button" onClick={() => { setRemoving(false); setPassword(''); setError(''); }} disabled={busy}>Cancel</Btn>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
