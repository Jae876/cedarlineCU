import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowDownToLine, ArrowUpFromLine, ChevronDown, ChevronLeft, CreditCard, Eye, EyeOff, History, LogOut, Settings as SettingsIcon, User as UserIcon, Wallet, X } from 'lucide-react'
import { apiRequest, clearSession } from '@services/apiClient'
import type { User } from '../types'

interface VerifyResponse { user: User }
type PaymentMethod = 'ACH' | 'WIRE' | 'INTERNAL'
type PaymentSettings = Record<PaymentMethod, { accountNumber: string; routingNumber: string; notes: string }>
const currency = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
const banks = ['Bank of America', 'Capital One', 'Chase', 'Citibank', 'PNC Bank', 'U.S. Bank', 'Wells Fargo', 'Other bank']

function createCardDetails() {
  const random = crypto.getRandomValues(new Uint8Array(19))
  const prefix = `4${Array.from(random.slice(0, 14), (digit) => digit % 10).join('')}`
  const checksum = prefix.split('').reverse().reduce((sum, character, index) => {
    let digit = Number(character)
    if (index % 2 === 0) digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2
    return sum + digit
  }, 0)
  const validCheckDigit = (10 - (checksum % 10)) % 10
  const invalidCheckDigit = (validCheckDigit + 1) % 10
  const month = (random[15] % 12) + 1
  const year = new Date().getFullYear() + 2 + (random[16] % 4)
  const securityCode = String(100 + ((random[17] * 256 + random[18]) % 900))

  return {
    number: `${prefix}${invalidCheckDigit}`.replace(/(.{4})/g, '$1 ').trim(),
    expiry: `${String(month).padStart(2, '0')}/${String(year).slice(-2)}`,
    securityCode,
  }
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(null)
  const [paymentSettings, setPaymentSettings] = useState<PaymentSettings | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showCard, setShowCard] = useState(false)
  const [revealCard, setRevealCard] = useState(false)
  const [cardDetails] = useState(createCardDetails)
  const [balanceVisible, setBalanceVisible] = useState(false)
  const [accountDetailsExpanded, setAccountDetailsExpanded] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activeTransfer, setActiveTransfer] = useState<'deposit' | 'withdrawal' | null>(null)
  const [transferStep, setTransferStep] = useState(1)
  const [receipt, setReceipt] = useState<User['account']['transactions'][number] | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('ACH')
  const [depositAmount, setDepositAmount] = useState('')
  const [withdrawalAmount, setWithdrawalAmount] = useState('')
  const [reference, setReference] = useState('')
  const [bankName, setBankName] = useState('Chase')
  const [customBankName, setCustomBankName] = useState('')
  const [destinationAccountNumber, setDestinationAccountNumber] = useState('')
  const [destinationRoutingNumber, setDestinationRoutingNumber] = useState('')

  useEffect(() => {
    apiRequest<VerifyResponse>('/api/auth/verify').then((result) => setUser(result.user)).catch(() => navigate('/login'))
    apiRequest<PaymentSettings>('/api/admin/payment-settings', { sessionScope: 'user' }).then(setPaymentSettings).catch(() => setPaymentSettings(null))
  }, [navigate])

  const submitRequest = async (event: FormEvent<HTMLFormElement>, operation: 'deposit' | 'withdrawal', amount: string) => {
    event.preventDefault()
    setError('')
    setNotice('')
    try {
      const result = await apiRequest<{ message: string; transaction: User['account']['transactions'][number] }>('/api/transactions', {
        method: 'POST',
        sessionScope: 'user',
        body: JSON.stringify({ operation, amount, reference, paymentMethod, bankName: bankName === 'Other bank' ? customBankName : bankName, accountNumber: destinationAccountNumber, routingNumber: destinationRoutingNumber }),
      })
      setNotice(result.message)
      if (operation === 'withdrawal' && result.transaction.receiptAvailable) setReceipt(result.transaction)
      if (operation === 'deposit') setDepositAmount('')
      else setWithdrawalAmount('')
      setReference('')
      setDestinationAccountNumber('')
      setDestinationRoutingNumber('')
      const refreshed = await apiRequest<VerifyResponse>('/api/auth/verify')
      setUser(refreshed.user)
      setActiveTransfer(null)
      setTransferStep(1)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Request could not be submitted.')
    }
  }

  const logout = async () => {
    try { await apiRequest('/api/auth/logout', { method: 'POST', sessionScope: 'user' }) } catch { /* session is cleared locally either way */ }
    clearSession(false)
    navigate('/')
  }

  if (!user) return <main className="page-main"><p>Loading your account…</p></main>

  const accountTypeLabel = user.accountType === 'joint' ? 'Joint checking' : user.accountType === 'business' ? 'Business checking' : 'Personal checking'
  const cardReference = `CL-${user.account.accountNumber.slice(-4)}-${String(user.id).padStart(6, '0')}`
  const activeAmount = activeTransfer === 'deposit' ? depositAmount : withdrawalAmount

  return (
    <main className="page-main banking-dashboard">
      <div className="page-heading-row banking-heading"><div><p className="eyebrow">Member banking</p><h1 className="page-title">Banking Dashboard</h1><p>Welcome back, {user.firstName}. Here is your account at a glance.</p></div><div className="account-menu"><button className="account-menu-trigger" type="button" aria-label="Settings" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)}><SettingsIcon size={19} /></button>{settingsOpen && <div className="account-menu-popover" role="menu"><Link role="menuitem" to="/profile" onClick={() => setSettingsOpen(false)}>Personal details</Link><button role="menuitem" type="button" onClick={() => void logout()}><LogOut size={15} /> Sign out</button></div>}</div></div>
      <section className="balance-overview">
        <div className="balance-primary">
          <div className="balance-label-row"><span>Available balance</span><button className="balance-eye" type="button" aria-label={balanceVisible ? 'Hide available balance' : 'Show available balance'} onClick={() => setBalanceVisible(!balanceVisible)}>{balanceVisible ? <EyeOff size={20} /> : <Eye size={20} />}</button></div>
          <button className="balance-expand" type="button" aria-expanded={accountDetailsExpanded} onClick={() => setAccountDetailsExpanded(!accountDetailsExpanded)}><strong>{balanceVisible ? currency(user.account.balance) : '••••••••'}</strong><span>{accountDetailsExpanded ? 'Hide account details' : 'Tap to view account details'}<ChevronDown size={18} /></span></button>
        </div>
      </section>
      {accountDetailsExpanded && <section className="account-disclosure" aria-label="Account details"><div className="account-disclosure-heading"><div><span className="section-overline">ACCOUNT OVERVIEW</span><h2>{accountTypeLabel}</h2></div><span className="account-status">Active</span></div><div className="account-disclosure-grid"><div><span>Account number</span><strong>{user.account.accountNumber}</strong></div><div><span>Routing number</span><strong>{user.account.routingNumber}</strong></div><div><span>Account opened</span><strong>{new Date(user.account.createdAt).toLocaleDateString(undefined, { timeZone: 'UTC' })}</strong></div></div></section>}
      <section className="card-access"><div className="card-preview" aria-hidden="true"><div><span>CEDARLINE</span><CreditCard size={21} /></div><strong>•••• •••• •••• {cardDetails.number.slice(-4)}</strong><small>MEMBER CARD</small></div><div className="card-access-copy"><span className="section-overline">CARD ACCESS</span><h2>Member card</h2><p>Details remain masked until you choose to reveal them.</p><button className="btn btn-secondary" onClick={() => { setShowCard(true); setRevealCard(false) }}><Eye size={16} /> View details</button></div></section>
      {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="form-success" role="status">{notice}</p>}
      <div className="banking-content-grid">
        <div className="service-grid banking-shortcuts">
          <button className="service-action" onClick={() => { setActiveTransfer('deposit'); setTransferStep(1); setError('') }}><span className="service-action-icon"><ArrowDownToLine size={20} /></span><strong>Add Funds</strong><small>View deposit instructions</small></button>
          <button className="service-action" onClick={() => { setActiveTransfer('withdrawal'); setTransferStep(1); setError('') }}><span className="service-action-icon"><ArrowUpFromLine size={20} /></span><strong>Withdraw</strong><small>Enter bank details</small></button>
          <Link className="service-action" to="/profile"><span className="service-action-icon"><UserIcon size={20} /></span><strong>Account Details</strong><small>View your account information</small></Link>
          <Link className="service-action" to="/transactions"><span className="service-action-icon"><History size={20} /></span><strong>History</strong></Link>
          <Link className="service-action" to="/transactions"><span className="service-action-icon"><Wallet size={20} /></span><strong>Balance Activity</strong><small>Review balance changes</small></Link>
        </div>
        <section className="panel app-panel history-panel">
          <div className="panel-header align-between"><div><span className="section-overline">ACCOUNT ACTIVITY</span><h2>Recent Activity</h2></div><Link to="/transactions">View all</Link></div>
          <TransactionTable transactions={user.account.transactions.slice(-6).reverse()} />
        </section>
      </div>
      {activeTransfer && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setActiveTransfer(null) }}><section className="bank-modal transfer-modal" role="dialog" aria-modal="true" aria-labelledby="transfer-title"><div className="transfer-modal-header"><div><span>ACCOUNT TRANSACTION</span><h2 id="transfer-title">{activeTransfer === 'deposit' ? 'Add Funds' : 'Withdraw Funds'}</h2></div><button className="icon-button" onClick={() => setActiveTransfer(null)} aria-label="Close transfer form"><X /></button></div><div className="transfer-progress">{(activeTransfer === 'deposit' ? ['Amount', 'Review'] : ['Amount', 'Bank details', 'Review']).map((label, index) => <span className={transferStep >= index + 1 ? 'active' : ''} key={label}>{index + 1}. {label}</span>)}</div><form className="app-form" onSubmit={(event) => void submitRequest(event, activeTransfer, activeAmount)}>
        {transferStep === 1 && <><p className="auth-intro">{activeTransfer === 'deposit' ? 'Enter the amount to add to your balance.' : `Available balance: ${currency(user.account.balance)}. Enter the amount to withdraw.`}</p><label>{activeTransfer === 'deposit' ? 'Deposit amount' : 'Withdrawal amount'}<input autoFocus type="number" min="0.01" max={activeTransfer === 'withdrawal' ? user.account.balance : undefined} step="0.01" value={activeAmount} onChange={(event) => activeTransfer === 'deposit' ? setDepositAmount(event.target.value) : setWithdrawalAmount(event.target.value)} required /></label>{activeTransfer === 'deposit' && <label>Deposit method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}><option value="ACH">ACH transfer</option><option value="WIRE">Wire transfer</option><option value="INTERNAL">Internal transfer</option></select></label>}</>}
        {activeTransfer === 'withdrawal' && transferStep === 2 && <><div className="fictional-notice">Review your destination and amount carefully.</div><label>Select bank<select value={bankName} onChange={(event) => setBankName(event.target.value)}>{banks.map((bank) => <option key={bank}>{bank}</option>)}</select></label>{bankName === 'Other bank' && <label>Bank name<input value={customBankName} onChange={(event) => setCustomBankName(event.target.value)} maxLength={100} required /></label>}<label>Account number<input inputMode="numeric" autoComplete="off" value={destinationAccountNumber} onChange={(event) => setDestinationAccountNumber(event.target.value.replace(/\D/g, '').slice(0, 17))} minLength={8} maxLength={17} required /><small>8–17 digits</small></label><label>Routing number<input inputMode="numeric" autoComplete="off" value={destinationRoutingNumber} onChange={(event) => setDestinationRoutingNumber(event.target.value.replace(/\D/g, '').slice(0, 9))} minLength={9} maxLength={9} required /><small>9 digits</small></label><label>Reference (optional)<input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={120} /></label></>}
        {((activeTransfer === 'deposit' && transferStep === 2) || (activeTransfer === 'withdrawal' && transferStep === 3)) && <><div className="fictional-notice">No external transfer will be made.</div><dl className="transfer-review"><div><dt>Amount</dt><dd>{currency(Number(activeAmount || 0))}</dd></div>{activeTransfer === 'deposit' ? <><div><dt>Method</dt><dd>{paymentMethod}</dd></div><div><dt>Send to</dt><dd>{paymentSettings?.[paymentMethod]?.accountNumber || 'Not configured'}</dd></div><div><dt>Routing</dt><dd>{paymentSettings?.[paymentMethod]?.routingNumber || '—'}</dd></div><div><dt>Instructions</dt><dd>{paymentSettings?.[paymentMethod]?.notes || '—'}</dd></div></> : <><div><dt>Bank</dt><dd>{bankName === 'Other bank' ? customBankName : bankName}</dd></div><div><dt>Account</dt><dd>••••{destinationAccountNumber.slice(-4)}</dd></div><div><dt>Routing</dt><dd>{destinationRoutingNumber}</dd></div></>}</dl></>}
        {error && <p className="form-error" role="alert">{error}</p>}<div className="app-actions transfer-actions">{transferStep > 1 && <button type="button" className="btn btn-secondary" onClick={() => { setError(''); setTransferStep(transferStep - 1) }}><ChevronLeft size={16} /> Back</button>}{(activeTransfer === 'deposit' ? transferStep === 2 : transferStep === 3) ? <button type="submit" className="btn btn-primary" disabled={activeTransfer === 'deposit' && !paymentSettings?.[paymentMethod]?.accountNumber}>Confirm {activeTransfer === 'deposit' ? 'Deposit' : 'Withdrawal'}</button> : <button type="button" className="btn btn-primary" disabled={activeTransfer === 'withdrawal' && transferStep === 1 && Number(activeAmount) > user.account.balance} onClick={() => { setError(''); setTransferStep(transferStep + 1) }}>Next: {activeTransfer === 'withdrawal' && transferStep === 1 ? 'Bank details' : 'Review'}</button>}</div></form></section></div>}
      {receipt && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setReceipt(null) }}><section className="bank-modal receipt-modal" role="dialog" aria-modal="true" aria-labelledby="receipt-title"><div className="modal-heading"><div><span className="section-overline">TRANSACTION RECEIPT</span><h2 id="receipt-title">Withdrawal completed</h2></div><button className="icon-button" onClick={() => setReceipt(null)} aria-label="Close receipt"><X /></button></div><dl className="transfer-review"><div><dt>Transaction ID</dt><dd>{receipt.transactionId}</dd></div><div><dt>Amount</dt><dd>{currency(Math.abs(receipt.amount))}</dd></div><div><dt>Destination</dt><dd>{receipt.bankName || 'Bank'} ({receipt.destinationAccountLast4})</dd></div><div><dt>Routing number</dt><dd>{receipt.destinationRoutingNumber}</dd></div><div><dt>Date</dt><dd>{new Date(receipt.date).toLocaleString()}</dd></div><div><dt>Status</dt><dd>Completed</dd></div></dl><button className="btn btn-secondary" onClick={() => setReceipt(null)}>Done</button></section></div>}
      {showCard && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowCard(false) }}><section className="bank-modal" role="dialog" aria-modal="true" aria-labelledby="card-dialog-title"><div className="modal-heading"><div><span className="section-overline">CARD DETAILS</span><h2 id="card-dialog-title">Member card</h2></div><button className="icon-button" onClick={() => setShowCard(false)} aria-label="Close card details"><X /></button></div><div className="fictional-card"><span>CEDARLINE</span><CreditCard size={24} /><strong>{revealCard ? cardDetails.number : '•••• •••• •••• ••••'}</strong><div><span>{user.firstName} {user.lastName}</span></div></div><div className="card-detail-row"><span>Expires</span><strong>{revealCard ? cardDetails.expiry : '••/••'}</strong></div><div className="card-detail-row"><span>Security code</span><strong>{revealCard ? cardDetails.securityCode : '•••'}</strong></div><button className="btn btn-secondary" onClick={() => setRevealCard(!revealCard)}>{revealCard ? <EyeOff size={16} /> : <Eye size={16} />}{revealCard ? ' Hide details' : ' Reveal details'}</button></section></div>}
    </main>
  )
}

export function TransactionTable({ transactions }: { transactions: User['account']['transactions'] }) {
  if (!transactions.length) return <p>No transactions recorded.</p>
  return <div className="table-wrap"><table className="app-table"><thead><tr><th>Type</th><th>Amount</th><th>Description</th><th>Date</th><th>Balance</th><th>Status</th></tr></thead><tbody>{transactions.map((transaction) => <tr key={transaction.transactionId}><td>{transaction.type.replace('_', ' ')}{transaction.generated && <small className="generated-label"> · Generated</small>}</td><td>{currency(transaction.amount)}</td><td>{transaction.description}<small className="transaction-id">{transaction.transactionId}</small></td><td>{new Date(transaction.date).toLocaleDateString()}</td><td>{transaction.balance === null ? '—' : currency(transaction.balance)}</td><td><span className={`status-${transaction.status || 'completed'}`}>{transaction.status || 'completed'}</span></td></tr>)}</tbody></table></div>
}
