import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { rememberNext } from '../lib/next'
import {
  canFinish,
  classifyRpcError,
  dueQuestion,
  needsReconnect,
  nextUnanswered,
  progressToSave,
  SKIP_TOLERANCE_S,
  tick,
  type PlayerQuestion,
  type StudentLesson,
} from '../lib/player'
import {
  finishAttempt,
  getAssignmentClassName,
  getQuestion,
  getStudentLesson,
  sendFocusEvent,
  saveProgress,
  submitAnswer,
  type FocusKind,
} from '../lib/studentApi'
import { formatTime } from '../lib/time'
import { loadYouTubeApi, YT_STATE, type YTPlayer } from '../lib/youtube'
import '../student.css'

const POLL_MS = 250
const SAVE_EVERY_MS = 10_000
const RECONNECT_RETRY_MS = 3_000

type Phase = 'loading' | 'ready' | 'playing' | 'finishing' | 'done'
type Away = 'fullscreen' | 'tab' | 'blur' | null
type Fatal = { kind: 'not_assigned' | 'video' | 'load'; message?: string }

/**
 * The student player at /student/assignments/:id (the link Google Classroom posts).
 *
 * Rules the server enforces, which this player is built never to trip for an honest student
 * (see docs in the PR and src/lib/player.ts):
 * - save_progress: progress can run at most ~30s ahead of the last good save, never past the next
 *   unanswered question, never past the end. So: 1x speed only, save every 10s, pause if Wi-Fi drops.
 * - submit_answer: one answer per question, only once the server has seen you reach it.
 * - finish_attempt: watched to within 2s of the end and every question answered.
 */
export function StudentPlayer() {
  const { id: assignmentId = '' } = useParams()
  const location = useLocation()
  const { profile, signOut, signInWithGoogle } = useAuth()

  const [phase, setPhase] = useState<Phase>('loading')
  const [fatal, setFatal] = useState<Fatal | null>(null)
  const [lesson, setLesson] = useState<StudentLesson | null>(null)
  const [className, setClassName] = useState<string | null>(null)
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set())
  const [question, setQuestion] = useState<PlayerQuestion | null>(null)
  const [playerReady, setPlayerReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [maxShown, setMaxShown] = useState(0)
  const [away, setAway] = useState<Away>(null)
  const [reconnecting, setReconnecting] = useState(false)
  const [shaky, setShaky] = useState(false) // a save failed twice in a row
  const [note, setNote] = useState<string | null>(null)
  const [finishError, setFinishError] = useState(false)
  const [resumeError, setResumeError] = useState(false)

  const rootRef = useRef<HTMLDivElement>(null)
  const mountRef = useRef<HTMLDivElement>(null)
  const player = useRef<YTPlayer | null>(null)
  // Live values for timers and event handlers, which would otherwise see stale state.
  const m = useRef({
    phase: 'loading' as Phase,
    lesson: null as StudentLesson | null,
    answered: new Set<string>() as ReadonlySet<string>,
    question: null as PlayerQuestion | null,
    away: null as Away,
    reconnecting: false,
    maxWatched: 0,
    confirmed: 0,
    savedPos: -1,
    fails: 0,
    ended: false,
    leaving: false,
    loggedNoFs: false,
    pendingLogs: [] as { kind: FocusKind; videoS: number }[],
    flushing: null as Promise<boolean> | null,
  })
  // Setters that keep the ref and React state in step. Stable: they only touch the ref and state setters.
  const setPhaseBoth = useCallback((p: Phase) => {
    m.current.phase = p
    setPhase(p)
  }, [])
  const setAnsweredBoth = useCallback((s: ReadonlySet<string>) => {
    m.current.answered = s
    setAnswered(s)
  }, [])
  const setAwayBoth = useCallback((a: Away) => {
    m.current.away = a
    setAway(a)
  }, [])
  const setReconnectingBoth = useCallback((r: boolean) => {
    m.current.reconnecting = r
    setReconnecting(r)
  }, [])

  const now = () => {
    const t = player.current?.getCurrentTime()
    return typeof t === 'number' && Number.isFinite(t) ? t : 0
  }

  // ------------------------------------------------------------------ load
  const applyServerState = useCallback((l: StudentLesson) => {
    const done = new Set(l.questions.filter((q) => q.answered).map((q) => q.id))
    m.current.lesson = l
    m.current.maxWatched = l.max_watched_s
    m.current.confirmed = l.max_watched_s
    setLesson(l)
    setMaxShown(l.max_watched_s)
    setAnsweredBoth(done)
  }, [setAnsweredBoth])

  useEffect(() => {
    let cancelled = false
    getStudentLesson(assignmentId)
      .then((l) => {
        if (cancelled) return
        applyServerState(l)
        setCurrent(l.last_pos_s)
        setPhaseBoth(l.finished_at ? 'done' : 'ready')
      })
      .catch((e: { message?: string }) => {
        if (cancelled) return
        const kind = classifyRpcError(e)
        // A malformed id is a Postgres uuid error: same thing to a student as "not yours".
        if (kind === 'not_assigned' || /uuid/i.test(e.message ?? '')) setFatal({ kind: 'not_assigned' })
        else setFatal({ kind: 'load' })
      })
    getAssignmentClassName(assignmentId).then((n) => !cancelled && setClassName(n))
    return () => {
      cancelled = true
    }
  }, [assignmentId, applyServerState, setPhaseBoth])

  // ------------------------------------------------------------------ focus log (durable)
  // Focus events are queued and retried, and the student can't resume until theirs is recorded. Otherwise
  // blocking just the log request (devtools, or flaky Wi-Fi) would mean leaving was never recorded.
  const flushLogs = useCallback((): Promise<boolean> => {
    const s = m.current
    if (s.flushing) return s.flushing
    const run = async () => {
      while (s.pendingLogs.length && s.lesson) {
        const e = s.pendingLogs[0]
        try {
          await sendFocusEvent(s.lesson.attempt_id, e.kind, e.videoS)
          s.pendingLogs.shift()
        } catch (err) {
          if (classifyRpcError(err as { message?: string }) === 'not_assigned') s.pendingLogs.shift()
          else return false
        }
      }
      return true
    }
    s.flushing = run().finally(() => {
      s.flushing = null
    })
    return s.flushing
  }, [])

  const logFocus = useCallback(
    (kind: FocusKind) => {
      m.current.pendingLogs.push({ kind, videoS: now() })
      void flushLogs()
    },
    [flushLogs],
  )

  // ------------------------------------------------------------------ saving
  const inflight = useRef<Promise<boolean> | null>(null)
  const queued = useRef<Promise<boolean> | null>(null)

  const resync = useCallback(async () => {
    // The server disagrees with us about how far they've watched. Take the server's word, quietly.
    try {
      const l = await getStudentLesson(assignmentId)
      applyServerState(l)
      if (now() > l.max_watched_s + SKIP_TOLERANCE_S) player.current?.seekTo(l.max_watched_s, true)
      setNote('Went back to where your progress was last saved.')
    } catch {
      /* next save will try again */
    }
  }, [assignmentId, applyServerState])

  const doSave = useCallback(async (): Promise<boolean> => {
    const s = m.current
    const l = s.lesson
    if (!l || s.phase === 'done') return true
    const value = progressToSave(s.maxWatched, l.duration_s)
    const pos = Math.min(progressToSave(now(), l.duration_s), value)
    if (value === s.confirmed && pos === s.savedPos) return true
    try {
      await saveProgress(l.attempt_id, value, pos)
      s.confirmed = Math.max(s.confirmed, value)
      s.savedPos = pos
      s.fails = 0
      setShaky(false)
      if (s.reconnecting && !needsReconnect(s.maxWatched, s.confirmed)) {
        setReconnectingBoth(false)
        if (!s.away && !s.question && s.phase === 'playing') player.current?.playVideo()
      }
      return true
    } catch (e) {
      const kind = classifyRpcError(e as { message?: string })
      if (kind === 'jump_rejected') {
        await resync()
        return false
      }
      if (kind === 'not_assigned') {
        setFatal({ kind: 'not_assigned' })
        return false
      }
      s.fails += 1
      if (s.fails >= 2) setShaky(true)
      return false
    }
  }, [resync, setReconnectingBoth])

  /** Single-flight save: at most one request in the air and one queued behind it. */
  const save = useCallback((): Promise<boolean> => {
    if (queued.current) return queued.current
    const run = () => {
      const p = doSave().finally(() => {
        if (inflight.current === p) inflight.current = null
      })
      inflight.current = p
      return p
    }
    if (inflight.current) {
      queued.current = inflight.current.then(() => {
        queued.current = null
        return run()
      })
      return queued.current
    }
    return run()
  }, [doSave])

  // ------------------------------------------------------------------ questions + finishing
  const showQuestion = useCallback(
    (q: PlayerQuestion) => {
      if (m.current.question?.id === q.id) return
      player.current?.pauseVideo()
      // A question a teacher added behind the student: take them to its frame.
      if (Math.abs(now() - q.at_s) > 2) player.current?.seekTo(q.at_s, true)
      m.current.question = q
      setQuestion(q)
      void save()
    },
    [save],
  )

  const finish = useCallback(async () => {
    const s = m.current
    const l = s.lesson
    if (!l || s.phase === 'finishing' || s.phase === 'done') return
    setPhaseBoth('finishing')
    setFinishError(false)
    let saved = false
    for (let i = 0; i < 3 && !saved; i++) saved = await save()
    try {
      if (!saved) throw new Error('network')
      await finishAttempt(l.attempt_id)
      m.current.leaving = true
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
      setPhaseBoth('done')
    } catch (e) {
      const kind = classifyRpcError(e as { message?: string })
      if (kind === 'not_finished' || kind === 'unanswered') {
        setPhaseBoth('playing')
        await resync()
        const q = dueQuestion(l.questions, m.current.answered, m.current.maxWatched)
        if (q) showQuestion(q)
        else player.current?.playVideo()
      } else {
        setPhaseBoth('playing')
        setFinishError(true)
      }
    }
  }, [save, resync, showQuestion, setPhaseBoth])

  const maybeFinish = useCallback(() => {
    const s = m.current
    if (!s.lesson || !s.ended) return
    if (canFinish(s.maxWatched, s.lesson.duration_s, s.lesson.questions, s.answered)) void finish()
    else {
      const q = nextUnanswered(s.lesson.questions, s.answered)
      if (q && q.at_s <= s.maxWatched + 1) showQuestion(q)
    }
  }, [finish, showQuestion])

  const onAnswered = useCallback(
    (qid: string) => {
      const s = m.current
      const next = new Set(s.answered)
      next.add(qid)
      setAnsweredBoth(next)
      m.current.question = null
      setQuestion(null)
      const l = s.lesson!
      const q = dueQuestion(l.questions, next, Math.max(now(), s.maxWatched))
      if (q) return showQuestion(q)
      if (s.ended) return maybeFinish()
      if (!s.away && !s.reconnecting) player.current?.playVideo()
    },
    [showQuestion, maybeFinish, setAnsweredBoth],
  )

  // ------------------------------------------------------------------ YouTube
  // Nothing inside the video can take focus or clicks (keyboard Tab included); our shield and controls do.
  useEffect(() => {
    mountRef.current?.setAttribute('inert', '')
  }, [])

  useEffect(() => {
    if (!lesson || phase === 'done' || !mountRef.current) return
    if (player.current) return
    let cancelled = false
    const mount = document.createElement('div')
    mountRef.current.replaceChildren(mount)
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled) return
        player.current = new YT.Player(mount, {
          videoId: lesson.youtube_id,
          playerVars: {
            controls: 0, // our own controls: no scrubbing ahead, no speed menu
            disablekb: 1,
            fs: 0, // YouTube's fullscreen would hide the question panel
            rel: 0,
            playsinline: 1,
            modestbranding: 1,
            iv_load_policy: 3,
            start: Math.floor(lesson.last_pos_s),
            origin: window.location.origin,
          },
          events: {
            onReady: () => !cancelled && setPlayerReady(true),
            onError: (e) => !cancelled && setFatal({ kind: 'video', message: studentVideoError(e.data) }),
            onPlaybackRateChange: (e) => {
              if (e.data !== 1) player.current?.setPlaybackRate(1)
            },
            onStateChange: (e) => {
              if (cancelled) return
              const s = m.current
              if (e.data === YT_STATE.PLAYING) {
                s.ended = false
                // Something started the video while it should be held (a question, left fullscreen, Wi-Fi).
                if (s.question || s.away || s.reconnecting || s.phase !== 'playing') player.current?.pauseVideo()
                else setPlaying(true)
              } else if (e.data === YT_STATE.PAUSED) {
                setPlaying(false)
                void save()
              } else if (e.data === YT_STATE.ENDED) {
                setPlaying(false)
                const l = s.lesson
                if (!l) return
                const t = now()
                const r = tick({ current: t, maxWatched: s.maxWatched, durationS: l.duration_s, questions: l.questions, answered: s.answered })
                if (r.snapBack) {
                  player.current?.seekTo(s.maxWatched, true)
                  return
                }
                s.maxWatched = r.maxWatched
                if (r.question) return showQuestion(r.question)
                // Honestly reached the end. YouTube's length can be a little short of what the teacher saved.
                s.maxWatched = l.duration_s
                setMaxShown(s.maxWatched)
                s.ended = true
                maybeFinish()
              }
            },
          },
        })
      })
      .catch((e: Error) => !cancelled && setFatal({ kind: 'video', message: e.message }))
    return () => {
      cancelled = true
    }
    // The player is created once per lesson load; handlers read live values from m.current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson?.attempt_id, phase === 'done'])

  useEffect(
    () => () => {
      player.current?.destroy()
      player.current = null
    },
    [],
  )

  // ------------------------------------------------------------------ leaving the video
  const goAway = useCallback(
    (reason: Exclude<Away, null>, kind: FocusKind) => {
      const s = m.current
      if (s.phase !== 'playing' || s.leaving || !s.lesson) return
      player.current?.pauseVideo()
      void save()
      if (s.away) return // one log per time away, not one per event
      setAwayBoth(reason)
      logFocus(kind)
    },
    [save, setAwayBoth, logFocus],
  )

  // ------------------------------------------------------------------ the 250ms watchdog
  useEffect(() => {
    if (phase !== 'playing' || !playerReady) return
    const id = window.setInterval(() => {
      const s = m.current
      const p = player.current
      const l = s.lesson
      if (!p || !l) return
      if (p.getPlaybackRate() !== 1) p.setPlaybackRate(1)
      const t = now()
      const r = tick({ current: t, maxWatched: s.maxWatched, durationS: l.duration_s, questions: l.questions, answered: s.answered })
      if (r.snapBack) {
        p.seekTo(s.maxWatched, true)
        setCurrent(s.maxWatched)
        return
      }
      s.maxWatched = r.maxWatched
      setCurrent(t)
      setMaxShown(r.maxWatched)
      if (r.question && !s.question) showQuestion(r.question)
      // Poll, don't just listen: listeners can be swallowed from the console, and a focused iframe
      // hides window blur. hasFocus() is true while focus is anywhere inside this page, iframe included.
      if (!s.away && !s.leaving) {
        if (l.require_fullscreen && !s.loggedNoFs && !document.fullscreenElement) goAway('fullscreen', 'exit_fullscreen')
        else if (document.visibilityState === 'hidden') goAway('tab', 'tab_hidden')
        else if (l.require_fullscreen && !document.hasFocus()) goAway('blur', 'blur')
      }
      if (!s.reconnecting && needsReconnect(s.maxWatched, s.confirmed)) {
        p.pauseVideo()
        setReconnectingBoth(true)
        void save()
      }
    }, POLL_MS)
    return () => window.clearInterval(id)
  }, [phase, playerReady, save, showQuestion, setReconnectingBoth, goAway])

  // Regular saves, plus fast retries while we're holding the video for Wi-Fi.
  useEffect(() => {
    if (phase !== 'playing') return
    const id = window.setInterval(
      () => {
        void save()
        void flushLogs()
      },
      reconnecting ? RECONNECT_RETRY_MS : SAVE_EVERY_MS,
    )
    return () => window.clearInterval(id)
  }, [phase, reconnecting, save, flushLogs])

  // ------------------------------------------------------------------ leaving the video
  useEffect(() => {
    if (phase !== 'playing' || !lesson) return
    const strict = lesson.require_fullscreen
    const onFs = () => {
      if (strict && !document.fullscreenElement) goAway('fullscreen', 'exit_fullscreen')
    }
    const onVis = () => {
      if (document.visibilityState === 'hidden') goAway('tab', 'tab_hidden')
    }
    const onBlur = () => {
      // The video container is inert and covered by a click shield, so focus can never land in YouTube's
      // iframe (which used to hide later blurs). A blur here means they really left the page.
      window.setTimeout(() => {
        if (document.visibilityState === 'hidden') return
        if (strict) goAway('blur', 'blur')
      }, 0)
    }
    const onHide = () => void save()
    document.addEventListener('fullscreenchange', onFs)
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('blur', onBlur)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('fullscreenchange', onFs)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('pagehide', onHide)
    }
  }, [phase, lesson, goAway, save])

  useEffect(() => {
    const live = m.current
    live.leaving = false // StrictMode runs cleanup once on mount in dev
    return () => {
      live.leaving = true
      void doSave()
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    }
  }, [doSave])

  // ------------------------------------------------------------------ actions
  const enterFullscreen = async (): Promise<void> => {
    const s = m.current
    if (!s.lesson?.require_fullscreen) return
    const el = rootRef.current
    if (document.fullscreenElement) return
    try {
      if (!el?.requestFullscreen) throw new Error('unsupported')
      await el.requestFullscreen({ navigationUI: 'hide' })
    } catch {
      if (!s.loggedNoFs) {
        s.loggedNoFs = true
        logFocus('no_fullscreen_support')
      }
    }
  }

  const start = async () => {
    const l = m.current.lesson
    if (!l || !playerReady) return
    await enterFullscreen()
    setPhaseBoth('playing')
    if (l.last_pos_s > 5) setNote(`Picking up at ${formatTime(l.last_pos_s)}.`)
    player.current?.seekTo(l.last_pos_s, true)
    const q = dueQuestion(l.questions, m.current.answered, m.current.maxWatched)
    // Only questions at or before where they are now; later ones fire as the video reaches them.
    if (q && q.at_s <= l.last_pos_s + 0.5) showQuestion(q)
    else if (q && q.at_s <= m.current.maxWatched) showQuestion(q)
    else player.current?.playVideo()
  }

  const resume = async () => {
    await enterFullscreen() // first, while the click still counts as a user gesture
    setResumeError(false)
    if (!(await flushLogs())) return setResumeError(true)
    setAwayBoth(null)
    if (!m.current.question && !m.current.reconnecting) player.current?.playVideo()
  }

  const togglePlay = () => {
    const s = m.current
    if (s.phase !== 'playing' || s.question || s.away || s.reconnecting) return
    setNote(null)
    if (playing) player.current?.pauseVideo()
    else if (s.ended) maybeFinish()
    else player.current?.playVideo()
  }

  const back10 = () => {
    if (m.current.phase !== 'playing' || m.current.question) return
    player.current?.seekTo(Math.max(0, now() - 10), true)
    setCurrent(Math.max(0, now() - 10))
    m.current.ended = false
  }

  const seekTo = (frac: number) => {
    const s = m.current
    const l = s.lesson
    if (!l || s.phase !== 'playing' || s.question) return
    const target = Math.min(frac * l.duration_s, s.maxWatched)
    player.current?.seekTo(target, true)
    setCurrent(target)
    if (target < l.duration_s - 1) s.ended = false
  }

  const onKey = (e: ReactKeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName
    if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'BUTTON') return
    if (e.key === ' ' || e.key === 'k') {
      e.preventDefault()
      togglePlay()
    } else if (e.key === 'ArrowLeft' || e.key === 'j') {
      e.preventDefault()
      back10()
    }
  }

  const switchAccount = async () => {
    rememberNext(location.pathname)
    await signOut()
    await signInWithGoogle()
  }

  // ------------------------------------------------------------------ render
  if (fatal) return <FatalScreen fatal={fatal} email={profile?.email ?? ''} onSwitch={switchAccount} />

  if (phase === 'done' && lesson) {
    return (
      <div className="player-root" ref={rootRef}>
        <div className="p-center">
          <div className="p-card">
            <p className="p-check" aria-hidden="true">
              ✓
            </p>
            <h1>Done</h1>
            <p>
              Your answers for <b>{lesson.title}</b> are in. You can close this tab.
            </p>
            <Link className="s-btn primary" to="/student">
              Back to my assignments
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const l = lesson
  const total = l?.questions.length ?? 0
  const qIndex = question && l ? l.questions.findIndex((x) => x.id === question.id) + 1 : 0
  const pct = (v: number) => (l ? `${Math.min(100, (100 * v) / l.duration_s)}%` : '0%')

  return (
    <div className="player-root" ref={rootRef} onKeyDown={onKey} tabIndex={-1}>
      <header className="p-top">
        <Link to="/student" className="p-back" aria-label="Back to my assignments">
          ←
        </Link>
        <strong>{l?.title ?? 'Loading…'}</strong>
        {className && <span>{className}</span>}
        {total > 0 && (
          <span>
            {question ? `Question ${qIndex} of ${total}` : `${answered.size} of ${total} questions answered`}
          </span>
        )}
        {shaky && phase === 'playing' && !reconnecting && <span className="p-chip">Saving… check Wi-Fi</span>}
      </header>

      <div className={`p-body${question ? ' with-panel' : ''}`}>
        <div className="p-stage">
          <div className="p-video" ref={mountRef} />
          {/* Clicks land here, not in YouTube's iframe: no window blur, no YouTube links, no scrubbing. */}
          <button
            className="p-shield"
            aria-label={playing ? 'Pause' : 'Play'}
            tabIndex={-1}
            onClick={togglePlay}
            disabled={phase !== 'playing'}
          />
          {question && (
            <div className="p-paused">
              <span>⏸ Paused for a question</span>
            </div>
          )}
          {phase === 'playing' && away && (
            <div className="p-overlay" role="alertdialog" aria-labelledby="away-h">
              <div className="p-card">
                <h2 id="away-h">
                  {away === 'fullscreen' ? 'Paused because you left fullscreen' : away === 'tab' ? 'Paused because you switched tabs' : 'Paused because you clicked away'}
                </h2>
                {resumeError && <p className="p-error">Couldn't reach Oasis. Check your Wi-Fi, then try again.</p>}
                <button className="s-btn primary big" onClick={resume} autoFocus>
                  Keep watching
                </button>
              </div>
            </div>
          )}
          {phase === 'playing' && !away && reconnecting && (
            <div className="p-overlay" role="status">
              <div className="p-card">
                <h2>Reconnecting…</h2>
                <p>Your Wi-Fi dropped, so the video is paused until your progress saves. Nothing is lost.</p>
              </div>
            </div>
          )}
          {phase === 'finishing' && (
            <div className="p-overlay" role="status">
              <div className="p-card">
                <h2>Saving your work…</h2>
              </div>
            </div>
          )}
          {finishError && phase === 'playing' && (
            <div className="p-overlay" role="alert">
              <div className="p-card">
                <h2>Couldn't reach Oasis</h2>
                <p>Your answers are saved. Check your Wi-Fi, then try again.</p>
                <button className="s-btn primary big" onClick={() => void finish()}>
                  Try again
                </button>
              </div>
            </div>
          )}
          {(phase === 'loading' || phase === 'ready') && (
            <div className="p-overlay solid">
              <StartCard lesson={l} ready={playerReady} onStart={start} />
            </div>
          )}
        </div>

        {question && l && (
          <QuestionPanel
            key={question.id}
            attemptId={l.attempt_id}
            q={question}
            number={qIndex}
            ensureReached={async () => {
              if (m.current.confirmed + 1 < question.at_s) await save()
            }}
            onDone={() => onAnswered(question.id)}
            onRejected={resync}
          />
        )}
      </div>

      <footer className="p-bottom">
        <div className="p-controls">
          <button className="p-ctl" onClick={togglePlay} disabled={phase !== 'playing' || !!question || !!away || reconnecting} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? '❚❚' : '▶'}
          </button>
          <button className="p-ctl" onClick={back10} disabled={phase !== 'playing' || !!question} aria-label="Back 10 seconds">
            ↺ 10
          </button>
          <div
            className="p-track"
            role="slider"
            aria-label="Video position"
            aria-valuemin={0}
            aria-valuemax={Math.round(l?.duration_s ?? 0)}
            aria-valuenow={Math.round(current)}
            aria-valuetext={`${formatTime(current)} of ${formatTime(l?.duration_s ?? 0)}`}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              seekTo((e.clientX - r.left) / r.width)
            }}
          >
            <span className="p-watched" style={{ width: pct(maxShown) }} />
            <span className="p-head" style={{ left: pct(current) }} />
            {l?.questions.map((q) => (
              <span key={q.id} className={`p-mark${answered.has(q.id) ? ' done' : ''}${question?.id === q.id ? ' now' : ''}`} style={{ left: pct(q.at_s) }} />
            ))}
          </div>
          <span className="p-time">
            {formatTime(current)} / {formatTime(l?.duration_s ?? 0)}
          </span>
        </div>
        {note && phase === 'playing' && (
          <p className="p-note" role="status">
            {note}
          </p>
        )}
      </footer>
    </div>
  )
}

function StartCard({ lesson, ready, onStart }: { lesson: StudentLesson | null; ready: boolean; onStart: () => void }) {
  if (!lesson) return <p className="p-muted">Loading…</p>
  const n = lesson.questions.length
  const resuming = lesson.max_watched_s > 0
  return (
    <div className="p-card">
      <h1>{lesson.title}</h1>
      <p className="p-muted">
        {formatTime(lesson.duration_s)} video · {n} question{n === 1 ? '' : 's'}
      </p>
      <ul className="p-rules">
        <li>The video stops for each question. Answers can't be changed once you submit.</li>
        <li>You can't skip ahead, but you can go back.</li>
        {lesson.require_fullscreen && <li>It plays fullscreen. Leaving fullscreen or switching tabs pauses it, and your teacher can see that.</li>}
      </ul>
      <button className="s-btn primary big" onClick={onStart} disabled={!ready} autoFocus>
        {!ready ? 'Loading video…' : resuming ? `Keep going from ${formatTime(lesson.last_pos_s)}` : 'Start'}
      </button>
    </div>
  )
}

function QuestionPanel(props: {
  attemptId: string
  q: PlayerQuestion
  number: number
  ensureReached: () => Promise<void>
  onDone: () => void
  onRejected: () => Promise<void>
}) {
  const { attemptId, number, ensureReached, onDone, onRejected } = props
  const [q, setQ] = useState<PlayerQuestion | null>(props.q.locked || props.q.prompt === undefined ? null : props.q)
  const [revealTry, setRevealTry] = useState(0)
  const [choice, setChoice] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const firstRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)

  // The server only reveals a question once it has seen the student reach it: save first, then ask.
  useEffect(() => {
    if (q) return
    let cancelled = false
    setError(null)
    ;(async () => {
      for (let i = 0; i < 3; i++) {
        try {
          await ensureReached()
          const full = await getQuestion(attemptId, props.q.id)
          if (!cancelled) setQ(full)
          return
        } catch (e) {
          if (classifyRpcError(e as { message?: string }) !== 'not_reached') break
        }
      }
      if (!cancelled) setError("Couldn't load the question. Check your Wi-Fi.")
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealTry])

  useEffect(() => firstRef.current?.focus(), [q])

  if (!q) {
    return (
      <aside className="p-panel" aria-busy={!error}>
        <p className="p-qmeta">
          Question {number} · {formatTime(props.q.at_s)}
        </p>
        {error ? (
          <>
            <p className="p-error" role="alert">
              {error}
            </p>
            <button className="s-btn primary big" onClick={() => setRevealTry((n) => n + 1)}>
              Try again
            </button>
          </>
        ) : (
          <p className="p-hint">Loading question…</p>
        )}
      </aside>
    )
  }

  const response = q.kind === 'mc' ? (choice === null ? '' : String(choice)) : text.trim()

  const submit = async () => {
    if (!response || busy) return
    setBusy(true)
    setError(null)
    try {
      await ensureReached()
      try {
        await submitAnswer(attemptId, q.id, response)
      } catch (e) {
        // The server hadn't seen them reach this question yet (a save was still in the air). Save, retry once.
        if (classifyRpcError(e as { message?: string }) !== 'not_reached') throw e
        await ensureReached()
        await submitAnswer(attemptId, q.id, response)
      }
      onDone()
    } catch (e) {
      const kind = classifyRpcError(e as { message?: string })
      if (kind === 'already_answered') return onDone()
      if (kind === 'not_reached') await onRejected()
      setError(kind === 'network' || kind === 'other' ? "Couldn't send your answer. Check your Wi-Fi and press Submit again." : 'Something went wrong. Press Submit again.')
      setBusy(false)
    }
  }

  return (
    <aside className="p-panel" aria-labelledby="q-prompt">
      <p className="p-qmeta">
        Question {number} · {formatTime(q.at_s)}
      </p>
      <h2 id="q-prompt">{q.prompt}</h2>
      {q.kind === 'mc' ? (
        <div className="p-choices" role="radiogroup" aria-labelledby="q-prompt">
          {(q.choices ?? []).map((c, i) => (
            <label key={i} className={`p-ans${choice === i ? ' sel' : ''}`}>
              <input
                ref={i === 0 ? firstRef : undefined}
                type="radio"
                name={`q-${q.id}`}
                checked={choice === i}
                onChange={() => setChoice(i)}
                disabled={busy}
              />
              <b aria-hidden="true">{String.fromCharCode(65 + i)}</b>
              <span>{c}</span>
            </label>
          ))}
        </div>
      ) : (
        <>
          <textarea
            ref={firstRef}
            className="p-text"
            rows={5}
            maxLength={5000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                void submit()
              }
            }}
            disabled={busy}
            aria-label="Your answer"
            placeholder="Type your answer"
          />
          <p className="p-hint">Ctrl+Enter to submit.</p>
        </>
      )}
      {error && (
        <p className="p-error" role="alert">
          {error}
        </p>
      )}
      <button className="s-btn primary big" onClick={() => void submit()} disabled={!response || busy}>
        {busy ? 'Sending…' : 'Submit and keep watching'}
      </button>
      <p className="p-hint">You can't change your answer after you submit.</p>
    </aside>
  )
}

function FatalScreen({ fatal, email, onSwitch }: { fatal: Fatal; email: string; onSwitch: () => void }) {
  return (
    <div className="player-root">
      <div className="p-center">
        <div className="p-card">
          {fatal.kind === 'not_assigned' ? (
            <>
              <h1>This assignment isn't on this account</h1>
              <p>
                You're signed in as <b>{email}</b>. If your teacher posted this in Google Classroom, switch to your school account.
              </p>
              <button className="s-btn primary big" onClick={onSwitch}>
                Switch account
              </button>
            </>
          ) : fatal.kind === 'video' ? (
            <>
              <h1>The video won't play</h1>
              <p>{fatal.message}</p>
            </>
          ) : (
            <>
              <h1>Couldn't load this assignment</h1>
              <p>Check your Wi-Fi and try again.</p>
              <button className="s-btn primary big" onClick={() => window.location.reload()}>
                Try again
              </button>
            </>
          )}
          <Link to="/student" className="p-link">
            My assignments
          </Link>
        </div>
      </div>
    </div>
  )
}

function studentVideoError(code: number): string {
  if (code === 101 || code === 150) return "The video's owner doesn't allow it to play outside YouTube. Tell your teacher so they can pick another one."
  if (code === 100) return 'This video was removed or made private. Tell your teacher.'
  return "YouTube couldn't load this video. If YouTube is blocked on this network, tell your teacher."
}
