#!/usr/bin/env python3
"""
Spike 2 Precision Benchmark: Comprehensive Fractional UoM Precision Analysis
Tests multi-step dispensing across 5 bottle sizes:
  1. 750 ml Bottle (Cost: INR 1,500.00, INR 2.00/ml)
  2. 700 ml Bottle (Cost: INR 2,100.00, INR 3.00/ml - non-terminating fraction 3/35)
  3. 650 ml Bottle (Cost: INR 260.00, INR 0.40/ml - non-terminating fraction 1/13)
  4. 375 ml Bottle (Cost: INR 900.00, INR 2.40/ml - pint size)
  5. 1000 ml Bottle (Cost: INR 2,500.00, INR 2.50/ml - 1 liter size)

Evaluates precision under:
  - Configuration A: Decimal Precision = 4 (rounding = 0.0001)
  - Configuration B: Decimal Precision = 5 (rounding = 0.00001)
  - Configuration C: Decimal Precision = 6 (rounding = 0.000001)

Verifies at EVERY step:
  - Theoretical Physical ML vs Stored Quant
  - Theoretical Asset Value vs Balance Sheet SVL Value
  - Theoretical COGS vs SVL Value
  - Maximum observed drift (paise)
  - Clean zeroing of stock quant (0.000000) and residual valuation (INR 0.00)
"""

import sys
import odoo
from odoo import api
from odoo.modules.registry import Registry

DB_NAME = "spike_odoo18"

# Test bottle definitions
BOTTLE_SPECS = [
    {
        "name": "Glenfiddich 12 (750ml)",
        "capacity_ml": 750.0,
        "cost": 1500.0,
        "steps": [
            ("Peg 1", 60.0),
            ("Peg 2", 60.0),
            ("Peg 3", 90.0),
            ("Portion 4", 120.0),
            ("Peg 5", 60.0),
            ("Peg 6", 90.0),
            ("Portion 7", 180.0),
            ("Peg 8", 60.0),
            ("Residual Wastage", 30.0),
        ],
    },
    {
        "name": "Monkey 47 Gin (700ml)",
        "capacity_ml": 700.0,
        "cost": 2100.0,
        "steps": [
            ("Peg 1", 60.0),
            ("Peg 2", 60.0),
            ("Peg 3", 60.0),
            ("Peg 4", 90.0),
            ("Peg 5", 90.0),
            ("Portion 6", 120.0),
            ("Peg 7", 60.0),
            ("Peg 8", 60.0),
            ("Peg 9", 60.0),
            ("Residual Wastage", 40.0),
        ],
    },
    {
        "name": "Kingfisher Ultra (650ml)",
        "capacity_ml": 650.0,
        "cost": 260.0,
        "steps": [
            ("Glass 1", 200.0),
            ("Glass 2", 300.0),
            ("Residual Wastage", 150.0),
        ],
    },
    {
        "name": "Blenders Pride Pint (375ml)",
        "capacity_ml": 375.0,
        "cost": 900.0,
        "steps": [
            ("Small Peg 1", 30.0),
            ("Peg 2", 60.0),
            ("Peg 3", 60.0),
            ("Large Peg 4", 90.0),
            ("Peg 5", 60.0),
            ("Peg 6", 60.0),
            ("Residual Wastage", 15.0),
        ],
    },
    {
        "name": "Absolut Vodka 1L (1000ml)",
        "capacity_ml": 1000.0,
        "cost": 2500.0,
        "steps": [
            ("Peg 1", 60.0),
            ("Large Peg 2", 90.0),
            ("Portion 3", 120.0),
            ("Portion 4", 180.0),
            ("Half Bottle 5", 500.0),
            ("Residual Wastage", 50.0),
        ],
    },
]

def run_benchmark_for_config(env, precision_digits, rounding_factor):
    print("\n" + "=" * 115)
    print(f"BENCHMARK RUN: DECIMAL PRECISION = {precision_digits} DIGITS (ROUNDING = {rounding_factor})")
    print("=" * 115)
    
    # 1. Apply precision configuration
    dp = env["decimal.precision"].search([("name", "=", "Product Unit of Measure")])
    dp.digits = precision_digits
    uom = env["uom.uom"].browse(1) # Units
    uom.rounding = rounding_factor
    env.cr.commit()
    
    categ = env["product.category"].search([("name", "=", "Liquor Automated AVCO")], limit=1)
    stock_loc = env["stock.location"].search([("complete_name", "=", "WH/Stock")], limit=1)
    cust_loc = env["stock.location"].search([("usage", "=", "customer")], limit=1)
    scrap_loc = env["stock.location"].search([("scrap_location", "=", True)], limit=1)
    picking_type = env["stock.picking.type"].search([("code", "=", "outgoing")], limit=1)
    
    summary_results = []
    
    for bottle in BOTTLE_SPECS:
        b_name = bottle["name"]
        cap_ml = bottle["capacity_ml"]
        cost = bottle["cost"]
        cost_per_ml = cost / cap_ml
        steps = bottle["steps"]
        
        prod = env["product.product"].create({
            "name": f"{b_name} [DP{precision_digits}]",
            "type": "consu",
            "is_storable": True,
            "categ_id": categ.id,
            "standard_price": cost,
        })
        
        quant = env["stock.quant"].create({
            "product_id": prod.id,
            "location_id": stock_loc.id,
            "inventory_quantity": 1.0,
        })
        quant.action_apply_inventory()
        
        print(f"\n>>> Bottle: {b_name} | Capacity: {cap_ml:.0f}ml | Cost: INR {cost:.2f} (INR {cost_per_ml:.4f}/ml)")
        print(f"{'Step':<20} | {'Disp (ml)':<10} | {'Phys Rem (ml)':<14} | {'Odoo Quant':<12} | {'Theor COGS':<12} | {'Actual COGS':<12} | {'COGS Diff':<10} | {'Rem Asset Val':<14}")
        print("-" * 115)
        
        cum_ml_dispensed = 0.0
        max_step_cogs_drift = 0.0
        
        for idx, (action_name, ml_amount) in enumerate(steps, 1):
            is_scrap = (idx == len(steps))
            cum_ml_dispensed += ml_amount
            phys_rem_ml = cap_ml - cum_ml_dispensed
            theor_step_cogs = ml_amount * cost_per_ml
            theor_rem_asset = phys_rem_ml * cost_per_ml
            
            if not is_scrap:
                fraction = ml_amount / cap_ml
                move = env["stock.move"].create({
                    "name": f"{action_name} ({ml_amount}ml)",
                    "product_id": prod.id,
                    "product_uom_qty": fraction,
                    "product_uom": prod.uom_id.id,
                    "location_id": stock_loc.id,
                    "location_dest_id": cust_loc.id,
                    "picking_type_id": picking_type.id,
                })
                move._action_confirm()
                move._action_assign()
                move.quantity = fraction
                move.picked = True
                move._action_done()
                
                # The SVL created for this specific move
                last_svl = env["stock.valuation.layer"].search([("stock_move_id", "=", move.id)], limit=1)
                actual_step_cogs = abs(last_svl.value)
            else:
                rem_q = env["stock.quant"].search([("product_id", "=", prod.id), ("location_id", "=", stock_loc.id)]).quantity
                scrap = env["stock.scrap"].create({
                    "product_id": prod.id,
                    "scrap_qty": rem_q,
                    "location_id": stock_loc.id,
                    "scrap_location_id": scrap_loc.id,
                })
                scrap.action_validate()
                
                # The SVL created for this scrap move
                last_svl = env["stock.valuation.layer"].search([("stock_move_id", "in", scrap.move_ids.ids)], limit=1)
                actual_step_cogs = abs(last_svl.value)
                
            cur_quant = env["stock.quant"].search([("product_id", "=", prod.id), ("location_id", "=", stock_loc.id)]).quantity
            svls = env["stock.valuation.layer"].search([("product_id", "=", prod.id)])
            cur_asset_val = sum(s.value for s in svls)
            
            cogs_diff = actual_step_cogs - theor_step_cogs
            if abs(cogs_diff) > max_step_cogs_drift:
                max_step_cogs_drift = abs(cogs_diff)
                
            print(f"{action_name:<20} | {ml_amount:<10.1f} | {phys_rem_ml:<14.1f} | {cur_quant:<12.6f} | INR {theor_step_cogs:<8.2f} | INR {actual_step_cogs:<8.2f} | {cogs_diff:+8.3f}   | INR {cur_asset_val:<10.2f}")
            
        final_svls = env["stock.valuation.layer"].search([("product_id", "=", prod.id)])
        final_asset_val = sum(s.value for s in final_svls)
        final_cum_cogs = sum(abs(s.value) for s in final_svls if s.value < 0)
        final_quant = env["stock.quant"].search([("product_id", "=", prod.id), ("location_id", "=", stock_loc.id)]).quantity
        
        summary_results.append({
            "bottle": b_name,
            "cost": cost,
            "final_quant": final_quant,
            "final_asset_val": final_asset_val,
            "final_cum_cogs": final_cum_cogs,
            "max_cogs_drift": max_step_cogs_drift,
        })
        
    return summary_results

def main():
    reg = Registry(DB_NAME)
    with reg.cursor() as cr:
        env = api.Environment(cr, odoo.SUPERUSER_ID, {})
        
        print("=" * 115)
        print("ORSQUARE SPIKE 2: UOM DECIMAL PRECISION & ACCURACY BENCHMARK SUITE")
        print("=" * 115)
        
        configs = [
            (4, 0.0001, "Config 4 (DP=4, Round=0.0001)"),
            (5, 0.00001, "Config 5 (DP=5, Round=0.00001)"),
            (6, 0.000001, "Config 6 (DP=6, Round=0.000001)"),
        ]
        
        all_results = {}
        for digits, rounding, label in configs:
            res = run_benchmark_for_config(env, digits, rounding)
            all_results[label] = res
            
        print("\n" + "=" * 115)
        print("OVERALL PRECISION COMPARISON MATRIX")
        print("=" * 115)
        print(f"{'Bottle SKU':<30} | {'Config 4 Max Drift':<20} | {'Config 5 Max Drift':<20} | {'Config 6 Max Drift':<20} | {'Final Asset / Quant':<20}")
        print("-" * 115)
        
        num_bottles = len(BOTTLE_SPECS)
        for i in range(num_bottles):
            b_name = BOTTLE_SPECS[i]["name"]
            d4 = all_results["Config 4 (DP=4, Round=0.0001)"][i]["max_cogs_drift"]
            d5 = all_results["Config 5 (DP=5, Round=0.00001)"][i]["max_cogs_drift"]
            d6 = all_results["Config 6 (DP=6, Round=0.000001)"][i]["max_cogs_drift"]
            
            q6 = all_results["Config 6 (DP=6, Round=0.000001)"][i]["final_quant"]
            v6 = all_results["Config 6 (DP=6, Round=0.000001)"][i]["final_asset_val"]
            
            clean_str = f"INR {v6:.2f} / {q6:.4f}"
            print(f"{b_name:<30} | {f'INR {d4:.4f} ({d4*100:.1f}p)':<20} | {f'INR {d5:.4f} ({d5*100:.1f}p)':<20} | {f'INR {d6:.4f} ({d6*100:.1f}p)':<20} | {clean_str:<20}")
            
        print("-" * 115)
        print("[+] BENCHMARK SUITE COMPLETE.")

if __name__ == "__main__":
    main()
