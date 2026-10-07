import { useEffect, useState, useMemo } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { BrandLogo } from '@/components/Logo';
import { Btn, IconButton, SearchField, Segmented } from '@/components/ui';
import { IconHistory, IconGear, IconLayers, IconPlus, IconRefresh, IconArrowRight } from '@/components/icons';
import { platformApi } from './api';
import { NewShopModal } from './NewShopModal';
import { ShopDrawer } from './ShopDrawer';
import type { PlatformAuditRow, PlatformFleetResponse, PlatformShopRow, PlatformSystemInfo, Lifecycle } from './types';

type DevTab = 'fleet' | 'audit' | 'system';

export default function DevApp() {
  const { me } = useAuth();
  const navigate = useNavigate();

  // Defense-in-depth: Immediately redirect any retail user or unauthenticated visitor away
  if (!me) return <Navigate to="/login" replace />;
  const isRetailStaff = me.roles.includes('owner') || me.roles.includes('cashier') || me.roles.includes('stockkeeper') || Boolean(me.company);
  const isPlatformDev = (me as any).surface === 'dev' || (me as any).roles?.includes('developer');
  if (isRetailStaff || !isPlatformDev) {
    return <Navigate to="/" replace />;
  }

  const [activeTab, setActiveTab] = useState<DevTab>('fleet');
  const [fleet, setFleet] = useState<PlatformFleetResponse | null>(null);
  const [audit, setAudit] = useState<PlatformAuditRow[]>([]);
  const [system, setSystem] = useState<PlatformSystemInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters for fleet
  const [search, setSearch] = useState('');
  const [lifecycleFilter, setLifecycleFilter] = useState<'all' | Lifecycle>('all');

  // Modals & Drawers
  const [selectedShop, setSelectedShop] = useState<PlatformShopRow | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      if (activeTab === 'fleet') {
        const data = await platformApi.getFleet(search || undefined, lifecycleFilter === 'all' ? undefined : lifecycleFilter);
        setFleet(data);
      } else if (activeTab === 'audit') {
        const logs = await platformApi.getAudit(100);
        setAudit(logs);
      } else if (activeTab === 'system') {
        const sys = await platformApi.getSystem();
        setSystem(sys);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load platform data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [activeTab, lifecycleFilter]);

  const filteredShops = useMemo(() => {
    if (!fleet?.rows) return [];
    if (!search.trim()) return fleet.rows;
    const q = search.trim().toLowerCase();
    return fleet.rows.filter((s) =>
      s.name.toLowerCase().includes(q) ||
      s.code.toLowerCase().includes(q) ||
      s.owner_login.toLowerCase().includes(q) ||
      (s.phone && s.phone.includes(q))
    );
  }, [fleet, search]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--canvas)', color: 'var(--ink)' }}>
      {/* Top Header */}
      <header style={{
        height: 44,
        background: 'var(--layer)',
        borderBottom: '1px solid var(--line)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: 16,
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BrandLogo size={22} />
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.04em' }}>DEV CONSOLE</span>
          <span style={{ fontSize: 11, padding: '1px 6px', background: 'var(--blue, #0f62fe)', color: '#fff', borderRadius: 0 }}>PLATFORM</span>
        </div>

        {/* Tab Navigation */}
        <nav style={{ display: 'flex', gap: 4, marginLeft: 20 }}>
          <button
            onClick={() => setActiveTab('fleet')}
            className={`btn-sm ${activeTab === 'fleet' ? 'active' : ''}`}
            style={{
              height: 28,
              padding: '0 12px',
              border: 'none',
              background: activeTab === 'fleet' ? 'var(--layer-accent, #393939)' : 'transparent',
              color: activeTab === 'fleet' ? 'var(--ink)' : 'var(--ink-2)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
            }}
          >
            <IconLayers size={14} /> Fleet ({fleet?.total ?? '—'})
          </button>

          <button
            onClick={() => setActiveTab('audit')}
            className={`btn-sm ${activeTab === 'audit' ? 'active' : ''}`}
            style={{
              height: 28,
              padding: '0 12px',
              border: 'none',
              background: activeTab === 'audit' ? 'var(--layer-accent, #393939)' : 'transparent',
              color: activeTab === 'audit' ? 'var(--ink)' : 'var(--ink-2)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
            }}
          >
            <IconHistory size={14} /> Audit Trail
          </button>

          <button
            onClick={() => setActiveTab('system')}
            className={`btn-sm ${activeTab === 'system' ? 'active' : ''}`}
            style={{
              height: 28,
              padding: '0 12px',
              border: 'none',
              background: activeTab === 'system' ? 'var(--layer-accent, #393939)' : 'transparent',
              color: activeTab === 'system' ? 'var(--ink)' : 'var(--ink-2)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
            }}
          >
            <IconGear size={14} /> System Diagnostics
          </button>
        </nav>

        {/* Right side status */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>Operator: <strong>{me?.login || 'admin'}</strong></span>
          <Btn variant="secondary" size="sm" onClick={() => navigate('/')}>
            Back to Shop <IconArrowRight size={12} style={{ marginLeft: 4 }} />
          </Btn>
        </div>
      </header>

      {/* Main Content Area */}
      <main style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {error && (
          <div style={{ padding: '12px 16px', background: 'var(--red-light, rgba(218, 30, 40, 0.1))', color: 'var(--red, #da1e28)', border: '1px solid var(--red, #da1e28)', marginBottom: 16, fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* ---------------- FLEET TAB ---------------- */}
        {activeTab === 'fleet' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Toolbar */}
            <div className="panel-actions" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <SearchField
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onClear={() => setSearch('')}
                placeholder="Search shops by name, code, owner, mobile…"
              />

              <Segmented
                label="Lifecycle filter"
                value={lifecycleFilter}
                onChange={(val) => setLifecycleFilter(val as any)}
                options={[
                  { value: 'all', label: `All (${fleet?.total ?? 0})` },
                  { value: 'active', label: `Active (${fleet?.counts?.active ?? 0})` },
                  { value: 'trial', label: `Trial (${fleet?.counts?.trial ?? 0})` },
                  { value: 'expiring', label: `Expiring (${fleet?.counts?.expiring ?? 0})` },
                  { value: 'suspended', label: `Suspended (${fleet?.counts?.suspended ?? 0})` },
                ]}
              />

              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <IconButton label="Refresh fleet" icon={<IconRefresh size={16} />} onClick={loadData} />
                <Btn variant="primary" onClick={() => setShowNewModal(true)}>
                  <IconPlus size={14} style={{ marginRight: 6 }} /> Provision Shop
                </Btn>
              </div>
            </div>

            {/* Fleet Grid */}
            <div style={{ border: '1px solid var(--line)', background: 'var(--layer)', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--canvas)', borderBottom: '1px solid var(--line)' }}>
                    <th style={{ padding: '10px 14px', fontWeight: 600 }}>Shop Business</th>
                    <th style={{ padding: '10px 14px', fontWeight: 600 }}>Database Code</th>
                    <th style={{ padding: '10px 14px', fontWeight: 600 }}>Owner &amp; Phone</th>
                    <th style={{ padding: '10px 14px', fontWeight: 600 }}>Preset</th>
                    <th style={{ padding: '10px 14px', fontWeight: 600 }}>Plan / Status</th>
                    <th style={{ padding: '10px 14px', fontWeight: 600 }}>Expires On</th>
                    <th style={{ padding: '10px 14px', fontWeight: 600, textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && !filteredShops.length ? (
                    <tr>
                      <td colSpan={7} style={{ padding: 32, textAlign: 'center', color: 'var(--ink-2)' }}>Loading shop fleet…</td>
                    </tr>
                  ) : filteredShops.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ padding: 32, textAlign: 'center', color: 'var(--ink-2)' }}>No shops matching filter.</td>
                    </tr>
                  ) : (
                    filteredShops.map((shop) => (
                      <tr
                        key={shop.code}
                        style={{ borderBottom: '1px solid var(--line)', cursor: 'pointer' }}
                        onClick={() => setSelectedShop(shop)}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--layer-accent, rgba(255,255,255,0.03))')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        <td style={{ padding: '12px 14px', fontWeight: 600, color: 'var(--ink)' }}>{shop.name}</td>
                        <td style={{ padding: '12px 14px', fontFamily: 'monospace', fontSize: 12, color: 'var(--ink-2)' }}>{shop.code}</td>
                        <td style={{ padding: '12px 14px' }}>
                          <div>{shop.owner_name} ({shop.owner_login})</div>
                          {shop.phone && <div style={{ fontSize: 11, color: 'var(--ink-2)' }}>{shop.phone}</div>}
                        </td>
                        <td style={{ padding: '12px 14px', textTransform: 'capitalize' }}>{shop.preset.replace('_', ' ')}</td>
                        <td style={{ padding: '12px 14px' }}>
                          <span style={{
                            fontSize: 11,
                            padding: '2px 8px',
                            fontWeight: 600,
                            background: shop.status === 'suspended' ? 'var(--red-light, rgba(218,30,40,0.1))' :
                                        shop.lifecycle === 'trial' ? 'var(--blue-light, rgba(15,98,254,0.1))' :
                                        'var(--green-light, rgba(36,161,72,0.1))',
                            color: shop.status === 'suspended' ? 'var(--red, #da1e28)' :
                                   shop.lifecycle === 'trial' ? 'var(--blue, #0f62fe)' :
                                   'var(--green, #24a148)',
                          }}>
                            {shop.status === 'suspended' ? 'SUSPENDED' : shop.plan.toUpperCase()}
                          </span>
                        </td>
                        <td style={{ padding: '12px 14px', color: 'var(--ink-2)' }}>{shop.expires_on || 'Permanent'}</td>
                        <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                          <Btn size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); setSelectedShop(shop); }}>
                            Manage
                          </Btn>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ---------------- AUDIT TAB ---------------- */}
        {activeTab === 'audit' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Operator Audit Trail</h2>
                <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 2 }}>Append-only record of all tenant modifications.</div>
              </div>
              <IconButton label="Refresh audit" icon={<IconRefresh size={16} />} onClick={loadData} />
            </div>

            <div style={{ border: '1px solid var(--line)', background: 'var(--layer)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--canvas)', borderBottom: '1px solid var(--line)' }}>
                    <th style={{ padding: '10px 14px', fontWeight: 600 }}>Timestamp</th>
                    <th style={{ padding: '10px 14px', fontWeight: 600 }}>Actor</th>
                    <th style={{ padding: '10px 14px', fontWeight: 600 }}>Action</th>
                    <th style={{ padding: '10px 14px', fontWeight: 600 }}>Target Shop</th>
                    <th style={{ padding: '10px 14px', fontWeight: 600 }}>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && !audit.length ? (
                    <tr><td colSpan={5} style={{ padding: 32, textAlign: 'center', color: 'var(--ink-2)' }}>Loading audit trail…</td></tr>
                  ) : audit.length === 0 ? (
                    <tr><td colSpan={5} style={{ padding: 32, textAlign: 'center', color: 'var(--ink-2)' }}>No audit events logged yet.</td></tr>
                  ) : (
                    audit.map((row) => (
                      <tr key={row.id} style={{ borderBottom: '1px solid var(--line)' }}>
                        <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--ink-2)' }}>{new Date(row.at).toLocaleString()}</td>
                        <td style={{ padding: '10px 14px', fontWeight: 500 }}>{row.actor}</td>
                        <td style={{ padding: '10px 14px' }}>
                          <span style={{ fontSize: 11, padding: '2px 6px', background: 'var(--layer-accent)', fontFamily: 'monospace' }}>
                            {row.action}
                          </span>
                        </td>
                        <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: 12 }}>{row.shop_code || '—'}</td>
                        <td style={{ padding: '10px 14px', color: 'var(--ink-2)' }}>{row.detail}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ---------------- SYSTEM TAB ---------------- */}
        {activeTab === 'system' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 800 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Platform System Diagnostics</h2>
                <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 2 }}>Core engine metrics and database registry health.</div>
              </div>
              <IconButton label="Refresh diagnostics" icon={<IconRefresh size={16} />} onClick={loadData} />
            </div>

            {system && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div style={{ padding: 16, background: 'var(--layer)', border: '1px solid var(--line)' }}>
                  <div style={{ fontSize: 11, color: 'var(--ink-2)', textTransform: 'uppercase' }}>Engine &amp; Core Version</div>
                  <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{system.engine}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 2 }}>Module: {system.platform_module || 'Active'}</div>
                </div>

                <div style={{ padding: 16, background: 'var(--layer)', border: '1px solid var(--line)' }}>
                  <div style={{ fontSize: 11, color: 'var(--ink-2)', textTransform: 'uppercase' }}>Database Multi-Tenancy</div>
                  <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{system.shop_databases} Active Shop DBs</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 2 }}>Registered: {system.registered_shops} shops</div>
                </div>

                <div style={{ padding: 16, background: 'var(--layer)', border: '1px solid var(--line)' }}>
                  <div style={{ fontSize: 11, color: 'var(--ink-2)', textTransform: 'uppercase' }}>Platform Database</div>
                  <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4, fontFamily: 'monospace' }}>{system.platform_db}</div>
                </div>

                <div style={{ padding: 16, background: 'var(--layer)', border: '1px solid var(--line)' }}>
                  <div style={{ fontSize: 11, color: 'var(--ink-2)', textTransform: 'uppercase' }}>Server Clock (UTC)</div>
                  <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4, fontFamily: 'monospace' }}>{system.server_time}</div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Modals & Drawers */}
      <NewShopModal
        open={showNewModal}
        onClose={() => setShowNewModal(false)}
        onCreated={() => {
          void loadData();
        }}
      />

      <ShopDrawer
        shop={selectedShop}
        onClose={() => setSelectedShop(null)}
        onUpdated={() => {
          void loadData();
        }}
      />
    </div>
  );
}
