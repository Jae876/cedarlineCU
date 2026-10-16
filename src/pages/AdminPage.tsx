import { useEffect, useState, type FormEvent } from 'react'
import { AlertCircle, LogOut, Plus, Save, Trash2, X } from 'lucide-react'
import { apiRequest, clearSession, persistSession } from '@services/apiClient'
import type { AdminStats } from '../types'

interface AdminUser {
  id: number
  email: string
  firstName: string
  lastName: string
  accountType: string
  status: string
  balance: number
  buyingPower: number
  transactionCount: number
  accountNumber: string
  routingNumber: string
  createdAt: string
}
interface AdminLogin { token: string; admin: { id: number; username: string; role: string } }
interface UsersResponse { users: AdminUser[] }
interface RequestItem { id: number; transactionId: string; operation: string; amount: string; email: string; fullName: string; accountNumber: string; bankName: string; accountNumberLast4: string; routingNumber: string; status: string; settled: boolean; createdAt: string }
interface AuditEvent { id: number; actor_username: string; action: string; target_user_id: number | null; details: Record<string, unknown>; created_at: string }
type PaymentMethod = 'ACH' | 'WIRE' | 'INTERNAL'
type PaymentSettings = Record<PaymentMethod, { accountNumber: string; routingNumber: string; notes: string }>

const emptyPaymentSettings: PaymentSettings = {
  ACH: { accountNumber: '', routingNumber: '', notes: '' },
  WIRE: { accountNumber: '', routingNumber: '', notes: '' },
  INTERNAL: { accountNumber: '', routingNumber: '', notes: '' },
}

const currency = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState(false)
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [dataLoading, setDataLoading] = useState(false)
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [requests, setRequests] = useState<RequestItem[]>([])
  const [audit, setAudit] = useState<AuditEvent[]>([])
  const [paymentSettings, setPaymentSettings] = useState<PaymentSettings>(emptyPaymentSettings)
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<AdminUser | null>(null)
  const [search, setSearch] = useState('')
  const [createForm, setCreateForm] = useState({ email: '', firstName: '', lastName: '', password: '', balance: '50000', accountType: 'individual', accountNumber: '', routingNumber: '', createdAt: new Date().toISOString().slice(0, 10) })
  const [editForm, setEditForm] = useState({ firstName: '', lastName: '', accountType: 'individual', balance: '0', accountNumber: '', routingNumber: '' })

  const loadData = async () => {
    setDataLoading(true)
    try {
      const [statsData, usersData, requestData, auditData, paymentData] = await Promise.all([
        apiRequest<{ stats: AdminStats }>('/api/admin/stats'),
        apiRequest<UsersResponse>('/api/admin/users'),
        apiRequest<RequestItem[]>('/api/admin/requests'),
        apiRequest<{ events: AuditEvent[] }>('/api/admin/audit'),
        apiRequest<PaymentSettings>('/api/admin/payment-settings'),
      ])
      setStats(statsData.stats)
      setUsers(usersData.users || [])
      setRequests(requestData || [])
      setAudit(auditData.events || [])
      setPaymentSettings({ ...emptyPaymentSettings, ...paymentData })
    } finally {
      setDataLoading(false)
    }
  }

  useEffect(() => {
    const token = localStorage.getItem('adminToken')
    const authTime = Number(localStorage.getItem('adminAuthTime') || 0)
    if (token && Date.now() - authTime < 8 * 60 * 60 * 1000) {
      apiRequest('/api/admin/session')
        .then(() => {
          setAuthenticated(true)
          return loadData()
        })
        .catch((reason) => {
          clearSession(true)
          setAuthenticated(false)
          setError(reason instanceof Error ? reason.message : 'Admin session expired. Sign in again.')
        })
    } else {
      clearSession(true)
    }
  }, [])

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoginError('')
    setLoading(true)
    try {
      const result = await apiRequest<AdminLogin>('/api/auth/admin-login', { method: 'POST', sessionScope: 'none', body: JSON.stringify({ password }) })
      persistSession(result.token, result.admin, true)
      setAuthenticated(true)
      setPassword('')
      await loadData()
    } catch (reason) {
      setLoginError(reason instanceof Error ? reason.message : 'Invalid admin credentials.')
      setPassword('')
    } finally {
      setLoading(false)
    }
  }

  const handleCreateUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!window.confirm(`Create ${createForm.accountType} account for ${createForm.email}?`)) return
    setError('')
    setNotice('')
    try {
      const result = await apiRequest<{ user: AdminUser }>('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ ...createForm, openingBalance: createForm.balance }),
      })
      setNotice(`Account created for ${createForm.email}.`)
      setCreateForm({ email: '', firstName: '', lastName: '', password: '', balance: '50000', accountType: 'individual', accountNumber: '', routingNumber: '', createdAt: new Date().toISOString().slice(0, 10) })
      setShowCreate(false)
      await loadData()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to create account.')
    }
  }

  const startEdit = (user: AdminUser) => {
    setEditing(user)
    setEditForm({ firstName: user.firstName, lastName: user.lastName, accountType: user.accountType, balance: user.balance.toFixed(2), accountNumber: user.accountNumber, routingNumber: user.routingNumber })
  }

  const saveEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editing) return
    if (!window.confirm(`Save account changes for ${editing.email}?`)) return
    try {
      await apiRequest('/api/admin/users', {
        method: 'PUT',
        body: JSON.stringify({ userId: editing.id, ...editForm }),
      })
      setEditing(null)
      setNotice(`Updated ${editing.email}.`)
      await loadData()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update account.')
    }
  }

  const deleteUser = async (id: number) => {
    if (!window.confirm('Delete this member account and its history?')) return
    try {
      await apiRequest('/api/admin/users', { method: 'DELETE', body: JSON.stringify({ userId: id }) })
      setNotice('User deleted.')
      await loadData()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to delete user.')
    }
  }

  const addFunds = async (user: AdminUser) => {
    const amount = window.prompt(`Balance adjustment for ${user.email} (USD)`)
    if (!amount) return
    if (!window.confirm(`Add a ${currency(Number(amount))} balance adjustment to ${user.email}?`)) return
    try {
      await apiRequest('/api/admin/users', { method: 'PUT', body: JSON.stringify({ userId: user.id, operation: 'admin_transfer', amount }) })
      setNotice('Balance adjustment recorded in the transaction ledger.')
      await loadData()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to record the adjustment.')
    }
  }

  const reviewRequest = async (id: number, decision: 'approve' | 'reject') => {
    if (!window.confirm(`${decision === 'approve' ? 'Approve' : 'Reject'} this request? No external transfer will occur.`)) return
    try {
      await apiRequest(`/api/admin/requests/${id}`, { method: 'PATCH', body: JSON.stringify({ decision }) })
      setNotice(decision === 'approve' ? 'Request approved. No external transfer was made.' : 'Request rejected. No external transfer was made.')
      await loadData()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to review request.')
    }
  }

  const savePaymentSetting = async (method: PaymentMethod) => {
    if (!window.confirm(`Save ${method} deposit instructions?`)) return
    try {
      await apiRequest('/api/admin/payment-settings', { method: 'PUT', body: JSON.stringify({ paymentMethod: method, ...paymentSettings[method] }) })
      setNotice(`${method} instructions saved.`)
      await loadData()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save deposit instructions.')
    }
  }

  const logout = async () => {
    try { await apiRequest('/api/admin/logout', { method: 'POST' }) } catch { /* local state is cleared below */ }
    clearSession(true)
    setAuthenticated(false)
  }

  if (!authenticated) {
    return <main className="page-main"><section className="panel app-auth-panel"><p className="eyebrow">Secure administration</p><h1 className="page-title">Admin sign in</h1>
      {loginError && <p className="form-error" role="alert"><AlertCircle size={16} /> {loginError}</p>}
      <form className="stack-form app-form" onSubmit={handleLogin}><label>Master password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label><button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button></form>
    </section></main>
  }

  const filteredUsers = users.filter((user) => `${user.email} ${user.firstName} ${user.lastName} ${user.accountNumber}`.toLowerCase().includes(search.toLowerCase()))

  return (
    <main className="page-main app-admin">
      <div className="page-heading-row banking-heading"><div><p className="eyebrow">Administration</p><h1 className="page-title">Account operations</h1><p>Manage members, balances, and requests.</p></div><button className="btn btn-secondary" onClick={logout}><LogOut size={16} /> Sign out</button></div>
      {error && <p className="form-error" role="alert">{error}<button className="icon-button" onClick={() => setError('')} aria-label="Dismiss error"><X size={16} /></button></p>}
      {notice && <p className="form-success" role="status">{notice}<button className="icon-button" onClick={() => setNotice('')} aria-label="Dismiss message"><X size={16} /></button></p>}
      <div className="content-grid admin-stats">
        <article className="content-item"><span>Total users</span><strong>{stats?.totalUsers ?? 0}</strong></article>
        <article className="content-item"><span>Active users</span><strong>{stats?.activeUsers ?? 0}</strong></article>
        <article className="content-item"><span>Total accounts</span><strong>{stats?.totalAccounts ?? 0}</strong></article>
        <article className="content-item"><span>Total balance</span><strong>{currency(Number(stats?.totalBalance || 0))}</strong></article>
        <article className="content-item"><span>Pending requests</span><strong>{stats?.pendingRequests ?? 0}</strong></article>
      </div>
      <section className="panel app-panel">
        <div className="panel-header align-between"><div><span className="section-overline">MEMBER DIRECTORY</span><h2>Accounts</h2></div><div className="app-actions"><input className="search-field" type="search" placeholder="Search members" value={search} onChange={(event) => setSearch(event.target.value)} /><button className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}><Plus size={16} /> Create account</button></div></div>
        {showCreate && <form className="app-form create-user-form" onSubmit={handleCreateUser}><div className="app-grid"><label>Email<input type="email" value={createForm.email} onChange={(event) => setCreateForm({ ...createForm, email: event.target.value })} required /></label><label>Temporary password<input type="password" value={createForm.password} onChange={(event) => setCreateForm({ ...createForm, password: event.target.value })} minLength={8} required /></label><label>First name<input value={createForm.firstName} onChange={(event) => setCreateForm({ ...createForm, firstName: event.target.value })} required /></label><label>Last name<input value={createForm.lastName} onChange={(event) => setCreateForm({ ...createForm, lastName: event.target.value })} required /></label><label>Account type<select value={createForm.accountType} onChange={(event) => setCreateForm({ ...createForm, accountType: event.target.value })}><option value="individual">Individual checking</option><option value="business">Business checking</option><option value="joint">Joint checking</option></select></label><label>Opening balance<input type="number" min="0" step="0.01" value={createForm.balance} onChange={(event) => setCreateForm({ ...createForm, balance: event.target.value })} required /></label><label>Account open date<input type="date" max={new Date().toISOString().slice(0, 10)} value={createForm.createdAt} onChange={(event) => setCreateForm({ ...createForm, createdAt: event.target.value })} required /></label><label>Account number (optional)<input inputMode="numeric" value={createForm.accountNumber} onChange={(event) => setCreateForm({ ...createForm, accountNumber: event.target.value.replace(/\D/g, '').slice(0, 17) })} placeholder="Generated if blank" /></label><label>Routing number (optional)<input inputMode="numeric" value={createForm.routingNumber} onChange={(event) => setCreateForm({ ...createForm, routingNumber: event.target.value.replace(/\D/g, '').slice(0, 9) })} placeholder="Generated if blank" /></label></div><p className="fictional-notice">Account and routing values are fictional and are not valid for real banking.</p><div className="app-actions"><button type="submit" className="btn btn-primary">Create fictional account</button><button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button></div></form>}
        {dataLoading ? <p className="table-empty" role="status">Loading member accounts…</p> : users.length === 0 ? <p className="table-empty">No member accounts yet.</p> : filteredUsers.length === 0 ? <p className="table-empty">No accounts match this search.</p> : <div className="table-wrap"><table className="app-table"><thead><tr><th>Email</th><th>Name</th><th>Account type</th><th>Opened</th><th>Balance</th><th>Transaction count</th><th>Account / routing details</th><th>Actions</th></tr></thead><tbody>{filteredUsers.map((user) => <tr key={user.id}><td>{user.email}</td><td>{user.firstName} {user.lastName}</td><td>{user.accountType === 'joint' ? 'Joint checking' : user.accountType === 'business' ? 'Business checking' : 'Personal checking'}</td><td>{new Date(user.createdAt).toLocaleDateString(undefined, { timeZone: 'UTC' })}</td><td>{currency(user.balance)}</td><td>{user.transactionCount}</td><td><span className="bank-number">{user.accountNumber}</span><small className="transaction-id">{user.routingNumber}</small></td><td><div className="row-actions"><button className="btn btn-secondary btn-small" onClick={() => startEdit(user)}>View / edit</button><button className="btn btn-secondary btn-small" onClick={() => addFunds(user)}>Add funds</button><button className="btn btn-danger btn-small" onClick={() => void deleteUser(user.id)}><Trash2 size={14} /> Delete</button></div></td></tr>)}</tbody></table></div>}
      </section>
      {editing && <section className="panel app-panel"><div className="panel-header align-between"><div><span className="section-overline">FICTIONAL MEMBER RECORD</span><h2>Edit {editing.email}</h2></div><button className="icon-button" onClick={() => setEditing(null)} aria-label="Close editor"><X /></button></div><form className="app-form" onSubmit={saveEdit}><div className="app-grid"><label>First name<input value={editForm.firstName} onChange={(event) => setEditForm({ ...editForm, firstName: event.target.value })} /></label><label>Last name<input value={editForm.lastName} onChange={(event) => setEditForm({ ...editForm, lastName: event.target.value })} /></label><label>Account type<select value={editForm.accountType} onChange={(event) => setEditForm({ ...editForm, accountType: event.target.value })}><option value="individual">Individual checking</option><option value="business">Business checking</option><option value="joint">Joint checking</option></select></label><label>Set balance<input type="number" min="0" step="0.01" value={editForm.balance} onChange={(event) => setEditForm({ ...editForm, balance: event.target.value })} /></label><label>Account number<input inputMode="numeric" value={editForm.accountNumber} onChange={(event) => setEditForm({ ...editForm, accountNumber: event.target.value.replace(/\D/g, '').slice(0, 17) })} /></label><label>Routing number<input inputMode="numeric" value={editForm.routingNumber} onChange={(event) => setEditForm({ ...editForm, routingNumber: event.target.value.replace(/\D/g, '').slice(0, 9) })} /></label></div><p className="fictional-notice">Changes are fictional and will be recorded in the admin audit history.</p><button className="btn btn-primary" type="submit"><Save size={15} /> Save changes</button></form></section>}
      <section className="panel app-panel"><div className="panel-header"><div><span className="section-overline">SIMULATED ACTIVITY</span><h2>Transaction requests</h2></div></div><div className="table-wrap"><table className="app-table"><thead><tr><th>Member</th><th>Request</th><th>Amount</th><th>Fictional destination</th><th>Transaction ID</th><th>Submitted</th><th>Review status</th></tr></thead><tbody>{requests.map((request) => <tr key={request.id}><td>{request.fullName}<small className="transaction-id">{request.email}</small></td><td className="capitalize">{request.operation}</td><td>{currency(Number(request.amount))}</td><td>{request.bankName}<small className="transaction-id">Account ···· {request.accountNumberLast4} / routing {request.routingNumber}</small></td><td className="transaction-id">{request.transactionId}</td><td>{new Date(request.createdAt).toLocaleString()}</td><td>{request.status === 'pending' ? <div className="row-actions"><button className="btn btn-primary btn-small" onClick={() => reviewRequest(request.id, 'approve')}>Approve for review</button><button className="btn btn-secondary btn-small" onClick={() => reviewRequest(request.id, 'reject')}>Reject</button></div> : <span className={`status-${request.status}`}>{request.settled ? 'completed · demo' : request.status === 'approved' ? 'approved · not settled' : request.status}</span>}</td></tr>)}</tbody></table>{!requests.length && <p>No fictional requests yet.</p>}</div></section>
      <section className="panel app-panel"><div className="panel-header"><div><span className="section-overline">ADMIN CONTROLS</span><h2>Audit history</h2></div></div><div className="table-wrap"><table className="app-table"><thead><tr><th>Date</th><th>Administrator</th><th>Action</th><th>Member ID</th><th>Recorded details</th></tr></thead><tbody>{audit.map((event) => <tr key={event.id}><td>{new Date(event.created_at).toLocaleString()}</td><td>{event.actor_username}</td><td>{event.action.split('_').join(' ')}</td><td>{event.target_user_id ?? '—'}</td><td>{JSON.stringify(event.details)}</td></tr>)}</tbody></table>{!audit.length && <p>No admin changes recorded.</p>}</div></section>
      <section className="panel app-panel"><div className="panel-header"><div><span className="section-overline">FICTIONAL DESTINATIONS</span><h2>Add Funds instructions</h2></div></div><p className="fictional-notice">These demo values are shown to members but cannot receive real transfers.</p><div className="payment-settings-grid">{(['ACH', 'WIRE', 'INTERNAL'] as PaymentMethod[]).map((method) => <form className="app-form payment-settings-item" key={method} onSubmit={(event) => { event.preventDefault(); void savePaymentSetting(method) }}><h3>{method}</h3><label>Destination account number<input inputMode="numeric" maxLength={17} value={paymentSettings[method].accountNumber} onChange={(event) => setPaymentSettings({ ...paymentSettings, [method]: { ...paymentSettings[method], accountNumber: event.target.value.replace(/\D/g, '').slice(0, 17) } })} required /></label><label>Routing number<input inputMode="numeric" maxLength={9} value={paymentSettings[method].routingNumber} onChange={(event) => setPaymentSettings({ ...paymentSettings, [method]: { ...paymentSettings[method], routingNumber: event.target.value.replace(/\D/g, '').slice(0, 9) } })} required /></label><label>Member instructions<input maxLength={500} value={paymentSettings[method].notes} onChange={(event) => setPaymentSettings({ ...paymentSettings, [method]: { ...paymentSettings[method], notes: event.target.value } })} /></label><button className="btn btn-secondary" type="submit">Save {method} instructions</button></form>)}</div></section>
    </main>
  )
}
