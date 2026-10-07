/**
 * Every public question and its direct answer, in one file.
 *
 * Rules for this file (see .agents/rules/landing-quality.md):
 *   - questions are the ones a shop owner, a manager or an accountant actually types
 *     or asks an assistant ("How do I reconcile cash at the end of the day?"), not
 *     brand-flavoured prompts;
 *   - every answer starts with the direct answer in one or two sentences, then adds
 *     only detail that is true of the product. Where the product pages do not state
 *     something, the answer says so instead of promising it;
 *   - no named customers, certifications, uptime numbers or prices, and the
 *     underlying software vendors are never named on the public site;
 *   - claims come from docs/tabs/* and docs/PRODUCT_RULES.md. Offline use, printers
 *     and GST are worded exactly as far as those documents go.
 *
 * The FAQ page renders this list statically (readable with JavaScript off) and
 * layers client-side search over it. The same list feeds the FAQPage JSON-LD and
 * llms.txt, so the visible answer and the machine-readable answer cannot differ.
 */

export type FaqCategory =
  | 'About the product'
  | 'Billing and the counter'
  | 'Stock: godown and counter'
  | 'Purchases and suppliers'
  | 'Khata, cash and the day book'
  | 'Reports and exports'
  | 'Data, privacy and security'
  | 'Team and access'
  | 'Getting access, pricing and support'
  | 'Devices and offline use'

export interface FaqEntry {
  /** Stable anchor id, so a question can be linked to directly. */
  id: string
  category: FaqCategory
  q: string
  a: string
  /** An optional internal page that goes deeper, shown under the answer. */
  see?: { href: string; label: string }
}

export const FAQ_CATEGORIES: FaqCategory[] = [
  'About the product',
  'Billing and the counter',
  'Stock: godown and counter',
  'Purchases and suppliers',
  'Khata, cash and the day book',
  'Reports and exports',
  'Data, privacy and security',
  'Team and access',
  'Getting access, pricing and support',
  'Devices and offline use',
]

export const FAQ: FaqEntry[] = [
  // ---- About the product ------------------------------------------------
  {
    id: 'what-is-or2',
    category: 'About the product',
    q: 'What is OR², and what does it do?',
    a: 'OR² (ORSQUARE) is a web-based business-operations platform. It brings counter billing, stock in two locations (godown and counter), purchases and supplier dues, customer khata, a cash register, a day book and reports into one workspace, so a business works from one set of records instead of separate registers and notebooks.',
    see: { href: '/modules', label: 'See every module' },
  },
  {
    id: 'who-is-it-for',
    category: 'About the product',
    q: 'Which businesses is OR² built for?',
    a: 'OR² is built for businesses that buy, hold and sell goods: retail shops, suppliers, distributors, and restaurants or cafés. Each business gets its own isolated workspace. Shops use barcode billing and two-location stock; restaurants use the table floor plan.',
  },
  {
    id: 'how-is-it-different',
    category: 'About the product',
    q: 'How is OR² different from a basic billing app?',
    a: 'A billing app records sales. In OR², a sale also reduces counter stock, a supplier bill adds godown stock and updates what you owe, and each day is closed with a count of stock and cash. Stock, money and reports come from the same entries, so they agree with each other.',
  },
  {
    id: 'what-is-not-included',
    category: 'About the product',
    q: 'Does OR² include payroll, manufacturing or an online store?',
    a: 'No. OR² covers the everyday work of a trading business: sales, stock, purchases, accounts, cash and reports. The modules page lists everything that is included, and a function that is not listed there, such as payroll, manufacturing or an online store, is not part of the product.',
    see: { href: '/modules', label: 'Read the module list' },
  },

  // ---- Billing and the counter -----------------------------------------
  {
    id: 'how-fast-is-billing',
    category: 'Billing and the counter',
    q: 'How do I bill a customer quickly at the counter?',
    a: 'Scan the barcode, or type part of the name or code, and the item is added to the bill. Change the quantity, apply any permitted discount, then settle the bill in cash, UPI or khata credit. A barcode scanner is the fastest way to bill, but it is not required.',
  },
  {
    id: 'does-it-do-gst',
    category: 'Billing and the counter',
    q: 'Does OR² handle GST on bills?',
    a: 'OR² can apply GST on a bill, keeps a supplier’s GSTIN on the supplier record, and reports the GST collected for a day. The product pages do not describe GST return filing or e-invoicing, so confirm what your compliance needs are with your administrator before you rely on it for either.',
  },
  {
    id: 'can-regular-customers-buy-on-credit',
    category: 'Billing and the counter',
    q: 'How do I sell on credit (khata) and track what a customer owes?',
    a: 'Put a customer on the bill and settle it as khata credit. The credit is recorded on that customer’s ledger, their balance stays visible, and a later payment reduces it with one entry. A khata sale needs a customer on the bill.',
    see: { href: '/modules#money', label: 'Accounts and khata ledgers' },
  },
  {
    id: 'can-i-give-a-discount',
    category: 'Billing and the counter',
    q: 'Can I give a discount on a bill?',
    a: 'Yes, where your settings allow it. Discounts and coupons are applied by the person billing, and nothing is discounted automatically: even the optional suggestion to round a small remainder down has to be accepted at the counter.',
  },
  {
    id: 'can-i-return-an-item',
    category: 'Billing and the counter',
    q: 'How do I handle a customer return or exchange?',
    a: 'Find the original bill in sales history, choose what is coming back, where it goes in stock and how the customer is refunded, and add any replacement items. The return is recorded against the original sale rather than edited into it, so the history of that bill stays intact.',
  },
  {
    id: 'can-i-reprint-a-bill',
    category: 'Billing and the counter',
    q: 'Can I find and reprint an old bill?',
    a: 'Yes. Every bill stays retrievable, and sales history is searchable, so you can find a bill from last week and print it again.',
  },
  {
    id: 'can-i-print-on-a-receipt-printer',
    category: 'Billing and the counter',
    q: 'Can I print bills on a thermal receipt printer?',
    a: 'OR² prints bills and receipts from the browser, with the bill header, paper size and layout set in Settings, including common receipt-paper widths. Printers differ, so print a test sheet from Settings on your own printer during onboarding before you rely on it at the counter.',
  },
  {
    id: 'what-if-a-tender-is-short',
    category: 'Billing and the counter',
    q: 'What happens if a customer pays less than the bill total?',
    a: 'A payment below the amount payable is refused unless the credit is recorded explicitly. A short payment never quietly becomes a debt on your books.',
  },
  {
    id: 'can-a-cashier-void-an-old-bill',
    category: 'Billing and the counter',
    q: 'Can a cashier change or void a bill from an earlier day?',
    a: 'Not by rewriting it. Reversible actions are limited to the time windows they are meant for, and a closed business day is sealed against further edits. Corrections go through the proper flow, such as a return, so posted history stays as it was.',
  },
  {
    id: 'can-i-serve-tables',
    category: 'Billing and the counter',
    q: 'Does OR² have a table service or restaurant floor plan?',
    a: 'Yes. A live floor plan shows your tables for restaurants and cafés. Open a table, run its tab and settle the bill; each table shows its running amount.',
  },

  // ---- Stock: godown and counter ---------------------------------------
  {
    id: 'how-many-stock-locations',
    category: 'Stock: godown and counter',
    q: 'How do I track stock in a godown and a shop counter separately?',
    a: 'OR² keeps two on-hand locations, the godown and the counter, each with its own quantity. Purchases normally enter the godown and counter sales reduce the counter, so each location shows what is physically there, and stock value is reported by location.',
    see: { href: '/modules#stock', label: 'Stock modules' },
  },
  {
    id: 'how-do-i-move-stock',
    category: 'Stock: godown and counter',
    q: 'How do I move stock from the godown to the counter?',
    a: 'Record a transfer. You see the quantities after the move before you confirm it, and the total number of pieces stays the same because a transfer only changes the location. Every transfer is kept in a history you can look back on.',
  },
  {
    id: 'do-i-get-low-stock-alerts',
    category: 'Stock: godown and counter',
    q: 'How do I get low-stock alerts?',
    a: 'Set a low-stock threshold on a product. Items that fall below it are flagged before they run out, and you can filter the product list to low stock.',
  },
  {
    id: 'what-details-does-a-product-carry',
    category: 'Stock: godown and counter',
    q: 'What details can I store for each product?',
    a: 'A product carries its name, barcode, MRP, pieces-per-box, category and unit, plus a brand and flavour for variants and a low-stock threshold. You find products by name, by code or by scanning, and the catalog exports to a spreadsheet.',
  },
  {
    id: 'can-i-reconcile-a-stock-register',
    category: 'Stock: godown and counter',
    q: 'What is the stock register (Sheet), and can I print it?',
    a: 'The Sheet is a daily or range stock register that shows opening, inward, closing and sold quantities for each product, with the amount worked out and a day summary. You can print it on A4, 80 mm or 58 mm paper, or export it to a spreadsheet.',
  },
  {
    id: 'can-i-track-brand-flavour-size',
    category: 'Stock: godown and counter',
    q: 'Can I track stock by brand, flavour and pack size?',
    a: 'Yes. The Sheet and the size-wise stock register show stock by brand with a column for each pack size, and a brand with several flavours expands to show each variant. Use them where one brand is sold in several sizes.',
  },
  {
    id: 'how-do-i-count-stock',
    category: 'Stock: godown and counter',
    q: 'How do I do a physical stock count and find the difference?',
    a: 'Count stock from the day book. You enter what you counted for each location, and OR² shows the difference between the counted quantity and what the books expected, so a discrepancy surfaces the same day instead of at month end.',
  },
  {
    id: 'why-did-a-quantity-change',
    category: 'Stock: godown and counter',
    q: 'Can I see why a stock quantity changed?',
    a: 'Yes. Every sale, purchase and transfer is logged as a movement, so any change in a quantity can be traced back to the document that caused it.',
  },

  // ---- Purchases and suppliers -----------------------------------------
  {
    id: 'what-happens-when-i-enter-a-purchase',
    category: 'Purchases and suppliers',
    q: 'What happens when I record a supplier bill?',
    a: 'The bill adds stock to the godown and adds the amount to what you owe that supplier, in one step. There is no separate bookkeeping afterwards, and the supplier’s outstanding total stays current.',
  },
  {
    id: 'how-do-supplier-dues-work',
    category: 'Purchases and suppliers',
    q: 'How do I keep track of what I owe each supplier?',
    a: 'Part-payments, full settlements and outstanding totals are tracked per supplier, so you can see what you owe and to whom without keeping a separate list.',
  },
  {
    id: 'do-i-manage-suppliers',
    category: 'Purchases and suppliers',
    q: 'Can I keep supplier details and GSTIN in one place?',
    a: 'Yes. Each supplier is a record with its bill history, payments and outstanding balance, and the supplier’s GSTIN is stored on that record.',
  },
  {
    id: 'are-payments-saved-for-later',
    category: 'Purchases and suppliers',
    q: 'What if I pay a supplier later, or only part of the bill?',
    a: 'An unpaid purchase still brings the stock in and shows as a supplier payable. When you pay, enter it against the supplier as a part-payment or a settlement; the outstanding figure falls and the cash register records the money going out.',
  },
  {
    id: 'can-i-return-purchases',
    category: 'Purchases and suppliers',
    q: 'Can I return damaged or excess stock to a supplier?',
    a: 'Yes. A purchase return corrects the quantities and the supplier ledger through a proper return or exchange, rather than by editing the original bill. You can also print a debit note.',
  },

  // ---- Khata, cash and the day book ------------------------------------
  {
    id: 'what-is-a-khata',
    category: 'Khata, cash and the day book',
    q: 'What is a khata, and how does OR² use it?',
    a: 'A khata is a customer ledger: the credit you gave, the payments you received, and the balance still owed. OR² keeps one against each customer, so the balance is always visible and a payment is a single entry.',
  },
  {
    id: 'can-i-settle-a-customer-in-one-entry',
    category: 'Khata, cash and the day book',
    q: 'How do I record a payment from a customer who owes me?',
    a: 'Open the customer in Accounts and record the payment. Their balance reduces by that amount and the entry appears on their ledger. A payment received is not counted as a new sale.',
  },
  {
    id: 'how-do-i-record-cash',
    category: 'Khata, cash and the day book',
    q: 'How do I see how much cash I actually have?',
    a: 'The cash flow register combines supplier payments, income and expenses with a running balance, and keeps pending vouchers apart, so the number you see is cash you hold rather than cash you expect. Only cash sales add to the drawer; UPI sales are recorded as collections but do not add drawer cash.',
  },
  {
    id: 'can-i-enter-income-and-expenses',
    category: 'Khata, cash and the day book',
    q: 'Can I record income and expenses that are not sales?',
    a: 'Yes. Enter income and expenses as vouchers in the cash flow register, alongside supplier payments, with the amount, method, head and narration. One running balance then covers all of it.',
  },
  {
    id: 'what-is-the-day-book',
    category: 'Khata, cash and the day book',
    q: 'What is a day book, and how do I close the day?',
    a: 'The day book opens the business day with an opening cash figure and closes it once you have counted stock and physical cash and reviewed any differences. A closed day is sealed, so its record stays as it was.',
  },
  {
    id: 'what-if-the-day-does-not-match',
    category: 'Khata, cash and the day book',
    q: 'How do I reconcile cash at the end of the day?',
    a: 'Count the cash in the drawer, enter it in the day book and compare it with the expected drawer cash, which comes from the cash account’s own balance. The difference is shown beside both figures and is recorded rather than hidden.',
  },
  {
    id: 'when-does-a-business-day-end',
    category: 'Khata, cash and the day book',
    q: 'When does a business day start and end?',
    a: 'A shop’s business day follows a configured cutoff time, 2:00 am Indian Standard Time by default, so a sale at 1:30 am belongs to the previous business day. The cutoff is a setting.',
  },
  {
    id: 'what-is-a-closed-business-day',
    category: 'Khata, cash and the day book',
    q: 'What does sealing a business day do?',
    a: 'Closing a day records what was taken in and stops that day being edited afterwards. New money or stock actions cannot be written into a sealed day, so the record of that day stays as it was.',
  },

  // ---- Reports and exports ---------------------------------------------
  {
    id: 'what-reports-are-included',
    category: 'Reports and exports',
    q: 'What reports does OR² include?',
    a: 'A dashboard for the day at a glance, a reports calendar, and financial reports: ledger statements, trial balance, profit and loss, balance sheet, receivables, payables and cash flow. Stock and sales registers can be printed or exported.',
    see: { href: '/modules#insights', label: 'Reporting modules' },
  },
  {
    id: 'what-is-the-reports-calendar',
    category: 'Reports and exports',
    q: 'What is the reports calendar?',
    a: 'A month calendar for the owner. Choose a day to open its report: total collection, the cash, UPI and khata split, bill count, average bill, GST collected and the day’s cash count. Days that have been closed are marked as locked.',
  },
  {
    id: 'do-i-have-to-build-reports',
    category: 'Reports and exports',
    q: 'Do I have to build the reports myself?',
    a: 'No. They build from the work you already do: billing, purchases, payments and transfers. Voided bills are left out and returns reduce the period they belong to, so the figures agree with the registers.',
  },
  {
    id: 'are-reports-final',
    category: 'Reports and exports',
    q: 'Are the figures for a past day final?',
    a: 'A closed day is a sealed record and does not change with later activity. A day that is still open shows live figures, which can change as bills and payments are entered.',
  },
  {
    id: 'can-i-export-my-data',
    category: 'Reports and exports',
    q: 'Can I export my data to Excel or CSV?',
    a: 'Yes. Products, ledgers, sales and registers export to CSV or Excel whenever you need them, in a form your accountant can use. Your data leaves with you.',
  },

  // ---- Data, privacy and security --------------------------------------
  {
    id: 'is-my-data-shared',
    category: 'Data, privacy and security',
    q: 'Can another business see my records?',
    a: 'No. Every business gets its own isolated workspace, and your records are never visible to, or shared with, another business.',
  },
  {
    id: 'who-owns-my-records',
    category: 'Data, privacy and security',
    q: 'Who owns the data I enter into OR²?',
    a: 'Your business does. Products, bills, payments, ledgers and reports belong to your business; OR² owns the platform itself.',
  },
  {
    id: 'can-your-staff-read-my-records',
    category: 'Data, privacy and security',
    q: 'Can OR² staff browse my business records?',
    a: 'There is no routine view of your business records. Access to systems is controlled and limited to what running the service needs, under least-privilege administration.',
  },
  {
    id: 'is-my-data-encrypted',
    category: 'Data, privacy and security',
    q: 'Is my data encrypted and protected?',
    a: 'Data is encrypted in transit, access to systems is controlled, administration follows least-privilege principles, and workspaces are isolated from one another by design. The product pages do not claim any security certification.',
  },
  {
    id: 'do-you-track-me',
    category: 'Data, privacy and security',
    q: 'Does OR² use analytics or advertising trackers?',
    a: 'No. The service carries no advertising machinery and no third-party analytics, and does not profile you or your business. This public site carries no trackers either.',
  },
  {
    id: 'do-you-sell-my-data',
    category: 'Data, privacy and security',
    q: 'Do you sell or share my business data?',
    a: 'No. Business data is not sold, rented or shared. The service infrastructure is hosted by service providers who process it under obligations to protect it, and only on our instructions.',
  },
  {
    id: 'can-i-delete-my-data',
    category: 'Data, privacy and security',
    q: 'Can I correct or delete my data?',
    a: 'Yes. You can export, correct or delete your records. When data is deleted, it is removed with no history and no footprints.',
  },
  {
    id: 'what-backup-is-available',
    category: 'Data, privacy and security',
    q: 'Does OR² back up my workspace?',
    a: 'The service is operated on a best-effort basis, and no backup guarantee is published. The dependable copy of your business is the export you control: your records can be exported to CSV or Excel at any time, so they are never held only by us.',
  },

  // ---- Team and access --------------------------------------------------
  {
    id: 'can-my-team-have-different-access',
    category: 'Team and access',
    q: 'Can different staff see different things?',
    a: 'Yes. Access is role-based. A cashier works the counter, while the owner sees the balances, reports and settings. Access to a screen, to money figures and to settlement are separate permissions.',
  },
  {
    id: 'what-can-a-cashier-see',
    category: 'Team and access',
    q: 'What can a cashier see in OR²?',
    a: 'A cashier sees the counter work they need: sales, products, the quantities they sell and the day book. Cost rates, purchase values and the owner reports are not theirs to see, and the server refuses them whatever the screen shows.',
  },
  {
    id: 'how-do-i-add-a-user',
    category: 'Team and access',
    q: 'How do I add a new staff member?',
    a: 'Your administrator invites each person and assigns their role in Settings. They sign in with their own credentials, and activity under an account is treated as your business activity.',
  },
  {
    id: 'can-two-people-bill-at-once',
    category: 'Team and access',
    q: 'Can more than one person use OR² at the same time?',
    a: 'Yes. Several people in the same business can be signed in and working at once, each within their role.',
  },

  // ---- Getting access, pricing and support -----------------------------
  {
    id: 'how-do-i-sign-up',
    category: 'Getting access, pricing and support',
    q: 'How do I get an OR² workspace?',
    a: 'OR² is provided to registered businesses by arrangement, not by open self-service sign-up. Your business administrator arranges onboarding and provisions the workspace, then invites each person who needs access.',
    see: { href: '/pricing', label: 'How access works' },
  },
  {
    id: 'is-there-a-free-trial',
    category: 'Getting access, pricing and support',
    q: 'Is there a free trial of OR²?',
    a: 'Yes. The Basic and Pro plans start with a 7-day free trial. Request it from the pricing page; OR² sets up your workspace, and no payment is taken during the trial.',
    see: { href: '/pricing', label: 'Plans and the free trial' },
  },
  {
    id: 'how-much-does-it-cost',
    category: 'Getting access, pricing and support',
    q: 'How much does OR² cost?',
    a: 'Basic is ₹999 a month and Pro is ₹1,999 a month, both with a 7-day free trial. The Custom plan, for several branches or distributors, is priced with you: contact us.',
    see: { href: '/pricing', label: 'Pricing and what is included' },
  },
  {
    id: 'is-everything-included',
    category: 'Getting access, pricing and support',
    q: 'Is every module included, or do modules cost extra?',
    a: 'Every module is included on every plan, with no add-ons, and modules added to the platform later join every plan.',
  },
  {
    id: 'how-long-does-onboarding-take',
    category: 'Getting access, pricing and support',
    q: 'How long does it take to set up my shop?',
    a: 'Setup has three steps: your administrator configures the workspace, your team loads products, opening stock in both locations, suppliers and customers, and then billing and reports run from those entries. No fixed setup time is promised, because it depends on how much opening data you have.',
  },
  {
    id: 'can-i-try-it-alone-first',
    category: 'Getting access, pricing and support',
    q: 'Can one person set it up before the whole team joins?',
    a: 'Yes. Your administrator decides who is invited, so one person can be set up first and the rest of the team added later on the same workspace and the same books.',
  },
  {
    id: 'how-do-i-get-support',
    category: 'Getting access, pricing and support',
    q: 'How do I get support for OR²?',
    a: 'Call or WhatsApp support on +91 8600527432 or +91 8412014240, or go through the workspace administrator who arranged your onboarding. When you ask, name the screen, what you expected and what happened.',
    see: { href: '/contact', label: 'Contact' },
  },
  {
    id: 'who-do-i-contact-about-billing',
    category: 'Getting access, pricing and support',
    q: 'Who do I contact about a charge or a service agreement?',
    a: 'Call or WhatsApp OR² on +91 8600527432 or +91 8412014240. Billing questions are handled directly with OR².',
  },
  {
    id: 'is-there-documentation',
    category: 'Getting access, pricing and support',
    q: 'Is there documentation or training for OR²?',
    a: 'This site lists every module and answers common questions. Your administrator can walk your team through the workspace during onboarding, and you can write to us with a specific question.',
    see: { href: '/modules', label: 'All modules' },
  },
  {
    id: 'how-do-i-raise-a-privacy-question',
    category: 'Getting access, pricing and support',
    q: 'How do I raise a question about my personal data?',
    a: 'Privacy questions are handled through your workspace administrator, who can exercise the access, correction, export and deletion rights on your behalf.',
    see: { href: '/privacy', label: 'Privacy policy (draft)' },
  },

  // ---- Devices and offline use -----------------------------------------
  {
    id: 'what-do-i-need-to-install',
    category: 'Devices and offline use',
    q: 'Do I have to install anything to use OR²?',
    a: 'No. OR² runs in any modern browser on the devices your team already uses, and there is nothing to install on the counter.',
  },
  {
    id: 'does-it-work-on-a-phone',
    category: 'Devices and offline use',
    q: 'Does OR² work on a phone or tablet?',
    a: 'Yes. The workspace is usable from a phone or a tablet as well as a computer, which makes entering opening stock and products from any device practical.',
  },
  {
    id: 'is-a-scanner-needed',
    category: 'Devices and offline use',
    q: 'Do I need a barcode scanner?',
    a: 'No. A scanner is the fastest way to bill, but you can always search by name or product code.',
  },
  {
    id: 'does-it-work-without-internet',
    category: 'Devices and offline use',
    q: 'Can I keep billing when the internet is down?',
    a: 'OR² is designed so the counter can keep billing without a connection. A bill made offline is queued and stays provisional until it is confirmed, and retrying never deducts stock or collects money twice. Test offline billing on your own device and network during onboarding rather than assuming it.',
  },
]
