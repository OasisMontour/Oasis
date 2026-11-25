import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { BULK_PASTE_EXAMPLE, parseBulkPaste, type DraftQuestion } from '../lib/bulkPaste'
import { EDPUZZLE_IMPORT_EXAMPLE, parseEdpuzzlePaste } from '../lib/edpuzzleImport'
import { bookmarkletHref, readBookmarkletHash } from '../lib/edpuzzleBookmarklet'
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
  const [shared, setShared] = useState(false)
  const copyId = isNew ? searchParams.get('copy') : null
  const starterId = isNew ? searchParams.get('starter') : null
  const [fullscreen, setFullscreen] = useState(true)
  const [aiGrade, setAiGrade] = useState(false)
  const [questions, setQuestions] = useState<Draft[]>([])
  // How the questions got here. Only recorded for analytics; imported lessons are ordinary lessons.
  const [source, setSource] = useState<'manual' | 'bulk_paste' | 'edpuzzle'>('manual')
  const [loading, setLoading] = useState(Boolean(id || copyId || starterId))
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [dirty, setDirty] = useState(false)
  // A bad or someone else's lesson id: show an error, not an empty form that would fail (or create a copy) on Save.
  const [loadFailed, setLoadFailed] = useState(false)

  const playerEl = useRef<HTMLDivElement>(null)
  const player = useRef<YTPlayer | null>(null)

  // ---- load an existing lesson
  useEffect(() => {
    if (!id && !copyId && !starterId) return
    let active = true
    ;(async () => {
      if (starterId) {
        const { data, error } = await supabase.from('starter_lessons').select('*').eq('id', starterId).single()
        if (!active) return
        setLoading(false)
        if (error || !data) return setStatus({ kind: 'error', text: 'Could not load this starter lesson.' })
        setTitle(data.title)
        setSubject(data.subject)
        setVideoInput('https://youtu.be/' + data.youtube_id)
        setYoutubeId(data.youtube_id)
        setQuestions((data.questions as DraftQuestion[]).map(toDraft))
        setDirty(true)
        return
      }
      let query = supabase.from('lessons')
        .select('id, shared, title, subject, youtube_id, duration_s, require_fullscreen, ai_grade_short, questions(id, at_s, kind, prompt, choices, correct_index, position, rubric)')
        .eq('id', copyId || id)
      if (copyId) query = query.eq('shared', true)
      const { data, error } = await query.single()
      if (!active) return
      setLoading(false)
      if (error || !data) {
        if (copyId) return setStatus({ kind: 'error', text: "Couldn't load that lesson." })
        return setLoadFailed(true)
      }
      setShared(!copyId && data.shared)
      setDirty(Boolean(copyId))
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
      setQuestions(qs.map((q) => toDraft({ ...q, id: copyId ? undefined : q.id, at_s: Number(q.at_s), choices: q.choices ?? [] })))
    })()
    return () => { active = false }
  }, [id, copyId, starterId])

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
                if (d > 0) {
                  // For a live stream getDuration() is the time elapsed so far, so it keeps growing. Students could
                  // never reach the end, so check again after a moment.
                  setTimeout(() => {
                    if (cancelled) return
                    if (p.getDuration() > d + 1) setVideoError("That's a live stream. Use the video once the stream has ended.")
                    else setDuration(Math.floor(d))
                  }, 2500)
                } else if (++tries < 20) setTimeout(check, 250)
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
  const [fromBookmarklet, setFromBookmarklet] = useState(false)
  const addImport = (text = importText, ytOverride: string | null = null) => {
    const r = parseEdpuzzlePaste(text)
    if (ytOverride) r.youtubeId = ytOverride
    // Pasting the same questions twice (easy to do) shouldn't double them up.
    const have = new Set(questions.map((q) => `${q.at_s}|${q.prompt.trim()}`))
    const fresh = r.questions.filter((q) => !have.has(`${q.at_s}|${q.prompt.trim()}`))
    const dupes = r.questions.length - fresh.length
    const warnings = dupes ? [...r.warnings, `Skipped ${dupes} question${dupes === 1 ? '' : 's'} already in this lesson.`] : r.warnings
    const needAnswer = fresh.filter((q) => q.kind === 'mc' && q.correct_index === null).length
    setImportNote({ added: fresh.length, needAnswer, warnings })
    if (r.youtubeId && !youtubeId) {
      setVideoInput(`https://youtu.be/${r.youtubeId}`)
      setVideoError(null)
      setDuration(null)
      setYoutubeId(r.youtubeId)
    }
    if (!fresh.length) return
    setQuestions((qs) => [...qs, ...fresh.map(toDraft)].sort((a, b) => a.at_s - b.at_s))
    setImportText('')
    setSource('edpuzzle')
    touch()
  }

  // Arriving from the "Send to Oasis" bookmarklet: the data is in the #fragment (never sent to a
  // server). It's untrusted, so it only pre-fills drafts; nothing is saved until the teacher clicks Save.
  const bookmarkletDone = useRef(false)
  useEffect(() => {
    if (!isNew || bookmarkletDone.current) return
    const p = readBookmarkletHash(window.location.hash)
    if (!p) return
    bookmarkletDone.current = true
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    setFromBookmarklet(true)
    addImport(p.text, p.yt)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew])

  // React refuses javascript: URLs in JSX, so the bookmarklet link's href is set directly.
  const bookmarkletRef = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    bookmarkletRef.current?.setAttribute('href', bookmarkletHref(window.location.origin))
  })

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
        shared,
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
          rubric: q.kind === 'short' ? (q.rubric ?? '').trim() : '',
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
        .select('id, at_s, kind, prompt, choices, correct_index, rubric')
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
      <div className="stack small">
        <p>
          <strong>Fastest:</strong> drag this button to your bookmarks bar:{' '}
          {/* href is set in an effect; clicking it here does nothing */}
          <a ref={bookmarkletRef} className="button" onClick={(e) => e.preventDefault()} title="Drag me to your bookmarks bar">
            Send to Oasis
          </a>
        </p>
        <p className="muted">
          Then open your lesson's questions in Edpuzzle and click the bookmark. It reads only the page you're looking at
          (nothing is sent to Edpuzzle and Oasis never sees your Edpuzzle login) and brings the questions here for you to
          check. If Edpuzzle changes their site or your school blocks bookmarklets, copy and paste instead:
        </p>
      </div>
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
      <button onClick={() => addImport()} disabled={!importText.trim()}>Import questions</button>
      {importNote && (
        <div role="status" className="stack small">
          {fromBookmarklet && <p className="muted">Brought over from your Edpuzzle page. Check every question before you save.</p>}
          <p className={importNote.added ? 'ok' : 'error'}>
            {importNote.added ? `Added ${importNote.added} question${importNote.added === 1 ? '' : 's'}.` : importNote.warnings.some((w) => w.startsWith('Skipped')) ? 'Nothing new to add.' : 'No questions found.'}
            {importNote.needAnswer > 0 && ` ${importNote.needAnswer} need you to pick the right answer (marked in red).`}
            {importNote.added > 0 && !youtubeId && ' Now paste the YouTube link at the top.'}
          </p>
          {importNote.warnings.length > 0 && <ul className="muted">{importNote.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        </div>
      )}
    </details>
  )

  if (loading) return <p className="muted center">Loading…</p>
  if (loadFailed)
    return (
      <main className="page builder">
        <header className="bar">
          <Link to="/teacher">← Back</Link>
          <strong>Edit lesson</strong>
        </header>
        <p className="error" role="alert">
          Couldn't open that lesson. It may have been deleted, the link may be wrong, or it belongs to another teacher.
        </p>
        <p><Link className="button" to="/teacher">Back to your lessons</Link></p>
      </main>
    )

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

      <div className="builder-grid">
      <section className="stack builder-media">
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
        <div className="builder-settings stack">
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
          <label className="check">
            <input type="checkbox" checked={shared} onChange={(e) => { setShared(e.target.checked); touch() }} />
            Share this lesson and its questions with other Oasis teachers
          </label>
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2>Questions <span className="count">{questions.length}</span></h2>
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
              {q.kind === 'short' && (
                <label className="small">
                  Expected answer <span className="muted">(optional, students never see it{aiGrade ? '; AI grades against it' : ''})</span>
                  <textarea rows={2} maxLength={1000} value={q.rubric ?? ''} onChange={(e) => update(q.key, { rubric: e.target.value })}
                    placeholder="e.g. Mitochondria make energy (ATP) for the cell. Accept any answer that mentions energy." />
                </label>
              )}
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
      </div>
    </main>
  )
}
