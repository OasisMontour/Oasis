// The `classroom` Edge Function's logic, with every outside dependency injected so it can be unit tested.
//
// POST { action: 'connect', refresh_token } -> verifies + stores the teacher's Google refresh token, then syncs
// POST { action: 'sync' }                   -> imports Classroom courses + rosters with the stored token
// POST { action: 'disconnect' }             -> revokes the token at Google and deletes it
//
// Business errors come back as 200 { ok: false, error } so the browser can show a message.

import { CLASSROOM_SCOPES } from './scopes.ts'
import { decryptToken, encryptToken } from './tokenCrypto.ts'
import { fetchClassroomRosters, InvalidGrantError, refreshAccessToken, revokeToken, type ImportCourse } from './google.ts'

export type SyncResult = { created: number; updated: number; newly_enrolled: number; skipped: string[] }

export type Deps = {
  fetch: typeof fetch
  env: { clientId: string; clientSecret: string; encKey: string }
  /** Resolves the caller from their Supabase JWT; null if not signed in. */
  getCaller(authHeader: string): Promise<{ id: string; isTeacher: boolean } | null>
  loadToken(userId: string): Promise<string | null>
  saveToken(userId: string, enc: string, scopes: string): Promise<void>
  deleteToken(userId: string): Promise<void>
  markUsed(userId: string): Promise<void>
  /** Calls import_classroom as the caller (their JWT), so the RPC's own checks apply. */
  importClassroom(authHeader: string, courses: ImportCourse[]): Promise<SyncResult>
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

export async function handleClassroom(req: Request, d: Deps): Promise<Response> {
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405)
  const auth = req.headers.get('Authorization') ?? ''
  const caller = auth ? await d.getCaller(auth) : null
  if (!caller) return json({ ok: false, error: 'not signed in' }, 401)
  if (!caller.isTeacher) return json({ ok: false, error: 'teachers only' }, 403)

  let body: { action?: string; refresh_token?: string }
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'bad request' }, 400)
  }

  const sync = async (accessToken: string) => {
    const courses = await fetchClassroomRosters(d.fetch, accessToken)
    const result = await d.importClassroom(auth, courses)
    await d.markUsed(caller.id)
    return json({ ok: true, courses: courses.length, students: courses.reduce((n, c) => n + c.students.length, 0), ...result })
  }

  try {
    if (body.action === 'connect') {
      const rt = body.refresh_token
      if (!rt || typeof rt !== 'string' || rt.length > 2048) return json({ ok: false, error: 'missing refresh token' }, 400)
      let token
      try {
        token = await refreshAccessToken(d.fetch, d.env.clientId, d.env.clientSecret, rt)
      } catch (e) {
        if (e instanceof InvalidGrantError) return json({ ok: false, error: 'reconnect' })
        throw e
      }
      const missing = CLASSROOM_SCOPES.filter((s) => !token.scopes.includes(s))
      if (missing.length) return json({ ok: false, error: 'missing_scopes', missing })
      await d.saveToken(caller.id, await encryptToken(rt, d.env.encKey, caller.id), token.scopes.join(' '))
      return await sync(token.accessToken)
    }

    if (body.action === 'sync') {
      const enc = await d.loadToken(caller.id)
      if (!enc) return json({ ok: false, error: 'not_connected' })
      let token
      try {
        token = await refreshAccessToken(d.fetch, d.env.clientId, d.env.clientSecret, await decryptToken(enc, d.env.encKey, caller.id))
      } catch (e) {
        if (e instanceof InvalidGrantError) {
          await d.deleteToken(caller.id)
          return json({ ok: false, error: 'reconnect' })
        }
        throw e
      }
      return await sync(token.accessToken)
    }

    if (body.action === 'disconnect') {
      const enc = await d.loadToken(caller.id)
      if (enc) {
        await revokeToken(d.fetch, await decryptToken(enc, d.env.encKey, caller.id)).catch(() => undefined)
        await d.deleteToken(caller.id)
      }
      return json({ ok: true })
    }

    return json({ ok: false, error: 'unknown action' }, 400)
  } catch (e) {
    console.error('classroom function failed', e)
    return json({ ok: false, error: (e as Error).message }, 500)
  }
}
