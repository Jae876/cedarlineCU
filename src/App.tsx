import { useEffect } from 'react'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import Navbar from '@components/layout/Navbar'
import Footer from '@components/layout/Footer'
import LiveChatWidget from '@components/LiveChatWidget'
import HomePage from '@pages/HomePage'
import SignupPage from '@pages/SignupPage'
import LoginPage from '@pages/LoginPage'
import DashboardPage from '@pages/DashboardPage'
import ProfilePage from '@pages/ProfilePage'
import TransactionsPage from '@pages/TransactionsPage'
import AdminPage from '@pages/AdminPage'
import { MarketDataPage, TradingPage, PlatformsPage, FeaturesPage, PricingPage } from '@pages/SectionPages'

function RouteFrame() {
  const location = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [location.pathname])

  return (
    <div className="app-shell">
      <Navbar />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/trading" element={<TradingPage />} />
          <Route path="/platforms" element={<PlatformsPage />} />
          <Route path="/features" element={<FeaturesPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/market-data" element={<MarketDataPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<HomePage />} />
        </Routes>
      </main>
      <Footer />
      {!['/admin', '/signup', '/login'].includes(location.pathname) && <LiveChatWidget />}
    </div>
  )
}

export default function App() {
  return <BrowserRouter><RouteFrame /></BrowserRouter>
}
