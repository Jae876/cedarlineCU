import { useState } from 'react'
import { Bot, MessageCircle, Send, User, X } from 'lucide-react'
import { apiRequest } from '@services/apiClient'

interface ChatMessage { id: string; sender: 'bot' | 'user'; text: string }

const initialMessages: ChatMessage[] = [{
  id: 'welcome', sender: 'bot', text: 'Welcome to Cedarline support. I can help with account access, transfers, and membership questions.',
}]

function replyTo(message: string) {
  const query = message.toLowerCase()
  if (query.includes('balance')) return 'Sign in to see your current available balance and recorded account activity.'
  if (query.includes('deposit') || query.includes('fund')) return 'Submit a deposit request from your account dashboard. Your balance changes after administrator review.'
  if (query.includes('withdraw') || query.includes('transfer')) return 'Submit a withdrawal request from your account dashboard. Requests are reviewed before account funds change.'
  if (query.includes('sign in') || query.includes('login')) return 'Use Sign in in the navigation. If you need account access, contact Cedarline support.'
  if (query.includes('account') || query.includes('open')) return 'Start an account application from Open account. Account access is created by Cedarline after review.'
  return 'I can help with account access, membership, deposits, and withdrawals. You can also send your message to Cedarline support below.'
}

export default function LiveChatWidget() {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState(initialMessages)
  const [error, setError] = useState('')

  const send = async () => {
    const text = message.trim()
    if (!text) return
    setMessage('')
    setError('')
    setMessages((current) => [...current, { id: crypto.randomUUID(), sender: 'user', text }])
    try {
      await apiRequest('/api/chat', { method: 'POST', body: JSON.stringify({ sender: 'Website visitor', message: text }) })
    } catch {
      setError('Message could not reach support. It was not saved.')
    }
    setMessages((current) => [...current, { id: crypto.randomUUID(), sender: 'bot', text: replyTo(text) }])
  }

  return (
    <div className="chat-launcher">
      {open ? <section className="chat-panel" aria-label="Cedarline live support">
        <header className="chat-panel-header"><div><strong>Live support</strong><small>Cedarline member services</small></div><button type="button" className="icon-button" aria-label="Close support chat" onClick={() => setOpen(false)}><X size={18} /></button></header>
        <div className="chat-panel-messages" aria-live="polite">{messages.map((item) => <div className={`chat-message ${item.sender}`} key={item.id}><span>{item.sender === 'bot' ? <Bot size={14} /> : <User size={14} />} {item.sender === 'bot' ? 'Cedarline' : 'You'}</span><p>{item.text}</p></div>)}</div>
        {error && <p className="chat-error" role="alert">{error}</p>}
        <form onSubmit={(event) => { event.preventDefault(); void send() }} className="chat-panel-form"><input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Ask a question" aria-label="Message support" /><button type="submit" aria-label="Send message"><Send size={16} /></button></form>
      </section> : <button type="button" className="chat-launch-button" onClick={() => setOpen(true)} aria-label="Open live support chat"><MessageCircle size={21} /><span>Live support</span></button>}
    </div>
  )
}
