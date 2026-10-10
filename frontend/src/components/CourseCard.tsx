import { useEffect } from 'react'
import { displayName, displayTime, SESSION_LABEL, type CourseRow } from '../api'

/** One course = every section (row) that shares a course number and title. */
export interface CourseGroup {
  key: string
  first: CourseRow
  sections: CourseRow[]
}

export function groupCourses(rows: CourseRow[]): CourseGroup[] {
  const groups = new Map<string, CourseGroup>()
  for (const row of rows) {
    const key = `${row['Course Number']}|${row['Course Title']}`
    const group = groups.get(key)
    if (group) group.sections.push(row)
    else groups.set(key, { key, first: row, sections: [row] })
  }
  // Sort by the number part ("MGT 409" -> 409), so MBA courses come before PhD "MGMT 7xxx" ones.
  const num = (g: CourseGroup) => parseInt(g.first['Course Number'].replace(/\D+/g, ''), 10) || 0
  return [...groups.values()].sort((a, b) => num(a) - num(b) || a.first['Course Number'].localeCompare(b.first['Course Number']))
}

export function CourseCard({ group, onOpen }: { group: CourseGroup; onOpen: () => void }) {
  const c = group.first
  const faculty = [...new Set(group.sections.map((s) => displayName(s['Faculty 1'])))]
  return (
    <button className="card" onClick={onOpen}>
      <div className="card-top">
        <span className="course-number">{c['Course Number']}</span>
        <span className="tag">{c['Course Category']}</span>
      </div>
      <h3 className="card-title">{c['Course Title']}</h3>
      <p className="card-faculty">{faculty.slice(0, 2).join(', ')}{faculty.length > 2 ? ` +${faculty.length - 2}` : ''}</p>
      <div className="card-meta">
        <span>🕘 {displayTime(c.Daytimes)}</span>
        {group.sections.length > 1 && <span className="sections">{group.sections.length} sections</span>}
      </div>
      <div className="card-foot">
        <span>{SESSION_LABEL[c['Course Session']] ?? c['Course Session']}</span>
        <span>{c.Units} units</span>
      </div>
    </button>
  )
}

export function CourseDetail({ group, onClose }: { group: CourseGroup; onClose: () => void }) {
  const c = group.first
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label={c['Course Title']} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <span className="course-number">{c['Course Number']}</span>
        <h2>{c['Course Title']}</h2>
        <div className="modal-tags">
          <span className="tag">{c['Course Category']}</span>
          <span className="tag light">{SESSION_LABEL[c['Course Session']] ?? c['Course Session']}</span>
          <span className="tag light">{c.Units} units</span>
          <span className="tag light">{c['Bid Or Permission']}</span>
        </div>
        <p className="description">{c['Course Description']}</p>

        <h4>Sections</h4>
        <table className="sections-table">
          <thead><tr><th>Sec.</th><th>When</th><th>Room</th><th>Faculty</th></tr></thead>
          <tbody>
            {group.sections.map((s) => (
              <tr key={s['Course ID'] + s.Section}>
                <td>{s.Section}</td>
                <td>{displayTime(s.Daytimes)}</td>
                <td>{s.Room || '—'}</td>
                <td>{displayName(s['Faculty 1'])}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {c.faculty_bio && (
          <>
            <h4>About {displayName(c['Faculty 1'])}</h4>
            <p className="bio">{c.faculty_bio}</p>
          </>
        )}
      </div>
    </div>
  )
}
