import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, ArrowRight } from 'lucide-react'
import { apiRequest, persistSession } from '@services/apiClient'
import type { User } from '../types'

interface LoginResponse {
  token: string
  user: User
}

export default function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await apiRequest<LoginResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      persistSession(result.token, result.user)
      navigate('/dashboard')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to sign in.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="page-main">
      <section className="panel app-auth-panel">
        <p className="auth-kicker">Online banking</p>
        <h1 className="page-title">Sign in to your account</h1>
        <p className="auth-intro">Enter your email address and password to continue.</p>
        {error && <div className="form-error" role="alert"><AlertCircle size={18} /> {error}</div>}
        <form className="stack-form app-form" onSubmit={submit}>
          <label><span>Email address</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required /></label>
          <label><span>Password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
          <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'} {!loading && <ArrowRight size={16} />}</button>
          <p className="form-footnote">New to Cedarline? <Link to="/signup">Create your account</Link></p>
        </form>
      </section>
    </main>
  )
}
