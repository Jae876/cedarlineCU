import { ArrowRight, BarChart3, CircleDollarSign, Landmark, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'

function SectionPage({ eyebrow, title, intro, items }: { eyebrow: string; title: string; intro: string; items: { title: string; text: string }[] }) {
  return (
    <main className="page-main">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="page-title">{title}</h1>
      <p className="auth-intro section-intro">{intro}</p>
      <div className="content-grid">
        {items.map((item) => <article className="content-item" key={item.title}><h2>{item.title}</h2><p>{item.text}</p></article>)}
      </div>
      <p className="home-cta"><Link className="product-link" to="/signup">Explore membership <ArrowRight size={15} /></Link></p>
    </main>
  )
}

export function PlatformsPage() {
  return <SectionPage eyebrow="Banking, your way" title="Tools for every kind of day" intro="Access your account and member services from one secure place." items={[{ title: 'Online banking', text: 'Review your balance, account details, and recorded activity.' }, { title: 'Member support', text: 'Connect with Cedarline for guidance when you need it.' }, { title: 'Account access', text: 'Sign in securely from the device that works for you.' }]} />
}

export function FeaturesPage() {
  return <SectionPage eyebrow="Member services" title="The essentials, made clear" intro="A more personal way to stay connected to your everyday finances." items={[{ title: 'Account overview', text: 'A clear view of balances and account activity.' }, { title: 'Secure sign-in', text: 'Private access with a password you choose.' }, { title: 'Local guidance', text: 'Thoughtful help from a community-focused team.' }]} />
}

export function PricingPage() {
  return <SectionPage eyebrow="Membership" title="Straightforward service" intro="Contact Cedarline for current account terms and fee information." items={[{ title: 'Account terms', text: 'Account eligibility and terms are confirmed during application review.' }, { title: 'Member support', text: 'Questions about account services can be directed to our support team.' }]} />
}

export function MarketDataPage() {
  return <main className="page-main"><p className="eyebrow">Markets</p><h1 className="page-title">Market data</h1><section className="panel app-panel"><BarChart3 aria-hidden="true" /><h2>Market data service</h2><p>Live market pricing is not connected in this deployment. No quote or portfolio value is estimated.</p></section></main>
}

export function TradingPage() {
  return <main className="page-main"><p className="eyebrow">Account tools</p><h1 className="page-title">Trading</h1><div className="content-grid"><article className="content-item"><CircleDollarSign aria-hidden="true" /><h2>Account activity</h2><p>View posted activity from your protected account dashboard.</p><Link to="/transactions">View transactions</Link></article><article className="content-item"><ShieldCheck aria-hidden="true" /><h2>Member access</h2><p>Requests are reviewed before they change your account balance.</p><Link to="/dashboard">Open dashboard</Link></article><article className="content-item"><Landmark aria-hidden="true" /><h2>Account services</h2><p>Get help with account services through Cedarline support.</p><Link to="/features">View services</Link></article></div></main>
}
