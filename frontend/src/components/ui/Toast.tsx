import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { IconCheck, IconX } from '@/components/icons'
import { cx } from '@/lib/cx'

export type ToastKind = 'ok' | 'err' | 'success' | 'info' | 'error' | 'warn'
type ToastItem = { id: number; msg: string; kind: 'ok' | 'err' | 'info' | 'warn' }

export type ToastFn = (msg: string, kind?: ToastKind) => void

const ToastCtx = createContext<ToastFn>(() => {})
let seq = 0

/**
 * Bottom-centre notification stack: newest last, 4 visible, 3.5s lifetime,
 * dark bar (red for errors). Same API as the original (`toast(msg, 'err')`).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const show = useCallback<ToastFn>((msg, kind = 'ok') => {
    const id = ++seq
    const norm: ToastItem['kind'] = kind === 'err' || kind === 'error' ? 'err' : kind === 'info' ? 'info' : kind === 'warn' ? 'warn' : 'ok'
    setItems((ts) => [...ts.slice(-3), { id, msg, kind: norm }])
  }, [])

  useEffect(() => {
    if (!items.length) return
    const t = setTimeout(() => setItems((ts) => ts.slice(1)), 3500)
    return () => clearTimeout(t)
  }, [items])

  const api = useMemo(() => show, [show])

  return (
    <ToastCtx.Provider value={api}>
      {children}
      {items.length > 0 && (
        <div className="pointer-events-none fixed bottom-26 left-1/2 z-(--z-toast) flex [transform:translateX(-50%)] flex-col items-center gap-8">
          {items.map((t) => (
            <div
              key={t.id}
              className={cx(
                'z-(--z-toast) flex animate-[lab-rise-stack_180ms_ease-out] items-center gap-10 px-20 py-12 text-s13 text-canvas',
                t.kind === 'err' ? 'bg-err' : 'bg-ink',
              )}
              role={t.kind === 'err' ? 'alert' : 'status'}
            >
              {t.kind === 'ok' ? <IconCheck size={14} /> : <IconX size={14} />}
              <span>{t.msg}</span>
            </div>
          ))}
        </div>
      )}
    </ToastCtx.Provider>
  )
}

export const useToast = () => useContext(ToastCtx)
