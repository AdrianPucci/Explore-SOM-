// A no-backend course assistant: answers questions by searching the course JSON in the browser.
// Used on the deployed static site, where there is no server (and no place to keep an API key),
// so there is no AI model and no web search — just search_courses, done in TypeScript.

import { displayName, displayTime, SESSION_LABEL, type ChatReply, type CourseRow } from './api'

const MAX_LISTED = 8

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'for', 'to', 'with', 'is', 'are', 'there', 'what', 'which',
  'who', 'whom', 'when', 'where', 'how', 'many', 'much', 'some', 'any', 'good', 'best', 'great', 'cool', 'me',
  'i', 'my', 'can', 'do', 'does', 'teach', 'teaches', 'teaching', 'taught', 'by', 'course', 'courses', 'class',
  'classes', 'about', 'tell', 'show', 'list', 'find', 'give', 'please', 'meet', 'meets', 'offered', 'take',
  'should', 'would', 'like', 'want', 'interested', 'have', 'has', 'that', 'this', 'at', 'som', 'yale', 'fall',
])

const DAYS: Record<string, string> = {
  monday: 'M', mondays: 'M', tuesday: 'T', tuesdays: 'T', wednesday: 'W', wednesdays: 'W',
  thursday: 'Th', thursdays: 'Th', friday: 'F', fridays: 'F',
}
const DAY_NAMES: Record<string, string> = { M: 'Monday', T: 'Tuesday', W: 'Wednesday', Th: 'Thursday', F: 'Friday' }

function meetingDays(row: CourseRow): Set<string> {
  const days = new Set<string>()
  for (const token of row.Daytimes.trim().split(/\s+/)) {
    if (/\d/.test(token)) break
    if (token) days.add(token)
  }
  return days
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Short words ("AI") must be whole words; longer ones may match a word's start ("financ" -> "financial"). */
function matchesTerm(term: string, text: string) {
  const pattern = term.length <= 3 ? `\\b${escapeRegex(term)}\\b` : `\\b${escapeRegex(term)}`
  return new RegExp(pattern, 'i').test(text)
}

/** The text a topic word is searched in. Faculty bios are only searched if nothing else matches. */
function haystack(r: CourseRow, withBio = false) {
  return [r['Course Number'], r['Course Title'], r['Course Category'], r['Course Type'], r['Faculty 1'],
    r.Daytimes, r.Room, r['Course Description'], withBio ? r.faculty_bio : ''].join(' ')
}

/** Collapse sections that share a course number + title into one entry. */
function byCourse(rows: CourseRow[]) {
  const groups = new Map<string, CourseRow[]>()
  for (const r of rows) {
    const key = `${r['Course Number']}|${r['Course Title']}`
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  return [...groups.values()]
}

function courseLine(sections: CourseRow[]) {
  const c = sections[0]
  const faculty = [...new Set(sections.map((s) => displayName(s['Faculty 1'])))].join(', ')
  const when = sections.length > 1 ? `${sections.length} sections` : displayTime(c.Daytimes)
  const session = SESSION_LABEL[c['Course Session']] ?? c['Course Session']
  return `- **${c['Course Number']} — ${c['Course Title']}** · ${faculty} · ${when} · ${session} · ${c.Units} units`
}

function courseList(rows: CourseRow[]) {
  const courses = byCourse(rows)
  const lines = courses.slice(0, MAX_LISTED).map(courseLine)
  if (courses.length > MAX_LISTED) lines.push(`- …and ${courses.length - MAX_LISTED} more. Use the search box above to see them all.`)
  return lines.join('\n')
}

function trim(text: string, limit: number) {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length <= limit ? t : `${t.slice(0, limit).trimEnd()}…`
}

/** Full answer about one course number (e.g. "MGT 409"). */
function describeCourse(sections: CourseRow[]) {
  const c = sections[0]
  const faculty = [...new Set(sections.map((s) => displayName(s['Faculty 1'])))]
  const lines = [
    `**${c['Course Number']} — ${c['Course Title']}** is taught by **${faculty.join(', ')}**.`,
    '',
    `${SESSION_LABEL[c['Course Session']] ?? c['Course Session']} · ${c.Units} units · ${c['Course Category']}`,
    '',
    ...sections.map((s) => `- Section ${s.Section}: ${displayTime(s.Daytimes)}${s.Room ? ` · ${s.Room}` : ''} · ${displayName(s['Faculty 1'])}`),
    '',
    trim(c['Course Description'], 400),
  ]
  return lines.join('\n')
}

export function answerLocally(message: string, all: CourseRow[]): ChatReply {
  const tools_used = ['search_courses']
  const text = message.toLowerCase()

  // 1. A specific course number: "who teaches MGT 409?", "when does mgt409 meet?"
  const numberMatch = message.match(/\b([A-Za-z]{3,4})\s*(\d{3,4})\b/)
  if (numberMatch) {
    const number = `${numberMatch[1].toUpperCase()} ${numberMatch[2]}`
    const rows = all.filter((r) => r['Course Number'].replace(/\s+/g, ' ').toUpperCase() === number)
    if (rows.length === 0) return { reply: `I couldn't find **${number}** in the Fall 2026 course list.`, tools_used }
    return { reply: byCourse(rows).map(describeCourse).join('\n\n---\n\n'), tools_used }
  }

  // Filters the question mentions: a category ("core", "finance"), a day ("monday"), a faculty last name.
  const categories = [...new Set(all.map((r) => r['Course Category']).filter(Boolean))]
    .sort((a, b) => b.length - a.length) // longest first, so "Entrepreneurship & Private Equity" beats shorter names
  const category = categories.find((c) => new RegExp(`\\b${escapeRegex(c.toLowerCase())}\\b`).test(text))
  const dayWord = Object.keys(DAYS).find((d) => new RegExp(`\\b${d}\\b`).test(text))
  const day = dayWord ? DAYS[dayWord] : undefined
  const facultyLast = [...new Set(all.map((r) => r['Faculty 1'].split(',')[0].trim()).filter((n) => n.length > 2))]
    .find((last) => new RegExp(`\\b${escapeRegex(last.toLowerCase())}\\b`).test(text))

  let rows = all
  if (category) rows = rows.filter((r) => r['Course Category'] === category)
  if (day) rows = rows.filter((r) => meetingDays(r).has(day))
  if (facultyLast) rows = rows.filter((r) => r['Faculty 1'].toLowerCase().startsWith(facultyLast.toLowerCase()))

  // Remaining words are topic keywords ("AI", "negotiation", "private equity").
  const used = new Set([category, dayWord, facultyLast].filter(Boolean).flatMap((s) => s!.toLowerCase().split(/\s+/)))
  const terms = (text.match(/[\p{L}\p{N}&'-]+/gu) ?? [])
    .map((t) => t.replace(/'s$/, ''))
    .filter((t) => !STOPWORDS.has(t) && !used.has(t))
  if (terms.length) {
    // Strictest first: every word in the course itself, then also faculty bios, then any one word.
    let hits = rows.filter((r) => terms.every((t) => matchesTerm(t, haystack(r))))
    if (hits.length === 0) hits = rows.filter((r) => terms.every((t) => matchesTerm(t, haystack(r, true))))
    if (hits.length === 0) hits = rows.filter((r) => terms.some((t) => matchesTerm(t, haystack(r, true))))
    // Courses with the keyword in the title first.
    rows = hits.sort((a, b) =>
      terms.filter((t) => matchesTerm(t, b['Course Title'])).length - terms.filter((t) => matchesTerm(t, a['Course Title'])).length)
  }

  const filtersUsed = category || day || facultyLast || terms.length
  if (!filtersUsed) {
    return {
      reply: 'Try asking about a course number ("Who teaches MGT 409?"), a category ("How many core courses are there?"), '
        + 'a topic ("What are some AI courses?"), a day ("Finance courses on Monday"), or a professor\'s last name.',
      tools_used: [],
    }
  }

  // e.g. "Finance courses about valuation taught by Tookes meeting on Monday"
  const describe = (n: number) => [
    `${category ? `**${category}** ` : ''}course${n === 1 ? '' : 's'}`,
    terms.length ? `about **${terms.map((t) => (t.length <= 3 ? t.toUpperCase() : t)).join(' ')}**` : '',
    facultyLast ? `taught by **${facultyLast}**` : '',
    day ? `meeting on **${DAY_NAMES[day]}**` : '',
  ].filter(Boolean).join(' ')

  if (rows.length === 0) {
    return { reply: `I didn't find any ${describe(2)} in the Fall 2026 list. Try different words.`, tools_used }
  }

  const distinct = byCourse(rows).length
  const counts = /\bhow many\b|\bnumber of\b|\bcount\b/.test(text)
    ? `There are **${distinct}** ${describe(distinct)} (${rows.length} section${rows.length === 1 ? '' : 's'} in total).`
    : `I found **${distinct}** ${describe(distinct)}:`
  // EMBA core courses are filed under the "EMBA" category, so point them out when someone asks about core.
  let embaNote = ''
  if (category === 'Core' && !terms.length && !facultyLast && !day) {
    const embaCore = byCourse(all.filter((r) => r['Course Category'] === 'EMBA' && /\bcore\b/i.test(r['Course Type']))).length
    if (embaCore) embaNote = `\n\nThat's the MBA core. There are also **${embaCore} EMBA core courses** (filed under the EMBA category).`
  }
  return { reply: `${counts}\n\n${courseList(rows)}${embaNote}`, tools_used }
}
