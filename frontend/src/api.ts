// Everything the React app needs to talk to the FastAPI backend.

// On Render, set VITE_API_URL to the backend's URL (it is baked in at build time, so redeploy after changing it).
export const API_URL = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '')

const IS_LOCAL_API = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(API_URL)
const IS_LOCAL_PAGE = ['127.0.0.1', 'localhost'].includes(window.location.hostname)

/** What to check when the backend can't be reached, depending on where the page is running. */
export function backendHint(): string {
  if (IS_LOCAL_API && !IS_LOCAL_PAGE) {
    return 'This site was built without VITE_API_URL. In Render, set VITE_API_URL to your backend URL and redeploy the static site.'
  }
  if (IS_LOCAL_API) return 'Is `uvicorn main:app --port 8000` running in backend/?'
  return 'The backend may be waking up (free Render services sleep) — wait a minute and refresh.'
}

/** One row of yale_som_classes.json, exactly as /api/courses returns it. */
export interface CourseRow {
  'Course ID': string
  'Course Number': string
  'Course Title': string
  'Course Category': string
  'Course Type': string
  'Course Session': string
  'Course Description': string
  Section: string
  Units: string
  Daytimes: string
  Room: string
  'Faculty 1': string
  'Faculty 1 Email': string
  'Bid Or Permission': string
  faculty_bio: string
}

export interface ChatReply {
  reply: string
  tools_used: string[]
}

export async function fetchCourses(q: string, signal?: AbortSignal): Promise<CourseRow[]> {
  const url = new URL('/api/courses', API_URL)
  if (q.trim()) url.searchParams.set('q', q.trim())
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Course list failed (${res.status})`)
  const data: { count: number; courses: CourseRow[] } = await res.json()
  return data.courses
}

export async function sendChat(message: string): Promise<ChatReply> {
  const res = await fetch(new URL('/api/chat', API_URL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })
  if (!res.ok) throw new Error(`Chat failed (${res.status})`)
  return res.json()
}

/** "Zaman, Tauhid" -> "Tauhid Zaman" */
export function displayName(lastFirst: string): string {
  const [last, first] = lastFirst.split(',').map((s) => s.trim())
  return first ? `${first} ${last}` : lastFirst.trim()
}

/** "M  W 10:05 AM-11:25 AM" -> "Mon · Wed  10:05 AM–11:25 AM" */
export function displayTime(daytimes: string): string {
  if (!daytimes.trim()) return 'Time TBA'
  const names: Record<string, string> = { M: 'Mon', T: 'Tue', W: 'Wed', Th: 'Thu', F: 'Fri' }
  const tokens = daytimes.trim().split(/\s+/)
  const firstTime = tokens.findIndex((t) => /\d/.test(t))
  const days = tokens.slice(0, firstTime < 0 ? tokens.length : firstTime).map((d) => names[d] ?? d)
  const time = firstTime < 0 ? '' : tokens.slice(firstTime).join(' ').replace('-', '–')
  return `${days.join(' · ')}  ${time}`.trim()
}

export const SESSION_LABEL: Record<string, string> = {
  fall: 'Full fall',
  'fall-1': 'Fall 1',
  'fall-2': 'Fall 2',
}
