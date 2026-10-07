import React, { useState } from 'react'
import { Modal, Btn } from '@/components/ui'
import { IconFlame, IconSortAlpha, IconPin, IconPinFilled, IconGripVertical, IconX } from '@/components/icons'
import type { SortMode } from '@/lib/pinnedSorting'

export interface CompactSortHeaderProps {
  label: string
  sortMode: SortMode
  onToggleSort: () => void
  pinnedCount: number
  onOpenPinModal: () => void
  disabled?: boolean
}

/**
 * Super-compact sorting and pin management control embedded directly inside the table header.
 *
 * Visual hierarchy:
 * [ LABEL ] [ (Flame / A↕) button ] [ Pin button with count badge ]
 */
export function CompactSortHeader({
  label,
  sortMode,
  onToggleSort,
  pinnedCount,
  onOpenPinModal,
  disabled = false,
}: CompactSortHeaderProps) {
  return (
    <div className="rg-sort-header-wrap" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, userSelect: 'none' }}>
      <span className="rg-header-label" style={{ fontWeight: 600 }}>{label}</span>
      <div className="rg-sort-actions" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
        <button
          type="button"
          className={`rg-sort-btn ${sortMode === 'most-sold' ? 'active-sold' : 'active-alpha'}`}
          onClick={(e) => {
            e.stopPropagation()
            onToggleSort()
          }}
          disabled={disabled}
          title={sortMode === 'most-sold' ? 'Sorted by Most Sold (Click for A–Z)' : 'Sorted Alphabetically A–Z (Click for Most Sold)'}
          aria-label={sortMode === 'most-sold' ? 'Sort mode: Most Sold. Click to switch to Alphabetical' : 'Sort mode: Alphabetical. Click to switch to Most Sold'}
        >
          {sortMode === 'most-sold' ? (
            <>
              <IconFlame size={13} />
              <span className="rg-sort-indicator">HOT</span>
            </>
          ) : (
            <>
              <IconSortAlpha size={13} />
              <span className="rg-sort-indicator">A–Z</span>
            </>
          )}
        </button>

        <button
          type="button"
          className={`rg-pin-mgr-btn ${pinnedCount > 0 ? 'has-pins' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            onOpenPinModal()
          }}
          title={pinnedCount > 0 ? `Manage ${pinnedCount} pinned items` : 'Manage pinned items'}
          aria-label={pinnedCount > 0 ? `Manage ${pinnedCount} pinned items` : 'Manage pinned items'}
        >
          {pinnedCount > 0 ? <IconPinFilled size={13} /> : <IconPin size={13} />}
          {pinnedCount > 0 && <span className="rg-pin-count">{pinnedCount}</span>}
        </button>
      </div>
    </div>
  )
}

export interface PinnedItemInfo {
  key: string
  label: string
  sublabel?: string
  soldText?: string
}

export interface PinManagementModalProps {
  open: boolean
  onClose: () => void
  title?: string
  pinnedKeys: string[]
  allItems: PinnedItemInfo[]
  onMovePinned: (fromIndex: number, toIndex: number) => void
  onUnpin: (key: string) => void
  onPin: (key: string) => void
}

/**
 * Lightweight modal dialog to manage pinned items and drag-and-drop or stepper reordering.
 */
export function PinManagementModal({
  open,
  onClose,
  title = 'Pinned Items Priority',
  pinnedKeys,
  allItems,
  onMovePinned,
  onUnpin,
  onPin,
}: PinManagementModalProps) {
  const [search, setSearch] = useState('')
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const itemsMap = React.useMemo(() => {
    const map = new Map<string, PinnedItemInfo>()
    for (const it of allItems) {
      map.set(it.key, it)
    }
    return map
  }, [allItems])

  const pinnedItems = React.useMemo(() => {
    return pinnedKeys.map((k) => itemsMap.get(k) || { key: k, label: k })
  }, [pinnedKeys, itemsMap])

  const availableToAdd = React.useMemo(() => {
    const pinnedSet = new Set(pinnedKeys)
    let list = allItems.filter((it) => !pinnedSet.has(it.key))
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter((it) =>
        it.label.toLowerCase().includes(q) || (it.sublabel && it.sublabel.toLowerCase().includes(q))
      )
    }
    return list.slice(0, 50)
  }, [allItems, pinnedKeys, search])

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverIndex !== index) {
      setDragOverIndex(index)
    }
  }

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault()
    if (draggedIndex !== null && draggedIndex !== dropIndex) {
      onMovePinned(draggedIndex, dropIndex)
    }
    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      ariaLabel={title}
      width={480}
      footer={
        <Btn variant="primary" onClick={onClose} style={{ height: 34, fontSize: 13 }}>
          Done
        </Btn>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.4 }}>
          Pinned items permanently stay at the top of the table. Drag rows or use arrows to define exact priority.
        </div>

        {/* Pinned list */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--ink)', marginBottom: 6 }}>
            Pinned Priority ({pinnedItems.length})
          </div>

          {pinnedItems.length === 0 ? (
            <div style={{ padding: '14px', border: '1px dashed var(--line)', background: 'var(--layer)', textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}>
              No items pinned yet. Pin frequently accessed items below.
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                border: '1px solid var(--line)',
                background: 'var(--canvas)',
                maxHeight: 260,
                overflowY: 'auto',
              }}
            >
              {pinnedItems.map((item, idx) => {
                const isDragging = draggedIndex === idx
                const isOver = dragOverIndex === idx

                return (
                  <div
                    key={item.key}
                    draggable
                    onDragStart={(e) => handleDragStart(e, idx)}
                    onDragOver={(e) => handleDragOver(e, idx)}
                    onDrop={(e) => handleDrop(e, idx)}
                    onDragEnd={handleDragEnd}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '7px 10px',
                      borderBottom: idx < pinnedItems.length - 1 ? '1px solid var(--line)' : 'none',
                      background: isDragging ? 'var(--layer-hover)' : isOver ? 'var(--layer-accent)' : 'var(--canvas)',
                      cursor: 'grab',
                      transition: 'background-color 0.1s ease',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                      <span style={{ color: 'var(--subtle)', display: 'inline-flex', cursor: 'grab' }} title="Drag to reorder">
                        <IconGripVertical size={13} />
                      </span>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 20,
                          height: 20,
                          fontSize: 11,
                          fontWeight: 700,
                          fontFamily: 'var(--font-mono)',
                          background: 'var(--layer)',
                          border: '1px solid var(--line)',
                          color: 'var(--ink)',
                          flexShrink: 0,
                        }}
                      >
                        {idx + 1}
                      </span>
                      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
                        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {item.label}
                        </span>
                        {item.sublabel && (
                          <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {item.sublabel}
                          </span>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      {item.soldText && (
                        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--muted)', marginRight: 4 }}>
                          {item.soldText}
                        </span>
                      )}
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => onMovePinned(idx, idx - 1)}
                        style={{
                          width: 24,
                          height: 24,
                          border: '1px solid var(--line)',
                          background: 'var(--canvas)',
                          cursor: idx === 0 ? 'not-allowed' : 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 11,
                          color: idx === 0 ? 'var(--disabled)' : 'var(--ink)',
                        }}
                        title="Move Up"
                        aria-label="Move Up"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        disabled={idx === pinnedItems.length - 1}
                        onClick={() => onMovePinned(idx, idx + 1)}
                        style={{
                          width: 24,
                          height: 24,
                          border: '1px solid var(--line)',
                          background: 'var(--canvas)',
                          cursor: idx === pinnedItems.length - 1 ? 'not-allowed' : 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 11,
                          color: idx === pinnedItems.length - 1 ? 'var(--disabled)' : 'var(--ink)',
                        }}
                        title="Move Down"
                        aria-label="Move Down"
                      >
                        ▼
                      </button>
                      <button
                        type="button"
                        onClick={() => onUnpin(item.key)}
                        style={{
                          width: 24,
                          height: 24,
                          border: '1px solid var(--line)',
                          background: 'var(--canvas)',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--err)',
                          marginLeft: 4,
                        }}
                        title="Unpin item"
                        aria-label="Unpin item"
                      >
                        <IconX size={12} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Pin more items */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--ink)' }}>
              Pin More Items
            </span>
          </div>
          <input
            className="field-control"
            placeholder="Search item to pin…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%', height: 32, fontSize: 12, marginBottom: 6 }}
          />

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              border: '1px solid var(--line)',
              background: 'var(--canvas)',
              maxHeight: 180,
              overflowY: 'auto',
            }}
          >
            {availableToAdd.length === 0 ? (
              <div style={{ padding: '12px', textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}>
                {search ? 'No matching items.' : 'All items are already pinned.'}
              </div>
            ) : (
              availableToAdd.map((it, idx) => (
                <div
                  key={it.key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 10px',
                    borderBottom: idx < availableToAdd.length - 1 ? '1px solid var(--line)' : 'none',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {it.label}
                    </span>
                    {it.sublabel && (
                      <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {it.sublabel}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    {it.soldText && (
                      <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
                        {it.soldText}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => onPin(it.key)}
                      style={{
                        padding: '3px 8px',
                        border: '1px solid var(--line)',
                        background: 'var(--layer)',
                        cursor: 'pointer',
                        fontSize: 11,
                        fontWeight: 600,
                        color: 'var(--ink)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                      title={`Pin ${it.label}`}
                    >
                      <IconPin size={11} /> Pin
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}
