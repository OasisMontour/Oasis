import { useState } from 'react'
import type { AdminAssignment } from '../lib/admin'

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '–')
const FIRST = 10

// Newest assignments first; the first 10 by default so the page stays scannable once every teacher is assigning.
export function AdminAssignments({ assignments }: { assignments: AdminAssignment[] | null }) {
  const [showAll, setShowAll] = useState(false)
  if (!assignments) return null
  const rows = showAll ? assignments : assignments.slice(0, FIRST)
  return (
    <section>
      <div className="section-head">
        <h2>Assignments</h2>
        {assignments.length > FIRST && (
          <button className="small" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
            {showAll ? `Show newest ${FIRST}` : `Show all ${assignments.length}`}
          </button>
        )}
      </div>
      {assignments.length === 0 && <p className="muted">No assignments yet.</p>}
      {assignments.length > 0 && (
        <div className="table-wrap">
          <table className="results-table">
            <thead>
              <tr>
                <th>Assigned</th>
                <th>Teacher</th>
                <th>Class</th>
                <th>Lesson</th>
                <th>Started</th>
                <th>Finished</th>
                <th>Avg score</th>
                <th>Flagged</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td>
                    {day(a.created_at)}
                    {a.due_at && <div className="muted small">due {day(a.due_at)}</div>}
                  </td>
                  <td>{a.teacher}</td>
                  <td>{a.class}</td>
                  <td>
                    {a.lesson}
                    {!a.posted_to_classroom && <div className="muted small">not posted to Classroom</div>}
                  </td>
                  <td>{a.started} / {a.students}</td>
                  <td>{a.finished} / {a.students}</td>
                  <td>{a.avg_score ?? '–'}</td>
                  <td>
                    {a.flagged > 0 ? (
                      <span className="tag warn" title={`${a.focus_events} times away from the video`}>{a.flagged} {a.flagged === 1 ? 'student' : 'students'}</span>
                    ) : (
                      <span className="muted">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">
        {showAll || assignments.length <= FIRST ? `${assignments.length} shown, newest first (up to 200).` : `Newest ${FIRST} of ${assignments.length}.`} Student-level
        results stay on each teacher's results page.
      </p>
    </section>
  )
}
