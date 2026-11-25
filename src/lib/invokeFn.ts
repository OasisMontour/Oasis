import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'

/**
 * supabase.functions.invoke, but a non-2xx response still hands back the function's JSON body.
 * supabase-js otherwise throws the body away and only says "Edge Function returned a non-2xx status code",
 * which hides the real reason (Google refused, not signed in, not your assignment...).
 */
export async function invokeFn<T>(name: string, body: Record<string, unknown>): Promise<{ data: T | null; error: Error | null }> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body })
  if (error instanceof FunctionsHttpError) {
    const parsed = (await error.context.json().catch(() => null)) as T | null
    if (parsed && typeof parsed === 'object') return { data: parsed, error: null }
    return { data: null, error: new Error(`The server returned ${error.context.status}.`) }
  }
  if (error) return { data: null, error: new Error("Couldn't reach the Oasis server. Check your connection and try again.") }
  return { data: data ?? null, error: null }
}
