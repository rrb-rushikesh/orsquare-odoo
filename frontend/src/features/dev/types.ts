export type Stage = 'active' | 'trial' | 'expiring' | 'suspended' | 'unavailable'
export type PlanKey = '7d' | '28d' | '1y'

export interface Person {
  id: string
  name: string
  login: string
  active: boolean
  role: 'owner' | 'cashier'
  mobile: { country: string; number: string } | null
}

export interface Business {
  slug: string
  code: string
  name: string
  status: 'active' | 'suspended' | 'unavailable'
  reason: 'administrative' | 'expired' | 'not_started' | null
  stage: Stage
  plan: PlanKey | null
  planLabel: string | null
  validFrom: string | null
  validUntil: string | null
  daysLeft: number | null
  timezone: string
  owner: Person | null
  cashiers: { used: number; limit: number; list: Person[] }
  users: { total: number; active: number }
  tabs: number
  createdAt: string
  /** Set only for a business whose database could not be read. */
  error?: string
}

export interface Plan {
  key: PlanKey
  label: string
  days: number
  price: number | null
}

export interface DevMe {
  user: { name: string; login: string }
}

/** Business Studio: Business -> Tabs -> Variants -> Features. */
export interface StudioFeature {
  id: string
  label: string
  description: string
  default: boolean
}
export interface StudioVariant {
  key: string
  label: string
  features: StudioFeature[]
}
export interface StudioTab {
  key: string
  label: string
  variants: StudioVariant[]
}
export interface StudioGroup {
  key: string
  label: string
  tabs: StudioTab[]
}
export interface StudioSetup {
  /** Enabled variant keys: the unit the server enforces. */
  tabs: string[]
  /** Feature switches that differ from their default, by variant key. */
  features: Record<string, Record<string, boolean>>
}
export interface StudioData {
  groups: StudioGroup[]
  setup: StudioSetup
  templates: Record<string, string[]>
}

export interface AuditEvent {
  id: string
  at: string
  actor: string
  action: string
  target: string
  business: string
  detail: string
}

export interface Health {
  tryton: string
  database: string
  template: string
  serverTime: string
  businesses: number
  expiryJob: { registered: boolean; active: boolean }
}

export interface Secret {
  login: string
  password: string
}
