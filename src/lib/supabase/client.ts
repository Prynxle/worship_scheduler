import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

let browserClient: SupabaseClient | null = null;
let currentKey: string = '';

export function getSupabaseClient(): SupabaseClient {
  if (typeof window === 'undefined') {
    // Server-side: use service role key for full access
    return createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY || '');
  }

  // Browser-side: ALWAYS use anonymous key for security (never service role key)
  if (!browserClient || currentKey !== supabaseAnonKey) {
    browserClient = createClient(supabaseUrl, supabaseAnonKey);
    currentKey = supabaseAnonKey;
  }

  return browserClient;
}

export function createServerClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  );
}
