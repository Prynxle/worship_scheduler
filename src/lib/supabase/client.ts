import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabaseServiceKey = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY || '';

let browserClient: SupabaseClient | null = null;
let currentKey: string = '';

export function getSupabaseClient(): SupabaseClient {
  if (typeof window === 'undefined') {
    return createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY || '');
  }

  const isDevMode = localStorage.getItem('devMode') === 'true';
  const key = isDevMode && supabaseServiceKey ? supabaseServiceKey : supabaseAnonKey;

  if (!browserClient || currentKey !== key) {
    browserClient = createClient(supabaseUrl, key);
    currentKey = key;
  }

  return browserClient;
}

export function createServerClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  );
}
