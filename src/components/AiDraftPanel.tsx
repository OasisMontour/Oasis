import { useState } from 'react'
import type { DraftQuestion } from '../lib/bulkPaste'
import { AI_MATERIAL_MAX, AI_MATERIAL_MIN, aiDraftError, draftQuestionsWithAi, type AiDraftKind } from '../lib/aiDraft'

/**
 * "Draft questions with AI" in the lesson builder. The teacher pastes material they're allowed to share (a
 * transcript, notes, a reading), and gets editable drafts with answer keys and pause points. Nothing is saved
 * until they press Save, and writing questions by hand keeps working whatever happens here.
 */
export function AiDraftPanel({
  durationS,
  open,
  onDrafts,
}: {
  durationS: number | null
  open?: boolean
  onDrafts: (qs: DraftQuestion[]) => void
}) {
  const [material, setMaterial] = useState('')
  const [count, setCount] = useState(5)
  const [kinds, setKinds] = useState<Set<AiDraftKind>>(new Set(['mc', 'short']))
  const [ok, setOk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const len = material.trim().length
  const toggle = (k: AiDraftKind) =>
    setKinds((s) => {
      const n = new Set(s)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })

  const why =
    !durationS ? 'Load the video first, so the questions fit its length.'
    : len < AI_MATERIAL_MIN ? `Paste at least ${AI_MATERIAL_MIN} characters of material.`
    : len > AI_MATERIAL_MAX ? `That's over ${AI_MATERIAL_MAX.toLocaleString()} characters. Trim it down.`
    : !kinds.size ? 'Pick at least one question type.'
    : !ok ? 'Tick the box to confirm this material is OK to send.'
    : null

  const run = async () => {
    if (why || !durationS || busy) return
    setBusy(true)
    setMsg({ kind: 'ok', text: 'Drafting questions… this can take up to a minute.' })
    const r = await draftQuestionsWithAi({ material: material.trim(), durationS, count, kinds: [...kinds] })
    setBusy(false)
    if (!r.ok) return setMsg({ kind: 'error', text: aiDraftError(r.error) })
    onDrafts(r.questions)
    const n = r.questions.length
    setMsg({
      kind: 'ok',
      text:
        `Added ${n} draft question${n === 1 ? '' : 's'}. Check every question, answer and time before you save.` +
        (r.timed ? ' Pause points follow the timestamps in your material.' : ' Your material had no timestamps, so pause points are spread evenly: move them to the right spots.') +
        ` ${r.left_today} AI draft${r.left_today === 1 ? '' : 's'} left today.`,
    })
  }

  return (
    <details className="card ai-draft" open={open || undefined}>
      <summary>
        Draft questions with AI <span className="muted small">For a sub plan in minutes</span>
      </summary>
      <div className="stack small">
        <p className="muted">
          Paste the video's transcript (on YouTube: ⋯ under the video, then Show transcript, and copy it with the timestamps) or your own
          notes. Oasis drafts questions, answer keys and pause points. You edit them, then save.
        </p>
        <textarea
          aria-label="Material for AI"
          rows={8}
          maxLength={AI_MATERIAL_MAX + 500}
          value={material}
          onChange={(e) => setMaterial(e.target.value)}
          placeholder={'0:00 Today we look at how cells get energy…\n1:12 The mitochondria…'}
          disabled={busy}
        />
        <p className="muted">{len.toLocaleString()} / {AI_MATERIAL_MAX.toLocaleString()} characters</p>
        <div className="row">
          <label>
            Questions{' '}
            <select value={count} onChange={(e) => setCount(Number(e.target.value))} disabled={busy}>
              {[3, 5, 8, 10].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={kinds.has('mc')} onChange={() => toggle('mc')} disabled={busy} /> Multiple choice
          </label>
          <label className="check">
            <input type="checkbox" checked={kinds.has('short')} onChange={() => toggle('short')} disabled={busy} /> Short answer
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} disabled={busy} />
          This material is OK to send to a free AI service: it has no student names or personal details, and I'm allowed to share it.
        </label>
        <p className="muted">
          It goes to Cloudflare, Groq or Cerebras, which don't train on it or keep it. Emails and phone numbers are removed before sending.
        </p>
        <div className="row">
          <button className="primary" onClick={() => void run()} disabled={!!why || busy}>
            {busy ? 'Drafting…' : 'Draft questions'}
          </button>
          {why && !busy && <span className="muted">{why}</span>}
        </div>
        {msg && (
          <p className={msg.kind} role={msg.kind === 'error' ? 'alert' : 'status'}>
            {msg.text}
          </p>
        )}
      </div>
    </details>
  )
}
