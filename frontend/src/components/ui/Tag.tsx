import type { ReactNode } from 'react'
import { cva, cx, type VariantProps } from '@/lib/cx'

/** Status badge: square, 11.5px / 600, `3px 8px`. Tones map 1:1 to the original's tag colours. */
const tag = cva('inline-block px-8 py-3 text-s11h font-semibold tracking-caption whitespace-nowrap', {
  variants: {
    tone: {
      neutral: 'bg-gray-bg text-gray-fg',
      gray: 'bg-gray-bg text-gray-fg',
      blue: 'bg-info-bg text-info-fg',
      info: 'bg-info-bg text-info-fg',
      green: 'bg-ok-bg text-ok-fg',
      ok: 'bg-ok-bg text-ok-fg',
      red: 'bg-err-bg text-err-fg',
      err: 'bg-err-bg text-err-fg',
      warn: 'bg-warn-bg text-warn-fg',
      amber: 'bg-warn-bg text-warn-fg',
      yellow: 'bg-warn-bg text-warn-fg',
      purple: 'bg-purple-bg text-purple-fg',
    },
  },
  defaultVariants: { tone: 'neutral' },
})

export type TagTone = NonNullable<VariantProps<typeof tag>['tone']>

export function Tag({
  tone,
  children,
  className,
  title,
}: {
  tone?: TagTone
  children: ReactNode
  className?: string
  title?: string
}) {
  return (
    <span className={cx(tag({ tone }), className)} title={title}>
      {children}
    </span>
  )
}
