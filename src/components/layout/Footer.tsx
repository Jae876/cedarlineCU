import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="container-max footer-inner">
        <Link className="brand-name" to="/">Cedarline <small>Community Credit Union</small></Link>
        <nav aria-label="Footer navigation">
          <Link to="/features">Banking</Link>
          <Link to="/pricing">Fees</Link>
          <Link to="/login">Online banking</Link>
        </nav>
        <small>© {new Date().getFullYear()} Cedarline Community Credit Union</small>
      </div>
    </footer>
  )
}
