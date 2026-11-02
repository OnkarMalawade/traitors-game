import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://yxqugedqnlefzhhmooya.supabase.co';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_C1g1I7VKqsuBaSK40eHXDQ_2KHmtcJX';

let client: SupabaseClient | null = null;

export function getMobileSupabase() {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    });
  }
  return client;
}

export async function ensureMobileAnonymousSession() {
  const supabase = getMobileSupabase();
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (session) return session.user.id;
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw new Error(`Anonymous sign-in failed: ${error.message}`);
  if (!data.user) throw new Error('Could not create an anonymous player session.');
  return data.user.id;
}

