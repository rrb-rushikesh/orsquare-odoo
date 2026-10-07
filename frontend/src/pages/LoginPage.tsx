import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { BRAND_CONFIG } from '@/config/brand'
import { BrandLogo } from '@/components/Logo'
import { Btn, Field } from '@/components/ui'
import { ApiError } from '@/lib/api'

export default function LoginPage() {
  const { signIn, me } = useAuth()
  const navigate = useNavigate()

  if (me) {
    if ((me as any).surface === 'dev' || (me as any).roles?.includes('developer')) {
      return <Navigate to="/dev" replace />
    }
    return <Navigate to="/" replace />
  }

  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [suspendedMsg, setSuspendedMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    setSuspendedMsg(null)
    setBusy(true)
    try {
      const me = await signIn(email.trim(), pw)
      if ((me as any).surface === 'dev' || (me as any).roles?.includes('developer')) {
        navigate('/dev')
        return
      }
        const tabGrants = me.tabs
        const hasDashboard = tabGrants.includes('dashboard')

        if (hasDashboard) {
          navigate('/')
        } else {
          // Route employee to first accessible tab
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
          const target = tabGrants.map((t) => tabToRoute[t]).find(Boolean) || '/sales'
          navigate(target)
        }
      } catch (ex: any) {
      const isSuspended =
        (ex instanceof ApiError && (ex.code === 'account_suspended' || ex.data?.code === 'account_suspended' || ex.data?.detail?.code === 'account_suspended')) ||
        (ex?.message && typeof ex.message === 'string' && ex.message.toLowerCase().includes('suspended'));

      if (isSuspended) {
        const msg = (ex instanceof ApiError ? (ex.data?.message || ex.data?.detail?.message) : null) || (ex?.message || 'This account has been suspended.');
        setSuspendedMsg(msg)
      } else {
        setErr(ex?.message || 'Sign-in failed. Please verify your credentials.')
      }
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
