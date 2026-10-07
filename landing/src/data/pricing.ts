/**
 * The plans, what every plan includes, and how access is arranged.
 *
 * Prices and plan names are the owner's (2026-10-04). Every plan includes every
 * module (no module is held back behind a plan). The 7-day trial is a UI flow only
 * for now: no payment is taken and nothing is activated automatically; the request
 * reaches OR² over WhatsApp and the workspace is set up by hand. Billing, trial
 * logic and activation come later with the payment gateway (see landing/STATUS.md).
 */

export interface Plan {
  id: 'basic' | 'pro' | 'custom'
  name: string
  /** Monthly price in rupees, or null when the price is agreed per business. */
  pricePerMonth: number | null
  blurb: string
  /** True when the plan offers the 7-day free trial. */
  trial: boolean
}

export const TRIAL_DAYS = 7

export const PLANS: Plan[] = [
  {
    id: 'basic',
    name: 'Basic',
    pricePerMonth: 999,
    blurb: 'Every module for one shop, to run billing, stock and accounts in one place.',
    trial: true,
  },
  {
    id: 'pro',
    name: 'Pro',
    pricePerMonth: 1999,
    blurb: 'Every module for a busier shop or restaurant with a larger team.',
    trial: true,
  },
  {
    id: 'custom',
    name: 'Custom',
    pricePerMonth: null,
    blurb: 'For several branches, distributors, or a setup that needs to be planned with us.',
    trial: false,
  },
]

/** "₹1,999" in Indian grouping. */
export function rupees(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`
}

export interface PlanGroup {
  label: string
  items: string[]
}

export const PLAN_GROUPS: PlanGroup[] = [
  {
    label: 'Sales & billing',
    items: [
      'Scan/barcode billing with khata credit for regulars',
      'Table service floor plan for restaurants and cafés',
      'Counter built to keep billing without a connection',
      'Sales history with returns recorded against the original bill',
    ],
  },
  {
    label: 'Inventory',
    items: [
      'Products & catalog with barcodes, MRP, pieces-per-box and categories',
      'Two-location stock: godown and counter, tracked separately',
      'Stock transfers with after-move preview and full transfer history',
      'Low-stock alerts and complete movement history',
    ],
  },
  {
    label: 'Purchasing',
    items: [
      'Supplier bills posted straight to godown stock and the supplier ledger',
      'Supplier outstanding, part-payments and settlements per supplier',
      'Purchase returns and exchanges',
    ],
  },
  {
    label: 'Money',
    items: [
      'Customer accounts with khata ledgers and one-entry settlement',
      'Cash flow register with vouchers, pending vouchers and a running balance',
      'Day book to open and close the counter day with a clear record',
    ],
  },
  {
    label: 'Insights',
    items: [
      'Reports calendar: open any day for its collection, payment split and cash count',
      'Ledger statements, trial balance, profit and loss, balance sheet, receivables and payables',
      'CSV/Excel exports of products, ledgers, sales and registers',
    ],
  },
  {
    label: 'Platform & security',
    items: [
      'Isolated workspace per business: your own short URL, nothing shared',
      'Role-based access for your team',
      'Encrypted in transit',
      'CSV backup exports. Your data leaves with you.',
      'Works in any modern browser, nothing to install',
    ],
  },
]

/** How a business gets access, from the app's pricing page. */
export const ACCESS_STEPS: PlanGroup['items'] = [
  'Your administrator provisions the workspace, and onboarding is arranged with OR² through your business administrator.',
  'Your administrator invites each user. You sign in with your own credentials.',
  'Every module is enabled from day one, on every plan. No add-ons to switch on.',
]

/** The short questions answered on the pricing page; the full FAQ has its own page. */
export const PRICING_FAQ: { q: string; a: string }[] = [
  {
    q: 'Is there a free trial?',
    a: 'Yes. Basic and Pro start with a 7-day free trial. Request it from this page; we set up your workspace and no payment is taken during the trial.',
  },
  {
    q: 'Do we pay per module?',
    a: 'No. Every plan includes every module listed above. As modules are added to the platform, they join every plan.',
  },
  {
    q: 'Who can join?',
    a: 'Registered businesses. Workspaces are provisioned by an administrator, so access is by arrangement rather than open sign-up.',
  },
]
