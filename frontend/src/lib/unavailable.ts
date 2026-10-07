import { ApiError } from "./api";
import type { OfflineSalePayload } from "./db";
import type { OpenBill } from "../types";
import type { PProduct, OnboardingPlan, ShopLibraryOption, RepairSummary, OnboardingResult, PCategory, PUnit, PParent, UnitOpts, PAccount, AccountLedgerResponse, TrialBalanceResponse, ProfitLossResponse, BalanceSheetResponse, PVoucher, PageOpts, SaleSubmitResult, PSale, PSaleReturn, SaleReturnPayload, CorrectSalePayload, PPurchase, PPurchaseReturn, PurchaseReturnPayload, PServerTab, PTransfer, PStockMovement, PIncExp, ClosingState, ClosingAudit, PDayStatus, PBusinessDayInfo, PFeatureState, PFeatureCatalogEntry, ShopClosingSettings, PSnapshot, PEmployee, DistributionRecord, DistributeLineInput, StockOverview, RetailerOutstandingRow, OwnerSummary, RetailerShopCreateResult, UserPrefsPayload, SheetResponse, SheetQuery, ShopExperienceResponse, ShopExperienceData, ShopExperienceUpdatePayload, LibraryListResponse, LibraryProductPage, LibraryProductRow, LibraryProductPatch, LibraryBulkProductUpdatePayload, LibraryBulkProductUpdateResponse, LibraryParentRow, LibrarySummary, LibraryOptionsPatch, ActiveSession, ImpersonationPayload } from "./contracts";
export async function listProducts(shopId: string, opts?: { search?: string; categoryId?: string; is_kitchen?: boolean | string }): Promise<PProduct[]> { void shopId; void opts; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function createProduct(shopId: string, input: Record<string, any>): Promise<PProduct> { void shopId; void input; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function updateProduct(shopId: string, id: string, input: Record<string, any>): Promise<PProduct> { void shopId; void id; void input; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function deleteProduct(shopId: string, productId: string): Promise<void> { void shopId; void productId; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function importProducts(
  shopId: string,
  payload: { products: Record<string, any>[]; categories?: { name: string }[]; units?: { name: string; ml_volume?: number | null }[] }
): Promise<{ created: string[]; errors: { row: number; error: string }[] }> { void shopId; void payload; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function previewOnboarding(
  shopId: string,
  payload: { products: Record<string, any>[]; initialize_stock: boolean; direct_opening_stock?: boolean; supplier_id?: string | null; library_key?: string }
): Promise<OnboardingPlan> { void shopId; void payload; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function listShopLibraries(shopId: string): Promise<ShopLibraryOption[]> { void shopId; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function repairImportRows(
  shopId: string,
  libraryKey: string,
  rows: Record<string, any>[]
): Promise<{ rows: Record<string, any>[]; summary: RepairSummary }> { void shopId; void libraryKey; void rows; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function commitOnboarding(
  shopId: string,
  payload: {
    import_id: string;
    products: Record<string, any>[];
    initialize_stock: boolean;
    direct_opening_stock?: boolean;
    supplier_id?: string | null;
    source_file?: string;
  }
): Promise<{ already_completed?: boolean; result: OnboardingResult }> { void shopId; void payload; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function getOnboardingOperation(shopId: string, importId: string): Promise<{
  import_id: string;
  status: 'processing' | 'completed' | 'failed';
  source_file: string;
  bill_no: string;
  result: OnboardingResult | null;
  error: Record<string, any> | null;
}> { void shopId; void importId; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function listCategories(shopId: string): Promise<PCategory[]> { void shopId; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function listDiscountSchemes(
  shopId: string
): Promise<{ id: string; code: string; label: string; kind: 'percentage' | 'flat'; value: string | number }[]> { void shopId; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function createDiscountScheme(
  shopId: string,
  data: { code: string; label?: string; kind: 'percentage' | 'flat'; value: number }
): Promise<{ id: string; code: string; label: string; kind: 'percentage' | 'flat'; value: string | number }> { void shopId; void data; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function updateDiscountScheme(
  shopId: string,
  id: string,
  data: { label?: string; kind?: 'percentage' | 'flat'; value?: number; is_active?: boolean }
): Promise<{ id: string; code: string; label: string; kind: 'percentage' | 'flat'; value: string | number }> { void shopId; void id; void data; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function deleteDiscountScheme(shopId: string, id: string): Promise<void> { void shopId; void id; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function createCategory(shopId: string, name: string): Promise<PCategory> { void shopId; void name; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function updateCategory(shopId: string, id: string, name: string): Promise<void> { void shopId; void id; void name; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function deleteCategory(shopId: string, id: string): Promise<void> { void shopId; void id; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function listUnits(shopId: string): Promise<PUnit[]> { void shopId; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function listParents(shopId: string): Promise<PParent[]> { void shopId; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function createParent(shopId: string, name: string, fullName = ''): Promise<PParent> { void shopId; void name; void fullName; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function updateParent(shopId: string, id: string, name: string, fullName = ''): Promise<void> { void shopId; void id; void name; void fullName; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function deleteParent(shopId: string, id: string): Promise<void> { void shopId; void id; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function createUnit(shopId: string, name: string, opts?: UnitOpts): Promise<PUnit> { void shopId; void name; void opts; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function updateUnit(shopId: string, id: string, name: string, opts?: { mlVolume?: number | null }): Promise<void> { void shopId; void id; void name; void opts; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function deleteUnit(shopId: string, id: string): Promise<void> { void shopId; void id; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function seedDefaultCatalogMaster(shopId: string): Promise<{
  created_categories: string[];
  created_units: string[];
  all_categories: PCategory[];
  all_units: PUnit[];
}> { void shopId; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function listAccounts(shopId: string, opts?: { type?: string; search?: string; includeSystem?: boolean }): Promise<PAccount[]> { void shopId; void opts; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function createAccount(shopId: string, data: Record<string, any>): Promise<PAccount> { void shopId; void data; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function updateAccount(shopId: string, accountId: string, data: Record<string, any>): Promise<PAccount> { void shopId; void accountId; void data; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function deleteAccount(shopId: string, accountId: string): Promise<void> { void shopId; void accountId; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function getAccountLedger(
  shopId: string,
  accountId: string,
  opts?: { from?: string; to?: string }
): Promise<AccountLedgerResponse> { void shopId; void accountId; void opts; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function setAccountOpeningBalance(
  shopId: string,
  accountId: string,
  data: { amount: number; balance_type: 'Debit' | 'Credit'; date?: string }
): Promise<PAccount> { void shopId; void accountId; void data; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function getTrialBalance(shopId: string, opts?: { as_of?: string }): Promise<TrialBalanceResponse> { void shopId; void opts; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function getProfitLoss(shopId: string, opts?: { from?: string; to?: string }): Promise<ProfitLossResponse> { void shopId; void opts; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function getBalanceSheet(shopId: string, opts?: { as_of?: string }): Promise<BalanceSheetResponse> { void shopId; void opts; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function recordPayment(shopId: string, data: { supplier_id: string; amount: number; mode?: string; ref?: string; purchase_id?: string; idempotency_key: string }): Promise<PVoucher> { void shopId; void data; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function recordReceipt(shopId: string, data: { customer_id: string; amount: number; mode?: string; ref?: string; sale_id?: string; idempotency_key: string }): Promise<PVoucher> { void shopId; void data; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function fetchOpenBills(shopId: string, accountId: string): Promise<OpenBill[]> { void shopId; void accountId; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function listVouchers(shopId: string, kind: 'payments' | 'receipts', opts?: { from?: string; to?: string; account_id?: string; search?: string } & PageOpts): Promise<PVoucher[]> { void shopId; void kind; void opts; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function createSale(shopId: string, payload: Omit<OfflineSalePayload, 'shop_id'> & { shop_id?: string }): Promise<SaleSubmitResult> { void shopId; void payload; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function listSales(shopId: string, opts?: { from?: string; to?: string; search?: string } & PageOpts): Promise<PSale[]> { void shopId; void opts; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function getSale(_shopId: string, saleId: string): Promise<PSale> { void _shopId; void saleId; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function voidSale(shopId: string, saleId: string, reason: string): Promise<void> { void shopId; void saleId; void reason; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function listSaleReturns(shopId: string, opts?: { saleId?: string; limit?: number; offset?: number }): Promise<PSaleReturn[]> { void shopId; void opts; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function createSaleReturn(shopId: string, payload: SaleReturnPayload): Promise<PSaleReturn> { void shopId; void payload; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function correctSale(shopId: string, saleId: string, payload: CorrectSalePayload): Promise<PSale> { void shopId; void saleId; void payload; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function salesSummary(shopId: string, date?: string): Promise<Record<string, any>> { void shopId; void date; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function liveSalesTotal(shopId: string, date?: string): Promise<{ gross_sales: number; returns_total: number; net_sales: number }> { void shopId; void date; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function reportsSummary(shopId: string, from: string, to: string): Promise<Record<string, any>> { void shopId; void from; void to; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function listPurchases(shopId: string, opts?: { status?: string; from?: string; to?: string; search?: string } & PageOpts): Promise<PPurchase[]> { void shopId; void opts; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function purchasesSummary(shopId: string, opts?: { from?: string; to?: string }): Promise<{ total: number; paid: number; outstanding: number; qty: number; bills: number; returnsTotal?: number; netIntake?: number }> { void shopId; void opts; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function getPurchase(shopId: string, purchaseId: string): Promise<PPurchase> { void shopId; void purchaseId; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function createPurchase(shopId: string, data: Record<string, any>): Promise<PPurchase> { void shopId; void data; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function editPurchase(shopId: string, purchaseId: string, data: Record<string, any>): Promise<PPurchase> { void shopId; void purchaseId; void data; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function listPurchaseEdits(shopId: string): Promise<any[]> { void shopId; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function listPurchaseReturns(shopId: string, opts?: { purchaseId?: string; limit?: number; offset?: number }): Promise<PPurchaseReturn[]> { void shopId; void opts; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function createPurchaseReturn(shopId: string, payload: PurchaseReturnPayload): Promise<PPurchaseReturn> { void shopId; void payload; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function listServerTabs(shopId: string): Promise<PServerTab[]> { void shopId; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function saveServerTab(
  shopId: string,
  tableLabel: string,
  tab: { customerName: string; gstSlab: number; couponCode: string; tipPct: number; draftItems: any[] },
  force = false,
): Promise<{ ok: true; tab: PServerTab } | { ok: false; conflict: PServerTab | null }> { void shopId; void tableLabel; void tab; void force; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function releaseServerTab(shopId: string, tableLabel: string): Promise<void> { void shopId; void tableLabel; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function transferStock(shopId: string, data: { product_id: string; from_loc: 'godown' | 'counter'; to_loc: 'godown' | 'counter'; qty: number }): Promise<void> { void shopId; void data; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function listTransfers(shopId: string, opts?: { from?: string; to?: string } & PageOpts): Promise<PTransfer[]> { void shopId; void opts; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function listStockMovements(shopId: string, opts?: { from?: string; to?: string; reason?: string } & PageOpts): Promise<PStockMovement[]> { void shopId; void opts; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function createVoucher(shopId: string, data: { head: string; type: 'Income' | 'Expense'; amount: number; narration?: string; date?: string }): Promise<PIncExp> { void shopId; void data; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function cashflowSummary(
  shopId: string,
  date?: string,
  from?: string,
  to?: string
): Promise<Record<string, any>> { void shopId; void date; void from; void to; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function listIncExp(shopId: string, opts?: { from?: string; to?: string } & PageOpts): Promise<PIncExp[]> { void shopId; void opts; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function closingState(shopId: string, date: string): Promise<ClosingState> { void shopId; void date; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function saveClosingCount(
  shopId: string, dateKey: string, productId: string, actualQty: number | null,
  skipReason = '', varianceCause = '', varianceNote = '',
): Promise<void> { void shopId; void dateKey; void productId; void actualQty; void skipReason; void varianceCause; void varianceNote; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function saveClosingCash(shopId: string, dateKey: string, amount: number): Promise<void> { void shopId; void dateKey; void amount; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function recordClosingSale(shopId: string, dateKey: string, productId: string, qty: number, key: string): Promise<{ bill_no: string }> { void shopId; void dateKey; void productId; void qty; void key; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function recordClosingExpense(shopId: string, dateKey: string, amount: number, category: string, note: string, key: string): Promise<void> { void shopId; void dateKey; void amount; void category; void note; void key; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function recordClosingIncome(shopId: string, dateKey: string, amount: number, category: string, note: string, key: string): Promise<{ voucher_no: string }> { void shopId; void dateKey; void amount; void category; void note; void key; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function recordClosingCorrection(shopId: string, dateKey: string, productId: string, cause: string, qty: number, note: string, idempotencyKey?: string): Promise<{ qty_delta: number; movement_id?: string }> { void shopId; void dateKey; void productId; void cause; void qty; void note; void idempotencyKey; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function abandonClosingReview(shopId: string, dateKey: string, reason: string): Promise<{ discarded_counts: number }> { void shopId; void dateKey; void reason; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function closingAudit(shopId: string, date: string): Promise<ClosingAudit> { void shopId; void date; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function dayStatus(shopId: string, date?: string): Promise<PDayStatus> { void shopId; void date; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function openDay(shopId: string, data: { opening_cash: number; date_key?: string; note?: string }): Promise<void> { void shopId; void data; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function closeDay(shopId: string, data: { date_key: string; closing_cash: number; closing_note?: string }): Promise<void> { void shopId; void data; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function addDayLog(shopId: string, data: { date_key: string; text: string }): Promise<void> { void shopId; void data; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function businessDayInfo(shopId: string): Promise<PBusinessDayInfo> { void shopId; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function getShopFeatures(shopId: string): Promise<{ features: Record<string, PFeatureState>; catalog: PFeatureCatalogEntry[] }> { void shopId; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function updateShopFeatures(shopId: string, patch: Record<string, Partial<PFeatureState>>): Promise<Record<string, PFeatureState>> { void shopId; void patch; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function getShopClosingSettings(shopId: string): Promise<ShopClosingSettings> { void shopId; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function updateShopClosingSettings(
  shopId: string, patch: { materiality?: string; depth?: 'simple' | 'rigorous' },
): Promise<ShopClosingSettings> { void shopId; void patch; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function reauditSnapshots(shopId: string, from: string, to: string): Promise<{ audited: number; corrected: number }> { void shopId; void from; void to; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function listSnapshots(shopId: string): Promise<PSnapshot[]> { void shopId; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function listEmployees(shopId: string): Promise<{ cap: number | null; count: number; employees: PEmployee[] }> { void shopId; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function createEmployee(
  shopId: string,
  data: { name: string; email: string; password: string; tabGrants: string[]; canSeeMoney: boolean; canSeeValuation: boolean }
): Promise<void> { void shopId; void data; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function updateEmployeeAccess(
  shopId: string,
  userId: string,
  data: { tabGrants: string[]; canSeeMoney: boolean; canSeeValuation: boolean }
): Promise<void> { void shopId; void userId; void data; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function deleteEmployee(shopId: string, userId: string): Promise<void> { void shopId; void userId; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function suspendEmployee(shopId: string, userId: string): Promise<void> { void shopId; void userId; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function reactivateEmployee(shopId: string, userId: string): Promise<void> { void shopId; void userId; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function resetEmployeePassword(shopId: string, userId: string, newPassword: string): Promise<void> { void shopId; void userId; void newPassword; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function distributeStock(input: {
  fromShopId: string;
  toShopId: string;
  lines: DistributeLineInput[];
  paymentMode: 'Cash' | 'UPI' | 'Credit';
  paymentRef?: string;
  gstSlab?: number;
  notes?: string;
  idempotencyKey: string;
}): Promise<DistributionRecord> { void input; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function listDistributions(shopId: string, limit = 50): Promise<DistributionRecord[]> { void shopId; void limit; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function fetchStockOverview(shopId: string): Promise<StockOverview> { void shopId; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function fetchRetailerOutstanding(shopId: string): Promise<RetailerOutstandingRow[]> { void shopId; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function fetchOwnerSummary(from: string, to: string, shopId: string | null): Promise<OwnerSummary> { void from; void to; void shopId; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function resetShopLogin(shopId: string, newPassword: string): Promise<{ ok: boolean; login_email: string }> { void shopId; void newPassword; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function createRetailerShop(
  tenantId: string,
  input: {
    name?: string;
    code?: string;
    phone?: string;
    address?: string;
    gstin?: string;
    owner_name: string;
    owner_email: string;
    owner_password: string;
    existing_shop_id?: string;
  },
): Promise<RetailerShopCreateResult> { void tenantId; void input; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function fetchUserPrefs(): Promise<UserPrefsPayload> {  throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function fetchQzCertificate(): Promise<string> {  throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function signQzRequest(request: string): Promise<string> { void request; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function patchUserPrefs(data: Record<string, unknown>): Promise<UserPrefsPayload> { void data; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function getSheet(shopId: string, query: string | SheetQuery): Promise<SheetResponse> { void shopId; void query; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function getShopExperience(shopId: string): Promise<ShopExperienceResponse> { void shopId; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function putShopExperience(
  shopId: string,
  payload: ShopExperienceUpdatePayload,
  version: number
): Promise<{ status: string; experience: ShopExperienceData }> { void shopId; void payload; void version; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function getLibraries(library?: string): Promise<LibraryListResponse> { void library; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function listLibraryProducts(
  key: string,
  params: {
    search?: string;
    category?: string;
    parent?: string;
    review?: string;
    unit_kind?: 'ml' | 'pieces';
    offset?: number;
    limit?: number;
  } = {}
): Promise<LibraryProductPage> { void key; void params; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function createLibraryProduct(
  key: string,
  body: LibraryProductPatch & { name: string }
): Promise<LibraryProductRow> { void key; void body; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function updateLibraryProduct(
  key: string,
  id: string,
  patch: LibraryProductPatch
): Promise<LibraryProductRow> { void key; void id; void patch; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function bulkUpdateLibraryProducts(
  key: string,
  payload: LibraryBulkProductUpdatePayload
): Promise<LibraryBulkProductUpdateResponse> { void key; void payload; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function deleteLibraryProduct(key: string, id: string): Promise<void> { void key; void id; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function createLibraryParent(
  key: string,
  body: Partial<LibraryParentRow>
): Promise<LibraryParentRow> { void key; void body; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function updateLibraryParent(
  key: string,
  id: string,
  patch: Partial<LibraryParentRow>
): Promise<LibraryParentRow> { void key; void id; void patch; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function deleteLibraryParent(key: string, id: string): Promise<void> { void key; void id; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function updateLibraryOptions(
  key: string,
  patch: LibraryOptionsPatch
): Promise<LibrarySummary> { void key; void patch; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function fetchActiveSessions(): Promise<{ sessions: ActiveSession[]; limit: number }> {  throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function revokeSession(sid: string): Promise<void> { void sid; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function logoutAllSessions(): Promise<{ revoked: number }> {  throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function startImpersonation(userId: string, shopId?: string): Promise<ImpersonationPayload> { void userId; void shopId; throw new ApiError("This operation is not available yet.", "not_available", 422); }

export async function endImpersonation(body: { target_user?: string; target_name?: string }): Promise<void> { void body; throw new ApiError("This operation is not available yet.", "not_available", 422); }
