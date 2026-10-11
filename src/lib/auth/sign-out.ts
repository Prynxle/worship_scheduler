import { getSupabaseClient } from '@/lib/supabase/client';

/**
 * Sign the current user out locally and clear any leftover Supabase session
 * keys. Local scope means a network failure cannot trap the user in a session
 * they asked to leave. Callers own navigation and their own pending state.
 */
export async function signOutLocal(): Promise<void> {
  try {
    await getSupabaseClient().auth.signOut({ scope: 'local' });
  } catch {
    // Local-only sign out: ignore network errors and clear the session anyway.
  } finally {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith('sb-')) {
        localStorage.removeItem(key);
      }
    }
  }
}
