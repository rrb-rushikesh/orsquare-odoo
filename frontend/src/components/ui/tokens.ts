/**
 * Standardized Design Tokens for ORSquare UI components.
 *
 * All values adhere to the IBM Carbon / Plex design philosophy:
 * - 0px radius geometry
 * - Standardized control heights (--ctl-h: 40px comfortable, 32px inline/dense)
 * - Standardized icon sizes (13, 14, 15, 16)
 */

export const ICON = {
  xs: 13, // dense rows, sm buttons
  sm: 14, // inline with 13-14px body text
  md: 15, // default table glyphs, search icon
  lg: 16, // toolbar buttons, modal headers
} as const

export const CONTROL = {
  height: 40,
  heightSm: 32,
  gap: 8,
} as const
