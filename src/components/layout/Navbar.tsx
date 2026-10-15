import { useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Menu, X } from 'lucide-react'

const navigation = [
  { label: 'Personal', to: '/features' },
  { label: 'Business', to: '/platforms' },
  { label: 'Markets', to: '/market-data' },
  { label: 'Pricing', to: '/pricing' },
]

export default function Navbar() {
  const [open, setOpen] = useState(false)
  const signedIn = Boolean(localStorage.getItem('token'))

  return (
    <header className="site-header">
      <div className="header-inner">
        <Link className="brand-lockup" to="/" aria-label="Cedarline Community Credit Union home" onClick={() => setOpen(false)}>
          <img className="brand-symbol" src="/cedarline-mark.svg" alt="" />
          <span className="brand-name">Cedarline <small>Community Credit Union</small></span>
        </Link>
        <nav className={`header-links ${open ? 'is-open' : ''}`} aria-label="Main navigation">
          {navigation.map((item) => (
            <NavLink key={item.to} to={item.to} onClick={() => setOpen(false)}>{item.label}</NavLink>
          ))}
        </nav>
        <div className="header-actions">
          {signedIn ? (
            <Link className="btn btn-secondary" to="/dashboard">My account</Link>
          ) : (
            <>
              <Link className="btn btn-secondary" to="/login">Sign in</Link>
              <Link className="btn btn-primary auth-btn" to="/signup">Open account</Link>
            </>
          )}
          <button className="menu-toggle" type="button" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>
    </header>
  )
}
