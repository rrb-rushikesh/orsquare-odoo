import { useState } from 'react'
import type { DiscountScheme } from '@/types'
import * as repo from '@/lib/repo'
import { Btn, Drawer, Field, Tag, ConfirmDialog, useToast } from '@/components/ui'
import { IconPlus, IconTrash, IconEdit, IconCheck } from '@/components/icons'

interface DiscountSchemeManagerProps {
  open: boolean
  shopId: string
  schemes: DiscountScheme[]
  onClose: () => void
  onSchemesChange: () => void
}

export function DiscountSchemeManager({
  open,
  shopId,
  schemes,
  onClose,
  onSchemesChange,
}: DiscountSchemeManagerProps) {
  const toast = useToast()
  const [showAdd, setShowAdd] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Form state
  const [code, setCode] = useState('')
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<'percentage' | 'flat'>('percentage')
  const [value, setValue] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<DiscountScheme | null>(null)
  const [deleting, setDeleting] = useState(false)

  const activeSchemes = schemes.filter((s) => s.code !== '')

  function resetForm() {
    setCode('')
    setLabel('')
    setKind('percentage')
    setValue('')
    setEditingId(null)
    setShowAdd(false)
  }

  function startEdit(s: DiscountScheme) {
    setEditingId(s.id)
    setCode(s.code)
    setLabel(s.label)
    setKind(s.kind)
    setValue(String(s.value))
    setShowAdd(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    const cleanCode = code.trim().toUpperCase()
    const numVal = parseFloat(value)

    if (!cleanCode) {
      toast('Coupon code is required', 'err')
      return
    }
    if (isNaN(numVal) || numVal <= 0) {
      toast('Discount value must be greater than 0', 'err')
      return
    }
    if (kind === 'percentage' && numVal > 100) {
      toast('Percentage discount cannot exceed 100%', 'err')
      return
    }

    const cleanLabel = label.trim() || (kind === 'percentage' ? `${cleanCode} · ${numVal}% off` : `${cleanCode} · ₹${numVal} off`)

    setSubmitting(true)
    try {
      if (editingId) {
        await repo.updateDiscountScheme(shopId, editingId, {
          label: cleanLabel,
          kind,
          value: numVal,
        })
        toast(`Discount scheme '${cleanCode}' updated`, 'ok')
      } else {
        await repo.createDiscountScheme(shopId, {
          code: cleanCode,
          label: cleanLabel,
          kind,
          value: numVal,
        })
        toast(`Discount scheme '${cleanCode}' created`, 'ok')
      }
      resetForm()
      onSchemesChange()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to save discount scheme', 'err')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await repo.deleteDiscountScheme(shopId, deleteTarget.id)
      toast(`Discount scheme '${deleteTarget.code}' removed`, 'ok')
      setDeleteTarget(null)
      onSchemesChange()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to delete discount scheme', 'err')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <Drawer
        open={open}
        onClose={() => {
          resetForm()
          onClose()
        }}
        title="Discount Schemes"
      >
        <p className="t-caption" style={{ margin: '0 0 16px', color: 'var(--muted)' }}>
          Create and manage custom percentages, coupons, and flat discounts.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {!showAdd && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Btn
                variant="primary"
                sm
                onClick={() => {
                  resetForm()
                  setShowAdd(true)
                }}
              >
                <IconPlus size={14} style={{ marginRight: 6 }} />
                Add Discount Scheme
              </Btn>
            </div>
          )}

          {showAdd && (
            <form
              onSubmit={handleSave}
              style={{
                border: '1px solid var(--line)',
                padding: 16,
                background: 'var(--surface-1)',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>
                  {editingId ? 'Edit Discount Scheme' : 'New Discount Scheme'}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={resetForm}
                  style={{ padding: '2px 6px', fontSize: 12 }}
                >
                  Cancel
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="Code (e.g. SAVE20)">
                  <input
                    type="text"
                    className="field-control"
                    placeholder="VIP15"
                    value={code}
                    disabled={!!editingId}
                    onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))}
                    required
                    style={{ textTransform: 'uppercase', fontFamily: 'monospace' }}
                  />
                </Field>

                <Field label="Type">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', border: '1px solid var(--line)' }}>
                    <button
                      type="button"
                      className={`btn btn-ghost btn-sm ${kind === 'percentage' ? 'active' : ''}`}
                      style={{
                        borderRadius: 0,
                        border: 0,
                        background: kind === 'percentage' ? 'var(--blue)' : 'transparent',
                        color: kind === 'percentage' ? '#fff' : 'var(--ink)',
                        fontWeight: kind === 'percentage' ? 600 : 400,
                      }}
                      onClick={() => setKind('percentage')}
                    >
                      % Percent
                    </button>
                    <button
                      type="button"
                      className={`btn btn-ghost btn-sm ${kind === 'flat' ? 'active' : ''}`}
                      style={{
                        borderRadius: 0,
                        border: 0,
                        borderLeft: '1px solid var(--line)',
                        background: kind === 'flat' ? 'var(--blue)' : 'transparent',
                        color: kind === 'flat' ? '#fff' : 'var(--ink)',
                        fontWeight: kind === 'flat' ? 600 : 400,
                      }}
                      onClick={() => setKind('flat')}
                    >
                      ₹ Flat
                    </button>
                  </div>
                </Field>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10 }}>
                <Field label={kind === 'percentage' ? 'Discount %' : 'Discount ₹'}>
                  <input
                    type="number"
                    step="any"
                    min="0.01"
                    max={kind === 'percentage' ? '100' : undefined}
                    className="field-control num"
                    placeholder={kind === 'percentage' ? '15' : '50'}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    required
                  />
                </Field>

                <Field label="Label / Description (Optional)">
                  <input
                    type="text"
                    className="field-control"
                    placeholder={kind === 'percentage' ? 'e.g. VIP Customer · 15% off' : 'e.g. Flat ₹50 off'}
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                  />
                </Field>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <Btn variant="tertiary" sm type="button" onClick={resetForm}>
                  Cancel
                </Btn>
                <Btn variant="primary" sm type="submit" disabled={submitting}>
                  <IconCheck size={14} style={{ marginRight: 6 }} />
                  {submitting ? 'Saving…' : editingId ? 'Update Scheme' : 'Create Scheme'}
                </Btn>
              </div>
            </form>
          )}

          <div>
            <div className="micro-label" style={{ marginBottom: 8 }}>Active Schemes ({activeSchemes.length})</div>
            {activeSchemes.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', border: '1px dashed var(--line)' }}>
                No active discount schemes yet. Click "Add Discount Scheme" to create one.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {activeSchemes.map((s) => (
                  <div
                    key={s.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 12px',
                      border: '1px solid var(--line)',
                      background: 'var(--canvas)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Tag kind={s.kind === 'percentage' ? 'blue' : 'green'}>
                        <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{s.code}</span>
                      </Tag>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{s.label}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                          {s.kind === 'percentage' ? `${s.value}% off subtotal` : `₹${s.value} flat discount`}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Btn
                        variant="ghost"
                        className="btn-icon"
                        aria-label={`Edit ${s.code}`}
                        title="Edit scheme"
                        onClick={() => startEdit(s)}
                      >
                        <IconEdit size={14} />
                      </Btn>
                      <Btn
                        variant="ghost"
                        className="btn-icon del"
                        aria-label={`Delete ${s.code}`}
                        title="Delete scheme"
                        onClick={() => setDeleteTarget(s)}
                      >
                        <IconTrash size={14} />
                      </Btn>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Drawer>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Discount Scheme"
        message={deleteTarget ? `Are you sure you want to remove the '${deleteTarget.code}' discount scheme?` : ''}
        confirmLabel="Delete Scheme"
        busy={deleting}
        onConfirm={handleDeleteConfirm}
        onClose={() => setDeleteTarget(null)}
      />
    </>
  )
}
