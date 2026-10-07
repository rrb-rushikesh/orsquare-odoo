/**
 * OR² brand mark: the single shared logo. Blue square, white "OR" with a
 * superscript 2. Use <BrandLogo /> everywhere; never inline a custom logo.
 */
export function BrandLogo({ size = 26, label = 'OR²' }: { size?: number; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={label}
      style={{ flexShrink: 0, display: 'block' }}
    >
      <rect width="64" height="64" fill="#0f62fe" />
      <text
        x="27"
        y="43"
        fontFamily="'IBM Plex Sans', Arial, Helvetica, sans-serif"
        fontSize="26"
        fontWeight="600"
        fill="#ffffff"
        textAnchor="middle"
        letterSpacing="-1"
      >
        OR
      </text>
      <text
        x="50"
        y="24"
        fontFamily="'IBM Plex Sans', Arial, Helvetica, sans-serif"
        fontSize="15"
        fontWeight="600"
        fill="#ffffff"
        textAnchor="middle"
      >
        2
      </text>
    </svg>
  )
}
