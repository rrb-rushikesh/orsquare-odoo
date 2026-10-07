#!/usr/bin/env python3
"""
Orchestration script for Milestone 0 Spikes
Usage:
  python run_spike.py start         # Starts scratch docker containers
  python run_spike.py init-db       # Initializes spike_odoo18 database with POS & Stock
  python run_spike.py spike1        # Runs Spike 1: Headless POS & Concurrency
  python run_spike.py spike2        # Runs Spike 2: Open Bottle Accounting
  python run_spike.py spike3        # Runs Spike 3: Anand Wines Bill
  python run_spike.py spike4        # Runs Spike 4: Tenant Provisioning
  python run_spike.py stop          # Stops scratch docker containers
"""

import sys
import subprocess
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
COMPOSE_FILE = os.path.join(SCRIPT_DIR, "docker-compose.yml")

def run_cmd(cmd, cwd=SCRIPT_DIR):
    print(f"[*] Running: {cmd}")
    res = subprocess.run(cmd, shell=True, cwd=cwd)
    return res.returncode

def start_containers():
    print("[*] Starting Odoo 18 Scratch Containers...")
    return run_cmd(f"docker compose -f {COMPOSE_FILE} up -d")

def stop_containers():
    print("[*] Stopping Odoo 18 Scratch Containers...")
    return run_cmd(f"docker compose -f {COMPOSE_FILE} down")

def init_db():
    print("[*] Initializing spike_odoo18 database with point_of_sale, stock_account, purchase...")
    cmd = f"docker compose -f {COMPOSE_FILE} exec -T odoo odoo -i point_of_sale,stock_account,purchase -d spike_odoo18 --stop-after-init"
    return run_cmd(cmd)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    
    action = sys.argv[1].lower()
    if action == "start":
        start_containers()
    elif action == "stop":
        stop_containers()
    elif action == "init-db":
        init_db()
    elif action == "spike1":
        run_cmd(f"python {os.path.join(SCRIPT_DIR, 'spikes', 'spike1_pos_concurrency.py')}")
    else:
        print(f"Unknown action: {action}")
        print(__doc__)
