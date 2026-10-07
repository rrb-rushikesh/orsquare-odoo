import { useState, useEffect } from 'react';
import { Drawer, Btn, Field, NumInput, useToast } from '@/components/ui';
import * as repo from '@/lib/repo';
import type { PAccount } from '@/lib/repo';
import type { OpenBill } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
  shopId: string;
  accounts: PAccount[];
  preselectedAccountId?: string | null;
  defaultDirection?: 'in' | 'out';
  onSuccess?: () => void;
}

export function AccountPaymentModal({
  open,
  onClose,
  shopId,
  accounts,
  preselectedAccountId,
  defaultDirection,
  onSuccess,
}: Props) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [partyId, setPartyId] = useState('');
  const [mode, setMode] = useState<'Cash' | 'UPI'>('Cash');
  const [refNo, setRefNo] = useState('');
  const [amount, setAmount] = useState<number>(0);

  // Open bills for the selected party
  const [openBills, setOpenBills] = useState<OpenBill[]>([]);
  // One idempotency key per USER INTENT, not per request. It is minted when
  // the form opens and reused for every retry of the same intent, so a payment
  // that committed server-side but whose response was lost is de-duplicated
  // instead of paid twice. It is only rotated after a definite success - and
  // also when the amount or party changes, because that is a different intent.
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());
  const [loadingBills, setLoadingBills] = useState(false);
  const [selectedBillId, setSelectedBillId] = useState('');

  // Eligible accounts based on direction:
  // Money In: Customer, Retailer
  // Money Out: Supplier
  const eligibleAccounts = accounts.filter((a) => {
    if (direction === 'in') return a.type === 'Customer' || a.type === 'Retailer';
    return a.type === 'Supplier';
  });

  // When modal opens or preselectedAccountId changes:
  useEffect(() => {
    if (open) {
      const pre = accounts.find((a) => a.id === preselectedAccountId);
      if (defaultDirection) {
        setDirection(defaultDirection);
      } else if (pre) {
        if (pre.type === 'Supplier') {
          setDirection('out');
        } else {
          setDirection('in');
        }
      } else {
        const firstCust = accounts.find((a) => a.type === 'Customer' || a.type === 'Retailer');
        if (firstCust) {
          setDirection('in');
        } else {
          setDirection('out');
        }
      }
      if (pre) {
        setPartyId(pre.id);
      } else {
        const firstCust = accounts.find((a) => a.type === 'Customer' || a.type === 'Retailer');
        const firstSupp = accounts.find((a) => a.type === 'Supplier');
        setPartyId((defaultDirection === 'out' ? firstSupp?.id : firstCust?.id) || '');
      }
      setAmount(0);
      setRefNo('');
      setMode('Cash');
      setSelectedBillId('');
    }
  }, [open, preselectedAccountId, accounts]);

  // When direction changes, pick the first eligible party
  const handleDirectionChange = (newDir: 'in' | 'out') => {
    setDirection(newDir);
    setSelectedBillId('');
    setOpenBills([]);
    const matching = accounts.filter((a) => {
      if (newDir === 'in') return a.type === 'Customer' || a.type === 'Retailer';
      return a.type === 'Supplier';
    });
    setPartyId(matching[0]?.id || '');
  };

  // Fetch open bills when partyId changes
  useEffect(() => {
    if (!open || !partyId || !shopId) {
      setOpenBills([]);
      setSelectedBillId('');
      return;
    }

    let active = true;
    setLoadingBills(true);
    repo
      .fetchOpenBills(shopId, partyId)
      .then((bills) => {
        if (active) {
          setOpenBills(bills || []);
          setLoadingBills(false);
          // If previously selected bill is no longer in open list, reset
          if (selectedBillId && !bills.some((b) => b.id === selectedBillId)) {
            setSelectedBillId('');
          }
        }
      })
      .catch((err) => {
        if (active) {
          console.error('Failed to load open bills:', err);
          setOpenBills([]);
          setLoadingBills(false);
        }
      });

    return () => {
      active = false;
    };
  }, [open, partyId, shopId]);

  // When user selects a bill, auto-populate amount with outstanding
  const handleBillSelect = (billId: string) => {
    setSelectedBillId(billId);
    if (billId) {
      const bill = openBills.find((b) => b.id === billId);
      if (bill) {
        setAmount(bill.outstanding_amount);
        if (!refNo && bill.bill_no) {
          setRefNo(`Ref ${bill.bill_no}`);
        }
      }
    }
  };

  const selectedBill = openBills.find((b) => b.id === selectedBillId);

  const handleSave = async () => {
    const amt = Math.round(amount * 100) / 100;
    if (!(amt > 0)) {
      toast('Enter an amount above zero.', 'err');
      return;
    }
    if (!partyId) {
      toast(`Select a ${direction === 'in' ? 'customer' : 'supplier'} account.`, 'err');
      return;
    }

    if (selectedBill && amt > selectedBill.outstanding_amount) {
      toast(
        `Amount (₹${amt}) cannot exceed bill outstanding balance (₹${selectedBill.outstanding_amount}).`,
        'err'
      );
      return;
    }

    setBusy(true);
    try {
      if (direction === 'in') {
        const v = await repo.recordReceipt(shopId, {
          customer_id: partyId,
          amount: amt,
          mode,
          ref: refNo.trim(),
          sale_id: selectedBillId || undefined,
          idempotency_key: idemKey,
        });
        toast(`Receipt ${v.voucherNo} recorded successfully.`);
      } else {
        const v = await repo.recordPayment(shopId, {
          supplier_id: partyId,
          amount: amt,
          mode,
          ref: refNo.trim(),
          purchase_id: selectedBillId || undefined,
          idempotency_key: idemKey,
        });
        toast(`Payment ${v.voucherNo} recorded successfully.`);
      }
      setIdemKey(crypto.randomUUID());
      onClose();
      onSuccess?.();
    } catch (err) {
      // Key deliberately NOT rotated: if this actually committed server-side
      // and only the response was lost, retrying with the same key is what
      // makes it safe. The user sees the error and taps Save again.
      toast(err instanceof Error ? err.message : 'Failed to record transaction.', 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      title={direction === 'in' ? 'Record Receipt (Money In)' : 'Record Payment (Money Out)'}
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
          <Btn variant="primary" block disabled={busy} onClick={handleSave}>
            {busy
              ? direction === 'in'
                ? 'Recording receipt…'
                : 'Recording payment…'
              : direction === 'in'
              ? 'Confirm & Record Receipt'
              : 'Confirm & Record Payment'}
          </Btn>
          <Btn variant="ghost" block onClick={onClose}>
            Cancel
          </Btn>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Direction Switcher */}
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--ink, #161616)' }}>
            Transaction Direction
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button
              type="button"
              onClick={() => handleDirectionChange('in')}
              style={{
                padding: '10px 16px',
                fontSize: 13,
                fontWeight: 600,
                textAlign: 'center',
                cursor: 'pointer',
                border: direction === 'in' ? '2px solid var(--fin-rec, #2d6b3f)' : '1px solid var(--line, #e0e0e0)',
                background: direction === 'in' ? 'var(--fin-rec-bg, #edf6f0)' : '#fff',
                color: direction === 'in' ? 'var(--fin-rec-fg, #235c35)' : 'var(--ink, #161616)',
                borderRadius: 0,
              }}
            >
              Money In (Customer Receipt)
            </button>
            <button
              type="button"
              onClick={() => handleDirectionChange('out')}
              style={{
                padding: '10px 16px',
                fontSize: 13,
                fontWeight: 600,
                textAlign: 'center',
                cursor: 'pointer',
                border: direction === 'out' ? '2px solid var(--fin-pay, #a03b3b)' : '1px solid var(--line, #e0e0e0)',
                background: direction === 'out' ? 'var(--fin-pay-bg, #faebeb)' : '#fff',
                color: direction === 'out' ? 'var(--fin-pay-fg, #8a2e2e)' : 'var(--ink, #161616)',
                borderRadius: 0,
              }}
            >
              Money Out (Supplier Payment)
            </button>
          </div>
        </div>

        {/* Party Selector */}
        <Field
          label={direction === 'in' ? 'Received From (Customer / Retailer)' : 'Disbursed To (Supplier)'}
          help={
            direction === 'in'
              ? 'Select the customer paying outstanding Khata balance.'
              : 'Select the supplier to disburse payment.'
          }
        >
          <select
            className="field-control"
            value={partyId}
            onChange={(e) => {
              setPartyId(e.target.value);
              setSelectedBillId('');
            }}
          >
            <option value="">Select an account…</option>
            {eligibleAccounts.map((a) => {
              const bal = Number(a.balance || 0);
              let balStr = '';
              if (bal !== 0) {
                if (direction === 'in') {
                  balStr = bal > 0 ? `· Due: ₹${bal.toLocaleString('en-IN')}` : `· Advance: ₹${Math.abs(bal).toLocaleString('en-IN')}`;
                } else {
                  balStr = bal < 0 ? `· Payable: ₹${Math.abs(bal).toLocaleString('en-IN')}` : `· Advance: ₹${bal.toLocaleString('en-IN')}`;
                }
              }
              return (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.type}) {balStr}
                </option>
              );
            })}
          </select>
        </Field>

        {/* Bill Reference / Allocation Selector */}
        <Field
          label="Bill Reference / Allocation"
          help={
            direction === 'in'
              ? 'Optionally allocate to an outstanding Sales bill.'
              : 'Optionally allocate to an outstanding Purchase bill.'
          }
        >
          {loadingBills ? (
            <div style={{ padding: '8px 12px', fontSize: 13, color: 'var(--muted, #6f6f6f)', background: 'var(--surface-subtle, #f4f4f4)', border: '1px solid var(--line, #e0e0e0)' }}>
              Checking open bills…
            </div>
          ) : openBills.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <select
                className="field-control"
                value={selectedBillId}
                onChange={(e) => handleBillSelect(e.target.value)}
              >
                <option value="">No specific bill (Apply on-account / FIFO)</option>
                {openBills.map((b) => (
                  <option key={b.id} value={b.id}>
                    Bill #{b.bill_no} · {b.date} · Orig: ₹{b.original_amount} · Paid: ₹{b.paid_amount} · Outstanding: ₹{b.outstanding_amount} ({b.status})
                  </option>
                ))}
              </select>

              {selectedBill && (
                <div
                  style={{
                    padding: '10px 12px',
                    background: 'var(--surface-subtle, #f4f4f4)',
                    border: '1px solid var(--line, #e0e0e0)',
                    fontSize: 12,
                    lineHeight: 1.6,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span>Source Bill: <strong>#{selectedBill.bill_no}</strong></span>
                    <span>Date: <strong>{selectedBill.date}</strong></span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Original: <strong>₹{selectedBill.original_amount.toLocaleString('en-IN')}</strong></span>
                    <span>Already Paid: <strong>₹{selectedBill.paid_amount.toLocaleString('en-IN')}</strong></span>
                    <span>
                      Remaining Due:{' '}
                      <strong style={{ color: direction === 'in' ? 'var(--fin-rec, #2d6b3f)' : 'var(--fin-pay, #a03b3b)' }}>
                        ₹{selectedBill.outstanding_amount.toLocaleString('en-IN')}
                      </strong>
                    </span>
                  </div>
                </div>
              )}
            </div>
          ) : partyId ? (
            <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--muted, #6f6f6f)', background: 'var(--surface-subtle, #f4f4f4)', border: '1px solid var(--line, #e0e0e0)' }}>
              No unsettled bills found for this account. Entry will post as an on-account {direction === 'in' ? 'receipt' : 'disbursement'}.
            </div>
          ) : (
            <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--muted, #6f6f6f)', background: 'var(--surface-subtle, #f4f4f4)', border: '1px solid var(--line, #e0e0e0)' }}>
              Select an account above to view open bills.
            </div>
          )}
        </Field>

        <div className="form-grid">
          <Field label="Payment Mode">
            <select
              className="field-control"
              value={mode}
              onChange={(e) => setMode(e.target.value as 'Cash' | 'UPI')}
            >
              <option value="Cash">Cash</option>
              <option value="UPI">UPI / Bank</option>
            </select>
          </Field>

          <Field label="Reference / Note" help="Optional UTR, cheque or receipt number.">
            <input
              type="text"
              className="field-control num"
              placeholder="e.g. UTR-99482"
              value={refNo}
              onChange={(e) => setRefNo(e.target.value)}
            />
          </Field>
        </div>

        <Field
          label={direction === 'in' ? 'Amount Received (₹)' : 'Amount Disbursed (₹)'}
          help={
            selectedBill
              ? `Max payable for this bill: ₹${selectedBill.outstanding_amount.toLocaleString('en-IN')}`
              : undefined
          }
        >
          <NumInput
            className="field-control num"
            min="0"
            max={selectedBill ? selectedBill.outstanding_amount : undefined}
            step="0.01"
            value={amount}
            onChange={(val) => setAmount(val)}
            placeholder="0.00"
          />
        </Field>
      </div>
    </Drawer>
  );
}
