import { describe, expect, it } from 'vitest'
import { handleClassroom, type ClaimResult, type Deps, type TeacherEvidence } from './classroomHandler.ts'
import { CLASSROOM_SCOPES } from './scopes.ts'
import { decryptToken, encryptToken } from './tokenCrypto.ts'

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))
const OTHER_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)))

function setup(
  opts: {
    teacher?: boolean
    scopes?: string[]
    revoked?: boolean
    failGradeFor?: string[]
    googleEmail?: string
    hd?: string | null
    verified?: boolean
    claim?: ClaimResult
    existingCoursework?: { id: string; materials?: { link?: { url?: string } }[] }[]
    profileStatus?: number
    importFails?: boolean
  } = {},
) {
  const claims: TeacherEvidence[] = []
  const revoked: string[] = []
  const store = new Map<string, string>()
  const calls: string[] = []
  const imported: unknown[] = []
  const posted: { url: string; body: Record<string, unknown> }[] = []
  let roster: unknown[] = [{ profile: { emailAddress: 'kid@d.org', name: { fullName: 'Kid' } } }]
  const patched: { url: string; body: Record<string, unknown> }[] = []
  const grades = [
    { email: 'Ann@d.org', score: 90.46 },
    { email: 'bob@d.org', score: 70 },
    { email: 'ghost@d.org', score: 50 },
  ]
  const asg = { id: 'as1', lessonTitle: 'Cells', courseId: 'gc1', dueAt: '2026-12-08T04:59:00.000Z', courseworkId: null as string | null }
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push(url.split('?')[0])
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      const rt = new URLSearchParams(String(init?.body)).get('refresh_token')
      if (opts.revoked || rt !== 'good-refresh') return Response.json({ error: 'invalid_grant' }, { status: 400 })
      return Response.json({ access_token: 'acc', scope: (opts.scopes ?? CLASSROOM_SCOPES).join(' ') })
    }
    if (url.startsWith('https://oauth2.googleapis.com/revoke')) {
      revoked.push(String(new URLSearchParams(String(init?.body)).get('token')))
      return new Response('')
    }
    if ((init?.headers as Record<string, string>)?.Authorization !== 'Bearer acc') return new Response('', { status: 401 })
    if (url.includes('/courseWork') && init?.method === 'POST') {
      posted.push({ url, body: JSON.parse(String(init.body)) })
      return Response.json({ id: 'cw1' })
    }
    if (url.includes('/studentSubmissions') && init?.method === 'PATCH') {
      if ((opts.failGradeFor ?? []).some((id) => url.includes(`/studentSubmissions/${id}?`))) return Response.json({ error: { message: 'nope' } }, { status: 403 })
      patched.push({ url, body: JSON.parse(String(init.body)) })
      return Response.json({})
    }
    if (url.includes('/courseWork?')) return Response.json({ courseWork: opts.existingCoursework ?? [] })
    if (url.endsWith('/userProfiles/me') && opts.profileStatus)
      return Response.json({ error: { status: 'PERMISSION_DENIED', message: 'The Classroom API is disabled for this domain.' } }, { status: opts.profileStatus })
    if (url.endsWith('/userProfiles/me'))
      return Response.json({ emailAddress: opts.googleEmail ?? 'T@d.org', verifiedTeacher: opts.verified ?? false, permissions: [{ permission: 'CREATE_COURSE' }] })
    if (url.startsWith('https://openidconnect.googleapis.com/v1/userinfo')) return Response.json(opts.hd === null ? { email: 'x' } : { email: 'x', hd: opts.hd ?? 'd.org' })
    if (url.includes('/studentSubmissions')) return Response.json({ studentSubmissions: [{ id: 'sub-ann', userId: 'u-ann' }, { id: 'sub-bob', userId: 'u-bob' }] })
    if (url.includes('/students')) return Response.json({ students: roster })
    if (url.includes('/courses')) return Response.json({ courses: [{ id: 'gc1', name: 'Bio', section: 'P2' }] })
    return new Response('', { status: 404 })
  }) as typeof fetch
  const deps: Deps = {
    fetch: fakeFetch,
    env: { clientId: 'cid', clientSecret: 'sec', encKey: KEY, appOrigin: 'https://oasis.test/' },
    getCaller: async (h) => (h === 'Bearer jwt' ? { id: 'teacher-1', email: 't@d.org', isTeacher: opts.teacher ?? true } : null),
    claimTeacher: async (_u, ev) => {
      claims.push(ev)
      return opts.claim ?? { status: 'granted', via: 'verified_teacher' }
    },
    loadToken: async (u) => store.get(u) ?? null,
    saveToken: async (u, enc) => void store.set(u, enc),
    deleteToken: async (u) => void store.delete(u),
    markUsed: async () => {},
    importClassroom: async (teacherId, courses) => {
      expect(teacherId).toBe('teacher-1')
      if (opts.importFails) throw new Error('too many courses')
      imported.push(courses)
      return { created: 1, updated: 0, newly_enrolled: 0, removed: 0, skipped: [] }
    },
    getAssignment: async (_h, id) => (id === asg.id ? { ...asg } : null),
    getGradesToPush: async (_h, id) => (id === asg.id ? { courseId: asg.courseId, courseworkId: asg.courseworkId, grades: [...grades] } : null),
    setCourseworkId: async (_h, _id, cw) => void (asg.courseworkId = cw),
  }
  const call = async (body: unknown, auth = 'Bearer jwt') => {
    const res = await handleClassroom(new Request('http://x', { method: 'POST', headers: { Authorization: auth }, body: JSON.stringify(body) }), deps)
    return { status: res.status, body: await res.json() }
  }
  return { claims, revoked, setRoster: (r: unknown[]) => void (roster = r), store, calls, imported, posted, patched, grades, asg, call }
}

describe('classroom edge function', () => {
  it('connect stores an encrypted token and syncs', async () => {
    const t = setup()
    const r = await t.call({ action: 'connect', refresh_token: 'good-refresh' })
    expect(r.body).toMatchObject({ ok: true, courses: 1, students: 1, created: 1 })
    const enc = t.store.get('teacher-1')!
    expect(enc).not.toContain('good-refresh')
    expect(await decryptToken(enc, KEY, 'teacher-1')).toBe('good-refresh')
    expect(t.imported).toEqual([[{ id: 'gc1', name: 'Bio', section: 'P2', students: [{ email: 'kid@d.org', name: 'Kid' }], hidden_emails: 0 }]])
  })

  it('sync uses the stored token', async () => {
    const t = setup()
    await t.call({ action: 'connect', refresh_token: 'good-refresh' })
    const r = await t.call({ action: 'sync' })
    expect(r.body.ok).toBe(true)
    expect(t.imported).toHaveLength(2)
  })

  it('refuses a token missing Classroom scopes and stores nothing', async () => {
    const t = setup({ scopes: ['openid', 'email'] })
    const r = await t.call({ action: 'connect', refresh_token: 'good-refresh' })
    expect(r.body).toMatchObject({ ok: false, error: 'missing_scopes' })
    expect(t.store.size).toBe(0)
  })

  it('a revoked token is deleted and the teacher is asked to reconnect', async () => {
    const t = setup()
    t.store.set('teacher-1', await encryptToken('revoked-refresh', KEY, 'teacher-1'))
    const r = await t.call({ action: 'sync' })
    expect(r.body).toEqual({ ok: false, error: 'reconnect' })
    expect(t.store.size).toBe(0)
  })

  it('sync without a connection says not_connected', async () => {
    expect((await setup().call({ action: 'sync' })).body).toEqual({ ok: false, error: 'not_connected' })
  })

  it('disconnect revokes at Google and deletes', async () => {
    const t = setup()
    await t.call({ action: 'connect', refresh_token: 'good-refresh' })
    expect((await t.call({ action: 'disconnect' })).body).toEqual({ ok: true })
    expect(t.store.size).toBe(0)
    expect(t.calls).toContain('https://oauth2.googleapis.com/revoke')
  })

  it('a token encrypted under another key is dropped: sync asks to reconnect, disconnect still deletes', async () => {
    const t = setup()
    t.store.set('teacher-1', await encryptToken('good-refresh', OTHER_KEY, 'teacher-1'))
    expect((await t.call({ action: 'sync' })).body).toEqual({ ok: false, error: 'reconnect' })
    expect(t.store.size).toBe(0)
    t.store.set('teacher-1', await encryptToken('good-refresh', OTHER_KEY, 'teacher-1'))
    expect((await t.call({ action: 'disconnect' })).body).toEqual({ ok: true })
    expect(t.store.size).toBe(0)
  })

  it('rejects signed-out callers and students', async () => {
    expect((await setup().call({ action: 'sync' }, '')).status).toBe(401)
    expect((await setup().call({ action: 'sync' }, 'Bearer forged')).status).toBe(401)
    expect((await setup({ teacher: false }).call({ action: 'sync' })).status).toBe(403)
    expect((await setup({ teacher: false }).call({ action: 'connect', refresh_token: 'good-refresh' })).status).toBe(403)
    expect((await setup({ teacher: false }).call({ action: 'post', assignment_id: 'as1' })).status).toBe(403)
    expect((await setup().call(null)).status).toBe(400)
  })

  it('connect refuses a different Google account than the signed-in teacher', async () => {
    const t = setup({ googleEmail: 'someone.else@d.org' })
    const r = await t.call({ action: 'connect', refresh_token: 'good-refresh' })
    expect(r.body).toEqual({ ok: false, error: 'wrong_account' })
    expect(t.store.size).toBe(0)
    expect(t.imported).toEqual([])
  })
})

describe('teacher sign-up (claim_teacher)', () => {
  it('a student can claim; Google evidence goes to the database, and on a grant the token is stored and classes import', async () => {
    const t = setup({ teacher: false, verified: true, hd: 'D.org' })
    const r = await t.call({ action: 'claim_teacher', refresh_token: 'good-refresh' })
    expect(r.body).toMatchObject({ ok: true, status: 'granted', via: 'verified_teacher', courses: 1, students: 1, created: 1 })
    expect(t.claims).toEqual([
      { google_email: 't@d.org', hosted_domain: 'd.org', verified_teacher: true, can_create_courses: true, active_courses: 1, students: 1, course_names: ['Bio · P2'] },
    ])
    expect(await decryptToken(t.store.get('teacher-1')!, KEY, 'teacher-1')).toBe('good-refresh')
    expect(t.imported).toHaveLength(1)
  })

  it('pending: stores the token for later, imports nothing', async () => {
    const t = setup({ teacher: false, hd: null, claim: { status: 'pending', reason: 'personal_account' } })
    const r = await t.call({ action: 'claim_teacher', refresh_token: 'good-refresh' })
    expect(r.body).toEqual({ ok: true, status: 'pending', reason: 'personal_account' })
    expect(t.claims[0].hosted_domain).toBeNull()
    expect(t.store.has('teacher-1')).toBe(true)
    expect(t.imported).toEqual([])
  })

  it('refused: stores nothing, imports nothing, revokes our access', async () => {
    const t = setup({ teacher: false, claim: { status: 'refused', reason: 'no_courses' } })
    const r = await t.call({ action: 'claim_teacher', refresh_token: 'good-refresh' })
    expect(r.body).toEqual({ ok: true, status: 'refused', reason: 'no_courses' })
    expect(t.store.size).toBe(0)
    expect(t.imported).toEqual([])
    expect(t.revoked).toEqual(['good-refresh'])
  })

  it("wrong account: refused without revoking someone else's grant", async () => {
    const t = setup({ teacher: false, googleEmail: 'other@d.org', claim: { status: 'refused', reason: 'wrong_account' } })
    const r = await t.call({ action: 'claim_teacher', refresh_token: 'good-refresh' })
    expect(r.body.reason).toBe('wrong_account')
    expect(t.claims[0].google_email).toBe('other@d.org') // passed through; the database compares it to the account
    expect(t.revoked).toEqual([])
    expect(t.store.size).toBe(0)
  })

  it('needs a valid token with every Classroom scope before asking anything', async () => {
    const t = setup({ teacher: false, scopes: CLASSROOM_SCOPES.slice(0, 2) })
    expect((await t.call({ action: 'claim_teacher', refresh_token: 'good-refresh' })).body.error).toBe('missing_scopes')
    expect((await t.call({ action: 'claim_teacher', refresh_token: 'stolen' })).body.error).toBe('reconnect')
    expect((await t.call({ action: 'claim_teacher' })).status).toBe(400)
    expect(t.claims).toEqual([])
  })
})

describe('auto-post to Classroom', () => {
  it('posts the assignment with a link, due date in UTC and 100 points, then records the coursework id', async () => {
    const t = setup()
    await t.call({ action: 'connect', refresh_token: 'good-refresh' })
    const r = await t.call({ action: 'post', assignment_id: 'as1' })
    expect(r.body).toEqual({ ok: true, coursework_id: 'cw1' })
    expect(t.posted).toHaveLength(1)
    expect(t.posted[0].url).toBe('https://classroom.googleapis.com/v1/courses/gc1/courseWork')
    expect(t.posted[0].body).toMatchObject({
      title: 'Cells',
      workType: 'ASSIGNMENT',
      state: 'PUBLISHED',
      maxPoints: 100,
      materials: [{ link: { url: 'https://oasis.test/student/assignments/as1' } }],
      dueDate: { year: 2026, month: 12, day: 8 },
      dueTime: { hours: 4, minutes: 59 },
    })
    expect(t.asg.courseworkId).toBe('cw1')
  })

  it('never posts the same assignment twice', async () => {
    const t = setup()
    await t.call({ action: 'connect', refresh_token: 'good-refresh' })
    await t.call({ action: 'post', assignment_id: 'as1' })
    const r = await t.call({ action: 'post', assignment_id: 'as1' })
    expect(r.body).toMatchObject({ ok: true, already: true })
    expect(t.posted).toHaveLength(1)
  })

  it('omits the due date when there is none', async () => {
    const t = setup()
    t.asg.dueAt = null
    await t.call({ action: 'connect', refresh_token: 'good-refresh' })
    await t.call({ action: 'post', assignment_id: 'as1' })
    expect(t.posted[0].body).not.toHaveProperty('dueDate')
  })

  it("refuses someone else's assignment and needs a connection", async () => {
    const t = setup()
    expect((await t.call({ action: 'post', assignment_id: 'nope' })).status).toBe(404)
    expect((await t.call({ action: 'post', assignment_id: 'as1' })).body).toEqual({ ok: false, error: 'not_connected' })
    expect(t.posted).toHaveLength(0)
  })
})

describe('push grades', () => {
  const ready = async (opts: Parameters<typeof setup>[0] = {}) => {
    const t = setup(opts)
    await t.call({ action: 'connect', refresh_token: 'good-refresh' })
    t.asg.courseworkId = 'cw1'
    t.setRoster([{ userId: 'u-ann', profile: { emailAddress: 'ANN@d.org' } }, { userId: 'u-bob', profile: { emailAddress: 'bob@d.org' } }])
    return t
  }

  it('patches draft and assigned grade, rounded, and reports unknown students', async () => {
    const t = await ready()
    const r = await t.call({ action: 'push_grades', assignment_id: 'as1' })
    expect(r.body).toEqual({ ok: true, pushed: 2, not_in_classroom: ['ghost@d.org'], needs_grading: [], failed: [] })
    const byUrl = Object.fromEntries(t.patched.map((p) => [p.url, p.body]))
    const base = 'https://classroom.googleapis.com/v1/courses/gc1/courseWork/cw1/studentSubmissions'
    expect(byUrl[`${base}/sub-ann?updateMask=assignedGrade,draftGrade`]).toEqual({ assignedGrade: 90.5, draftGrade: 90.5 })
    expect(byUrl[`${base}/sub-bob?updateMask=assignedGrade,draftGrade`]).toEqual({ assignedGrade: 70, draftGrade: 70 })
  })

  it('only sends the grades it is given (unfinished students are left out)', async () => {
    const t = await ready()
    t.grades.splice(1)
    const r = await t.call({ action: 'push_grades', assignment_id: 'as1' })
    expect(r.body).toMatchObject({ pushed: 1, not_in_classroom: [] })
    expect(t.patched).toHaveLength(1)
  })

  it('holds back students with short answers still to grade (they would count as wrong)', async () => {
    const t = await ready()
    t.grades[1] = { ...t.grades[1], ungraded: 1 }
    const r = await t.call({ action: 'push_grades', assignment_id: 'as1' })
    expect(r.body).toMatchObject({ ok: true, pushed: 1, needs_grading: ['bob@d.org'] })
    expect(t.patched.map((p) => p.url)).not.toContain(expect.stringContaining('sub-bob'))
    expect(t.patched).toHaveLength(1)
  })

  it("one student's failure doesn't stop the others", async () => {
    const t = await ready({ failGradeFor: ['sub-ann'] })
    const r = await t.call({ action: 'push_grades', assignment_id: 'as1' })
    expect(r.body.ok).toBe(true)
    expect(r.body.pushed).toBe(1)
    expect(r.body.failed).toHaveLength(1)
    expect(r.body.failed[0]).toMatchObject({ email: 'Ann@d.org' })
    expect(r.body.failed[0].error).toContain('403')
    expect(t.patched).toHaveLength(1)
  })

  it('needs the assignment posted, a connection, and ownership', async () => {
    const t = setup()
    expect((await t.call({ action: 'push_grades', assignment_id: 'as1' })).body).toEqual({ ok: false, error: 'not_posted' })
    t.asg.courseworkId = 'cw1'
    expect((await t.call({ action: 'push_grades', assignment_id: 'as1' })).body).toEqual({ ok: false, error: 'not_connected' })
    expect((await t.call({ action: 'push_grades', assignment_id: 'nope' })).status).toBe(404)
    expect(t.patched).toHaveLength(0)
  })
})

describe('token encryption', () => {
  it('is bound to the key and the user', async () => {
    const enc = await encryptToken('secret', KEY, 'u1')
    expect(await decryptToken(enc, KEY, 'u1')).toBe('secret')
    await expect(decryptToken(enc, OTHER_KEY, 'u1')).rejects.toThrow()
    await expect(decryptToken(enc, KEY, 'u2')).rejects.toThrow()
    expect(await encryptToken('secret', KEY, 'u1')).not.toBe(enc) // fresh IV each time
  })

  it('a stored token that no longer decrypts is dropped and the teacher is asked to reconnect', async () => {
    const t = setup()
    t.store.set('teacher-1', await encryptToken('good-refresh', OTHER_KEY, 'teacher-1'))
    expect((await t.call({ action: 'sync' })).body).toEqual({ ok: false, error: 'reconnect' })
    expect(t.store.has('teacher-1')).toBe(false)
  })

  it("disconnect still works when the stored token can't be decrypted", async () => {
    const t = setup()
    t.store.set('teacher-1', await encryptToken('good-refresh', OTHER_KEY, 'teacher-1'))
    expect((await t.call({ action: 'disconnect' })).body).toEqual({ ok: true })
    expect(t.store.has('teacher-1')).toBe(false)
  })

  it("Google refusals come back as 200 with Google's reason, so the page can show it", async () => {
    const t = setup({ profileStatus: 403 })
    const r = await t.call({ action: 'connect', refresh_token: 'good-refresh' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ ok: false, google_status: 403, google_reason: 'PERMISSION_DENIED' })
    expect(r.body.error).toContain('The Classroom API is disabled for this domain.')
  })

  it('a granted sign-up still reports granted if the class import fails afterwards', async () => {
    const t = setup({ teacher: false, importFails: true })
    const r = await t.call({ action: 'claim_teacher', refresh_token: 'good-refresh' })
    expect(r.body).toMatchObject({ ok: true, status: 'granted', import_error: 'too many courses' })
    expect(t.store.has('teacher-1')).toBe(true)
  })

  it('reuses coursework a lost earlier response already created instead of posting twice', async () => {
    const t = setup({ existingCoursework: [{ id: 'cw-old', materials: [{ link: { url: 'https://oasis.test/student/assignments/as1' } }] }] })
    t.store.set('teacher-1', await encryptToken('good-refresh', KEY, 'teacher-1'))
    expect((await t.call({ action: 'post', assignment_id: 'as1' })).body).toEqual({ ok: true, coursework_id: 'cw-old' })
    expect(t.posted).toHaveLength(0)
    expect(t.asg.courseworkId).toBe('cw-old')
  })

  it('counts students Google listed without an email instead of silently dropping them', async () => {
    const t = setup()
    t.setRoster([{ profile: { emailAddress: 'kid@d.org', name: { fullName: 'Kid' } } }, { profile: { name: { fullName: 'Hidden' } } }])
    const r = await t.call({ action: 'connect', refresh_token: 'good-refresh' })
    expect(r.body).toMatchObject({ ok: true, students: 1, hidden_emails: 1 })
    expect((t.imported[0] as { hidden_emails: number }[])[0].hidden_emails).toBe(1)
  })
})
