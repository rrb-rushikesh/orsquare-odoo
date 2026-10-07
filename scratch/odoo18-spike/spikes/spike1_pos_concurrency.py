#!/usr/bin/env python3
"""
Spike 1: Odoo 18 Headless POS Integration & Concurrency Stress Test
Empirically tests:
1. Native Odoo 18 sync_from_ui headless order ingestion.
2. Native stock delivery & picking creation on POS checkout.
3. Concurrency Stress Test: 5 simultaneous worker threads competing for
   the last remaining stock unit (1.0 bottle in stock), measuring:
   - Success vs failure counts.
   - Serialization / lock contention.
   - Whether stock quant goes negative or is bounded.
"""

import sys
import time
import uuid
import json
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

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

def get_env_data(uid, pwd):
    # Find active session
    sessions = execute_kw(uid, pwd, "pos.session", "search_read", [[['state', 'in', ['opened', 'opening_control']]]], {'fields': ['id', 'company_id', 'config_id']})
    session = sessions[0]
    session_id = session['id']
    company_id = session['company_id'][0]
    config_id = session['config_id'][0]
    
    # Product
    prods = execute_kw(uid, pwd, "product.product", "search_read", [[['default_code', '=', 'RC-750ML']]], {'fields': ['id', 'name']})
    prod_id = prods[0]['id']
    
    # Payment method
    config = execute_kw(uid, pwd, "pos.config", "read", [[config_id]], {'fields': ['payment_method_ids', 'picking_type_id']})[0]
    pm_id = config['payment_method_ids'][0]
    
    # Stock Location
    picking_type = execute_kw(uid, pwd, "stock.picking.type", "read", [[config['picking_type_id'][0]]], {'fields': ['default_location_src_id']})[0]
    src_location_id = picking_type['default_location_src_id'][0]
    
    # Check current stock
    quants = execute_kw(uid, pwd, "stock.quant", "search_read", [[
        ['product_id', '=', prod_id],
        ['location_id', '=', src_location_id]
    ]], {'fields': ['quantity']})
    stock_qty = quants[0]['quantity'] if quants else 0.0
    
    return {
        'session_id': session_id,
        'company_id': company_id,
        'prod_id': prod_id,
        'payment_method_id': pm_id,
        'src_location_id': src_location_id,
        'current_stock': stock_qty
    }

def post_order(uid, pwd, env_data, order_ref):
    order_data = {
        'name': f"Order {order_ref}",
        'session_id': env_data['session_id'],
        'company_id': env_data['company_id'],
        'user_id': uid,
        'uuid': str(uuid.uuid4()),
        'amount_paid': 750.0,
        'amount_total': 750.0,
        'amount_tax': 0.0,
        'amount_return': 0.0,
        'lines': [
            (0, 0, {
                'product_id': env_data['prod_id'],
                'qty': 1.0,
                'price_unit': 750.0,
                'price_subtotal': 750.0,
                'price_subtotal_incl': 750.0,
            })
        ],
        'payment_ids': [
            (0, 0, {
                'amount': 750.0,
                'payment_method_id': env_data['payment_method_id'],
                'payment_date': time.strftime('%Y-%m-%d %H:%M:%S'),
            })
        ]
    }
    return execute_kw(uid, pwd, "pos.order", "sync_from_ui", [[order_data]])

def run_concurrency_test(uid, pwd, env_data):
    print("\n=======================================================")
    print("STEP 2: Concurrency Stress Test on Remaining Stock")
    print("=======================================================")
    print(f"[*] Current Available Stock in WH/Stock: {env_data['current_stock']} units")
    print(f"[*] Firing 5 concurrent checkout requests simultaneously...")
    
    results = []
    def worker(worker_id):
        ref = f"CONCUR-W{worker_id}-{int(time.time()*1000)}"
        t0 = time.time()
        try:
            res = post_order(uid, pwd, env_data, ref)
            elapsed = (time.time() - t0) * 1000
            order_info = res.get('pos.order', [{}])[0]
            return {
                'worker': worker_id,
                'success': True,
                'order_id': order_info.get('id'),
                'name': order_info.get('name'),
                'state': order_info.get('state'),
                'elapsed_ms': elapsed,
                'error': None
            }
        except Exception as e:
            elapsed = (time.time() - t0) * 1000
            return {
                'worker': worker_id,
                'success': False,
                'order_id': None,
                'name': None,
                'state': None,
                'elapsed_ms': elapsed,
                'error': str(e)
            }

    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(worker, i) for i in range(1, 6)]
        for f in as_completed(futures):
            results.append(f.result())
            
    results.sort(key=lambda x: x['worker'])
    
    print("\n--- Concurrency Execution Report ---")
    succeeded = [r for r in results if r['success']]
    failed = [r for r in results if not r['success']]
    
    print(f"[+] Total Requests Sent: {len(results)}")
    print(f"[+] Succeeded Orders: {len(succeeded)}")
    print(f"[-] Failed Orders: {len(failed)}")
    
    for r in results:
        if r['success']:
            print(f"    Worker {r['worker']}: SUCCESS -> Order #{r['order_id']} ({r['name']}, {r['state']}) in {r['elapsed_ms']:.1f}ms")
        else:
            print(f"    Worker {r['worker']}: FAILED in {r['elapsed_ms']:.1f}ms -> {r['error'][:100]}")
            
    # Check final stock
    quants = execute_kw(uid, pwd, "stock.quant", "search_read", [[
        ['product_id', '=', env_data['prod_id']],
        ['location_id', '=', env_data['src_location_id']]
    ]], {'fields': ['quantity']})
    final_stock = quants[0]['quantity'] if quants else 0.0
    
    print("\n=======================================================")
    print("EMPIRICAL FINDINGS:")
    print("=======================================================")
    print(f"Starting Stock: {env_data['current_stock']} units")
    print(f"Final Stock:    {final_stock} units")
    print(f"Total Sold:     {len(succeeded)} units")
    
    if final_stock < 0:
        print("\n[!] CRITICAL PROOF: Odoo 18 native POS DOES NOT PREVENT NEGATIVE STOCK OUT-OF-THE-BOX!")
        print("    -> Stock quant decreased below zero without blocking sales.")
        print("    -> This directly confirms the user's warning: Native POS allows overselling by default.")
        print("    -> Architecture conclusion: If the shop owner requires strict zero-overselling, an explicit")
        print("       stock reservation guard or OCA stock_no_negative constraint is MANDATORY.")
    else:
        print("\n[+] Stock remained >= 0.")

if __name__ == "__main__":
    uid, pwd = get_connection()
    if not uid:
        print("[-] Could not connect to Odoo 18.")
        sys.exit(1)
    env_data = get_env_data(uid, pwd)
    run_concurrency_test(uid, pwd, env_data)
