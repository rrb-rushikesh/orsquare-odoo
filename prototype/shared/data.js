/* Sample data shared by every prototype. Fake numbers, no network, no build step. */
const inr = (n, d = 0) => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });

const SHOP = { name: 'Krishna Wines', address: 'Shop 4, Station Road, Pune 411001', gstin: '27ABCDE1234F1Z5', phone: '98765 43210' };

const BILLS = [
  {
    id: 'sale-part', label: 'Sale · part paid', kind: 'sale', no: 'S-1042', date: '07 Oct 2026', time: '21:14',
    party: 'Ramesh Patil', phone: '98220 11456', staff: 'Cashier', taxLabel: 'VAT 0%', tax: 0, discount: 50,
    items: [
      { name: 'Royal Stag 750ml', unit: '750 ml', qty: 2, rate: 1650 },
      { name: 'Imperial Blue 375ml', unit: '375 ml', qty: 3, rate: 520 },
      { name: 'Soda 600ml', unit: 'Piece', qty: 6, rate: 25 },
      { name: 'Mineral Water 1L', unit: 'Piece', qty: 2, rate: 20 },
    ],
    payments: [{ method: 'Cash', amount: 3000, at: '21:14' }],
  },
  {
    id: 'sale-paid', label: 'Sale · settled', kind: 'sale', no: 'S-1043', date: '07 Oct 2026', time: '21:40',
    party: 'Walk-in customer', phone: '', staff: 'Cashier', taxLabel: 'GST 5%', tax: 36, discount: 0,
    items: [{ name: 'RC 180ML', unit: '180 ml', qty: 4, rate: 180 }],
    payments: [{ method: 'UPI', amount: 756, at: '21:40' }],
  },
  {
    id: 'purchase-due', label: 'Purchase · payable', kind: 'purchase', no: 'P-0218', date: '05 Oct 2026', time: '11:02',
    party: 'Sai Distributors', phone: '98900 22110', staff: 'Owner', taxLabel: 'VAT 0%', tax: 0, discount: 0, supplierInvoice: 'INV/2210',
    items: [
      { name: 'Royal Stag 750ml', unit: '750 ml', qty: 24, rate: 1380 },
      { name: 'Old Monk 750ml', unit: '750 ml', qty: 12, rate: 780 },
    ],
    payments: [{ method: 'Cash', amount: 20000, at: '11:20' }],
  },
];

/** The only maths in the prototypes: totals for display. The real app takes these from Odoo. */
function calc(b) {
  const subtotal = b.items.reduce((s, i) => s + i.qty * i.rate, 0);
  const total = subtotal - b.discount + b.tax;
  const paid = b.payments.reduce((s, p) => s + p.amount, 0);
  const due = Math.max(total - paid, 0);
  const state = due === 0 ? 'settled' : paid > 0 ? 'part' : 'open';
  return { subtotal, total, paid, due, state };
}
/** Retail words, never Debit/Credit. */
function dueWord(b) { return b.kind === 'sale' ? 'Receivable' : 'Payable'; }
function dueClass(b) { return b.kind === 'sale' ? 'rec' : 'pay'; }

/** Draws the bill picker bar and re-renders when you pick another sample bill. */
function mountBills(render) {
  const bar = document.querySelector('[data-switch]');
  const out = document.getElementById('bill');
  const show = (id) => {
    const b = BILLS.find((x) => x.id === id);
    out.innerHTML = render(b, calc(b));
    bar.querySelectorAll('button').forEach((el) => el.classList.toggle('on', el.dataset.id === id));
  };
  bar.innerHTML = BILLS.map((b) => `<button data-id="${b.id}">${b.label}</button>`).join('');
  bar.addEventListener('click', (e) => { if (e.target.dataset.id) show(e.target.dataset.id); });
  show(BILLS[0].id);
}

const PARTIES = [
  { id: 'c1', type: 'Customer', name: 'Ramesh Patil', phone: '98220 11456', balance: 3500, bills: [{ no: 'S-1031', date: '29 Sep', due: 1500 }, { no: 'S-1042', date: '07 Oct', due: 2000 }] },
  { id: 'c2', type: 'Customer', name: 'Hotel Sagar', phone: '98230 44001', balance: 12800, bills: [{ no: 'S-1019', date: '21 Sep', due: 8300 }, { no: 'S-1027', date: '26 Sep', due: 4500 }] },
  { id: 'c3', type: 'Customer', name: 'Anil Kumar', phone: '98500 77123', balance: -500, bills: [] },
  { id: 's1', type: 'Supplier', name: 'Sai Distributors', phone: '98900 22110', balance: 28480, bills: [{ no: 'P-0201', date: '28 Sep', due: 6000 }, { no: 'P-0218', date: '05 Oct', due: 22480 }] },
  { id: 's2', type: 'Supplier', name: 'Maharashtra Beverages', phone: '98811 90090', balance: 15000, bills: [{ no: 'P-0210', date: '02 Oct', due: 15000 }] },
];
/** balance > 0: customer owes the shop (receivable) / the shop owes supplier (payable). balance < 0: advance. */
const isReceive = (p) => p.type === 'Customer';
