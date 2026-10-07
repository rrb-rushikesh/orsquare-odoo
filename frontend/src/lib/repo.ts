/** Original screen contracts over Odoo. No legacy HTTP endpoints or ledgers. */
import { call, ApiError } from './api';
import { getSnapshot, refreshNow, bootstrapNow, submitSale, submitQueued } from './sync';
import type { WireProduct, WireStock } from './api';
import type { PProduct, PAccount, PSale, PPurchase, PVoucher, PIncExp, TrialBalanceResponse, ProfitLossResponse, BalanceSheetResponse, AccountLedgerResponse } from './contracts';
import { salePayload } from './quote';
export * from './contracts';
export * from './unavailable';
export const num = (v: unknown): number => Number(v ?? 0);
export const decNum = (v: unknown): number | null => v == null ? null : Number(v);
const sid = (v: unknown) => String(v ?? '');
const unavailable = (label: string): never => { throw new ApiError(`${label} is not available yet.`, 'not_available', 422); };

export function productRow(p: WireProduct, s?: WireStock): PProduct {
  return { id: sid(p.product_id), stockValue: s?.value, code: p.short_code, barcode: p.barcode, name: p.name,
    brand: p.brand, parentId: sid(p.brand_id), parentName: p.brand, category: p.category,
    categoryId: sid(p.category_id), unit: p.uom, unitId: sid(p.uom_id), mrp: p.mrp ?? p.price,
    rate: p.price, costPrice: p.cost, piecesPerBox: 1, godownPcs: s?.godown ?? 0,
    counterPcs: s?.counter ?? 0, lowLevel: p.low_stock_qty, active: p.active, isKitchen: p.kind === 'kitchen' };
}
export function accountRow(p: any): PAccount {
  const value = p.balance;
  const hidden = value == null;
  return { id: sid(p.id), code: p.code || '', name: p.name, type: p.kind?.replace(/^./, (c: string) => c.toUpperCase()) || 'Customer',
    phone: p.mobile || '', countryCode: '+91', opening: 0, balance: value, balanceHidden: hidden,
    side: p.side ?? null, role: p.kind,
    isReceivable: !!p.is_receivable, isPayable: !!p.is_payable,
    isAdvance: !!p.is_advance, isSettled: !!p.is_settled, active: true };
}
export async function listProducts(_shop: string, opts?: { search?: string; is_kitchen?: boolean }): Promise<PProduct[]> {
  const s = getSnapshot(); return s.products.filter(p => (!opts?.search || `${p.name} ${p.barcode} ${p.short_code}`.toLowerCase().includes(opts.search.toLowerCase())) && (opts?.is_kitchen !== false || p.kind !== 'kitchen')).map(p => productRow(p, s.stock.find(r => r.product_id === p.product_id)));
}
export async function listAccounts(_shop: string, opts?: any): Promise<PAccount[]> {
  const result = await call<any>('accounts', 'directory', { limit: 2000, kind: opts?.type?.toLowerCase() || 'all', search: opts?.search });
  return result.rows.map(accountRow);
}
const productValues = (v: any) => ({ name: v.name, barcode: v.barcode, short_code: v.short_code || v.code,
  list_price: Number(v.rate ?? v.mrp), mrp: Number(v.mrp), cost: v.cost_price == null ? undefined : Number(v.cost_price),
  categ_id: Number(v.category), uom_id: Number(v.unit), brand_id: Number(v.parent) || undefined,
  portions: v.portions, low_stock_qty: Number(v.low_level || 0), kind: v.is_kitchen ? 'kitchen' : 'retail' });
export async function createProduct(shop: string, input: any): Promise<PProduct> {
  if (Number(input.opening_godown_pcs) || Number(input.opening_counter_pcs)) unavailable('Opening stock in this form');
  const id = await call<number>('catalog', 'save_product', { values: productValues(input) }); await bootstrapNow();
  const rows = await listProducts(shop); const product = getSnapshot().products.find(p => p.id === id);
  const row = rows.find(p => p.id === sid(product?.product_id));
  if (!row) throw new ApiError('Product saved; refresh the catalog.', 'refresh'); return row;
}
export async function updateProduct(shop: string, id: string, input: any): Promise<PProduct> {
  const p = getSnapshot().products.find(p => sid(p.product_id) === id); if (!p) throw new ApiError('Product not found.');
  await call('catalog', 'save_product', { product_tmpl_id: p.id, values: productValues(input) }); await bootstrapNow();
  return (await listProducts(shop)).find(p => p.id === id)!;
}
export async function createAccount(shop: string, input: any): Promise<PAccount> {
  if (input.opening_date && input.opening_date !== getSnapshot().me?.company.business_date) unavailable('Backdated opening balance');
  if (input.opening_balance && ((input.type === 'Supplier' && input.opening_balance_type === 'Debit') || (input.type !== 'Supplier' && input.opening_balance_type === 'Credit'))) unavailable('This opening balance direction');
  const id = await call<number>('accounts', 'create_party', { name: input.name, kind: input.type?.toLowerCase(), mobile: input.phone, opening_balance: Number(input.opening_balance || 0) });
  return (await listAccounts(shop)).find(p => p.id === sid(id))!;
}
export async function listCategories(_shop: string): Promise<any[]> { return getSnapshot().categories.map(c => ({ ...c, id: sid(c.id) })); }
export async function listUnits(_shop: string): Promise<any[]> {
  const u = getSnapshot().units; return [...(u?.base_units || []), ...(u?.shop_units || [])].map((r: any) => ({ ...r, id: sid(r.id) }));
}
export async function listParents(_shop: string): Promise<any[]> { return getSnapshot().brands.map(b => ({ ...b, id: sid(b.id), fullName: b.name })); }
export async function createCategory(_shop: string, name: string) { const id = await call<number>('catalog', 'create_category', { name }); await bootstrapNow(); return { id: sid(id), name, isDefault: false, originPreset: '' }; }
export async function createParent(_shop: string, name: string) { const id = await call<number>('catalog', 'create_brand', { name }); await bootstrapNow(); return { id: sid(id), name, fullName: name }; }

export function purchaseRow(b: any): PPurchase {
  return { id: sid(b.id), billNo: b.number, date: b.date, supplierId: sid(b.supplier_id), supplierName: b.supplier,
    amount: b.total, paidAmount: b.amount_paid, status: b.payment_state === 'paid' ? 'Paid' : b.payment_state === 'partial' ? 'Partial' : 'Unpaid',
    totalQty: b.qty ?? 0, itemCount: b.lines?.length ?? b.line_count ?? 0, createdAt: b.date,
    items: b.lines?.map((l: any) => ({ id: sid(l.id), productId: sid(l.product_id), productName: l.name, qty: l.qty, rate: l.rate, total: l.total })) };
}
export async function listPurchases(_shop: string, opts?: any): Promise<PPurchase[]> {
  const r = await call<any>('purchases', 'list_bills', { search: opts?.search, date_from: opts?.from, date_to: opts?.to, limit: opts?.limit || 200 });
  return r.map(purchaseRow);
}
export async function getPurchase(_shop: string, id: string): Promise<PPurchase> { return purchaseRow(await call('purchases', 'bill_detail', { bill_id: Number(id) })); }
export async function createPurchase(shop: string, v: any): Promise<PPurchase> {
  if (v.notes?.trim()) unavailable('Purchase notes');
  const payload = { client_ref: v.idempotency_key || crypto.randomUUID(), supplier_id: Number(v.supplier_id), bill_date: v.date, supplier_invoice_no: v.bill_no,
    lines: v.lines.map((l: any) => ({ product_id: Number(l.product_id), qty: l.qty, rate: l.rate, uom_id: getSnapshot().products.find(p => p.product_id === Number(l.product_id))?.uom_id })),
    payment: v.paid_amount ? { amount: v.paid_amount, method: v.mode?.toLowerCase() || 'cash' } : undefined };
  const r = await call<any>('purchases', 'record_bill', { payload }); await refreshNow(); return getPurchase(shop, sid(r.bill_id));
}
export function saleRow(b: any): PSale {
  return { id: sid(b.order_id), billNo: b.number || b.name, date: b.date, businessDate: b.business_date, customerName: b.customer || '', customerId: sid(b.partner_id),
    tableLabel: b.table || '', subtotal: b.subtotal ?? b.total, discount: b.discount || 0, gstAmount: b.tax || 0, tip: 0,
    total: b.total, method: b.method || '', isVoid: false, createdAt: b.date,
    items: b.lines?.map((l: any) => ({ id: sid(l.line_id), productId: sid(l.product_id), productName: l.name, unit: l.uom || '', qty: l.qty, rate: l.price_unit, discount: l.discount, total: l.total })),
    payments: b.payments?.map((p: any) => ({ method: p.method === 'upi' ? 'UPI' : p.method === 'khata' ? 'Khata' : 'Cash', amount: p.amount })) };
}
export async function listSales(_shop: string, opts?: any): Promise<PSale[]> {
  const r = await call<any[]>('day', 'bill_lookup', { search: opts?.search, date_from: opts?.from, date_to: opts?.to, limit: opts?.limit || 500 }); return r.map(saleRow);
}
export async function getSale(_shop: string, id: string): Promise<PSale> { return saleRow(await call('day', 'bill_detail', { order_id: Number(id) })); }
export async function createSale(_shop: string, v: any) {
  const payload = { ...salePayload(v), client_ref: v.idempotency_key,
    estimated_total: v.estimated_total, payments: v.payments.map((p: any) => ({ method: p.method.toLowerCase(), amount: Number(p.amount) })) };
  const r = await submitSale(payload); return { billNo: r.result?.name || `OFF-${payload.client_ref.slice(0, 8)}`, offline: r.queued, result: r.result };
}
export async function transferStock(_shop: string, v: any) { return submitQueued('stock_transfer', { direction: v.from_loc === 'godown' ? 'godown_to_counter' : 'counter_to_godown', quantities: { [Number(v.product_id)]: Number(v.qty) } }); }
export async function salesSummary(_shop: string, _date?: string) { const r = await call<any>('reports', 'dashboard'); return { ...r.retailer_summary, stockValue: r.stock_value }; }
export async function listPurchaseEdits(_shop: string): Promise<any[]> { return unavailable('Purchase edit history'); }
export async function listServerTabs(_shop: string): Promise<any[]> { const r = await call<any[]>('tabs', 'table_status'); return r; }
export async function listDiscountSchemes(_shop: string): Promise<any[]> { const rows = await call<any[]>('promos', 'list_promos'); return rows.filter(r=>r.active).map(r=>({...r,id:sid(r.id),label:r.name || r.code,kind:r.kind === 'percent'?'percentage':'flat'})); }
export async function listIncExp(_shop: string, opts?: any): Promise<PIncExp[]> {
  const r = await call<any>('cashflow', 'register', { date_from: opts?.from, date_to: opts?.to });
  return r.rows.filter((v: any) => ['income','expense'].includes(v.entry_kind)).map((v: any) => ({ id: sid(v.id), voucherNo: v.voucher, date: v.date, head: v.description, type: v.in > 0 ? 'Income' : 'Expense', amount: v.in || v.out, narration: v.description }));
}
export async function listVouchers(_shop: string, _kind: string, _opts?: any): Promise<PVoucher[]> { const r = await cashRegister(_opts); return r.rows.filter((v: any) => v.entry_kind === 'payment' && (_kind === 'payments' ? v.out > 0 : v.in > 0)).map((v: any) => ({ id: sid(v.payment_id), voucherNo: v.voucher, date: v.date, party: v.partner, mode: v.mode === 'cash' ? 'Cash' : 'UPI', ref: v.description, amount: _kind === 'payments' ? v.out : v.in, status: 'Cleared', createdAt: v.at })); }
export async function listTransfers(_shop: string, _opts?: any): Promise<any[]> { return unavailable('Transfer register'); }
export async function cashRegister(opts?: any): Promise<any> { return call('cashflow', 'register', { date_from: opts?.from, date_to: opts?.to }); }
export async function createVoucher(_shop: string, v: any) { if(v.date && v.date !== getSnapshot().me?.company.business_date) unavailable('Backdated cash entry'); const id = await call<number>('cashflow', 'new_entry', { kind: v.type.toLowerCase(), amount: v.amount, mode: v.mode?.toLowerCase() || 'cash', description: v.narration || v.head }); await refreshNow(); return {id:sid(id),voucherNo:sid(id)}; }
export async function recordPayment(_shop: string, v: any) { if(v.purchase_id) unavailable('Payment linked to a particular bill'); const id = await call('accounts', 'pay_supplier', { partner_id: Number(v.supplier_id), amount: v.amount, method: v.mode?.toLowerCase(), note: v.ref }); return { id: sid(id), voucherNo: sid(id) }; }
export async function recordReceipt(_shop: string, v: any) { if(v.sale_id) unavailable('Receipt linked to a particular bill'); const id = await call('accounts', 'receive_payment', { partner_id: Number(v.customer_id), amount: v.amount, method: v.mode?.toLowerCase(), note: v.ref }); return { id: sid(id), voucherNo: sid(id) }; }
export async function fetchUserPrefs() { return unavailable('Account preference sync'); }
export async function patchUserPrefs(_data: any) { return unavailable('Account preference sync'); }

export async function getTrialBalance(_shop: string, opts?: { as_of?: string }): Promise<TrialBalanceResponse> {
 const r = await call<any>('reports','trial_balance',{date_to:opts?.as_of});
 return { as_of_date: opts?.as_of || '', rows: r.rows.map((x: any)=>({account_id:x.code,name:x.name,code:x.code,type:'',debit:String(x.debit),credit:String(x.credit)})), total_debit:String(r.total_debit),total_credit:String(r.total_credit),is_balanced:r.balanced };
}
export async function getProfitLoss(_shop: string, opts?: {from?:string;to?:string}): Promise<ProfitLossResponse> {
 const r = await call<any>('reports','profit_and_loss',{date_from:opts?.from,date_to:opts?.to});
 return {income:r.revenue,total_income:String(r.total_revenue),expenses:[...(r.cogs||[]),...r.expenses],total_expenses:String(r.total_operating_cost ?? r.total_expenses),net_profit:r.net_profit == null ? 'unavailable' : String(r.net_profit)};
}
export async function getBalanceSheet(_shop: string, opts?: {as_of?:string}): Promise<BalanceSheetResponse> {
 const r = await call<any>('reports','balance_sheet',{as_of:opts?.as_of}); return {...r,is_balanced:r.balanced};
}
export async function getAccountLedger(shop: string,id:string,opts?: {from?:string;to?:string}): Promise<AccountLedgerResponse> {
 const [r,accounts] = await Promise.all([call<any>('accounts','statement',{partner_id:Number(id),date_from:opts?.from,date_to:opts?.to}),listAccounts(shop)]);
 const p = accounts.find(a=>a.id===id); if(!p) throw new ApiError('Account not found.');
 return {account:{id,name:p.name,code:p.code,type:p.type,phone:p.phone,country_code:p.countryCode,opening:String(r.opening),balance:String(r.closing),status_label:'',is_active:p.active},initial_balance:String(r.opening),opening_side:r.opening_side,total_debit:String(r.total_debit),total_credit:String(r.total_credit),closing_balance:String(r.closing),ledger_balance:String(r.closing),side:r.side,role:r.side==='Dr'?'Receivable':r.side==='Cr'?'Payable':'Settled',is_receivable:r.side==='Dr',is_payable:r.side==='Cr',entries:r.rows.map((x:any)=>({id:sid(x.id),date:x.date,voucher_no:x.voucher,voucher_type:'Journal',against_account:'',remarks:x.description,debit:String(x.debit),credit:String(x.credit),running_balance:String(x.balance),side:x.side,role:x.side==='Dr'?'Receivable':x.side==='Cr'?'Payable':'Settled',is_opening:false}))};
}

export async function purchasesSummary(_shop: string,opts?:{from?:string;to?:string}): Promise<any> { return call('purchases','summary',{date_from:opts?.from,date_to:opts?.to}); }
export async function liveSalesTotal(_shop:string,_date?:string): Promise<{gross_sales:number;net_sales:number}> { const r=await call<any>('reports','dashboard'); return {gross_sales:r.today.gross_sales,net_sales:r.today.total_sales}; }
export async function createDiscountScheme(shop: string,data:{code:string;label?:string;kind:'percentage'|'flat';value:number}) {
 const id=await call<number>('promos','create_promo',{code:data.code,name:data.label,kind:data.kind === 'percentage' ? 'percent':'amount',value:data.value});
 return (await listDiscountSchemes(shop)).find(p=>p.id===sid(id))!;
}

export async function stockValue(): Promise<any> { return call('stock','stock_value_by_location'); }
