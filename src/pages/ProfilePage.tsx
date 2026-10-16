import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Save, Target } from 'lucide-react'
import { apiRequest } from '@services/apiClient'
import type { User } from '../types'

interface VerifyResponse { user: User }

export default function ProfilePage() {
  const navigate = useNavigate()
  const [user, setUser] = useState<User | null>(null)
  const [target, setTarget] = useState('5000000')
  const [saved, setSaved] = useState(false)
  const [profileSaved, setProfileSaved] = useState(false)
  const [error, setError] = useState('')
  const [profileError, setProfileError] = useState('')
  const [details, setDetails] = useState({ firstName: '', lastName: '', line1: '', line2: '', city: '', state: '', postalCode: '' })

  useEffect(() => {
    apiRequest<VerifyResponse>('/api/auth/verify').then((result) => {
      setUser(result.user)
      setDetails({ firstName: result.user.firstName, lastName: result.user.lastName, ...result.user.address })
      const stored = localStorage.getItem(`accountTarget:${result.user.id}`)
      if (stored) setTarget(stored)
    }).catch(() => navigate('/login'))
  }, [navigate])

  const currentBalance = user?.account.balance || 0
  const targetValue = Math.max(0, Number(target) || 0)
  const progress = useMemo(() => targetValue ? Math.min((currentBalance / targetValue) * 100, 100) : 0, [currentBalance, targetValue])

  const saveTarget = () => {
    if (!user || targetValue < 100000) {
      setError('Target must be at least $100,000.')
      return
    }
    localStorage.setItem(`accountTarget:${user.id}`, String(targetValue))
    setSaved(true)
    setError('')
    window.setTimeout(() => setSaved(false), 2500)
  }

  const saveDetails = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setProfileError('')
    setProfileSaved(false)
    try {
      const result = await apiRequest<VerifyResponse>('/api/profile', {
        method: 'PUT',
        body: JSON.stringify({ firstName: details.firstName, lastName: details.lastName, address: { line1: details.line1, line2: details.line2, city: details.city, state: details.state, postalCode: details.postalCode } }),
      })
      setUser(result.user)
      setProfileSaved(true)
    } catch (reason) {
      setProfileError(reason instanceof Error ? reason.message : 'Unable to save your details.')
    }
  }

  if (!user) return <main className="page-main"><p>Loading profile…</p></main>
  return (
    <main className="page-main">
      <div className="page-heading-row"><div><p className="eyebrow">Member profile</p><h1 className="page-title">Account profile</h1><p>{user.firstName} {user.lastName}</p></div><Link className="btn btn-secondary" to="/dashboard"><ArrowLeft size={15} /> Account overview</Link></div>
      <section className="panel app-panel profile-grid">
        <div><span className="account-label">Current balance</span><strong>{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(currentBalance)}</strong></div>
        <div><span className="account-label">Buying power</span><strong>{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(user.account.buyingPower)}</strong></div>
        <div><span className="account-label">Account created</span><strong>{new Date(user.account.createdAt).toLocaleDateString(undefined, { timeZone: 'UTC' })}</strong></div>
        <div><span className="account-label">Account type</span><strong className="capitalize">{user.accountType}</strong></div>
      </section>
      <section className="panel app-panel">
        <div className="panel-header"><h2>Personal details</h2></div>
        <form className="app-form" onSubmit={saveDetails}>
          <div className="app-grid">
            <label>First name<input autoComplete="given-name" value={details.firstName} onChange={(event) => setDetails({ ...details, firstName: event.target.value })} maxLength={80} required /></label>
            <label>Last name<input autoComplete="family-name" value={details.lastName} onChange={(event) => setDetails({ ...details, lastName: event.target.value })} maxLength={80} required /></label>
            <label>Address line 1<input autoComplete="address-line1" value={details.line1} onChange={(event) => setDetails({ ...details, line1: event.target.value })} maxLength={120} /></label>
            <label>Address line 2<input autoComplete="address-line2" value={details.line2} onChange={(event) => setDetails({ ...details, line2: event.target.value })} maxLength={120} /></label>
            <label>City<input autoComplete="address-level2" value={details.city} onChange={(event) => setDetails({ ...details, city: event.target.value })} maxLength={100} /></label>
            <label>State<input autoComplete="address-level1" value={details.state} onChange={(event) => setDetails({ ...details, state: event.target.value.toUpperCase().slice(0, 2) })} maxLength={2} /></label>
            <label>ZIP code<input autoComplete="postal-code" inputMode="numeric" value={details.postalCode} onChange={(event) => setDetails({ ...details, postalCode: event.target.value.replace(/[^\d-]/g, '').slice(0, 10) })} maxLength={10} /></label>
          </div>
          {profileError && <p className="form-error" role="alert">{profileError}</p>}
          {profileSaved && <p className="form-success" role="status">Personal details saved.</p>}
          <button className="btn btn-primary" type="submit"><Save size={15} /> Save personal details</button>
        </form>
      </section>
      <section className="panel app-panel target-panel">
        <div className="panel-header"><h2><Target size={19} /> Account target</h2></div>
        <div className="target-summary"><div><span className="account-label">Target</span><strong>{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(targetValue)}</strong></div><div><span className="account-label">Remaining</span><strong>{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.max(targetValue - currentBalance, 0))}</strong></div><div><span className="account-label">Progress</span><strong>{progress.toFixed(1)}%</strong></div></div>
        <div className="target-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div>
        <div className="app-form target-form"><label>Set your target amount<input type="number" min="100000" step="100000" value={target} onChange={(event) => setTarget(event.target.value)} /></label>{error && <p className="form-error" role="alert">{error}</p>}{saved && <p className="form-success" role="status">Target saved.</p>}<button className="btn btn-primary" onClick={saveTarget}><Save size={15} /> Save target</button></div>
      </section>
    </main>
  )
}
