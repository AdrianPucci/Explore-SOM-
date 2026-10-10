// Everything the React app needs to get courses and chat answers.
//
// Two modes:
// - Backend mode: talk to the FastAPI + PydanticAI backend (real AI agent with web search).
//   Used when VITE_API_URL is set, or when running locally (backend on 127.0.0.1:8000).
// - Front-end-only mode: the deployed static site with no backend. Courses come from
//   public/yale_som_classes.json and the chat is answered in the browser by localAssistant.ts.

import { answerLocally } from './localAssistant'

const IS_LOCAL_PAGE = ['127.0.0.1', 'localhost'].includes(window.location.hostname)
const CONFIGURED_API = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')

export const API_URL = CONFIGURED_API || (IS_LOCAL_PAGE ? 'http://127.0.0.1:8000' : '')
export const FRONTEND_ONLY = !API_URL

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

let bundledCourses: Promise<CourseRow[]> | null = null

/** The course file shipped with the site (front-end-only mode). Loaded once. */
function loadBundledCourses(): Promise<CourseRow[]> {
  bundledCourses ??= fetch(`${import.meta.env.BASE_URL}yale_som_classes.json`).then((res) => {
    if (!res.ok) throw new Error(`Course file failed (${res.status})`)
    return res.json()
  })
  return bundledCourses
}

export async function fetchCourses(q: string, signal?: AbortSignal): Promise<CourseRow[]> {
  if (FRONTEND_ONLY) {
    // Same filter as the backend's /api/courses: the text appears anywhere in the row.
    const courses = await loadBundledCourses()
    const needle = q.trim().toLowerCase()
    return needle ? courses.filter((c) => JSON.stringify(c).toLowerCase().includes(needle)) : courses
  }
  const url = new URL('/api/courses', API_URL)
  if (q.trim()) url.searchParams.set('q', q.trim())
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Course list failed (${res.status})`)
  const data: { count: number; courses: CourseRow[] } = await res.json()
  return data.courses
}

export async function sendChat(message: string): Promise<ChatReply> {
  if (FRONTEND_ONLY) return answerLocally(message, await loadBundledCourses())
  const res = await fetch(new URL('/api/chat', API_URL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })
  if (!res.ok) throw new Error(`Chat failed (${res.status})`)
  return res.json()
}

/** What to check when the backend can't be reached. */
export function backendHint(): string {
  if (IS_LOCAL_PAGE && !CONFIGURED_API) return 'Is `uvicorn main:app --port 8000` running in backend/?'
  return 'The backend may be waking up (free Render services sleep) — wait a minute and refresh.'
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
