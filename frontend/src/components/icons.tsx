import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }

function S({ size = 18, children, ...rest }: P) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  )
}

export const IconDash = (p: P) => (
  <S {...p}><rect x="3" y="3" width="8" height="10" /><rect x="13" y="3" width="8" height="6" /><rect x="3" y="15" width="8" height="6" /><rect x="13" y="11" width="8" height="10" /></S>
)

export const IconMaximize = (p: P) => (
  <S {...p}><path d="M4 9V4h5" /><path d="M20 15v5h-5" /><path d="M15 4h5v5" /><path d="M9 20H4v-5" /></S>
)

export const IconMinimize = (p: P) => (
  <S {...p}><path d="M9 4v5H4" /><path d="M15 20v-5h5" /><path d="M4 15h5v5" /><path d="M20 9h-5V4" /></S>
)

export const IconCal = (p: P) => (
  <S {...p}><rect x="3" y="5" width="18" height="16" /><path d="M3 10h18" /><path d="M8 2v5" /><path d="M16 2v5" /></S>
)

export const IconPOS = (p: P) => (
  <S {...p}><path d="M2 4h3l2.5 11h11L21 7H6" /><circle cx="9.5" cy="20" r="1.6" /><circle cx="17.5" cy="20" r="1.6" /></S>
)

export const IconZap = (p: P) => (
  <S {...p}><path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2Z" /></S>
)

export const IconTruck = (p: P) => (
  <S {...p}><path d="M2 4h3l3 12h11l2-7H9" /><circle cx="9.5" cy="20" r="1.6" /><circle cx="17.5" cy="20" r="1.6" /></S>
)

export const IconBox = (p: P) => (
  <S {...p}><path d="M3 8l9-5 9 5v8l-9 5-9-5z" /><path d="M3 8l9 5 9-5" /><path d="M12 13v8" /></S>
)

export const IconUsers = (p: P) => (
  <S {...p}><circle cx="9" cy="8" r="3.4" /><path d="M2.5 20c.8-3.4 3.4-5 6.5-5s5.7 1.6 6.5 5" /><circle cx="17" cy="9" r="2.6" /><path d="M16 14.6c2.7.2 4.8 1.6 5.5 4.4" /></S>
)

export const IconTag = (p: P) => (
  <S {...p}><path d="M3 11V3h8l10 10-8 8z" /><circle cx="8" cy="8" r="1.4" /></S>
)

export const IconCard = (p: P) => (
  <S {...p}><rect x="2.5" y="5.5" width="19" height="13" rx="1" /><path d="M2.5 10h19" /></S>
)

export const IconRupee = (p: P) => (
  <S {...p}>
    <path d="M6 3h12" />
    <path d="M6 8h12" />
    <path d="m6 13 8.5 8" />
    <path d="M6 13h3" />
    <path d="M9 13c6.667 0 6.667-10 0-10" />
  </S>
)

export const IconSwap = (p: P) => (
  <S {...p}><path d="M4 8h14l-3.5-3.5" /><path d="M20 16H6l3.5 3.5" /></S>
)

export const IconBars = (p: P) => (
  <S {...p}><path d="M4 20v-8" /><path d="M10 20V6" /><path d="M16 20v-5" /><path d="M22 20H2" /></S>
)

export const IconBook = (p: P) => (
  <S {...p}><rect x="4" y="3.5" width="16" height="17" rx="1.5" /><path d="M4 9.5h16" /><path d="M8 3.5v17" /></S>
)

export const IconChart = (p: P) => (
  <S {...p}><rect x="3.5" y="3.5" width="17" height="17" rx="1.5" /><path d="M8 16v-5" /><path d="M12 16V8" /><path d="M16 16v-3" /></S>
)

export const IconGear = (p: P) => (
  <S {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></S>
)

export const IconSearch = (p: P) => (
  <S size={15} {...p}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" /></S>
)

export const IconPlus = (p: P) => (
  <S size={15} {...p}><path d="M12 5v14" /><path d="M5 12h14" /></S>
)

export const IconDownload = (p: P) => (
  <S size={15} {...p}><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 21h16" /></S>
)

export const IconUpload = (p: P) => (
  <S size={15} {...p}><path d="M12 15V3" /><path d="m7 8 5-5 5 5" /><path d="M4 21h16" /></S>
)

export const IconX = (p: P) => (
  <S size={17} {...p}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></S>
)

export const IconChevronDown = (p: P) => (
  <S size={14} {...p}><path d="m6 9 6 6 6-6" /></S>
)

export const IconChevronRight = (p: P) => (
  <S size={14} {...p}><path d="m9 6 6 6-6 6" /></S>
)

export const IconLogout = (p: P) => (
  <S size={15} {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></S>
)

export const IconCheck = (p: P) => (
  <S size={15} {...p}><path d="M20 6 9 17l-5-5" /></S>
)

export const IconTrash = (p: P) => (
  <S size={14} {...p}><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M6 7l1 13h10l1-13" /></S>
)

// F6: U-turn return arrow (Return / Exchange mode on the Sales tab).
export const IconReturnArrow = (p: P) => (
  <S {...p}><path d="M20 19v-6a5 5 0 0 0-5-5H5" /><path d="M9 4 5 8l4 4" /></S>
)

// History / audit trail entry points (Sales history, Purchase edit log).
export const IconHistory = (p: P) => (
  <S {...p}><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.4" /><path d="M3.5 3.5v4.9h4.9" /><path d="M12 7.5V12l3 3" /></S>
)

// Universal spreadsheet export (CSV/Excel): neutral sheet glyph, NOT any vendor logo.
export const IconSheet = (p: P) => (
  <S {...p}><rect x="3" y="4" width="18" height="16" /><path d="M3 9.5h18" /><path d="M9.5 9.5V20" /><path d="M15.5 9.5V20" /></S>
)

// Daily Sheet / Register grid icon for the AppShell topnav:
export const IconRegisterSheet = (p: P) => (
  <S size={16} {...p}>
    <rect x="3" y="3" width="18" height="18" rx="0" />
    <line x1="3" y1="8" x2="21" y2="8" />
    <line x1="3" y1="13" x2="21" y2="13" />
    <line x1="9" y1="8" x2="9" y2="21" />
    <line x1="15" y1="8" x2="15" y2="21" />
  </S>
)

// F7: package with exchange arcs (Return / Exchange mode on the Purchases tab).
export const IconBoxReturn = (p: P) => (
  <S {...p}>
    <path d="M4.8 8.6A8.6 8.6 0 0 1 19.2 8.6" />
    <path d="M19.2 15.4a8.6 8.6 0 0 1-14.4 0" />
    <path d="M19.5 3.5v5.2h-5.2" />
    <path d="M4.5 20.5v-5.2h5.2" />
    <path d="M12 8.2 8.8 10v4l3.2 1.8 3.2-1.8v-4L12 8.2Z" />
  </S>
)

export const IconEdit = (p: P) => (
  <S size={14} {...p}><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z" /><path d="M13.5 6.5l4 4" /></S>
)

// Low stock / alert filter (warning triangle glyph).
export const IconLowStock = (p: P) => (
  <S size={16} {...p}>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </S>
)

export const IconTransfer = (p: P) => (
  <S size={15} {...p}><path d="M3 8h13" /><path d="m13 4 4 4-4 4" /><path d="M21 16H8" /><path d="m11 12-4 4 4 4" /></S>
)

export const IconMenu = (p: P) => (
  <S size={19} {...p}><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></S>
)

export const IconScan = (p: P) => (
  <S size={16} {...p}><path d="M3 7h18" /><path d="M5 7l4-4" /><path d="M19 7l-4-4" /><rect x="5.5" y="11" width="13" height="2.6" /></S>
)

export const IconUser = (p: P) => (
  <S size={15} {...p}><circle cx="12" cy="8" r="3.6" /><path d="M5 20c.9-3.5 3.7-5.2 7-5.2s6.1 1.7 7 5.2" /></S>
)

export const IconArrowRight = (p: P) => (
  <S size={15} {...p}><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></S>
)

export const IconLayers = (p: P) => (
  <S size={15} {...p}><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></S>
)

export const IconDatabase = (p: P) => (
  <S size={15} {...p}><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></S>
)

export const IconShield = (p: P) => (
  <S size={15} {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></S>
)

export const IconServer = (p: P) => (
  <S size={15} {...p}><rect x="2" y="2" width="20" height="8" rx="0" /><rect x="2" y="14" width="20" height="8" rx="0" /><line x1="6" y1="6" x2="6.01" y2="6" /><line x1="6" y1="18" x2="6.01" y2="18" /></S>
)

export const IconActivity = (p: P) => (
  <S size={15} {...p}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></S>
)

export const IconCheckCircle = (p: P) => (
  <S size={15} {...p}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></S>
)

export const IconTerminal = (p: P) => (
  <S size={15} {...p}><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></S>
)

export const IconFileText = (p: P) => (
  <S size={15} {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></S>
)

export const IconRefresh = (p: P) => (
  <S size={15} {...p}><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></S>
)

export const IconCash = (p: P) => (
  <S size={16} {...p}>
    <rect x="2" y="6" width="20" height="12" rx="0" />
    <circle cx="12" cy="12" r="3" />
    <path d="M6 12h.01M18 12h.01" />
  </S>
)

export const IconQrCode = (p: P) => (
  <S size={16} {...p}>
    <rect x="3" y="3" width="6" height="6" rx="0" />
    <rect x="15" y="3" width="6" height="6" rx="0" />
    <rect x="3" y="15" width="6" height="6" rx="0" />
    <path d="M15 15h2v2h-2zM19 15h2v2h-2zM15 19h2v2h-2zM19 19h2v2h-2z" />
  </S>
)

export const IconCreditLedger = (p: P) => (
  <S size={16} {...p}>
    <rect x="4" y="3" width="16" height="18" rx="0" />
    <line x1="8" y1="3" x2="8" y2="21" />
    <line x1="12" y1="8" x2="16" y2="8" />
    <line x1="12" y1="12" x2="16" y2="12" />
    <line x1="12" y1="16" x2="16" y2="16" />
  </S>
)

export const IconPrinter = (p: P) => (
  <S size={16} {...p}>
    <polyline points="6 9 6 2 18 2 18 9" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect x="6" y="14" width="12" height="8" rx="0" />
    <circle cx="17" cy="10" r="1" />
  </S>
)

export const IconMessageSquare = (p: P) => (
  <S size={16} {...p}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    <line x1="8" y1="10" x2="8.01" y2="10" />
    <line x1="12" y1="10" x2="12.01" y2="10" />
    <line x1="16" y1="10" x2="16.01" y2="10" />
  </S>
)

export const IconPaperless = (p: P) => (
  <S size={16} {...p}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <path d="m9 15 2 2 4-4" />
  </S>
)

export const IconSun = (p: P) => (
  <S size={15} {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </S>
)

export const IconMoon = (p: P) => (
  <S size={15} {...p}>
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  </S>
)

export const IconDensity = (p: P) => (
  <S size={15} {...p}>
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </S>
)

export const IconAlertTriangle = (p: P) => (
  <S size={15} {...p}>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </S>
)

export const IconTable = (p: P) => (
  <S size={15} {...p}>
    <rect x="3" y="4" width="18" height="16" rx="0" />
    <line x1="3" y1="10" x2="21" y2="10" />
    <line x1="12" y1="10" x2="12" y2="20" />
  </S>
)

export const IconBowl = (p: P) => (
  <S size={16} {...p}>
    <path d="M4 11h16a8 8 0 0 1-16 0z" />
    <path d="M8 19h8" />
    <path d="M7 4c1 2 1 3 0 5" />
    <path d="M12 4c1 2 1 3 0 5" />
    <path d="M17 4c1 2 1 3 0 5" />
  </S>
)

export const IconRestaurant = (p: P) => (
  <S size={16} {...p}>
    <path d="M18 2v20" />
    <path d="M21 15V2a5 5 0 0 0-5 5v8h5z" />
    <path d="M6 2v20" />
    <path d="M3 2v6a3 3 0 0 0 6 0V2" />
  </S>
)


export const GoogleGlyph = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <path fill="var(--blue)" d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.17 3.57-8.81z" />
    <path fill="var(--ok-fg)" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.87-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.29v3.1A12 12 0 0 0 12 24z" />
    <path fill="var(--warn-fg)" d="M5.27 14.28A7.2 7.2 0 0 1 4.89 12c0-.79.14-1.56.38-2.28v-3.1H1.29a12 12 0 0 0 0 10.76l3.98-3.1z" />
    <path fill="var(--err-fg)" d="M12 4.76c1.76 0 3.34.6 4.58 1.8l3.44-3.44A11.98 11.98 0 0 0 12 0 12 12 0 0 0 1.29 6.62l3.98 3.1C6.22 6.87 8.87 4.76 12 4.76z" />
  </svg>
)

export const IconSparkles = (p: P) => (
  <S {...p}>
    <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
    <path d="M19 4v4" />
    <path d="M21 6h-4" />
  </S>
)

export const IconSend = (p: P) => (
  <S {...p}>
    <path d="m22 2-7 20-4-9-9-4Z" />
    <path d="M22 2 11 13" />
  </S>
)

export const IconPaperclip = (p: P) => (
  <S {...p}>
    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </S>
)

export const IconBot = (p: P) => (
  <S {...p}>
    <path d="M12 8V4H8" />
    <rect width="16" height="12" x="4" y="8" rx="0" />
    <path d="M2 14h2" />
    <path d="M20 14h2" />
    <path d="M15 13v2" />
    <path d="M9 13v2" />
  </S>
)

export const IconCopy = (p: P) => (
  <S {...p}>
    <rect width="14" height="14" x="8" y="8" rx="0" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </S>
)

export const IconThumbsUp = (p: P) => (
  <S {...p}>
    <path d="M7 10v12" />
    <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h3Z" />
  </S>
)

export const IconThumbsDown = (p: P) => (
  <S {...p}>
    <path d="M17 14V2" />
    <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3Z" />
  </S>
)

export const IconLock = (p: P) => (
  <S {...p}>
    <rect x="3" y="11" width="18" height="11" rx="0" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </S>
)

export const IconUnlock = (p: P) => (
  <S {...p}>
    <rect x="3" y="11" width="18" height="11" rx="0" />
    <path d="M7 11V7a5 5 0 0 1 9.9-1" />
  </S>
)

export const IconPin = (p: P) => (
  <S size={15} {...p}>
    <path d="m15 4.5 4.5 4.5L18 10.5l-2-2-4 4 1 5-2 2-3.5-5.5L4 17.5 3 16.5l3.5-3.5L1 9.5l2-2 5 1 4-4-2-2L11.5 1 15 4.5z" />
  </S>
)

export const IconPinFilled = (p: P) => (
  <S size={15} fill="currentColor" {...p}>
    <path d="m15 4.5 4.5 4.5L18 10.5l-2-2-4 4 1 5-2 2-3.5-5.5L4 17.5 3 16.5l3.5-3.5L1 9.5l2-2 5 1 4-4-2-2L11.5 1 15 4.5z" />
  </S>
)

export const IconFlame = (p: P) => (
  <S size={15} {...p}>
    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 3z" />
  </S>
)

export const IconSortAlpha = (p: P) => (
  <S size={15} {...p}>
    <path d="m3 9 2.5-6L8 9" />
    <path d="M4 7.5h3" />
    <path d="M15 4v16" />
    <path d="m11.5 16.5 3.5 3.5 3.5-3.5" />
  </S>
)

export const IconGripVertical = (p: P) => (
  <S size={14} {...p}>
    <circle cx="9" cy="5" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="9" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="9" cy="19" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="15" cy="5" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="15" cy="19" r="1.5" fill="currentColor" stroke="none" />
  </S>
)

