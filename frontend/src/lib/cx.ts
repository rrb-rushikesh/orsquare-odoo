import { clsx, type ClassValue } from 'clsx'

/** Joins class names. No Tailwind-merge on purpose: components expose explicit variants instead of overridable class soup. */
export const cx = (...inputs: ClassValue[]): string => clsx(inputs)
export { cva, type VariantProps } from 'class-variance-authority'
