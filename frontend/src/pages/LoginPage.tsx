import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { homeFor, isPlatformDev } from '@/auth/surface'
import { BRAND_CONFIG } from '@/config/brand'
import { BrandLogo } from '@/components/Logo'
import { Btn, Field } from '@/components/ui'
import { ApiError, type Me } from '@/lib/api'
import { MfaCodeForm } from '@/components/MfaCodeForm'

export default function LoginPage() {
  const { signIn, completeMfa, me } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [suspendedMsg, setSuspendedMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [awaitingCode, setAwaitingCode] = useState(false)

  // Hooks above, redirect below: an early return before a hook changes the hook count when `me` flips on sign-in.
  if (me) return <Navigate to={homeFor(me)} replace />

  async function finish(me: Me) {
    if (isPlatformDev(me)) {
      navigate('/dev', { replace: true })
      return
    }
    const tabGrants = me.tabs
    if (tabGrants.includes('dashboard')) {
      navigate('/')
      return
    }
    // an employee goes to the first tab they may open
    const tabToRoute: Record<string, string> = {
      sales: '/sales',
      stock: '/stock',
      purchases: '/purchases',
      products: '/products',
      accounts: '/accounts',
      cashflow: '/cashflow',
      daybook: '/daybook',
      settings: '/settings',
    }
    navigate(tabGrants.map((t: string) => tabToRoute[t]).find(Boolean) || '/sales')
  }

  function explain(ex: any) {
    const isSuspended =
      (ex instanceof ApiError && (ex.code === 'account_suspended' || ex.data?.code === 'account_suspended' || ex.data?.detail?.code === 'account_suspended')) ||
      (ex?.message && typeof ex.message === 'string' && ex.message.toLowerCase().includes('suspended'))
    if (isSuspended) {
      const msg = (ex instanceof ApiError ? (ex.data?.message || ex.data?.detail?.message) : null) || (ex?.message || 'This account has been suspended.')
      setSuspendedMsg(msg)
    } else {
      setErr(ex?.message || 'Sign-in failed. Please verify your credentials.')
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    setSuspendedMsg(null)
    setBusy(true)
    try {
      const result = await signIn(email.trim(), pw)
      if ('mfaRequired' in result) {
        setAwaitingCode(true)
        return
      }
      await finish(result)
    } catch (ex: any) {
      explain(ex)
    } finally {
      setBusy(false)
    }
  }

  async function submitCode(code: string) {
    setErr('')
    setBusy(true)
    try {
      await finish(await completeMfa(code))
    } catch (ex: any) {
      // an expired pre-session means the password step has to be done again
      if (ex instanceof ApiError && ex.code === 'mfa_expired') setAwaitingCode(false)
      setErr(ex?.message || 'That code did not work.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-split">
      <section className="login-hero" aria-hidden>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }} title="OR²">
            <BrandLogo size={26} />
          </div>
        </div>
        <div>
          <h1>Run your counter with clarity.</h1>
          <p>
            Accounts, stock in two locations, purchasing and fast billing: one workspace,
            synced live across every device you sign in from.
          </p>
        </div>
        <div className="hero-deco">
          <span /><span className="b" /><span />
          <span className="o" /><span /><span className="b o" />
          <span /><span className="o b" /><span />
        </div>
      </section>

      <section className="login-panel">
        <div className="login-card">
          <div>
            <h1 className="login-title">Sign in to {BRAND_CONFIG.name}</h1>
          </div>
          {awaitingCode ? (
            <MfaCodeForm
              onSubmit={submitCode}
              onCancel={() => { setAwaitingCode(false); setErr(''); setPw('') }}
              error={err}
              busy={busy}
            />
          ) : (
          <>
          {err && <div className="alert" role="alert">{err}</div>}
          {suspendedMsg && <div className="alert" role="alert">{suspendedMsg}</div>}

          <form onSubmit={submit} className="stack" style={{ gap: 16 }}>
            <Field label="Email or Mobile">
              <input
                className="field-control"
                type="text"
                autoComplete="username"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="owner@krishnawines.com or 9876543210"
                required
              />
            </Field>
            <Field label="Password">
              <input
                className="field-control"
                type="password"
                autoComplete="current-password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
              />
            </Field>
            <Btn variant="primary" type="submit" block disabled={busy}>
              {busy ? 'Please wait.' : 'Sign in'}
            </Btn>
          </form>
          </>
          )}

          <div className="invite-note">
            <strong>Invite-only workspace</strong>
            <span>
              {BRAND_CONFIG.name} is provisioned for registered businesses. Sign-up is not
              open to the public. To onboard your shop, please contact your administrator.
            </span>
          </div>
        </div>
      </section>
    </div>
  )
}
