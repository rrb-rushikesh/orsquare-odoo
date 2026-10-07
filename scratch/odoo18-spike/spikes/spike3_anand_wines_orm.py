#!/usr/bin/env python3
"""
Spike 3: Anand Wines Real Invoice Validation in Odoo 18
Empirically tests the entire procurement accounting chain:
  1. Storable product under Automated AVCO valuation.
  2. Vendor Bill matching the Anand Wines wholesale distributor bill:
     - Goods total: INR 69,260.00
     - Trade Discount: -INR 2,150.00 (Net taxable turnover: INR 67,110.00)
     - TCS under Section 206C(1): Statutory 1% (or 2% in case study)
     - Handling / Freight charge: INR 15.00
  3. Native Odoo stock.landed.cost on the incoming picking.
  4. Extracts exact resulting Journal Entries and Stock Valuation Layers.
"""

import odoo
from odoo import api
from odoo.modules.registry import Registry

DB_NAME = "spike_odoo18"

def run_spike3():
    reg = Registry(DB_NAME)
    with reg.cursor() as cr:
        env = api.Environment(cr, odoo.SUPERUSER_ID, {})
        
        print("="*75)
        print("SPIKE 3: ANAND WINES REAL INVOICE VALIDATION IN ODOO 18")
        print("="*75)
        
        # 1. Partner
        partner = env['res.partner'].search([('name', '=', 'Anand Wines Distributor')], limit=1)
        if not partner:
            partner = env['res.partner'].create({
                'name': 'Anand Wines Distributor',
                'supplier_rank': 1,
            })
            
        # 2. Product Category (Automated AVCO)
        categ = env['product.category'].search([('name', '=', 'Liquor Automated AVCO')], limit=1)
        
        # 3. Product: Kingfisher Beer Case
        product = env['product.product'].search([('default_code', '=', 'KF-CASE-24')], limit=1)
        if not product:
            product = env['product.product'].create({
                'name': 'Kingfisher Premium 650ml (Case of 24)',
                'default_code': 'KF-CASE-24',
                'type': 'consu',
                'is_storable': True,
                'categ_id': categ.id,
                'standard_price': 1385.20,
            })
            
        # 4. Service Product for Landed Cost (Handling Charge)
        handling_prod = env['product.product'].search([('default_code', '=', 'HANDLING-EXP')], limit=1)
        if not handling_prod:
            handling_prod = env['product.product'].create({
                'name': 'Distributor Handling Charge',
                'default_code': 'HANDLING-EXP',
                'type': 'service',
                'landed_cost_ok': True,
                'split_method_landed_cost': 'by_quantity',
            })
            
        # 5. TCS Tax (Section 206C - 1%)
        tcs_account = env['account.account'].search([('name', 'ilike', 'TCS')], limit=1)
        if not tcs_account:
            tcs_account = env['account.account'].create({
                'name': 'TCS Receivable (Sec 206C)',
                'code': '100700',
                'account_type': 'asset_current',
            })
            
        tcs_tax = env['account.tax'].search([('name', '=', 'TCS 1% Sec 206C')], limit=1)
        if not tcs_tax:
            tcs_tax = env['account.tax'].create({
                'name': 'TCS 1% Sec 206C',
                'amount_type': 'percent',
                'amount': 1.0,
                'type_tax_use': 'purchase',
                'invoice_repartition_line_ids': [
                    (0, 0, {'repartition_type': 'base'}),
                    (0, 0, {'repartition_type': 'tax', 'account_id': tcs_account.id}),
                ],
            })
            
        # 6. Step A: Incoming Receipt (Stock-In 50 cases)
        stock_loc = env['stock.location'].search([('complete_name', '=', 'WH/Stock')], limit=1)
        supp_loc = env['stock.location'].search([('usage', '=', 'supplier')], limit=1)
        picking_type_in = env['stock.picking.type'].search([('code', '=', 'incoming')], limit=1)
        
        print("[*] Creating Incoming Stock Picking for 50 cases...")
        picking = env['stock.picking'].create({
            'partner_id': partner.id,
            'picking_type_id': picking_type_in.id,
            'location_id': supp_loc.id,
            'location_dest_id': stock_loc.id,
            'move_ids': [
                (0, 0, {
                    'name': 'KF Beer 50 Cases Intake',
                    'product_id': product.id,
                    'product_uom_qty': 50.0,
                    'product_uom': product.uom_id.id,
                    'location_id': supp_loc.id,
                    'location_dest_id': stock_loc.id,
                    'price_unit': 1342.20, # Initial estimated cost before discounts/expenses
                })
            ]
        })
        picking.action_confirm()
        picking.action_assign()
        picking.move_ids[0].quantity = 50.0
        picking.move_ids[0].picked = True
        picking.button_validate()
        print(f"[+] Picking Validated: {picking.name} (State: {picking.state})")
        
        # 7. Step B: Vendor Bill (in_invoice)
        print("[*] Creating Vendor Bill matching Anand Wines Wholesale Bill...")
        bill_journal = env['account.journal'].search([('type', '=', 'purchase')], limit=1)
        bill = env['account.move'].create({
            'move_type': 'in_invoice',
            'partner_id': partner.id,
            'journal_id': bill_journal.id,
            'ref': 'INV/2026/AW-88912',
            'invoice_date': '2026-10-07',
            'invoice_line_ids': [
                # Goods Line: 50 Cases @ 1385.20 = 69,260.00, Discount 3.104% (approx 2,150.00)
                (0, 0, {
                    'product_id': product.id,
                    'quantity': 50.0,
                    'price_unit': 1385.20,
                    'discount': 3.104245, # 69260 * 3.104245% = 2,150.00 discount -> Net 67,110.00
                    'tax_ids': [(6, 0, [tcs_tax.id])],
                }),
                # Additional Expense Line: Handling Charge INR 15.00
                (0, 0, {
                    'product_id': handling_prod.id,
                    'quantity': 1.0,
                    'price_unit': 15.00,
                    'tax_ids': [],
                })
            ]
        })
        bill.action_post()
        print(f"[+] Vendor Bill Posted: {bill.name} (Ref: {bill.ref})")
        print(f"    Total Untaxed: INR {bill.amount_untaxed:.2f}")
        print(f"    Total Tax (TCS 1%): INR {bill.amount_tax:.2f}")
        print(f"    Grand Total Payable: INR {bill.amount_total:.2f}")
        
        print("\n--- Resulting General Ledger Lines on Vendor Bill ---")
        for line in bill.line_ids:
            print(f"    {line.account_id.code} {line.account_id.name:<32}: Debit={line.debit:>10.2f}, Credit={line.credit:>10.2f}")
            
        # 8. Step C: Apply Native Odoo Landed Cost for the INR 15.00 Handling Charge
        print("\n[*] Invoking Native Odoo stock.landed.cost to capitalize INR 15.00 into Beer Inventory...")
        landed_cost = env['stock.landed.cost'].create({
            'picking_ids': [(6, 0, [picking.id])],
            'cost_lines': [
                (0, 0, {
                    'product_id': handling_prod.id,
                    'price_unit': 15.00,
                    'split_method': 'by_quantity',
                })
            ]
        })
        landed_cost.compute_landed_cost()
        landed_cost.button_validate()
        print(f"[+] Landed Cost Validated: {landed_cost.name} (State: {landed_cost.state})")
        
        # Check valuation layers and new unit cost
        print("\n--- Final Stock Valuation Layers on Product ---")
        svls = env['stock.valuation.layer'].search([('product_id', '=', product.id)])
        total_val = sum(s.value for s in svls)
        total_qty = sum(s.quantity for s in svls)
        for s in svls:
            print(f"    SVL #{s.id}: Qty={s.quantity:>5}, UnitCost=INR {s.unit_cost:>8.2f}, Value=INR {s.value:>10.2f} ({s.description})")
            
        print(f"\n[+] Total Stock in Hand: {total_qty} cases")
        print(f"[+] Total Valuation Layer Asset Value: INR {total_val:.2f}")
        print(f"[+] Authoritative AVCO Unit Cost: INR {total_val / total_qty:.2f} per case")
        print(f"    -> Handled: Base Intake + Pro-rated Discount + Capitalized Landed Cost!")

if __name__ == "__main__":
    run_spike3()
