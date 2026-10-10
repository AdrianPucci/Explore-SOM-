import { useEffect, useMemo, useState } from 'react'
import { API_URL, backendHint, fetchCourses, FRONTEND_ONLY, type CourseRow } from './api'
import { ChatPanel } from './components/ChatPanel'
import { CourseCard, CourseDetail, groupCourses, type CourseGroup } from './components/CourseCard'

const SESSIONS = [
  { value: '', label: 'All sessions' },
  { value: 'fall', label: 'Full fall' },
  { value: 'fall-1', label: 'Fall 1' },
  { value: 'fall-2', label: 'Fall 2' },
]
const TOP_CATEGORIES = 10 // chips shown before "+N more"

export default function App() {
  const [rows, setRows] = useState<CourseRow[]>([])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [session, setSession] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<CourseGroup | null>(null)
  const [showAllCategories, setShowAllCategories] = useState(false)

  // Ask the backend for courses matching the search box, waiting until typing pauses.
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setLoading(true)
      fetchCourses(query, controller.signal)
        .then((data) => { setRows(data); setError('') })
        .catch((e) => { if (e.name !== 'AbortError') setError(FRONTEND_ONLY ? 'Could not load the course list. Try refreshing the page.' : `Could not load courses from ${API_URL}. ${backendHint()}`) })
        .finally(() => setLoading(false))
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [query])

  const categories = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of rows) {
      if (r['Course Category'].trim()) counts.set(r['Course Category'], (counts.get(r['Course Category']) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name)
  }, [rows])

  const groups = useMemo(
    () => groupCourses(rows.filter((r) =>
      (!category || r['Course Category'] === category) && (!session || r['Course Session'] === session))),
    [rows, category, session],
  )

  return (
    <>
      <header className="hero">
        <div className="hero-inner">
          <p className="eyebrow">Yale School of Management · Fall 2026</p>
          <h1>Course Explorer</h1>
          <p className="hero-sub">Browse every SOM course, or ask the assistant who teaches what, when it meets, and what's worth taking.</p>
          <div className="search">
            <span aria-hidden>🔍</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by title, number, faculty, room, topic…"
              aria-label="Search courses"
            />
            {query && <button onClick={() => setQuery('')} aria-label="Clear search">×</button>}
          </div>
        </div>
      </header>

      <main className="content">
        <div className="filters">
          <div className="chips">
            <button className={`chip ${category === '' ? 'active' : ''}`} onClick={() => setCategory('')}>All</button>
            {(showAllCategories ? categories : categories.slice(0, TOP_CATEGORIES)).map((c) => (
              <button key={c} className={`chip ${category === c ? 'active' : ''}`} onClick={() => setCategory(c === category ? '' : c)}>
                {c}
              </button>
            ))}
            {categories.length > TOP_CATEGORIES && (
              <button className="chip more" onClick={() => setShowAllCategories((v) => !v)}>
                {showAllCategories ? 'Fewer' : `+${categories.length - TOP_CATEGORIES} more`}
              </button>
            )}
          </div>
          <select value={session} onChange={(e) => setSession(e.target.value)} aria-label="Session">
            {SESSIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        <p className="result-count">
          {loading ? 'Loading…' : `${groups.length} course${groups.length === 1 ? '' : 's'}`}
        </p>
        {error && <p className="error-banner">{error}</p>}

        <section className="grid">
          {groups.map((g) => <CourseCard key={g.key} group={g} onOpen={() => setSelected(g)} />)}
        </section>
        {!loading && !error && groups.length === 0 && <p className="empty">No courses match. Try a different search.</p>}
      </main>

      {selected && <CourseDetail group={selected} onClose={() => setSelected(null)} />}
      <ChatPanel />
    </>
  )
}
