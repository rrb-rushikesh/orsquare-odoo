import { createContext, useContext, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { cva, cx, type VariantProps } from '@/lib/cx'

/* ---------------------------------------------------------------------------
 * Field: label + control + hint/error with accessible context association.
 * ------------------------------------------------------------------------- */
const FieldIdContext = createContext<string | undefined>(undefined)
export const useFieldId = () => useContext(FieldIdContext)

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label?: string
  hint?: string
  error?: string
  required?: boolean
  children: ReactNode
  className?: string
}) {
  const id = useId()
  return (
    <FieldIdContext.Provider value={id}>
      <div className={cx('field', className)}>
        {label && (
          <label htmlFor={id} className="field-label">
            {label}
            {required && <span className="field-required text-err ml-1">*</span>}
          </label>
        )}
        {children}
        {hint && <span className="field-help">{hint}</span>}
        {error && (
          <span className="field-error" role="alert">
            {error}
          </span>
        )}
      </div>
    </FieldIdContext.Provider>
  )
}

/** Two-column form layout with 16px gap (responsive single-column on small screens) */
export function FormGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('form-grid', className)}>{children}</div>
}

/* ---------------------------------------------------------------------------
 * Standardized Input and Select Controls with CVA variants.
 * ------------------------------------------------------------------------- */
const inputVariants = cva('field-control', {
  variants: {
    appearance: {
      field: '',
      toolbar: 'shrink-0',
    },
    controlSize: {
      md: '',
      sm: 'btn-sm',
    },
  },
  defaultVariants: {
    appearance: 'field',
    controlSize: 'md',
  },
})

export type InputVariants = VariantProps<typeof inputVariants>

export function Input({
  appearance,
  controlSize,
  className,
  id,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & InputVariants) {
  const fieldId = useFieldId()
  return (
    <input
      id={id ?? fieldId}
      className={cx(inputVariants({ appearance, controlSize }), className)}
      {...rest}
    />
  )
}

export function Select({
  appearance,
  controlSize,
  className,
  id,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & InputVariants) {
  const fieldId = useFieldId()
  return (
    <select
      id={id ?? fieldId}
      className={cx(inputVariants({ appearance, controlSize }), className)}
      {...rest}
    >
      {children}
    </select>
  )
}
