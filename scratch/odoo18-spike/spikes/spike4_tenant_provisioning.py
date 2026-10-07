#!/usr/bin/env python3
"""
Spike 4: Database-per-Shop Provisioning & Routing Prototype
Empirically tests:
  1. PostgreSQL template database cloning speed:
     Measures milliseconds to provision a full new shop database from template.
  2. Immediate Odoo connect and query without server restart.
  3. Absolute tenant data isolation: verifying that mutations in tenant DB
     have zero impact on the master/template DB.
"""

import time
import psycopg2
import odoo
from odoo import api
from odoo.modules.registry import Registry

TEMPLATE_DB = "spike_odoo18"
NEW_SHOP_DB = "orsquare_shop_bench"
PG_HOST = "db"
PG_USER = "odoo"
PG_PASS = "odoo"
PG_PORT = 5432

def run_spike4():
    print("="*75)
    print("SPIKE 4: DATABASE-PER-SHOP PROVISIONING & TENANT ISOLATION")
    print("="*75)
    
    # 1. Connect to PostgreSQL server
    conn = psycopg2.connect(
        host=PG_HOST,
        user=PG_USER,
        password=PG_PASS,
        port=PG_PORT,
        dbname="postgres"
    )
    conn.autocommit = True
    cur = conn.cursor()
    
    # Terminate active connections to template DB so PostgreSQL allows cloning
    cur.execute(f"""
        SELECT pg_terminate_backend(pid) 
        FROM pg_stat_activity 
        WHERE datname = '{TEMPLATE_DB}' AND pid <> pg_backend_pid();
    """)
    
    # Drop test DB if exists
    cur.execute(f"DROP DATABASE IF EXISTS {NEW_SHOP_DB};")
    
    # 2. Benchmark Clone Speed
    print(f"[*] Benchmarking template cloning: '{TEMPLATE_DB}' -> '{NEW_SHOP_DB}'...")
    t0 = time.time()
    cur.execute(f"CREATE DATABASE {NEW_SHOP_DB} TEMPLATE {TEMPLATE_DB};")
    elapsed_ms = (time.time() - t0) * 1000
    print(f"[+] PROVISIONING BENCHMARK: New shop database cloned in {elapsed_ms:.1f} ms ({elapsed_ms/1000:.2f} seconds)!")
    
    cur.close()
    conn.close()
    
    # 3. Test Odoo connecting to the cloned database immediately
    print(f"[*] Verifying Odoo 18 Registry loading on new tenant database '{NEW_SHOP_DB}'...")
    t1 = time.time()
    reg = Registry(NEW_SHOP_DB)
    registry_ms = (time.time() - t1) * 1000
    print(f"[+] Tenant Registry initialized in {registry_ms:.1f} ms!")
    
    # 4. Verify Absolute Tenant Isolation
    with reg.cursor() as cr:
        env = api.Environment(cr, odoo.SUPERUSER_ID, {})
        # Count products in new tenant
        count_new = env['product.product'].search_count([])
        print(f"[+] Total Products in new tenant '{NEW_SHOP_DB}': {count_new}")
        
        # Create a new unique product in new tenant
        new_prod = env['product.product'].create({
            'name': 'TENANT ONLY PRODUCT (ISOLATION TEST)',
            'default_code': 'TENANT-ISO-001',
            'type': 'consu',
        })
        cr.commit()
        print(f"[+] Created tenant product ID: {new_prod.id} in '{NEW_SHOP_DB}'")
        
    # Check master template DB to verify isolation
    reg_orig = Registry(TEMPLATE_DB)
    with reg_orig.cursor() as cr_orig:
        env_orig = api.Environment(cr_orig, odoo.SUPERUSER_ID, {})
        iso_check = env_orig['product.product'].search([('default_code', '=', 'TENANT-ISO-001')])
        print(f"[+] Checking template database '{TEMPLATE_DB}' for tenant product...")
        if not iso_check:
            print("[+] EMPIRICAL PROOF: Absolute Tenant Isolation CONFIRMED!")
            print("    -> Zero data leakage. Tenant mutations exist solely inside tenant DB.")
        else:
            print("[-] FAIL: Data leakage detected!")

if __name__ == "__main__":
    run_spike4()
