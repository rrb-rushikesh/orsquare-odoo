import { createContext, useContext, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { cva, cx, type VariantProps } from '@/lib/cx'

/* ---------------------------------------------------------------------------
 * Field: label + control + hint/error. The label is associated with the
 * control through context (invisible improvement over the original).
 * ------------------------------------------------------------------------- */
const FieldIdContext = createContext<string | undefined>(undefined)
const useFieldId = () => useContext(FieldIdContext)

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label?: string
  hint?: string
  error?: string
  required?: boolean
  children: ReactNode
}) {
  const id = useId()
  return (
    <FieldIdContext.Provider value={id}>
      <div className="flex min-w-0 flex-col gap-6">
        {label && (
          <label htmlFor={id} className="text-s12h font-semibold text-ink-2">
            {label}
            {required && <span className="ml-4 text-err">*</span>}
          </label>
        )}
        {children}
        {hint && <span className="mt-4 text-s12 text-subtle">{hint}</span>}
        {error && (
          <span className="text-s12 text-err-fg" role="alert">
            {error}
          </span>
        )}
      </div>
    </FieldIdContext.Provider>
  )
}

/**
 * Two-column form layout (one column on phones). Fields inside are `Field`s; a field that needs the full
 * width is wrapped in `<FormSpan>`. Gap 16. (The original's `.form-grid` / `.span2`.)
 */
export function FormGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('grid grid-cols-2 gap-16 narrow:grid-cols-1', className)}>{children}</div>
}


/* ---------------------------------------------------------------------------
 * Controls. One look - grey fill, flat - in two borders:
 *   field    : bottom rule only (forms inside drawers/dialogs)
 *   toolbar  : full 1px border (panel header toolbars)
 * Focus always thickens the bottom rule to 2px blue.
 * Every full-size control is `--ctl-h` high (styles/controls.css); text is
 * 14px (13px compact). Sizes only differ in horizontal padding / reserved gutters:
 *   md            0 16px                      form fields
 *   combo         0 24px 0 16px               inline searchable select (room for the caret)
 *   dense         32px high                   inline rename in lists
 *   search        0 12px 0 36px               toolbar search (36px gutter holds the icon - see SearchField)
 *   toolbarSelect 0 34px 0 12px               toolbar select (34px right gutter holds the chevron)
 *   pageSize      rows-per-page select in table footers
 * ------------------------------------------------------------------------- */
const control = cva(
  [
    'bg-layer py-0 text-ink leading-normal [outline:none] placeholder:text-subtle',
    'disabled:cursor-not-allowed disabled:text-disabled focus:border-b-2 focus:border-b-blue',
  ],
  {
    variants: {
      appearance: {
        field: 'border-0 border-b border-b-subtle',
        toolbar: 'shrink-0 border border-line',
      },
      size: {
        md: 'h-ctl px-16 text-s14 compact:px-10 compact:text-s13',
        dense: 'h-ctl-sm px-16 text-s14 compact:px-10 compact:text-s13',
        combo: 'h-ctl pl-16 pr-24 text-s14 compact:pl-10 compact:text-s13',
        toolbarSelect: 'h-ctl pl-12 pr-34 text-s14 whitespace-nowrap compact:text-s13',
        search: 'h-ctl pl-36 pr-12 text-s14 compact:text-s13',
        pageSize: 'h-auto w-68 px-8 py-5! text-s13 narrow:h-36 narrow:text-s12',
      },
    },
    defaultVariants: { appearance: 'field', size: 'md' },
  },
)

type ControlVariants = VariantProps<typeof control>

/** Controls fill their container unless the caller sizes them (`fluid={false}` + a width class). */
type Fluid = { fluid?: boolean }
const isFluid = (fluid: boolean | undefined, size: ControlVariants['size']) =>
  fluid ?? !(size === 'toolbarSelect' || size === 'pageSize')

export function Input({
  appearance,
  size,
  fluid,
  className,
  id,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & ControlVariants & Fluid) {
  const fieldId = useFieldId()
  return (
    <input
      id={id ?? fieldId}
      {...rest}
      className={cx(control({ appearance, size }), isFluid(fluid, size) && 'w-full', className)}
    />
  )
}

export function Select({
  appearance,
  size,
  fluid,
  className,
  id,
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & ControlVariants & Fluid) {
  const fieldId = useFieldId()
  return (
    <select
      id={id ?? fieldId}
      {...rest}
      className={cx(
        control({ appearance, size }),
        // Every select shows the chevron (toolbar selects reserve 34px for it).
        'lab-select-chevron',
        isFluid(fluid, size) && 'w-full',
        className,
      )}
    />
  )
}
