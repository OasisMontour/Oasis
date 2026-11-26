import { describe, expect, it, vi } from 'vitest'
import { handleAiDraft, hasTimestamps, parseClock, parseDrafts, redact, type Deps, type GenClaim } from './aiDrafter.ts'
import type { Provider } from './aiGrader.ts'

const prov = (name: string): Provider => ({ name, url: `https://${name}.test/v1/chat/completions`, key: `${name}-key`, model: `${name}-model`, dailyCap: 100 })
const reply = (content: unknown, status = 200) =>
  new Response(status === 200 ? JSON.stringify({ choices: [{ message: { content } }] }) : 'nope', { status })

const MATERIAL = 'Photosynthesis happens in the chloroplasts of plant cells. '.repeat(6)
const TRANSCRIPT = '0:05 intro to cells\n1:10 the nucleus holds DNA\n2:20 mitochondria make energy\n3:30 chloroplasts do photosynthesis\n'.repeat(2)

const goodReply = JSON.stringify({
  questions: [
    { type: 'mc', time: '1:15', question: 'Where is DNA kept?', choices: ['Nucleus', 'Wall', 'Vacuole'], answer: 0 },
    { type: 'short', time: '2:30', question: 'What do mitochondria do?', expected: 'Make energy (ATP).' },
    { type: 'multi', time: '3:40', question: 'Which are organelles?', choices: ['Nucleus', 'Sugar', 'Mitochondria'], answers: [2, 0] },
  ],
})
const opts = { count: 5, kinds: ['mc', 'short', 'multi'] as const, durationS: 300, timed: true }

describe('parseDrafts', () => {
  it('keeps valid questions with the model times when the material is timed', () => {
    const r = parseDrafts(goodReply, { ...opts, kinds: [...opts.kinds] })!
    expect(r.dropped).toBe(0)
    expect(r.questions.map((q) => q.at_s)).toEqual([75, 150, 220])
    expect(r.questions[0]).toMatchObject({ kind: 'mc', correct_index: 0, choices: ['Nucleus', 'Wall', 'Vacuole'] })
    expect(r.questions[1]).toMatchObject({ kind: 'short', rubric: 'Make energy (ATP).', correct_index: null })
    expect(r.questions[2]).toMatchObject({ kind: 'multi', correct_indexes: [0, 2] })
  })

  it('spreads questions evenly without timestamps, ignoring made-up times', () => {
    const r = parseDrafts(goodReply, { ...opts, kinds: [...opts.kinds], timed: false })!
    expect(r.questions.map((q) => q.at_s)).toEqual([75, 150, 225])
  })

  it('spreads evenly if any model time is outside the video', () => {
    const bad = goodReply.replace('3:40', '9:59')
    expect(parseDrafts(bad, { ...opts, kinds: [...opts.kinds] })!.questions.map((q) => q.at_s)).toEqual([75, 150, 225])
  })

  it('drops bad keys, duplicate or blank choices, unknown types and overlong prompts', () => {
    const r = parseDrafts(
      JSON.stringify({
        questions: [
          { type: 'mc', question: 'Key out of range', choices: ['a', 'b'], answer: 2 },
          { type: 'mc', question: 'Dupes', choices: ['a', 'A'], answer: 0 },
          { type: 'mc', question: 'Blank', choices: ['a', ''], answer: 0 },
          { type: 'mc', question: 'String key', choices: ['a', 'b'], answer: '0' },
          { type: 'multi', question: 'Only one right', choices: ['a', 'b', 'c'], answers: [1] },
          { type: 'essay', question: 'Unknown type' },
          { type: 'short', question: 'x'.repeat(501) },
          { type: 'short', question: 'Fine one' },
        ],
      }),
      { ...opts, kinds: [...opts.kinds] },
    )!
    expect(r.questions).toHaveLength(1)
    expect(r.questions[0].prompt).toBe('Fine one')
    expect(r.dropped).toBe(7)
  })

  it('only returns the types the teacher asked for, and at most count', () => {
    const r = parseDrafts(goodReply, { ...opts, kinds: ['mc', 'short'], count: 1 })!
    expect(r.questions.map((q) => q.kind)).toEqual(['mc'])
    expect(r.dropped).toBe(2)
  })

  it('accepts a fenced reply and rejects junk', () => {
    expect(parseDrafts('```json\n' + goodReply + '\n```', { ...opts, kinds: [...opts.kinds] })!.questions).toHaveLength(3)
    expect(parseDrafts('sorry, I cannot', { ...opts, kinds: [...opts.kinds] })).toBeNull()
    expect(parseDrafts('{"questions": "no"}', { ...opts, kinds: [...opts.kinds] })).toBeNull()
    expect(parseDrafts(42, { ...opts, kinds: [...opts.kinds] })).toBeNull()
  })

  it('keeps pause points off 0 and the very end of short videos', () => {
    const r = parseDrafts(JSON.stringify({ questions: [{ type: 'short', question: 'a' }, { type: 'short', question: 'b' }] }), { ...opts, kinds: ['short'], durationS: 12, timed: false })!
    for (const q of r.questions) {
      expect(q.at_s).toBeGreaterThanOrEqual(5)
      expect(q.at_s).toBeLessThanOrEqual(10)
    }
  })
})

describe('input helpers', () => {
  it('redacts emails and phone numbers', () => {
    expect(redact('Email kid.one@district.org or call 412-555-1234.')).toBe('Email [email] or call [phone].')
  })
  it('detects a timed transcript', () => {
    expect(hasTimestamps(TRANSCRIPT)).toBe(true)
    expect(hasTimestamps(MATERIAL)).toBe(false)
  })
  it('parses clock times', () => {
    expect(parseClock('1:05')).toBe(65)
    expect(parseClock('1:02:03')).toBe(3723)
    expect(parseClock('1:75')).toBeNull()
    expect(parseClock('soon')).toBeNull()
  })
})

function setup(o: { claim?: GenClaim; responses?: Record<string, Array<Response | Error>>; take?: (n: string) => boolean; providers?: Provider[] } = {}) {
  const refunds: string[] = []
  const fails: { name: string; error: string }[] = []
  const sent: Record<string, unknown>[] = []
  const queues = Object.fromEntries(Object.entries(o.responses ?? {}).map(([k, v]) => [k, [...v]]))
  const deps: Deps = {
    providers: o.providers ?? [prov('a'), prov('b')],
    fetch: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const host = new URL(String(url)).hostname.split('.')[0]
      sent.push(JSON.parse(String(init?.body)))
      const next = queues[host]?.shift()
      if (!next) throw new Error(`no response queued for ${host}`)
      if (next instanceof Error) throw next
      return next
    }) as unknown as typeof fetch,
    getCaller: async (h) => (h === 'Bearer good' ? { id: 't1', isTeacher: true } : h === 'Bearer kid' ? { id: 's1', isTeacher: false } : null),
    claim: async () => o.claim ?? { ok: true, left_today: 4 },
    refund: async (id) => void refunds.push(id),
    providerTake: async (n) => (o.take ? o.take(n) : true),
    providerFail: async (name, _c, error) => void fails.push({ name, error }),
    nonce: () => 'n0nce',
  }
  const body = { material: TRANSCRIPT, authorized: true, duration_s: 300, count: 3, kinds: ['mc', 'short', 'multi'] }
  const run = (b: unknown = body, auth = 'Bearer good') =>
    handleAiDraft(new Request('https://x.test/ai-draft', { method: 'POST', headers: { Authorization: auth }, body: JSON.stringify(b) }), deps).then(async (r) => ({
      status: r.status,
      body: await r.json(),
    }))
  return { run, refunds, fails, sent, body }
}

describe('handleAiDraft', () => {
  it('returns validated drafts from the first provider that works', async () => {
    const s = setup({ responses: { a: [reply('nope', 429)], b: [reply(goodReply)] } })
    const r = await s.run()
    expect(r.body).toMatchObject({ ok: true, model: 'b/b-model', timed: true, left_today: 4 })
    expect(r.body.questions).toHaveLength(3)
    expect(s.fails).toEqual([{ name: 'a', error: 'HTTP 429' }])
    expect(s.refunds).toEqual([])
  })

  it('refunds the run when no provider gives anything usable', async () => {
    const s = setup({ responses: { a: [reply('not json')], b: [new Error('down')] } })
    const r = await s.run()
    expect(r.body).toEqual({ ok: false, error: 'unavailable' })
    expect(s.refunds).toEqual(['t1'])
  })

  it('skips a provider that is out of budget', async () => {
    const s = setup({ take: (n) => n !== 'a', responses: { b: [reply(goodReply)] } })
    expect((await s.run()).body.ok).toBe(true)
  })

  it('refuses students, signed-out callers and material not marked OK to share', async () => {
    const s = setup()
    expect((await s.run(undefined, 'Bearer kid')).status).toBe(403)
    expect((await s.run(undefined, 'Bearer nobody')).status).toBe(401)
    expect((await s.run({ ...s.body, authorized: false })).body.error).toBe('not_authorized')
    expect((await s.run({ ...s.body, material: 'too short' })).body.error).toBe('too_short')
    expect((await s.run({ ...s.body, material: 'x'.repeat(12001) })).body.error).toBe('too_long')
    expect((await s.run({ ...s.body, count: 11 })).body.error).toBe('bad_count')
    expect((await s.run({ ...s.body, kinds: ['essay'] })).body.error).toBe('bad_kinds')
    expect((await s.run({ ...s.body, duration_s: 'NaN' })).body.error).toBe('bad_duration')
    expect(s.sent).toEqual([])
  })

  it('passes cap and switch refusals through without calling a model', async () => {
    const s = setup({ claim: { ok: false, reason: 'teacher_cap' } })
    expect((await s.run()).body).toEqual({ ok: false, error: 'teacher_cap' })
    expect(s.sent).toEqual([])
  })

  it('strips emails before sending and fences the material', async () => {
    const s = setup({ responses: { a: [reply(goodReply)] } })
    await s.run({ ...s.body, material: TRANSCRIPT + ' contact mrs.smith@district.org' })
    const msgs = s.sent[0].messages as { content: string }[]
    expect(msgs[1].content).toContain('[email]')
    expect(msgs[1].content).not.toContain('district.org')
    expect(msgs[1].content).toMatch(/^<material_n0nce>/)
  })
})
