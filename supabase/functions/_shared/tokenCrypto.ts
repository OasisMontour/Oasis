// AES-256-GCM for refresh tokens at rest. Key = 32 random bytes, base64, in the
// TOKEN_ENCRYPTION_KEY Edge Function secret (generate with: openssl rand -base64 32).
// Format: "v1.<iv base64>.<ciphertext base64>"

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function importKey(keyB64: string): Promise<CryptoKey> {
  const raw = unb64(keyB64)
  if (raw.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded')
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

/** userId is bound in as associated data, so a row copied onto another user won't decrypt. */
export async function encryptToken(plain: string, keyB64: string, userId: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(userId) },
    await importKey(keyB64),
    new TextEncoder().encode(plain),
  )
  return `v1.${b64(iv)}.${b64(new Uint8Array(ct))}`
}

export async function decryptToken(enc: string, keyB64: string, userId: string): Promise<string> {
  const [v, iv, ct] = enc.split('.')
  if (v !== 'v1' || !iv || !ct) throw new Error('unknown token format')
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(iv), additionalData: new TextEncoder().encode(userId) },
    await importKey(keyB64),
    unb64(ct),
  )
  return new TextDecoder().decode(plain)
}
