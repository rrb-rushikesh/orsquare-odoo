import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from '@/lib/cx'

/** Flat bordered surface. No padding of its own: heads/bodies bring their own. */
export function Panel({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={cx('border border-line bg-canvas', className)} />
}

/** Panel header row: title group on the left, toolbar on the right. `9px 16px`, bottom rule. */
export function PanelHead({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-12 border-b border-line px-16 py-9">{children}</div>
}

/** Title + count caption (baseline aligned, gap 8). */
export function PanelTitle({ title, caption, as = 'h3' }: { title: string; caption?: string; as?: 'h3' | 'span' }) {
  // `as="span"`: the original's plain-title variant (a span in an ordinary block, no baseline row, no caption).
  if (as === 'span') {
    return (
      <div>
        <span className="text-s14 font-semibold">{title}</span>
      </div>
    )
  }
  return (
    <div className="flex shrink-0 items-baseline gap-8">
      <h3 className="m-0 text-s14 font-semibold">{title}</h3>
      {caption && <span className="t-caption">{caption}</span>}
    </div>
  )
}

/**
 * Right-aligned toolbar. Never wraps on desktop (only the search box may shrink);
 * wraps onto several rows below 672px.
 */
export function PanelActions({ children }: { children: ReactNode }) {
  return (
    <div className="ml-auto flex min-w-0 flex-nowrap items-center justify-end gap-8 narrow:ml-0 narrow:w-full narrow:flex-wrap narrow:justify-start">
      {children}
    </div>
  )
}

/** Padded body (24px) for a panel whose content is not a table/list (forms, summaries, empty states). */
export function PanelBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('p-24', className)}>{children}</div>
}
