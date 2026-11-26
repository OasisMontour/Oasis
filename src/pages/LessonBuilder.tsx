import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { BULK_PASTE_EXAMPLE, parseBulkPaste, type DraftQuestion } from '../lib/bulkPaste'
import { parseEdpuzzlePaste } from '../lib/edpuzzleImport'
import { readBookmarkletHash } from '../lib/edpuzzleBookmarklet'
import { formatTime, parseTime } from '../lib/time'
import { blankQuestion, removeChoice, switchKind, videoProblem, type DraftNote } from '../lib/builder'
import { AiDraftPanel } from '../components/AiDraftPanel'
import { AssignDialog, type AssignClass } from '../components/AssignDialog'
import { useAuth } from '../auth/AuthProvider'
import { loadYouTubeApi, parseYouTubeId, youTubeErrorMessage, type YTPlayer } from '../lib/youtube'
import { readTeacherDefaults } from '../lib/prefs'

type Draft = DraftQuestion & { key: string; timeText: string }

let keySeq = 0
const toDraft = (q: DraftQuestion): Draft => ({ ...q, correct_indexes: q.correct_indexes ?? [], key: `q${++keySeq}`, timeText: formatTime(q.at_s) })
const toNote = (at_s: number, body = ''): DraftNote => ({ key: `n${++keySeq}`, at_s, timeText: formatTime(at_s), body })

export function LessonBuilder() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isNew = !id
  const [searchParams, setSearchParams] = useSearchParams()
  const { profile } = useAuth()

  const [videoInput, setVideoInput] = useState('')
  const [youtubeId, setYoutubeId] = useState<string | null>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [videoError, setVideoError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  // Free-text subject is gone from the form (beta item 5); it's kept as loaded for the planned shared library.
  const [subject, setSubject] = useState('')
  // The class this lesson is for: only classes this teacher teaches. Carried into assignment.
  const [classId, setClassId] = useState<string>(isNew ? (searchParams.get('class') ?? '') : '')
  const [myClasses, setMyClasses] = useState<AssignClass[] | null>(null)
  const [assignedTo, setAssignedTo] = useState<ReadonlySet<string>>(new Set())
  const [assignOpen, setAssignOpen] = useState(false)
  // No share checkbox for the beta (item 2): new lessons are private, and a lesson that was already shared keeps
  // its setting on save. Changing existing sharing is a separate decision.
  const [shared, setShared] = useState(false)
  const copyId = isNew ? searchParams.get('copy') : null
  // New lessons start from the teacher's defaults in Settings; loading a lesson overwrites these.
  const [startDefaults] = useState(readTeacherDefaults)
  const [fullscreen, setFullscreen] = useState(startDefaults.fullscreen)
  const [aiGrade, setAiGrade] = useState(startDefaults.aiGrade)
  const [showFeedback, setShowFeedback] = useState(startDefaults.showFeedback)
  const [notes, setNotes] = useState<DraftNote[]>([])
  const [questions, setQuestions] = useState<Draft[]>([])
  // How the questions got here. Only recorded for analytics; imported lessons are ordinary lessons.
  const [source, setSource] = useState<'manual' | 'bulk_paste' | 'edpuzzle' | 'ai'>('manual')
  const [loading, setLoading] = useState(Boolean(id || copyId))
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [dirty, setDirty] = useState(false)
  // A bad or someone else's lesson id: show an error, not an empty form that would fail (or create a copy) on Save.
  const [loadFailed, setLoadFailed] = useState(false)
  // Save went through but re-reading the question ids failed. Editing on would save the drafts as
  // brand-new questions, so the form stays locked until the teacher reloads (audit #12).
  const [needsReload, setNeedsReload] = useState(false)
  // Bumped on every edit, so a save can tell whether the teacher changed anything while it was in flight (audit #8).
  const rev = useRef(0)

  const playerEl = useRef<HTMLDivElement>(null)
  const player = useRef<YTPlayer | null>(null)

  // ---- load an existing lesson
  useEffect(() => {
    if (!id && !copyId) return
    let active = true
    ;(async () => {
      let query = supabase.from('lessons')
        .select('id, shared, title, subject, class_id, show_feedback, youtube_id, duration_s, require_fullscreen, ai_grade_short, questions(id, at_s, kind, prompt, choices, correct_index, correct_indexes, position, rubric), lesson_notes(id, at_s, body, position), assignments(class_id)')
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
      if (!copyId) {
        setClassId(data.class_id ?? '')
        setAssignedTo(new Set((data.assignments ?? []).map((a: { class_id: string }) => a.class_id)))
      }
      setVideoInput(`https://youtu.be/${data.youtube_id}`)
      setYoutubeId(data.youtube_id)
      setDuration(Number(data.duration_s))
      setFullscreen(data.require_fullscreen)
      setAiGrade(data.ai_grade_short)
      setShowFeedback(data.show_feedback ?? true)
      setNotes(
        [...((data.lesson_notes ?? []) as { at_s: number; body: string; position: number }[])]
          .sort((a, b) => Number(a.at_s) - Number(b.at_s) || a.position - b.position)
          .map((n) => toNote(Number(n.at_s), n.body)),
      )
      const qs = [...(data.questions as (DraftQuestion & { id: string; position: number })[])].sort(
        (a, b) => a.at_s - b.at_s || a.position - b.position,
      )
      setQuestions(qs.map((q) => toDraft({ ...q, id: copyId ? undefined : q.id, at_s: Number(q.at_s), choices: q.choices ?? [], correct_indexes: q.correct_indexes ?? [] })))
    })()
    return () => { active = false }
  }, [id, copyId])

  // ---- the teacher's own classes, for the Class dropdown and assignment
  useEffect(() => {
    if (!profile) return
    let active = true
    supabase
      .from('classes')
      .select('id, name')
      .eq('teacher_id', profile.id)
      .order('name')
      .then(({ data }) => active && setMyClasses((data as AssignClass[] | null) ?? []))
    return () => {
      active = false
    }
  }, [profile])

  // Straight after a new lesson's first save: open assignment setup with its class picked (beta item 9).
  useEffect(() => {
    if (!isNew && searchParams.get('assign') === '1') {
      setAssignOpen(true)
      setSearchParams({}, { replace: true })
    }
  }, [isNew, searchParams, setSearchParams])

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
    rev.current++
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

  const addQuestion = (kind: DraftQuestion['kind']) => {
    player.current?.pauseVideo()
    const q = toDraft(blankQuestion(kind, now()))
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

  // ---- notes (beta item 8): text the player pauses on. Never graded.
  const addNote = () => {
    player.current?.pauseVideo()
    setNotes((ns) => [...ns, toNote(now())].sort((a, b) => a.at_s - b.at_s))
    touch()
  }
  const updateNote = (key: string, patch: Partial<DraftNote>) => {
    setNotes((ns) => ns.map((n) => (n.key === key ? { ...n, ...patch } : n)))
    touch()
  }
  const removeNote = (key: string) => {
    setNotes((ns) => ns.filter((n) => n.key !== key))
    touch()
  }
  const sortNotes = () => setNotes((ns) => [...ns].sort((a, b) => a.at_s - b.at_s))

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

  // ---- Edpuzzle bookmarklet arrivals. The import panel is gone from the builder (beta item 2), but teachers who
  // already dragged "Send to Oasis" to their bookmarks bar still land here with questions in the #fragment
  // (never sent to a server). It's untrusted, so it only pre-fills drafts; nothing is saved until Save.
  // Retiring the importer itself is Wyatt's call, so the parser stays.
  const [importNote, setImportNote] = useState<{ added: number; needAnswer: number; warnings: string[] } | null>(null)
  const bookmarkletDone = useRef(false)
  useEffect(() => {
    if (!isNew || bookmarkletDone.current) return
    const p = readBookmarkletHash(window.location.hash)
    if (!p) return
    bookmarkletDone.current = true
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    const r = parseEdpuzzlePaste(p.text)
    if (p.yt) r.youtubeId = p.yt
    setImportNote({ added: r.questions.length, needAnswer: r.questions.filter((q) => q.kind === 'mc' && q.correct_index === null).length, warnings: r.warnings })
    if (r.youtubeId) {
      setVideoInput(`https://youtu.be/${r.youtubeId}`)
      setYoutubeId(r.youtubeId)
    }
    if (!r.questions.length) return
    setQuestions(r.questions.map(toDraft).sort((a, b) => a.at_s - b.at_s))
    setSource('edpuzzle')
    touch()
  }, [isNew])

  // ---- save
  const problems = (): string[] => {
    const out: string[] = []
    const vp = videoProblem(videoInput, youtubeId, duration)
    if (vp) out.push(vp)
    if (!title.trim()) out.push('Give the lesson a title.')
    questions.forEach((q, i) => {
      const n = `Question ${i + 1}`
      if (parseTime(q.timeText) === null) out.push(`${n}: the time should look like 1:30.`)
      else if (duration && q.at_s > duration) out.push(`${n}: ${formatTime(q.at_s)} is past the end of the video (${formatTime(duration)}).`)
      if (!q.prompt.trim()) out.push(`${n}: write the question.`)
      if (q.kind !== 'short' && q.choices.some((c) => !c.trim())) out.push(`${n}: fill in every choice or remove the empty ones.`)
      if (q.kind === 'mc' && q.correct_index === null) out.push(`${n}: pick the right answer with the circle.`)
      if (q.kind === 'multi' && !(q.correct_indexes ?? []).length) out.push(`${n}: tick every right answer.`)
    })
    notes.forEach((nt, i) => {
      const n = `Note ${i + 1}`
      if (parseTime(nt.timeText) === null) out.push(`${n}: the time should look like 1:30.`)
      else if (duration && nt.at_s > duration) out.push(`${n}: ${formatTime(nt.at_s)} is past the end of the video.`)
      if (!nt.body.trim()) out.push(`${n}: write the note or delete it.`)
    })
    return out
  }

  const save = async () => {
    const p = problems()
    if (p.length) return setStatus({ kind: 'error', text: p.join(' ') })
    setSaving(true)
    const savedRev = rev.current
    const { data, error } = await supabase.rpc('save_lesson', {
      p_lesson: {
        id: id ?? null,
        title: title.trim(),
        subject: subject.trim(),
        class_id: classId || null,
        shared,
        youtube_id: youtubeId,
        duration_s: duration,
        require_fullscreen: fullscreen,
        ai_grade_short: aiGrade,
        show_feedback: showFeedback,
        source,
        notes: [...notes].sort((a, b) => a.at_s - b.at_s).map((n) => ({ at_s: n.at_s, body: n.body.trim() })),
      },
      p_questions: [...questions]
        .sort((a, b) => a.at_s - b.at_s)
        .map((q) => ({
          id: q.id ?? null,
          at_s: q.at_s,
          kind: q.kind,
          prompt: q.prompt.trim(),
          choices: q.kind !== 'short' ? q.choices.map((c) => c.trim()) : null,
          correct_index: q.kind === 'mc' ? q.correct_index : null,
          correct_indexes: q.kind === 'multi' ? q.correct_indexes : null,
          rubric: q.kind === 'short' ? (q.rubric ?? '').trim() : '',
        })),
    })
    if (error) {
      setSaving(false)
      return setStatus({ kind: 'error', text: error.message })
    }
    if (isNew) {
      setSaving(false)
      setDirty(false)
      navigate(`/teacher/lessons/${data}?assign=1`, { replace: true })
      return setStatus({ kind: 'ok', text: 'Saved.' })
    }
    // Reload so new questions pick up their ids. One retry: a missed read here means the next save
    // would treat every new question as new again.
    const readIds = () =>
      supabase
        .from('questions')
        .select('id, at_s, kind, prompt, choices, correct_index, correct_indexes, rubric')
        .eq('lesson_id', id)
        .order('at_s')
        .order('position')
    let { data: qs, error: readErr } = await readIds()
    if (readErr || !qs) ({ data: qs, error: readErr } = await readIds())
    setSaving(false)
    if (readErr || !qs) {
      setNeedsReload(true)
      return setStatus({ kind: 'error', text: "Saved, but Oasis couldn't refresh the lesson. Reload the page before making more changes." })
    }
    if (rev.current !== savedRev) {
      // The form is locked while saving, so this shouldn't happen; if it does, keep the newer edits
      // and leave the lesson marked unsaved rather than overwrite them with the server copy.
      return setStatus({ kind: 'error', text: 'Saved, but you changed something while it was saving. Save again to keep those changes.' })
    }
    setQuestions(qs.map((q) => toDraft({ ...q, at_s: Number(q.at_s), choices: q.choices ?? [], correct_indexes: q.correct_indexes ?? [] })))
    setDirty(false)
    setStatus({ kind: 'ok', text: 'Saved.' })
  }

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
        {!isNew && !needsReload && (
          <button onClick={() => setAssignOpen(true)} disabled={saving || dirty} title={dirty ? 'Save your changes first' : undefined}>
            Assign…
          </button>
        )}
        {needsReload
          ? <button className="primary" onClick={() => window.location.reload()}>Reload</button>
          : <button className="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : isNew ? 'Save and assign' : 'Save'}</button>}
      </header>
      {assignOpen && id && myClasses && (
        <AssignDialog
          lesson={{ id, title: title.trim() || 'Untitled lesson', questionCount: questions.length }}
          classes={myClasses}
          assignedClassIds={assignedTo}
          initialClassId={classId || null}
          onClose={() => setAssignOpen(false)}
          onAssigned={() =>
            supabase.from('assignments').select('class_id').eq('lesson_id', id).then(({ data }) => data && setAssignedTo(new Set(data.map((a) => a.class_id))))
          }
        />
      )}
      {status && <p className={status.kind} role={status.kind === 'error' ? 'alert' : 'status'}>{status.text}</p>}

      {/* Locked while saving: edits made mid-save were silently replaced by the server copy (audit #8). */}
      <fieldset className="plain" disabled={saving || needsReload}>

      {importNote && (
        <div role="status" className="card stack small">
          <p className={importNote.added ? 'ok' : 'error'}>
            {importNote.added ? `Brought over ${importNote.added} question${importNote.added === 1 ? '' : 's'} from your Edpuzzle page. Check every question before you save.` : 'No questions found on that Edpuzzle page.'}
            {importNote.needAnswer > 0 && ` ${importNote.needAnswer} need you to pick the right answer (marked in red).`}
          </p>
          {importNote.warnings.length > 0 && <ul className="muted">{importNote.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        </div>
      )}

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
            Class
            <select value={classId} onChange={(e) => { setClassId(e.target.value); touch() }} disabled={myClasses === null}>
              <option value="">{myClasses?.length === 0 ? 'No classes yet (connect Google Classroom)' : 'Choose a class…'}</option>
              {(myClasses ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
              {classId && myClasses && !myClasses.some((c) => c.id === classId) && <option value={classId}>A class you no longer teach</option>}
            </select>
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
            <input type="checkbox" checked={showFeedback} onChange={(e) => { setShowFeedback(e.target.checked); touch() }} />
            Tell students right away if a choice answer was right (turn off for a quiz: classmates could share answers)
          </label>
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2>Questions <span className="count">{questions.length}</span></h2>
          <span className="row">
            <button onClick={() => addQuestion('mc')} disabled={!duration}>+ Multiple choice here</button>
            <button onClick={() => addQuestion('multi')} disabled={!duration}>+ Multi-select here</button>
            <button onClick={() => addQuestion('short')} disabled={!duration}>+ Short answer here</button>
            <button onClick={addNote} disabled={!duration}>+ Note here</button>
          </span>
        </div>
        <p className="muted small">Pause the video where you want a question, then add it. Students can't skip past a question until they answer it.</p>

        <AiDraftPanel
          durationS={duration}
          open={searchParams.get('ai') === '1'}
          onDrafts={(qs) => {
            setQuestions((cur) => [...cur, ...qs.map(toDraft)].sort((a, b) => a.at_s - b.at_s))
            setSource((s) => (s === 'manual' ? 'ai' : s))
            touch()
          }}
        />

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
                    const kind = e.target.value as DraftQuestion['kind']
                    update(q.key, switchKind(q, kind))
                  }}
                >
                  <option value="mc">Multiple choice</option>
                  <option value="multi">Multi-select</option>
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
              {q.kind !== 'short' && (
                <div className="stack">
                  {q.choices.map((c, ci) => (
                    <div key={ci} className="row">
                      {q.kind === 'mc' ? (
                        <input type="radio" name={`correct-${q.key}`} aria-label={`Choice ${ci + 1} is correct`} checked={q.correct_index === ci} onChange={() => update(q.key, { correct_index: ci })} />
                      ) : (
                        <input
                          type="checkbox"
                          aria-label={`Choice ${ci + 1} is correct`}
                          checked={(q.correct_indexes ?? []).includes(ci)}
                          onChange={(e) => {
                            const set = new Set(q.correct_indexes ?? [])
                            if (e.target.checked) set.add(ci)
                            else set.delete(ci)
                            update(q.key, { correct_indexes: [...set].sort((a, b) => a - b) })
                          }}
                        />
                      )}
                      <input className="text grow" value={c} onChange={(e) => update(q.key, { choices: q.choices.map((x, j) => (j === ci ? e.target.value : x)) })} placeholder={`Choice ${String.fromCharCode(65 + ci)}`} />
                      {q.choices.length > 2 && (
                        // Removing a right answer never silently makes another choice right (on an assigned lesson that
                        // would re-grade every student on save). The teacher picks again.
                        <button className="small" aria-label="Remove choice" onClick={() => update(q.key, removeChoice(q, ci))}>✕</button>
                      )}
                    </div>
                  ))}
                  {q.choices.length < 6 && <button className="small" onClick={() => update(q.key, { choices: [...q.choices, ''] })}>+ Add choice</button>}
                  {q.kind === 'mc' ? (
                    <p className={q.correct_index === null ? 'error small' : 'muted small'}>Pick the right answer with the circle.</p>
                  ) : (
                    <p className={(q.correct_indexes ?? []).length ? 'muted small' : 'error small'}>
                      Tick every right answer. Students get it right only if they pick exactly these.
                    </p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>

        {notes.length > 0 && (
          <section aria-labelledby="notes-h" className="stack">
            <h3 id="notes-h">Notes <span className="muted small">The video pauses to show each one. Not graded.</span></h3>
            <ol className="cards">
              {notes.map((n, i) => (
                <li key={n.key} className="card stack">
                  <div className="row">
                    <strong>Note {i + 1}</strong>
                    <input
                      aria-label="Note time"
                      className="text time"
                      value={n.timeText}
                      onChange={(e) => {
                        const t = parseTime(e.target.value)
                        updateNote(n.key, { timeText: e.target.value, ...(t !== null ? { at_s: t } : {}) })
                      }}
                      onBlur={sortNotes}
                    />
                    <button className="small" onClick={() => { const t = now(); updateNote(n.key, { at_s: t, timeText: formatTime(t) }); sortNotes() }}>
                      Use current time
                    </button>
                    <button className="small danger" onClick={() => removeNote(n.key)}>Delete</button>
                  </div>
                  <textarea aria-label="Note" rows={2} maxLength={1000} value={n.body} onChange={(e) => updateNote(n.key, { body: e.target.value })}
                    placeholder="e.g. Look at the graph: we'll use it in class tomorrow." />
                </li>
              ))}
            </ol>
          </section>
        )}


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
      </fieldset>
    </main>
  )
}
