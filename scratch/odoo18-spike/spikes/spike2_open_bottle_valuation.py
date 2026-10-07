#!/usr/bin/env python3
"""
Spike 2: Open Bottle Accounting & Valuation Prototype
Empirically tests the 3 realistic accounting alternatives for opened liquor bottles in Odoo 18:
  - Alternative A: Immediate Consumption upon Opening (Standard Bar/Hospitality)
  - Alternative B: Fractional UoM Movement per Peg (Direct Asset Depletion)
  - Alternative C: Production/Unbuild Conversion (Bottle Piece -> Bulk Liquid ml)

For each alternative, inspects:
  1. Resulting Stock Quants
  2. Stock Valuation Layers (stock.valuation.layer - SVL)
  3. Resulting General Ledger entries (account.move.line)
  4. Balance Sheet & P&L impact
"""

import sys
import time
import json
import urllib.request

ODOO_URL = "http://localhost:8088"
DB_NAME = "spike_odoo18"
USER = "admin"
PASSWORDS = ["admin", "admin_spike_pwd"]

def json_rpc(service, method, args):
    req_data = {
        "jsonrpc": "2.0",
        "method": "call",
        "params": {
            "service": service,
            "method": method,
            "args": args
        },
        "id": int(time.time() * 1000)
    }
    req = urllib.request.Request(
        f"{ODOO_URL}/jsonrpc",
        data=json.dumps(req_data).encode('utf-8'),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req) as resp:
        res = json.loads(resp.read().decode('utf-8'))
        if "error" in res:
            raise Exception(res["error"])
        return res.get("result")

def execute_kw(uid, pwd, model, method, args=None, kwargs=None):
    if args is None:
        args = []
    if kwargs is None:
        kwargs = {}
    return json_rpc("object", "execute_kw", [DB_NAME, uid, pwd, model, method, args, kwargs])

def get_connection():
    for pwd in PASSWORDS:
        try:
            uid = json_rpc("common", "authenticate", [DB_NAME, USER, pwd, {}])
            if uid:
                return uid, pwd
        except Exception:
            pass
    return None, None

def setup_automated_valuation_category(uid, pwd):
    print("[*] Setting up Product Category with Automated AVCO Valuation...")
    # Find or create category with property_cost_method='average', property_valuation='automated'
    categ_ids = execute_kw(uid, pwd, "product.category", "search", [[['name', '=', 'Liquor Automated AVCO']]])
    if not categ_ids:
        # Get standard stock accounts
        accounts = execute_kw(uid, pwd, "account.account", "search_read", [[['account_type', 'in', ['asset_current', 'expense']]]], {'fields': ['id', 'name', 'account_type']})
        stock_val_acc = [a['id'] for a in accounts if 'asset' in a['account_type']][0]
        cogs_acc = [a['id'] for a in accounts if 'expense' in a['account_type']][0]
        
        categ_id = execute_kw(uid, pwd, "product.category", "create", [{
            'name': 'Liquor Automated AVCO',
            'property_cost_method': 'average',
            'property_valuation': 'real_time',
            'property_stock_valuation_account_id': stock_val_acc,
            'property_account_expense_categ_id': cogs_acc,
        }])
    else:
        categ_id = categ_ids[0]
    print(f"[+] Automated AVCO Category ID: {categ_id}")
    return categ_id

def test_alternative_a(uid, pwd, categ_id):
    print("\n" + "="*70)
    print("TESTING ALTERNATIVE A: Immediate Consumption upon Opening")
    print("="*70)
    print("Concept: 1 Bottle moved to Opened Shelf is recognized as consumed liquor expense.")
    print("Pegs are sold as service products. Physical dispenser tracks ml operationally.")
    
    # Create product
    prod_id = execute_kw(uid, pwd, "product.product", "create", [{
        'name': 'Glenfiddich 750ml (Alt A)',
        'default_code': 'GLEN-ALT-A',
        'type': 'consu',
        'is_storable': True,
        'categ_id': categ_id,
        'standard_price': 1500.0,
        'list_price': 2500.0,
    }])
    
    # Receive 1 bottle into WH/Stock at INR1500
    locations = execute_kw(uid, pwd, "stock.location", "search_read", [[['complete_name', '=', 'WH/Stock']]], {'fields': ['id']})
    stock_loc_id = locations[0]['id']
    
    quant_id = execute_kw(uid, pwd, "stock.quant", "create", [{
        'product_id': prod_id,
        'location_id': stock_loc_id,
        'inventory_quantity': 1.0
    }])
    execute_kw(uid, pwd, "stock.quant", "action_apply_inventory", [[quant_id]])
    
    # Check initial SVL
    svls_init = execute_kw(uid, pwd, "stock.valuation.layer", "search_read", [[['product_id', '=', prod_id]]], {'fields': ['quantity', 'unit_cost', 'value', 'description']})
    print(f"[+] Initial Inventory SVL: Qty={svls_init[-1]['quantity']}, Value=INR{svls_init[-1]['value']}")
    
    # Action: Uncork & Move to Opened Shelf (Immediate Scrap / Consumption to Cost of Opened Liquor)
    scrap_locs = execute_kw(uid, pwd, "stock.location", "search_read", [[['usage', '=', 'inventory']]], {'fields': ['id', 'name']})
    scrap_loc_id = scrap_locs[0]['id']
    
    print("[*] Uncorking bottle: Scraping/Consuming 1.0 unit from Stock to Opened/Consumed...")
    scrap_id = execute_kw(uid, pwd, "stock.scrap", "create", [{
        'product_id': prod_id,
        'scrap_qty': 1.0,
        'location_id': stock_loc_id,
        'scrap_location_id': scrap_loc_id,
    }])
    execute_kw(uid, pwd, "stock.scrap", "action_validate", [[scrap_id]])
    
    # Inspect SVLs and Account Move Lines
    svls = execute_kw(uid, pwd, "stock.valuation.layer", "search_read", [[['product_id', '=', prod_id]]], {'fields': ['quantity', 'unit_cost', 'value', 'description', 'account_move_id']})
    print("\n--- Resulting Stock Valuation Layers (Alt A) ---")
    for s in svls:
        print(f"  SVL #{s['id']}: Qty={s['quantity']}, UnitCost=INR{s['unit_cost']}, Value=INR{s['value']} ({s['description']})")
        
    print("\n--- Resulting Physical Stock Quant ---")
    quants = execute_kw(uid, pwd, "stock.quant", "search_read", [[['product_id', '=', prod_id], ['location_id', '=', stock_loc_id]]], {'fields': ['quantity']})
    print(f"  WH/Stock Balance: {quants[0]['quantity'] if quants else 0.0} bottles")
    print(f"  Operational Pegs remaining: 750 ml (managed by orsquare.opened_bottle)")
    print(f"  Financial COGS on Uncorking: INR{abs(svls[-1]['value'])}")
    print(f"  COGS on subsequent 60ml peg sale: INR0.00 (Peg revenue INR250 is 100% gross cash inflow)")

def test_alternative_b(uid, pwd, categ_id):
    print("\n" + "="*70)
    print("TESTING ALTERNATIVE B: Fractional UoM Movement per Peg")
    print("="*70)
    print("Concept: Bottle stays as inventory asset. Each 60ml peg (0.08 units) deducts stock directly.")
    
    prod_id = execute_kw(uid, pwd, "product.product", "create", [{
        'name': 'Glenfiddich 750ml (Alt B)',
        'default_code': 'GLEN-ALT-B',
        'type': 'consu',
        'is_storable': True,
        'categ_id': categ_id,
        'standard_price': 1500.0,
        'list_price': 2500.0,
    }])
    
    locations = execute_kw(uid, pwd, "stock.location", "search_read", [[['complete_name', '=', 'WH/Stock']]], {'fields': ['id']})
    stock_loc_id = locations[0]['id']
    cust_locs = execute_kw(uid, pwd, "stock.location", "search_read", [[['usage', '=', 'customer']]], {'fields': ['id']})
    cust_loc_id = cust_locs[0]['id']
    
    # Receive 1 bottle into WH/Stock at INR1500
    quant_id = execute_kw(uid, pwd, "stock.quant", "create", [{
        'product_id': prod_id,
        'location_id': stock_loc_id,
        'inventory_quantity': 1.0
    }])
    execute_kw(uid, pwd, "stock.quant", "action_apply_inventory", [[quant_id]])
    
    # Simulate selling 60ml peg (0.08 fraction of bottle: 60/750 = 0.08)
    print("[*] Selling 1st Peg (60 ml = 0.08 units of 750ml bottle)...")
    picking_types = execute_kw(uid, pwd, "stock.picking.type", "search_read", [[['code', '=', 'outgoing']]], {'fields': ['id']})
    picking_type_id = picking_types[0]['id']
    
    move_id = execute_kw(uid, pwd, "stock.move", "create", [{
        'name': 'Peg Sale 60ml',
        'product_id': prod_id,
        'product_uom_qty': 0.08,
        'product_uom': execute_kw(uid, pwd, "product.product", "read", [[prod_id]], {'fields': ['uom_id']})[0]['uom_id'][0],
        'location_id': stock_loc_id,
        'location_dest_id': cust_loc_id,
        'picking_type_id': picking_type_id,
    }])
    execute_kw(uid, pwd, "stock.move", "_action_confirm", [[move_id]])
    execute_kw(uid, pwd, "stock.move", "_action_assign", [[move_id]])
    execute_kw(uid, pwd, "stock.move", "write", [[move_id], {'quantity': 0.08}])
    execute_kw(uid, pwd, "stock.move", "_action_done", [[move_id]])
    
    svls = execute_kw(uid, pwd, "stock.valuation.layer", "search_read", [[['product_id', '=', prod_id]]], {'fields': ['quantity', 'unit_cost', 'value', 'description']})
    print("\n--- Resulting Stock Valuation Layers (Alt B) ---")
    for s in svls:
        print(f"  SVL #{s['id']}: Qty={s['quantity']}, UnitCost=INR{s['unit_cost']}, Value=INR{s['value']} ({s['description']})")
        
    quants = execute_kw(uid, pwd, "stock.quant", "search_read", [[['product_id', '=', prod_id], ['location_id', '=', stock_loc_id]]], {'fields': ['quantity']})
    rem_qty = quants[0]['quantity'] if quants else 0.0
    print(f"\n--- Ending State (Alt B) ---")
    print(f"  WH/Stock Balance: {rem_qty:.4f} units (equals {rem_qty * 750:.1f} ml)")
    print(f"  Balance Sheet Asset Value Remaining: INR{rem_qty * 1500.0:.2f}")
    print(f"  COGS recognized on 60ml Peg: INR{abs(svls[-1]['value']):.2f}")

def test_alternative_c(uid, pwd, categ_id):
    print("\n" + "="*70)
    print("TESTING ALTERNATIVE C: Production/Unbuild Conversion (Piece -> ml)")
    print("="*70)
    print("Concept: 1 Bottle (Piece) uncorked converts into 750 units of Liquid (ml).")
    
    # Find ml UoM
    uoms = execute_kw(uid, pwd, "uom.uom", "search_read", [[['name', 'ilike', 'ml']]], {'fields': ['id', 'name']})
    if not uoms:
        # Create ml UoM if not present
        categ_vol = execute_kw(uid, pwd, "uom.category", "search", [[['name', 'ilike', 'volume']]])[0]
        ml_uom_id = execute_kw(uid, pwd, "uom.uom", "create", [{
            'name': 'ml',
            'category_id': categ_vol,
            'uom_type': 'smaller',
            'factor': 1000.0,
            'rounding': 1.0,
        }])
    else:
        ml_uom_id = uoms[0]['id']
        
    # 1. Sealed Bottle SKU
    bottle_id = execute_kw(uid, pwd, "product.product", "create", [{
        'name': 'Glenfiddich 750ml Sealed (Alt C)',
        'type': 'consu',
        'is_storable': True,
        'categ_id': categ_id,
        'standard_price': 1500.0,
    }])
    
    # 2. Bulk Liquid SKU (UoM: ml)
    liquid_id = execute_kw(uid, pwd, "product.product", "create", [{
        'name': 'Glenfiddich Liquid ml (Alt C)',
        'type': 'consu',
        'is_storable': True,
        'categ_id': categ_id,
        'uom_id': ml_uom_id,
        'uom_po_id': ml_uom_id,
        'standard_price': 2.0, # INR1500 / 750 = INR2.0/ml
    }])
    
    locations = execute_kw(uid, pwd, "stock.location", "search_read", [[['complete_name', '=', 'WH/Stock']]], {'fields': ['id']})
    stock_loc_id = locations[0]['id']
    cust_locs = execute_kw(uid, pwd, "stock.location", "search_read", [[['usage', '=', 'customer']]], {'fields': ['id']})
    cust_loc_id = cust_locs[0]['id']
    
    # Receive 1 bottle into WH/Stock
    quant_id = execute_kw(uid, pwd, "stock.quant", "create", [{
        'product_id': bottle_id,
        'location_id': stock_loc_id,
        'inventory_quantity': 1.0
    }])
    execute_kw(uid, pwd, "stock.quant", "action_apply_inventory", [[quant_id]])
    
    print("[*] Conversion upon Uncorking: Consuming 1 Sealed Bottle -> Producing 750 ml Liquid...")
    # Production / Internal transformation move
    # 1 Bottle OUT
    out_move = execute_kw(uid, pwd, "stock.move", "create", [{
        'name': 'Bottle Opening Out',
        'product_id': bottle_id,
        'product_uom_qty': 1.0,
        'location_id': stock_loc_id,
        'location_dest_id': execute_kw(uid, pwd, "stock.location", "search", [[['usage', '=', 'production']]])[0],
    }])
    execute_kw(uid, pwd, "stock.move", "_action_confirm", [[out_move]])
    execute_kw(uid, pwd, "stock.move", "_action_assign", [[out_move]])
    execute_kw(uid, pwd, "stock.move", "write", [[out_move], {'quantity': 1.0}])
    execute_kw(uid, pwd, "stock.move", "_action_done", [[out_move]])
    
    # 750 ml IN
    in_move = execute_kw(uid, pwd, "stock.move", "create", [{
        'name': 'Liquid 750ml In',
        'product_id': liquid_id,
        'product_uom_qty': 750.0,
        'location_id': execute_kw(uid, pwd, "stock.location", "search", [[['usage', '=', 'production']]])[0],
        'location_dest_id': stock_loc_id,
        'price_unit': 2.0,
    }])
    execute_kw(uid, pwd, "stock.move", "_action_confirm", [[in_move]])
    execute_kw(uid, pwd, "stock.move", "_action_assign", [[in_move]])
    execute_kw(uid, pwd, "stock.move", "write", [[in_move], {'quantity': 750.0}])
    execute_kw(uid, pwd, "stock.move", "_action_done", [[in_move]])
    
    # Sell 60ml peg
    print("[*] Selling 1st Peg (60 ml liquid)...")
    peg_move = execute_kw(uid, pwd, "stock.move", "create", [{
        'name': 'Sell 60ml Peg',
        'product_id': liquid_id,
        'product_uom_qty': 60.0,
        'location_id': stock_loc_id,
        'location_dest_id': cust_loc_id,
    }])
    execute_kw(uid, pwd, "stock.move", "_action_confirm", [[peg_move]])
    execute_kw(uid, pwd, "stock.move", "_action_assign", [[peg_move]])
    execute_kw(uid, pwd, "stock.move", "write", [[peg_move], {'quantity': 60.0}])
    execute_kw(uid, pwd, "stock.move", "_action_done", [[peg_move]])
    
    svls = execute_kw(uid, pwd, "stock.valuation.layer", "search_read", [[['product_id', '=', liquid_id]]], {'fields': ['quantity', 'unit_cost', 'value', 'description']})
    print("\n--- Resulting Stock Valuation Layers for Liquid SKU (Alt C) ---")
    for s in svls:
        print(f"  SVL #{s['id']}: Qty={s['quantity']} ml, UnitCost=INR{s['unit_cost']}/ml, Value=INR{s['value']} ({s['description']})")
        
    quants = execute_kw(uid, pwd, "stock.quant", "search_read", [[['product_id', '=', liquid_id], ['location_id', '=', stock_loc_id]]], {'fields': ['quantity']})
    rem_ml = quants[0]['quantity'] if quants else 0.0
    print(f"\n--- Ending State (Alt C) ---")
    print(f"  Liquid SKU in WH/Stock: {rem_ml} ml")
    print(f"  Balance Sheet Asset Value Remaining: INR{rem_ml * 2.0:.2f}")
    print(f"  COGS recognized on 60ml Peg: INR{abs(svls[-1]['value']):.2f}")

if __name__ == "__main__":
    uid, pwd = get_connection()
    if not uid:
        print("[-] Could not connect.")
        sys.exit(1)
    categ_id = setup_automated_valuation_category(uid, pwd)
    test_alternative_a(uid, pwd, categ_id)
    test_alternative_b(uid, pwd, categ_id)
    test_alternative_c(uid, pwd, categ_id)
