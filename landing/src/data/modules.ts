/**
 * The module catalog. Titles and bodies are taken from the app's own modules
 * page so the marketing site never describes a module the product does not have.
 * Kept as data so `/modules`, the home page and llms.txt read from one list.
 */

export interface ModuleEntry {
  title: string
  body: string
}

export interface ModuleGroup {
  heading: string
  /** Anchor id for the group, used by the home page feature grid links. */
  id: string
  modules: ModuleEntry[]
}

export const MODULE_GROUPS: ModuleGroup[] = [
  {
    heading: 'Run the counter',
    id: 'counter',
    modules: [
      {
        title: 'Dashboard',
        body: "Your day at a glance: today's sales, cash position, low stock and pending supplier dues on one screen. Open the counter and start working in seconds.",
      },
      {
        title: 'Counter sales',
        body: 'Scan a barcode or search by name to bill in a few keystrokes, with khata credit for regulars. Billing is designed to continue without a connection; offline bills stay provisional until confirmed.',
      },
      {
        title: 'Table service floor',
        body: 'A live floor plan for restaurants and cafés. Open a table, run its tab and settle the bill. Every table shows its running amount.',
      },
    ],
  },
  {
    heading: 'Control your stock',
    id: 'stock',
    modules: [
      {
        title: 'Products & catalog',
        body: 'Every product carries its barcode, MRP, pieces-per-box and category. Search by name, code or scan: three keystrokes to any item.',
      },
      {
        title: 'Two-location stock',
        body: 'Godown and counter are tracked as separate on-hand locations. Move goods forward with an after-move preview and a full transfer history.',
      },
      {
        title: 'Stock alerts and movement history',
        body: 'Low-stock alerts flag items before they run out. Every sale, purchase and transfer is logged, so any change in quantity can be traced.',
      },
      {
        title: 'Stock register (Sheet)',
        body: 'A daily or range stock register with brand, flavour and size breakdowns, a day summary, reconciliation, exports and a printable sheet.',
      },
    ],
  },
  {
    heading: 'Buy and supply',
    id: 'purchasing',
    modules: [
      {
        title: 'Purchases',
        body: 'Record a supplier bill and it lands straight in godown stock and the supplier ledger at once. No separate bookkeeping step.',
      },
      {
        title: 'Supplier payments and outstanding',
        body: 'Part-payments, full settlements and outstanding totals stay current per supplier. You always know what you owe and to whom.',
      },
      {
        title: 'Purchase returns and exchanges',
        body: 'Return damaged or excess stock to a supplier and quantities and ledgers correct themselves through the proper business flow.',
      },
    ],
  },
  {
    heading: 'Keep the money honest',
    id: 'money',
    modules: [
      {
        title: 'Accounts',
        body: 'Customers with khata ledgers: credit given, payments received, balance always visible. Settlement takes one entry.',
      },
      {
        title: 'Cash flow register',
        body: 'Supplier payments, income and expenses flow into a single register with a running balance. Pending vouchers are tracked separately, so the number you see is cash you actually have.',
      },
      {
        title: 'Day book',
        body: 'Open and close the counter day with a clear record of what was taken in. Discrepancies surface the same day, not at month end.',
      },
    ],
  },
  {
    heading: 'Understand the business',
    id: 'insights',
    modules: [
      {
        title: 'Ledger and financial reports',
        body: 'General ledger statements with an opening and running balance, plus trial balance, profit and loss, balance sheet, receivables, payables and cash flow.',
      },
      {
        title: 'Reports calendar',
        body: 'A month calendar for the owner. Open any day for its collection, the cash, UPI and khata split, bills, GST collected and the day’s cash count. Closed days are marked as locked.',
      },
      {
        title: 'Sales history and returns',
        body: 'Every bill is retrievable. Search it, reprint it and record returns against the original sale. History stays intact and corrections go through the proper flow.',
      },
      {
        title: 'CSV/Excel exports',
        body: 'Export your products, ledgers, sales and registers to CSV or Excel whenever you need them. Your data leaves with you, in a form your accountant can use.',
      },
    ],
  },
  {
    heading: 'Settings and the team',
    id: 'platform',
    modules: [
      {
        title: 'Receipts, bill and printer settings',
        body: 'Set the receipt and bill header, the paper size and the printed layout. What you configure is what the counter prints.',
      },
      {
        title: 'Team and access',
        body: 'Invite the people in your business and give each one the role they need, from cashier to owner.',
      },
      {
        title: 'Isolated workspace',
        body: 'Each business gets its own workspace and its own short URL. Records are never shared between shops.',
      },
    ],
  },
]

/** The six short features used on the home page, from the app's home page. */
export const HOME_FEATURES: ModuleEntry[] = [
  {
    title: 'Two-location stock control',
    body: 'Godown and counter tracked as separate on-hand locations. Move goods forward before they sell, with after-move previews and a full transfer history.',
  },
  {
    title: 'Purchases that feed stock',
    body: 'Supplier bills land straight in godown stock and their ledger at once. Part-payments and outstanding totals stay current without extra bookkeeping.',
  },
  {
    title: 'A catalog built to be found',
    body: 'Barcodes, MRP, pieces-per-box, categories and low-stock alerts. Scan at speed or search by name, code or barcode. Every product is three keystrokes away.',
  },
  {
    title: 'One honest cash register',
    body: 'Supplier payments, income and expenses flow into a single register with a running balance. Pending vouchers are tracked separately, so the number you see is cash you actually have.',
  },
  {
    title: 'Numbers that explain themselves',
    body: 'Daily figures, stock value by location and financial statements build themselves from your daily work, so there is no end-of-month scramble.',
  },
  {
    title: 'Your own secure workspace',
    body: 'Every business gets its own isolated workspace and its own short URL. Nothing is ever shared between shops.',
  },
]

/** The four proof points under the home page hero. */
export const HOME_PROOF: ModuleEntry[] = [
  { title: 'Built for the counter', body: 'Designed so billing can continue without a connection.' },
  { title: 'Two stock locations', body: 'Godown and counter, one clear view.' },
  { title: 'Isolated workspaces', body: 'Your records are never shared between shops.' },
  { title: 'Built-in reporting', body: 'Balances and reports update as you work.' },
]

/** The three trust cards, from the app's home page. */
export const HOME_TRUST: ModuleEntry[] = [
  {
    title: 'Isolated by design',
    body: 'Your workspace is sealed to your business. Other businesses can never see your records, and we do not browse them as a routine.',
  },
  {
    title: 'Private by default',
    body: 'No trackers, no ad networks, and no selling data. Ever.',
  },
  {
    title: 'Grows with you',
    body: 'From one counter to many. The same simple workspace, the same habits.',
  },
]

/** The three getting-started steps, from the app's home page. */
export const HOME_STEPS: ModuleEntry[] = [
  {
    title: 'Configure',
    body: 'An administrator sets up your workspace around how your business actually runs.',
  },
  {
    title: 'Load',
    body: 'Products, opening stock in both locations, suppliers and customers, entered in minutes from any device.',
  },
  {
    title: 'Operate',
    body: 'Move stock, record purchases, settle suppliers. Everything else, from balances and alerts to reports, updates itself as you work.',
  },
]
