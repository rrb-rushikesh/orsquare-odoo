import { useState, type FormEvent } from 'react';
import { Btn, Field } from '@/components/ui';

/**
 * The second sign-in step: the 6 digits from the authenticator app.
 * Used by the shop sign-in and the Developer Console sign-in so both behave the same.
 */
export function MfaCodeForm({
  onSubmit,
  onCancel,
  error,
  busy,
}: {
  onSubmit: (code: string) => void | Promise<void>;
  onCancel: () => void;
  error?: string;
  busy?: boolean;
}) {
  const [code, setCode] = useState('');
  const ready = /^\d{6}$/.test(code.replace(/\s/g, ''));

  function submit(e: FormEvent) {
    e.preventDefault();
    if (ready && !busy) void onSubmit(code.replace(/\s/g, ''));
  }

  return (
    <form onSubmit={submit} className="stack" style={{ gap: 16 }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Two-step verification</div>
        <div className="t-caption" style={{ marginTop: 4 }}>
          Open your authenticator app and enter the 6-digit code for this account.
        </div>
      </div>
      {error && <div className="alert" role="alert">{error}</div>}
      <Field label="6-digit code">
        <input
          className="field-control num"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={7}
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d\s]/g, ''))}
          aria-label="6-digit code"
          style={{ letterSpacing: '0.3em', fontSize: 18 }}
        />
      </Field>
      <Btn variant="primary" type="submit" block disabled={!ready || busy}>
        {busy ? 'Checking…' : 'Verify and sign in'}
      </Btn>
      <Btn variant="ghost" type="button" block onClick={onCancel} disabled={busy}>
        Use a different account
      </Btn>
    </form>
  );
}
