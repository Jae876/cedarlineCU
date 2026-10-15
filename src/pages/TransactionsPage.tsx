import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowDownRight, ArrowUpRight, TrendingDown, TrendingUp } from 'lucide-react'
import { apiRequest } from '@services/apiClient'
import type { Transaction, User } from '../types'

interface VerifyResponse { user: User }
const currency = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)

export default function TransactionsPage() {
  const navigate = useNavigate()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState<Transaction | null>(null)

  useEffect(() => {
    apiRequest<VerifyResponse>('/api/auth/verify')
      .then((result) => setTransactions([...result.user.account.transactions].reverse()))
      .catch(() => navigate('/login'))
  }, [navigate])

  const filtered = useMemo(() => filter === 'all' ? transactions : transactions.filter((item) => item.type === filter), [filter, transactions])
  const totals = useMemo(() => ({
    deposits: transactions.filter((item) => item.type === 'deposit' || item.type === 'opening_balance').reduce((sum, item) => sum + Math.max(item.amount, 0), 0),
    withdrawals: transactions.filter((item) => item.type === 'withdrawal').reduce((sum, item) => sum + Math.abs(item.amount), 0),
    adjustments: transactions.filter((item) => item.type === 'balance_adjustment').reduce((sum, item) => sum + item.amount, 0),
  }), [transactions])

  const filters = ['all', 'deposit', 'withdrawal', 'balance_adjustment', 'opening_balance', 'trade']
  return (
    <main className="page-main">
      <p className="eyebrow">Online banking</p><h1 className="page-title">Account history</h1>
      <div className="content-grid transaction-summary">
        <article className="content-item"><span>Total deposits</span><strong>{currency(totals.deposits)}</strong></article>
        <article className="content-item"><span>Total withdrawals</span><strong>{currency(totals.withdrawals)}</strong></article>
        <article className="content-item"><span>Net adjustments</span><strong>{currency(totals.adjustments)}</strong></article>
        <article className="content-item"><span>Transactions</span><strong>{transactions.length}</strong></article>
      </div>
      <section className="panel app-panel">
        <div className="panel-header align-between"><h2>Transactions</h2><Link to="/dashboard">Account overview</Link></div>
        <div className="transaction-filters" role="group" aria-label="Filter transactions">
          {filters.map((item) => <button type="button" key={item} className={`filter-button ${filter === item ? 'active' : ''}`} aria-pressed={filter === item} onClick={() => { setFilter(item); setSelected(null) }}>{item === 'all' ? 'All' : item.replace('_', ' ')}</button>)}
        </div>
        {selected && <div className="transaction-detail"><div><span className="account-label">Transaction details</span><h2>{selected.type.replace('_', ' ')}</h2></div><div><span className="account-label">Transaction ID</span><strong>{selected.transactionId}</strong></div><div><span className="account-label">Date / status</span><strong>{new Date(selected.date).toLocaleString()} · {selected.status}</strong></div><div><span className="account-label">Amount / destination</span><strong>{currency(selected.amount)} · {selected.bankName || 'Account ledger'}</strong></div><div><span className="account-label">Description</span><strong>{selected.description}{selected.generated ? ' · Generated history' : ''}</strong></div><button className="btn btn-secondary btn-small" onClick={() => setSelected(null)}>Close details</button></div>}
        <div className="table-wrap"><table className="app-table"><thead><tr><th>Date</th><th>Transaction ID</th><th>Type</th><th>Description</th><th>Amount</th><th>Balance</th><th>Status</th></tr></thead><tbody>{filtered.map((transaction) => <tr key={transaction.transactionId} onClick={() => setSelected(transaction)} className="transaction-row"><td>{new Date(transaction.date).toLocaleDateString()}</td><td className="transaction-id">{transaction.transactionId}</td><td><span className="transaction-type">{transaction.amount < 0 ? <ArrowUpRight size={14} /> : transaction.type === 'withdrawal' ? <ArrowDownRight size={14} /> : transaction.type === 'trade' ? <TrendingUp size={14} /> : <TrendingDown size={14} />}{transaction.type.replace('_', ' ')}{transaction.generated ? ' · generated' : ''}</span></td><td>{transaction.description}</td><td className={transaction.amount < 0 ? 'amount-negative' : 'amount-positive'}>{currency(transaction.amount)}</td><td>{transaction.balance === null ? 'Pending' : currency(transaction.balance)}</td><td><span className={`status-${transaction.status || 'completed'}`}>{transaction.status || 'completed'}</span></td></tr>)}</tbody></table>{!filtered.length && <p className="table-empty">No recorded transactions for this filter.</p>}</div>
      </section>
    </main>
  )
}
