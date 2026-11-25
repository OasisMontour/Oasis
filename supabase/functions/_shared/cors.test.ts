import { describe, expect, it } from 'vitest'
import { corsFor, parseOrigins } from './cors.ts'

describe('cors', () => {
  it('ignores trailing slashes and spaces, and accepts a comma-separated list', () => {
    expect(parseOrigins(' https://a.app/ , https://b.app//')).toEqual(['https://a.app', 'https://b.app'])
    expect(parseOrigins(undefined)).toEqual([])
  })
  it('echoes an allowed origin, else the first one', () => {
    const o = ['https://a.app', 'https://b.app']
    expect(corsFor(o, 'https://b.app')['Access-Control-Allow-Origin']).toBe('https://b.app')
    expect(corsFor(o, 'https://evil.app')['Access-Control-Allow-Origin']).toBe('https://a.app')
    expect(corsFor([], 'https://x')['Access-Control-Allow-Origin']).toBe('*')
    expect(corsFor(o, null).Vary).toBe('Origin')
  })
})
