import { useEffect, useRef, useState, type FormEvent } from 'react'
import Markdown from 'react-markdown'
import { API_URL, backendHint, FRONTEND_ONLY, sendChat } from '../api'

interface Message {
  role: 'user' | 'assistant'
  text: string
  tools?: string[]
  error?: boolean
}

const SUGGESTIONS = ['Who teaches MGT 409?', 'How many core courses are there?', 'What are some good AI courses?']

const TOOL_LABEL: Record<string, string> = {
  search_courses: '📚 search_courses',
  web_search: '🌐 web_search',
}

export function ChatPanel() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, thinking])

  async function ask(text: string) {
    const question = text.trim()
    if (!question || thinking) return
    setMessages((m) => [...m, { role: 'user', text: question }])
    setInput('')
    setThinking(true)
    try {
      const res = await sendChat(question)
      setMessages((m) => [...m, { role: 'assistant', text: res.reply, tools: res.tools_used }])
    } catch {
      setMessages((m) => [
        ...m,
        { role: 'assistant', text: FRONTEND_ONLY ? 'Something went wrong searching the course list. Try refreshing.' : `Couldn't reach the backend at ${API_URL}. ${backendHint()}`, error: true },
      ])
    } finally {
      setThinking(false)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    ask(input)
  }

  if (!open) {
    return (
      <button className="chat-fab" onClick={() => setOpen(true)}>
        💬 Ask the course assistant
      </button>
    )
  }

  return (
    <aside className="chat-panel" aria-label="Course assistant chat">
      <header className="chat-header">
        <div>
          <strong>Course Assistant</strong>
          <span>{FRONTEND_ONLY ? 'Searches the SOM course list in your browser' : 'Searches the SOM course list & the web'}</span>
        </div>
        <button onClick={() => setOpen(false)} aria-label="Close chat">×</button>
      </header>

      <div className="chat-body">
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>Ask me anything about Fall 2026 SOM courses.</p>
            {SUGGESTIONS.map((s) => (
              <button key={s} className="suggestion" onClick={() => ask(s)}>{s}</button>
            ))}
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`bubble-row ${m.role}`}>
            <div className={`bubble ${m.role}${m.error ? ' error' : ''}`}>
              {m.role === 'assistant' ? (
                <Markdown components={{ a: (props) => <a {...props} target="_blank" rel="noreferrer" /> }}>{m.text}</Markdown>
              ) : (
                m.text
              )}
            </div>
            {m.role === 'assistant' && !m.error && (
              <div className="tools-used">
                {m.tools && m.tools.length > 0 ? (
                  <>Tools used: {m.tools.map((t) => <span key={t} className="tool-chip">{TOOL_LABEL[t] ?? t}</span>)}</>
                ) : (
                  'No tools used'
                )}
              </div>
            )}
          </div>
        ))}

        {thinking && (
          <div className="bubble-row assistant">
            <div className="bubble assistant thinking">
              <span className="spinner" aria-hidden /> Thinking…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form className="chat-input" onSubmit={onSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. Which finance courses meet on Monday?"
          disabled={thinking}
          autoFocus
        />
        <button type="submit" disabled={thinking || !input.trim()}>Send</button>
      </form>
    </aside>
  )
}
