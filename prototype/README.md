# Prototypes: bill detail and payment form (Accounts tab)

**Status: experiment only.** Nothing in `frontend/`, `addons/` or any other part of the product was changed. These are standalone HTML pages with made-up data, written to compare ideas before anything is built for real.

## How to look at them

Double-click `index.html` (no server, no install). Each page works on its own, on a desktop or a phone-sized window. The three bills at the top of each bill prototype (part-paid sale, settled sale, payable purchase) can be switched with the buttons in the dark bar.

```
prototype/
  index.html            gallery with links
  shared/base.css       colour tokens copied from frontend/src/styles/tokens.css
  shared/data.js        sample shop, three bills, five customers/suppliers
  bills/01..05-*.html   five bill-detail designs
  payments/01..05-*.html five payment-form designs
```

## The problem

* **Bill detail:** clicking a bill in Accounts' bill history shows an unformatted, hard-to-read page. We want a simple, minimal, readable bill.
* **Payment form:** Accounts records money in two directions. **Receive** (a customer pays you; they were *receivable*) and **Pay** (you pay a supplier; they were *payable*). The current form mixes the controls together.

All ten designs follow the project rules: no "Debit/Credit" words (only Receivable = green, Payable = red, Settled = grey, Advance = blue), sharp corners, hairline borders, the existing palette and no business maths in the real UI (the little sums in `data.js` exist only so the sample pages show totals; the real app must keep taking them from Odoo).

## A. Bill detail: five styles

| # | Name | Idea | Best at | Weak at |
| --- | --- | --- | --- | --- |
| 1 | Receipt slip | Narrow monospaced slip, dashed rules, stamp saying RECEIVABLE / PAID IN FULL. Looks like the printout. | Instant recognition, matches the thermal printer, and the on-screen bill can be reprinted as is. | Little room for extra info; feels small on a big monitor. |
| 2 | Formal invoice | Header with bill number, 4-box details grid, ruled item table, totals block, coloured balance bar. | Looks official, handles many items, easy to print on A4. | The most "ordinary" of the five; heavier than the others. |
| 3 | Phone cards | Single column. Big total, status chip, an item card per product, sticky Print / Receive button. | Phones and tablets, thumb reach, the action (receive the due money) is one tap away. | Long bills get tall; less dense on desktop. |
| 4 | Summary first | Dark panel with total, paid-progress bar and the due amount; timeline of payments; items folded. | Answers "is it paid?" before anything else; good for chasing Khata. | Items are one click away, so not ideal if the item list is what you want. |
| 5 | Editorial | No boxes. Large type, dotted leaders, one sentence for what is still owed. | Calm, very easy to read, most "designed". | Unusual for a retail tool; serif headline may not suit the brand. |

## B. Payment form: five styles

| # | Name | Idea | Best at | Weak at |
| --- | --- | --- | --- | --- |
| 1 | Single form | Receive / Pay switch, person, owed-line, amount with "Full" and "Half" chips, Cash/UPI, one button that repeats the amount. | Simplest to build and learn; closest to today's form. | Everything at once; not "against which bill" aware. |
| 2 | Three steps | Who, then how much (on account or a chosen bill), then confirm. | New or part-time staff; almost no way to pick the wrong direction. | More taps for a regular payment. |
| 3 | Bill allocation | Type one amount; it is spread over the oldest open bills with bars, remaining balance, and any extra is kept as advance. | Real accounting behaviour with no extra steps; shows exactly which bills get closed. | Needs the server to confirm the allocation rule (oldest-first is assumed). |
| 4 | Keypad | Big number display, touch keypad, quick-amount chips, big action button. | Touch counter, fastest for cash. | Takes more space; less suited to a keyboard. |
| 5 | Pick from list | People list grouped Receivable / Payable; the slip on the right shows "now" and "after this payment" balance. Direction is implied by who you click. | The least thinking: you click a person, not a mode. Always shows balances. | Needs width; on a phone it stacks. |

## My suggestion (not a decision)

* **Bill:** 4 (Summary first) as the on-screen view with a "Print" that produces 1 (Receipt slip). The first answers the question people actually have (what is still owed); the second is what they hand over.
* **Payment:** 5 (Pick from list) for the desktop Accounts tab, with 3's allocation preview added in the slip; 4 as a touch-counter variant. The reasoning: balances are visible before the choice, and the direction can't be wrong.

## If one is picked

1. Tell me the favourites (they can be mixed: e.g. 4's layout with 5's colour bar).
2. Next step is to map it onto the real data (`PSale`, `PPurchase`, `fetchOpenBills`, `AccountPaymentModal`) in `frontend/`, keeping the idempotency key behaviour already in the payment modal.
3. Prototype caveats to carry over: the "oldest bill first" rule in payment 3 and the "Full / Half" chips are guesses to confirm; the "Entered by" and phone fields in bill 2 depend on what the API returns.

## Not covered

Printing CSS, dark mode, accessibility audit (contrast uses the project's tokens; keyboard order was not tested), long item names, 50-line bills, and Hindi/Marathi text.
