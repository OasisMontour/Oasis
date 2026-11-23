import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { BULK_PASTE_EXAMPLE, parseBulkPaste, type DraftQuestion } from '../lib/bulkPaste'
import { EDPUZZLE_IMPORT_EXAMPLE, parseEdpuzzlePaste } from '../lib/edpuzzleImport'
import { formatTime, parseTime } from '../lib/time'
import { loadYouTubeApi, parseYouTubeId, youTubeErrorMessage, type YTPlayer } from '../lib/youtube'

type Draft = DraftQuestion & { key: string; timeText: string }

let keySeq = 0
const toDraft = (q: DraftQuestion): Draft => ({ ...q, key: `q${++keySeq}`, timeText: formatTime(q.at_s) })

export function LessonBuilder() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isNew = !id
  const [searchParams] = useSearchParams()

  const [videoInput, setVideoInput] = useState('')
  const [youtubeId, setYoutubeId] = useState<string | null>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [videoError, setVideoError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('')
  const [fullscreen, setFullscreen] = useState(true)
  const [aiGrade, setAiGrade] = useState(false)
  const [questions, setQuestions] = useState<Draft[]>([])
  // How the questions got here. Only recorded for analytics; imported lessons are ordinary lessons.
  const [source, setSource] = useState<'manual' | 'bulk_paste' | 'edpuzzle'>('manual')
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [dirty, setDirty] = useState(false)

  const playerEl = useRef<HTMLDivElement>(null)
  const player = useRef<YTPlayer | null>(null)

  // ---- load an existing lesson
  useEffect(() => {
    if (isNew) return
    ;(async () => {
      const { data, error } = await supabase
        .from('lessons')
        .select('id, title, subject, youtube_id, duration_s, require_fullscreen, ai_grade_short, questions(id, at_s, kind, prompt, choices, correct_index, position)')
        .eq('id', id)
        .single()
      setLoading(false)
      if (error || !data) return setStatus({ kind: 'error', text: "Couldn't load that lesson." })
      setTitle(data.title)
      setSubject(data.subject)
      setVideoInput(`https://youtu.be/${data.youtube_id}`)
      setYoutubeId(data.youtube_id)
      setDuration(Number(data.duration_s))
      setFullscreen(data.require_fullscreen)
      setAiGrade(data.ai_grade_short)
      const qs = [...(data.questions as (DraftQuestion & { id: string; position: number })[])].sort(
        (a, b) => a.at_s - b.at_s || a.position - b.position,
      )
      setQuestions(qs.map((q) => toDraft({ ...q, at_s: Number(q.at_s), choices: q.choices ?? [] })))
    })()
  }, [id, isNew])

  // ---- warn before leaving with unsaved edits
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  // ---- mount the preview player whenever the video changes
  useEffect(() => {
    if (!youtubeId || !playerEl.current) return
    let cancelled = false
    const mount = document.createElement('div')
    playerEl.current.replaceChildren(mount)
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled) return
        const p = new YT.Player(mount, {
          videoId: youtubeId,
          playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
          events: {
            onReady: () => {
              // getDuration() can be 0 for a moment after ready; poll briefly.
              let tries = 0
              const check = () => {
                if (cancelled) return
                const d = p.getDuration()
                if (d > 0) setDuration(Math.floor(d))
                else if (++tries < 20) setTimeout(check, 250)
                else setVideoError("Couldn't read this video's length. Live streams can't be used.")
              }
              check()
            },
            onError: (e) => !cancelled && setVideoError(youTubeErrorMessage(e.data)),
          },
        })
        player.current = p
      })
      .catch((e: Error) => !cancelled && setVideoError(e.message))
    return () => {
      cancelled = true
      player.current?.destroy()
      player.current = null
    }
  }, [youtubeId, loading])

  const touch = () => {
    setDirty(true)
    setStatus(null)
  }

  const loadVideo = () => {
    if (!videoInput.trim()) return // blurring an empty field isn't an error
    const vid = parseYouTubeId(videoInput)
    if (!vid && /edpuzzle\.com/i.test(videoInput))
      return setVideoError("That's an Edpuzzle link. Oasis plays the video from YouTube: open the video on YouTube and paste that link.")
    if (!vid) return setVideoError("That doesn't look like a YouTube link.")
    if (vid === youtubeId) return
    setVideoError(null)
    setDuration(null)
    setYoutubeId(vid)
    touch()
  }

  const now = () => Math.floor(player.current?.getCurrentTime() ?? 0)

  const addQuestion = (kind: 'mc' | 'short') => {
    player.current?.pauseVideo()
    const q = toDraft({ at_s: now(), kind, prompt: '', choices: kind === 'mc' ? ['', ''] : [], correct_index: kind === 'mc' ? 0 : null })
    setQuestions((qs) => [...qs, q].sort((a, b) => a.at_s - b.at_s))
    touch()
  }

  const update = (key: string, patch: Partial<Draft>) => {
    setQuestions((qs) => qs.map((q) => (q.key === key ? { ...q, ...patch } : q)))
    touch()
  }

  const remove = (key: string) => {
    setQuestions((qs) => qs.filter((q) => q.key !== key))
    touch()
  }

  const sortByTime = () => setQuestions((qs) => [...qs].sort((a, b) => a.at_s - b.at_s))

  // ---- bulk paste
  const [bulkText, setBulkText] = useState('')
  const [bulkErrors, setBulkErrors] = useState<string[]>([])
  const addBulk = () => {
    const r = parseBulkPaste(bulkText)
    setBulkErrors(r.errors)
    if (r.errors.length) return
    setQuestions((qs) => [...qs, ...r.questions.map(toDraft)].sort((a, b) => a.at_s - b.at_s))
    setBulkText('')
    setSource((s) => (s === 'edpuzzle' ? s : 'bulk_paste'))
    touch()
  }

  // ---- Edpuzzle import: the teacher copies their own lesson's questions and pastes them here.
  // Nothing is fetched from Edpuzzle. Imported questions are plain drafts and save through
  // save_lesson like any other, so they get the same ownership checks and question locking.
  const [importText, setImportText] = useState('')
  const [importNote, setImportNote] = useState<{ added: number; needAnswer: number; warnings: string[] } | null>(null)
  const addImport = () => {
    const r = parseEdpuzzlePaste(importText)
    const needAnswer = r.questions.filter((q) => q.kind === 'mc' && q.correct_index === null).length
    setImportNote({ added: r.questions.length, needAnswer, warnings: r.warnings })
    if (r.youtubeId && !youtubeId) {
      setVideoInput(`https://youtu.be/${r.youtubeId}`)
      setVideoError(null)
      setDuration(null)
      setYoutubeId(r.youtubeId)
    }
    if (!r.questions.length) return
    setQuestions((qs) => [...qs, ...r.questions.map(toDraft)].sort((a, b) => a.at_s - b.at_s))
    setImportText('')
    setSource('edpuzzle')
    touch()
  }

  // ---- save
  const problems = (): string[] => {
    const out: string[] = []
    if (!youtubeId) out.push('Add a YouTube video.')
    else if (!duration) out.push('Wait for the video to load.')
    if (!title.trim()) out.push('Give the lesson a title.')
    questions.forEach((q, i) => {
      const n = `Question ${i + 1}`
      if (parseTime(q.timeText) === null) out.push(`${n}: the time should look like 1:30.`)
      else if (duration && q.at_s > duration) out.push(`${n}: ${formatTime(q.at_s)} is past the end of the video (${formatTime(duration)}).`)
      if (!q.prompt.trim()) out.push(`${n}: write the question.`)
      if (q.kind === 'mc' && q.choices.some((c) => !c.trim())) out.push(`${n}: fill in every choice or remove the empty ones.`)
      if (q.kind === 'mc' && q.correct_index === null) out.push(`${n}: pick the right answer with the circle.`)
    })
    return out
  }

  const save = async () => {
    const p = problems()
    if (p.length) return setStatus({ kind: 'error', text: p.join(' ') })
    setSaving(true)
    const { data, error } = await supabase.rpc('save_lesson', {
      p_lesson: {
        id: id ?? null,
        title: title.trim(),
        subject: subject.trim(),
        youtube_id: youtubeId,
        duration_s: duration,
        require_fullscreen: fullscreen,
        ai_grade_short: aiGrade,
        source,
      },
      p_questions: [...questions]
        .sort((a, b) => a.at_s - b.at_s)
        .map((q) => ({
          id: q.id ?? null,
          at_s: q.at_s,
          kind: q.kind,
          prompt: q.prompt.trim(),
          choices: q.kind === 'mc' ? q.choices.map((c) => c.trim()) : null,
          correct_index: q.kind === 'mc' ? q.correct_index : null,
        })),
    })
    setSaving(false)
    if (error) return setStatus({ kind: 'error', text: error.message })
    setDirty(false)
    if (isNew) navigate(`/teacher/lessons/${data}`, { replace: true })
    else {
      // reload so new questions pick up their ids
      const { data: qs } = await supabase
        .from('questions')
        .select('id, at_s, kind, prompt, choices, correct_index')
        .eq('lesson_id', id)
        .order('at_s')
        .order('position')
      if (qs) setQuestions(qs.map((q) => toDraft({ ...q, at_s: Number(q.at_s), choices: q.choices ?? [] })))
    }
    setStatus({ kind: 'ok', text: 'Saved.' })
  }

  // Shown first when the teacher came here to import, otherwise tucked under the questions.
  const fromEdpuzzle = searchParams.get('from') === 'edpuzzle'
  const importPanel = (
    <details className="card" open={fromEdpuzzle || undefined}>
      <summary>Bring over an Edpuzzle lesson</summary>
      <ol className="muted small">
        <li>Open the lesson in Edpuzzle and click into the video's questions.</li>
        <li>Select the questions (or the whole page) and copy.</li>
        <li>Paste below. Times, questions and choices come over; anything else is ignored.</li>
      </ol>
      <p className="muted small">
        Edpuzzle doesn't copy which answer is right unless you add a * or ✓ next to it, so you'll pick those here. Video
        crops, notes, voiceovers and uploaded (non-YouTube) videos don't come over.
      </p>
      <textarea aria-label="Edpuzzle questions" rows={10} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder={EDPUZZLE_IMPORT_EXAMPLE} />
      <button onClick={addImport} disabled={!importText.trim()}>Import questions</button>
      {importNote && (
        <div role="status" className="stack small">
          <p className={importNote.added ? 'ok' : 'error'}>
            {importNote.added ? `Added ${importNote.added} question${importNote.added === 1 ? '' : 's'}.` : 'No questions found.'}
            {importNote.needAnswer > 0 && ` ${importNote.needAnswer} need you to pick the right answer (marked in red).`}
            {importNote.added > 0 && !youtubeId && ' Now paste the YouTube link at the top.'}
          </p>
          {importNote.warnings.length > 0 && <ul className="muted">{importNote.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        </div>
      )}
    </details>
  )

  if (loading) return <p className="muted center">Loading…</p>

  return (
    <main className="page builder">
      <header className="bar">
        <Link
          to="/teacher"
          onClick={(e) => {
            // beforeunload only covers closing the tab; in-app navigation needs its own check
            if (dirty && !window.confirm('You have unsaved changes. Leave without saving?')) e.preventDefault()
          }}
        >
          ← Back
        </Link>
        <strong>{isNew ? 'New lesson' : 'Edit lesson'}</strong>
        <button className="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </header>
      {status && <p className={status.kind} role={status.kind === 'error' ? 'alert' : 'status'}>{status.text}</p>}

      {fromEdpuzzle && <section>{importPanel}</section>}

      <section className="stack">
        <label>
          YouTube link
          <span className="row">
            <input className="text grow" value={videoInput} onChange={(e) => setVideoInput(e.target.value)} onBlur={loadVideo}
              onKeyDown={(e) => e.key === 'Enter' && loadVideo()} placeholder="https://www.youtube.com/watch?v=…" />
            <button onClick={loadVideo}>Load</button>
          </span>
        </label>
        {videoError && <p className="error">{videoError}</p>}
        <div ref={playerEl} className="video" hidden={!youtubeId} />
        {duration !== null && <p className="muted small">Video length {formatTime(duration)}</p>}

        <label>
          Title
          <input className="text" value={title} maxLength={200} onChange={(e) => { setTitle(e.target.value); touch() }} />
        </label>
        <label>
          Subject
          <input className="text" value={subject} onChange={(e) => { setSubject(e.target.value); touch() }} placeholder="Biology" />
        </label>
        <label className="check">
          <input type="checkbox" checked={fullscreen} onChange={(e) => { setFullscreen(e.target.checked); touch() }} />
          Students must watch fullscreen (pauses and flags them if they leave)
        </label>
        <label className="check">
          <input type="checkbox" checked={aiGrade} onChange={(e) => { setAiGrade(e.target.checked); touch() }} />
          Suggest grades for short answers with AI (you can always change them)
        </label>
      </section>

      <section>
        <div className="section-head">
          <h2>Questions ({questions.length})</h2>
          <span className="row">
            <button onClick={() => addQuestion('mc')} disabled={!duration}>+ Multiple choice here</button>
            <button onClick={() => addQuestion('short')} disabled={!duration}>+ Short answer here</button>
          </span>
        </div>
        <p className="muted small">Pause the video where you want a question, then add it. Students can't skip past a question until they answer it.</p>

        <ol className="cards">
          {questions.map((q, i) => (
            <li key={q.key} className="card stack">
              <div className="row">
                <strong>{i + 1}.</strong>
                <input
                  aria-label="Time"
                  className="text time"
                  value={q.timeText}
                  onChange={(e) => {
                    const t = parseTime(e.target.value)
                    update(q.key, { timeText: e.target.value, ...(t !== null ? { at_s: t } : {}) })
                  }}
                  onBlur={sortByTime}
                />
                <button className="small" onClick={() => { const t = now(); update(q.key, { at_s: t, timeText: formatTime(t) }); sortByTime() }}>
                  Use current time
                </button>
                <button className="small" onClick={() => player.current?.seekTo(q.at_s, true)}>Jump to</button>
                <select
                  aria-label="Question type"
                  value={q.kind}
                  onChange={(e) => {
                    const kind = e.target.value as 'mc' | 'short'
                    update(q.key, kind === 'mc' ? { kind, choices: q.choices.length >= 2 ? q.choices : ['', ''], correct_index: q.correct_index ?? 0 } : { kind, choices: [], correct_index: null })
                  }}
                >
                  <option value="mc">Multiple choice</option>
                  <option value="short">Short answer</option>
                </select>
                <button className="small danger" onClick={() => remove(q.key)}>Delete</button>
              </div>
              <textarea aria-label="Question" rows={2} value={q.prompt} maxLength={2000} onChange={(e) => update(q.key, { prompt: e.target.value })} placeholder="Type the question" />
              {q.kind === 'mc' && (
                <div className="stack">
                  {q.choices.map((c, ci) => (
                    <div key={ci} className="row">
                      <input type="radio" name={`correct-${q.key}`} aria-label={`Choice ${ci + 1} is correct`} checked={q.correct_index === ci} onChange={() => update(q.key, { correct_index: ci })} />
                      <input className="text grow" value={c} onChange={(e) => update(q.key, { choices: q.choices.map((x, j) => (j === ci ? e.target.value : x)) })} placeholder={`Choice ${String.fromCharCode(65 + ci)}`} />
                      {q.choices.length > 2 && (
                        <button className="small" aria-label="Remove choice" onClick={() => {
                          const choices = q.choices.filter((_, j) => j !== ci)
                          // Removing the right answer must not silently make choice A right (on an assigned
                          // lesson that would re-grade every student on save). Make the teacher pick again.
                          const ki = q.correct_index
                          update(q.key, { choices, correct_index: ki === null || ki === ci ? null : ki > ci ? ki - 1 : ki })
                        }}>✕</button>
                      )}
                    </div>
                  ))}
                  {q.choices.length < 6 && <button className="small" onClick={() => update(q.key, { choices: [...q.choices, ''] })}>+ Add choice</button>}
                  <p className={q.correct_index === null ? 'error small' : 'muted small'}>Pick the right answer with the circle.</p>
                </div>
              )}
            </li>
          ))}
        </ol>

        {!fromEdpuzzle && importPanel}

        <details className="card">
          <summary>Paste a bunch of questions at once</summary>
          <p className="muted small">One question per block. Start with the time, mark the right choice with *. No choices means short answer.</p>
          <textarea rows={10} value={bulkText} onChange={(e) => setBulkText(e.target.value)} placeholder={BULK_PASTE_EXAMPLE} />
          {bulkErrors.length > 0 && (
            <ul className="error small">{bulkErrors.map((e) => <li key={e}>{e}</li>)}</ul>
          )}
          <button onClick={addBulk} disabled={!bulkText.trim()}>Add these questions</button>
        </details>
      </section>
    </main>
  )
}
