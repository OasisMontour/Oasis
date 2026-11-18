import { describe, expect, it } from 'vitest'
import { handleClassroom, type Deps } from './classroomHandler.ts'
import { CLASSROOM_SCOPES } from './scopes.ts'
import { decryptToken, encryptToken } from './tokenCrypto.ts'

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))
const OTHER_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)))

function setup(opts: { teacher?: boolean; scopes?: string[]; revoked?: boolean } = {}) {
  const store = new Map<string, string>()
  const calls: string[] = []
  const imported: unknown[] = []
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push(url.split('?')[0])
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      const rt = new URLSearchParams(String(init?.body)).get('refresh_token')
      if (opts.revoked || rt !== 'good-refresh') return Response.json({ error: 'invalid_grant' }, { status: 400 })
      return Response.json({ access_token: 'acc', scope: (opts.scopes ?? CLASSROOM_SCOPES).join(' ') })
    }
    if (url.startsWith('https://oauth2.googleapis.com/revoke')) return new Response('')
    if ((init?.headers as Record<string, string>)?.Authorization !== 'Bearer acc') return new Response('', { status: 401 })
    if (url.includes('/students')) return Response.json({ students: [{ profile: { emailAddress: 'kid@d.org', name: { fullName: 'Kid' } } }] })
    if (url.includes('/courses')) return Response.json({ courses: [{ id: 'gc1', name: 'Bio', section: 'P2' }] })
    return new Response('', { status: 404 })
  }) as typeof fetch
  const deps: Deps = {
    fetch: fakeFetch,
    env: { clientId: 'cid', clientSecret: 'sec', encKey: KEY },
    getCaller: async (h) => (h === 'Bearer jwt' ? { id: 'teacher-1', isTeacher: opts.teacher ?? true } : null),
    loadToken: async (u) => store.get(u) ?? null,
    saveToken: async (u, enc) => void store.set(u, enc),
    deleteToken: async (u) => void store.delete(u),
    markUsed: async () => {},
    importClassroom: async (_h, courses) => {
      imported.push(courses)
      return { created: 1, updated: 0, newly_enrolled: 0, removed: 0, skipped: [] }
    },
  }
  const call = async (body: unknown, auth = 'Bearer jwt') => {
    const res = await handleClassroom(new Request('http://x', { method: 'POST', headers: { Authorization: auth }, body: JSON.stringify(body) }), deps)
    return { status: res.status, body: await res.json() }
  }
  return { store, calls, imported, call }
}

describe('classroom edge function', () => {
  it('connect stores an encrypted token and syncs', async () => {
    const t = setup()
    const r = await t.call({ action: 'connect', refresh_token: 'good-refresh' })
    expect(r.body).toMatchObject({ ok: true, courses: 1, students: 1, created: 1 })
    const enc = t.store.get('teacher-1')!
    expect(enc).not.toContain('good-refresh')
    expect(await decryptToken(enc, KEY, 'teacher-1')).toBe('good-refresh')
    expect(t.imported).toEqual([[{ id: 'gc1', name: 'Bio', section: 'P2', students: [{ email: 'kid@d.org', name: 'Kid' }] }]])
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

  it('rejects signed-out callers and students', async () => {
    expect((await setup().call({ action: 'sync' }, '')).status).toBe(401)
    expect((await setup().call({ action: 'sync' }, 'Bearer forged')).status).toBe(401)
    expect((await setup({ teacher: false }).call({ action: 'sync' })).status).toBe(403)
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
})
