import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { rememberNext } from '../lib/next'
import {
  canFinish,
  classifyRpcError,
  dueNote,
  dueQuestion,
  multiResponse,
  maxWatchedAfterEnd,
  needsReconnect,
  nextUnanswered,
  onVideoEnded,
  positionToSave,
  progressToSave,
  SKIP_TOLERANCE_S,
  tick,
  type AnswerResult,
  type PlayerNote,
  type PlayerQuestion,
  type StudentLesson,
} from '../lib/player'
import {
  finishAttempt,
  getAssignmentClassName,
  getQuestion,
  getStudentLesson,
  recheckEnrollment,
  sendFocusEvent,
  saveProgress,
  submitAnswer,
  type FocusKind,
} from '../lib/studentApi'
import { formatTime } from '../lib/time'
import { loadYouTubeApi, YT_STATE, type YTPlayer } from '../lib/youtube'
import { readPrefs } from '../lib/prefs'
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
  const [noteShown, setNoteShown] = useState<PlayerNote | null>(null)
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
  const [checking, setChecking] = useState(false)

  const rootRef = useRef<HTMLDivElement>(null)
  const mountRef = useRef<HTMLDivElement>(null)
  const player = useRef<YTPlayer | null>(null)
  // Live values for timers and event handlers, which would otherwise see stale state.
  const m = useRef({
    phase: 'loading' as Phase,
    lesson: null as StudentLesson | null,
    answered: new Set<string>() as ReadonlySet<string>,
    question: null as PlayerQuestion | null,
    note: null as PlayerNote | null,
    seenNotes: new Set<string>(),
    away: null as Away,
    reconnecting: false,
    maxWatched: 0,
    confirmed: 0,
    savedPos: -1,
    /** Last playhead position we trust. The player reports 0 until it's started, so until then this is the saved resume point. */
    lastPos: 0,
    /** Wall clock (ms) of the previous watchdog tick, to allow for a busy device skipping ticks. */
    lastTickAt: 0,
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
    const load = async () => {
      try {
        return await getStudentLesson(assignmentId)
      } catch (e) {
        // Not in this class yet? They may have been added in Google Classroom after the teacher's last sync.
        // Recheck that class once before turning them away (beta item 4).
        if (classifyRpcError(e as { message?: string }) !== 'not_assigned' || /uuid/i.test((e as Error).message ?? '')) throw e
        if (!cancelled) setChecking(true)
        const enrolled = await recheckEnrollment(assignmentId).catch(() => false)
        if (!enrolled) throw e
        return await getStudentLesson(assignmentId)
      }
    }
    load()
      .then((l) => {
        if (cancelled) return
        applyServerState(l)
        m.current.lastPos = l.last_pos_s
        m.current.savedPos = progressToSave(Math.min(l.last_pos_s, l.max_watched_s), l.duration_s)
        setCurrent(l.last_pos_s)
        setPhaseBoth(l.finished_at ? 'done' : 'ready')
        getAssignmentClassName(assignmentId).then((n) => !cancelled && setClassName(n))
      })
      .catch((e: { message?: string }) => {
        if (cancelled) return
        const kind = classifyRpcError(e)
        // A malformed id is a Postgres uuid error: same thing to a student as "not yours".
        if (kind === 'not_assigned' || /uuid/i.test(e.message ?? '')) setFatal({ kind: 'not_assigned' })
        else setFatal({ kind: 'load' })
      })
      .finally(() => !cancelled && setChecking(false))
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
    // Before Start the player hasn't been seeked to the resume point yet and reports 0: saving that
    // would throw away where the student was (audit #15).
    const pos = positionToSave(s.phase === 'playing' ? player.current?.getCurrentTime() : null, s.lastPos, value, l.duration_s)
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

  // Teacher notes: pause, show, continue. Not graded, and the server never waits for them.
  const showNote = useCallback(
    (n: PlayerNote) => {
      const s = m.current
      s.seenNotes.add(n.id)
      player.current?.pauseVideo()
      s.note = n
      setNoteShown(n)
    },
    [],
  )
  const closeNote = () => {
    const s = m.current
    s.note = null
    setNoteShown(null)
    if (!s.question && !s.away && !s.reconnecting && s.phase === 'playing') player.current?.playVideo()
  }

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
    s.maxWatched = maxWatchedAfterEnd(s.maxWatched, s.lesson.duration_s, s.lesson.questions, s.answered)
    setMaxShown(s.maxWatched)
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
      if (!s.away && !s.reconnecting && !s.note) player.current?.playVideo()
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
            // Student setting: captions on by default when the video has them.
            ...(readPrefs().captions ? { cc_load_policy: 1 } : {}),
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
                if (s.question || s.note || s.away || s.reconnecting || s.phase !== 'playing') player.current?.pauseVideo()
                else setPlaying(true)
              } else if (e.data === YT_STATE.PAUSED) {
                setPlaying(false)
                void save()
              } else if (e.data === YT_STATE.ENDED) {
                setPlaying(false)
                const l = s.lesson
                if (!l) return
                const out = onVideoEnded({ current: now(), maxWatched: s.maxWatched, durationS: l.duration_s, questions: l.questions, answered: s.answered })
                if (out.snapBack) {
                  player.current?.seekTo(s.maxWatched, true)
                  return
                }
                // Honestly reached the end (YouTube's length can be a little short of what the teacher saved).
                // Record that BEFORE showing a question that sits at the very end, so answering it finishes
                // the lesson instead of calling Play and replaying the video (audit #14).
                s.maxWatched = out.maxWatched
                s.lastPos = out.maxWatched
                setMaxShown(s.maxWatched)
                s.ended = true
                if (out.question) return showQuestion(out.question)
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
    m.current.lastTickAt = 0 // time spent outside 'playing' isn't playback
    const id = window.setInterval(() => {
      const s = m.current
      const p = player.current
      const l = s.lesson
      if (!p || !l) return
      if (p.getPlaybackRate() !== 1) p.setPlaybackRate(1)
      const t = now()
      const at = performance.now()
      const elapsedS = s.lastTickAt ? (at - s.lastTickAt) / 1000 : 0
      s.lastTickAt = at
      const r = tick({ current: t, maxWatched: s.maxWatched, durationS: l.duration_s, questions: l.questions, answered: s.answered, elapsedS })
      if (r.snapBack) {
        p.seekTo(s.maxWatched, true)
        setCurrent(s.maxWatched)
        return
      }
      s.maxWatched = r.maxWatched
      s.lastPos = t
      setCurrent(t)
      setMaxShown(r.maxWatched)
      if (r.question && !s.question) showQuestion(r.question)
      else if (!s.question && !s.note) {
        const n = dueNote(l.notes, s.seenNotes, t)
        if (n) showNote(n)
      }
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
  }, [phase, playerReady, save, showQuestion, showNote, setReconnectingBoth, goAway])

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
    for (const n of l.notes ?? []) if (n.at_s < l.last_pos_s - 0.5) m.current.seenNotes.add(n.id)
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
    if (!m.current.question && !m.current.note && !m.current.reconnecting) player.current?.playVideo()
  }

  const togglePlay = () => {
    const s = m.current
    if (s.phase !== 'playing' || s.question || s.note || s.away || s.reconnecting) return
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
    const l = m.current.lesson
    if (l) seekToS(frac * l.duration_s)
  }

  /** Seek anywhere already watched, never past it. */
  const seekToS = (sec: number) => {
    const s = m.current
    const l = s.lesson
    if (!l || s.phase !== 'playing' || s.question) return
    const target = Math.max(0, Math.min(sec, s.maxWatched))
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
        <Link to={`/report?from=${encodeURIComponent(location.pathname)}`} className="p-back small-link">
          Report a problem
        </Link>
      </header>

      <div className={`p-body${question || noteShown ? ' with-panel' : ''}`}>
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
          {(question || noteShown) && (
            <div className="p-paused">
              <span>{question ? '⏸ Paused for a question' : '⏸ Paused for a note from your teacher'}</span>
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
              <StartCard lesson={l} ready={playerReady} checking={checking} onStart={start} />
            </div>
          )}
        </div>

        {noteShown && !question && (
          <aside className="p-panel" aria-labelledby="note-h">
            <p className="p-qmeta">Note from your teacher · {formatTime(noteShown.at_s)}</p>
            <h2 id="note-h" className="p-note-body">{noteShown.body}</h2>
            <div className="p-submit">
              <button className="s-btn primary big" onClick={closeNote} autoFocus>
                Continue
              </button>
            </div>
          </aside>
        )}
        {question && l && (
          <QuestionPanel
            key={question.id}
            attemptId={l.attempt_id}
            q={question}
            number={qIndex}
            showFeedback={l.show_feedback === true}
            ensureReached={async () => {
              if (m.current.confirmed + 1 < question.at_s) await save()
            }}
            onDone={() => onAnswered(question.id)}
            onRejected={resync}
            onNotAssigned={() => setFatal({ kind: 'not_assigned' })}
          />
        )}
      </div>

      <footer className="p-bottom">
        <div className="p-controls">
          <button className="p-ctl" onClick={togglePlay} disabled={phase !== 'playing' || !!question || !!noteShown || !!away || reconnecting} aria-label={playing ? 'Pause' : 'Play'}>
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
            aria-disabled={phase !== 'playing' || !!question}
            tabIndex={0}
            onKeyDown={(e) => {
              // Keyboard slider (audit #18): arrows step 5s, Home/End jump to the start or as far as watched.
              const step = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5, PageDown: -30, PageUp: 30 }[e.key]
              if (step === undefined && e.key !== 'Home' && e.key !== 'End') return
              e.preventDefault()
              e.stopPropagation()
              if (e.key === 'Home') seekToS(0)
              else if (e.key === 'End') seekToS(m.current.maxWatched)
              else seekToS(now() + (step as number))
            }}
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

function StartCard({ lesson, ready, checking, onStart }: { lesson: StudentLesson | null; ready: boolean; checking?: boolean; onStart: () => void }) {
  if (!lesson) return <p className="p-muted">{checking ? 'Checking your class list in Google Classroom…' : 'Loading…'}</p>
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
  /** Show Correct / Incorrect before playback resumes (the lesson's setting). */
  showFeedback: boolean
  ensureReached: () => Promise<void>
  onDone: () => void
  onRejected: () => Promise<void>
  /** The server says this student isn't in the class any more (taken off the Classroom roster mid-lesson). */
  onNotAssigned: () => void
}) {
  const { attemptId, number, showFeedback, ensureReached, onDone, onRejected, onNotAssigned } = props
  const [q, setQ] = useState<PlayerQuestion | null>(props.q.locked || props.q.prompt === undefined ? null : props.q)
  const [revealTry, setRevealTry] = useState(0)
  const [choice, setChoice] = useState<number | null>(null)
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set())
  // Locked in: what to tell the student before the video starts again.
  const [result, setResult] = useState<AnswerResult | null>(null)
  const continueRef = useRef<HTMLButtonElement>(null)
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
          const kind = classifyRpcError(e as { message?: string })
          if (kind === 'not_assigned') {
            if (!cancelled) onNotAssigned()
            return
          }
          if (kind !== 'not_reached') break
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
  useEffect(() => {
    if (result) continueRef.current?.focus()
  }, [result])

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

  const response = q.kind === 'mc' ? (choice === null ? '' : String(choice)) : q.kind === 'multi' ? multiResponse(picked) : text.trim()

  // After the answer is locked: right/wrong for choice questions (if the lesson shows it), "submitted for review"
  // for short answers. Never which choice was right. Continue starts the video again.
  if (result) {
    const short = q.kind === 'short'
    return (
      <aside className="p-panel" aria-labelledby="q-prompt">
        <p className="p-qmeta">
          Question {number} · {formatTime(q.at_s)}
        </p>
        <h2 id="q-prompt">{q.prompt}</h2>
        <p className={`p-result ${result}`} role="status">
          {result === 'correct' ? '✓ Correct' : result === 'incorrect' ? '✗ Incorrect' : short ? 'Submitted for review' : 'Answer saved'}
        </p>
        {result === 'submitted' && short && <p className="p-hint">Your teacher will grade this one.</p>}
        <div className="p-submit">
          <button ref={continueRef} className="s-btn primary big" onClick={onDone}>
            Keep watching
          </button>
        </div>
      </aside>
    )
  }

  const submit = async () => {
    if (!response || busy) return
    setBusy(true)
    setError(null)
    try {
      await ensureReached()
      let r: AnswerResult
      try {
        r = await submitAnswer(attemptId, q.id, response)
      } catch (e) {
        // The server hadn't seen them reach this question yet (a save was still in the air). Save, retry once.
        if (classifyRpcError(e as { message?: string }) !== 'not_reached') throw e
        await ensureReached()
        r = await submitAnswer(attemptId, q.id, response)
      }
      // Choice answers with feedback off go straight back to the video, as before.
      if (q.kind !== 'short' && (!showFeedback || r === 'submitted')) return onDone()
      setBusy(false)
      setResult(r)
    } catch (e) {
      const kind = classifyRpcError(e as { message?: string })
      if (kind === 'already_answered') return onDone()
      if (kind === 'not_assigned') return onNotAssigned()
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
      {q.kind === 'multi' ? (
        <fieldset className="p-choices" aria-labelledby="q-prompt" aria-describedby="q-multi-hint">
          <p id="q-multi-hint" className="p-hint">Pick every answer that's right.</p>
          {(q.choices ?? []).map((c, i) => (
            <label key={i} className={`p-ans${picked.has(i) ? ' sel' : ''}`}>
              <input
                ref={i === 0 ? firstRef : undefined}
                type="checkbox"
                checked={picked.has(i)}
                onChange={() =>
                  setPicked((p) => {
                    const n = new Set(p)
                    if (n.has(i)) n.delete(i)
                    else n.add(i)
                    return n
                  })
                }
                disabled={busy}
              />
              <b aria-hidden="true">{String.fromCharCode(65 + i)}</b>
              <span>{c}</span>
            </label>
          ))}
        </fieldset>
      ) : q.kind === 'mc' ? (
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
      {/* Pinned to the bottom of the panel: a long question with many choices scrolls, Submit stays visible. */}
      <div className="p-submit">
        {error && (
          <p className="p-error" role="alert">
            {error}
          </p>
        )}
        <button className="s-btn primary big" onClick={() => void submit()} disabled={!response || busy}>
          {busy ? 'Sending…' : 'Submit'}
        </button>
        <p className="p-hint">You can't change your answer after you submit.</p>
      </div>
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
              <p>
                Already on your school account? You may have been moved out of this class in Google Classroom. Ask your teacher.
              </p>
              <button className="s-btn primary big" onClick={onSwitch}>
                Switch account
              </button>
            </>
          ) : fatal.kind === 'video' ? (
            <>
              <h1>The video won't play</h1>
              <p>{fatal.message}</p>
              <button className="s-btn primary big" onClick={() => window.location.reload()}>
                Try again
              </button>
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
