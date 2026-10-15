import { Link } from 'react-router-dom'
import { ArrowRight, Landmark, ShieldCheck, Users } from 'lucide-react'

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <div className="hero-inner">
          <div className="hero-content">
            <p className="eyebrow light">A little closer to home</p>
            <h1>Good things grow when we grow together.</h1>
            <p>Banking should feel personal. Find the everyday tools, thoughtful guidance, and local support to move toward what matters to you.</p>
            <div className="hero-actions">
              <Link className="btn btn-primary" to="/signup">Become a member <ArrowRight size={16} /></Link>
              <Link className="btn btn-secondary btn-alternative" to="/login">Online banking</Link>
            </div>
            <div className="hero-badges">
              <div className="hero-badge"><strong>Here for you</strong><span>Banking that fits real life</span></div>
              <div className="hero-badge"><strong>Rooted here</strong><span>People helping people</span></div>
            </div>
          </div>
          <div className="hero-visual">
            <div className="mini-shell">
              <div className="mock-card">
                <div className="mock-card-top"><span>Cedarline</span><span>Online banking</span></div>
                <h2>Money management, made more personal.</h2>
                <p>Pick up where you left off and keep everyday banking close at hand.</p>
                <Link className="btn btn-primary" to="/login">Sign in to your account</Link>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section className="section-surface home-band">
        <div className="home-band-inner">
          <p className="eyebrow">Banking for real life</p>
          <h2>Close to home. Ready for what’s next.</h2>
          <div className="content-grid">
            <article className="content-item"><Landmark aria-hidden="true" /><h3>Everyday accounts</h3><p>Clear account access and a straightforward view of your balance and activity.</p></article>
            <article className="content-item"><ShieldCheck aria-hidden="true" /><h3>Secure access</h3><p>Private sign-in and account support built around your membership.</p></article>
            <article className="content-item"><Users aria-hidden="true" /><h3>Local support</h3><p>Thoughtful guidance from a team committed to the communities we serve.</p></article>
          </div>
          <p className="home-cta"><Link className="product-link" to="/signup">Start a membership application <ArrowRight size={15} /></Link></p>
        </div>
      </section>
    </>
  )
}
