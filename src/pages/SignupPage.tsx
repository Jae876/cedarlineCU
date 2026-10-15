import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, ArrowRight, CheckCircle, Lock, Mail, User } from 'lucide-react'
import { apiRequest, persistSession } from '@services/apiClient'
import type { User as BankingUser } from '../types'

interface SignupResponse {
  token: string
  user: BankingUser
}

const requirementChecks = (password: string) => [
  password.length >= 8,
  /[A-Z]/.test(password),
  /[a-z]/.test(password),
  /[0-9]/.test(password),
  /[!@#$%^&*]/.test(password),
]

export default function SignupPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', confirmPassword: '', accountType: 'individual' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const checks = requirementChecks(form.password)

  const update = (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }))
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    if (!checks.every(Boolean)) {
      setError('Password does not meet all requirements.')
      return
    }
    setLoading(true)
    try {
      const result = await apiRequest<SignupResponse>('/api/auth/signup', {
        method: 'POST',
        sessionScope: 'none',
        body: JSON.stringify({ firstName: form.firstName, lastName: form.lastName, email: form.email, password: form.password, accountType: form.accountType }),
      })
      persistSession(result.token, result.user)
      navigate('/dashboard')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Signup failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="page-main">
      <section className="panel app-auth-panel">
        <p className="auth-kicker">Membership</p>
        <h1 className="page-title">Create your account</h1>
        <p className="auth-intro">Create a fictional demo account. No real banking or payment services are provided.</p>
        {error && <div className="form-error" role="alert"><AlertCircle size={18} /> {error}</div>}
        <form className="stack-form app-form" onSubmit={submit}>
          <div className="app-grid">
            <label><span><User size={15} /> First name</span><input name="firstName" value={form.firstName} onChange={update} autoComplete="given-name" required /></label>
            <label><span>Last name</span><input name="lastName" value={form.lastName} onChange={update} autoComplete="family-name" required /></label>
          </div>
          <label><span><Mail size={15} /> Email address</span><input type="email" name="email" value={form.email} onChange={update} autoComplete="email" required /></label>
          <label><span>Account type</span>
            <select name="accountType" value={form.accountType} onChange={update}>
              <option value="individual">Individual</option>
              <option value="business">Business</option>
              <option value="joint">Joint</option>
            </select>
          </label>
          <label><span><Lock size={15} /> Password</span><input type="password" name="password" value={form.password} onChange={update} autoComplete="new-password" required /></label>
          {form.password && <div className="password-reqs">{['At least 8 characters', 'One uppercase letter', 'One lowercase letter', 'One number', 'One special character (!@#$%^&*)'].map((text, index) => <span key={text} className={checks[index] ? 'requirement-met' : ''}>{checks[index] && <CheckCircle size={13} />} {text}</span>)}</div>}
          <label><span>Confirm password</span><input type="password" name="confirmPassword" value={form.confirmPassword} onChange={update} autoComplete="new-password" required /></label>
          <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Creating account…' : 'Create account'} {!loading && <ArrowRight size={16} />}</button>
          <p className="form-footnote">Already have an account? <Link to="/login">Sign in</Link></p>
        </form>
      </section>
    </main>
  )
}
