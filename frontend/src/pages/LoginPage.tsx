import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { BRAND_CONFIG } from '@/config/brand'
import { BrandLogo } from '@/components/Logo'
import { Btn, Field } from '@/components/ui'
import { ApiError } from '@/lib/api'

export default function LoginPage() {
  const { signIn, me } = useAuth()
  const navigate = useNavigate()
  const [shop, setShop] = useState(() => {
    try { return localStorage.getItem('or2_shop') || '' } catch { return '' }
  })
  const [login, setLogin] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (me) navigate('/', { replace: true })
  }, [me, navigate])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      await signIn(shop, login, pw)
      navigate('/', { replace: true })
    } catch (ex) {
      setErr(
        ex instanceof ApiError && ex.status === 429
          ? 'Too many attempts. Please wait a few minutes and try again.'
          : ex instanceof ApiError && ex.network
            ? 'Cannot reach the server. Check your connection.'
            : 'Wrong shop code, login or password.',
      )
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

          <form onSubmit={submit} className="stack" style={{ gap: 16 }}>
            <Field label="Shop code">
              <input
                className="field-control"
                autoComplete="organization"
                autoFocus={!shop}
                value={shop}
                onChange={(e) => setShop(e.target.value.trim().toLowerCase())}
                placeholder="orsquare_myshop"
                required
              />
            </Field>
            <Field label="Login">
              <input
                className="field-control"
                autoComplete="username"
                autoFocus={!!shop}
                value={login}
                onChange={(e) => setLogin(e.target.value)}
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