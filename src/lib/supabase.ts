import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const REMOTE_ENABLED = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = REMOTE_ENABLED
  ? createClient(url as string, anonKey as string, {
      auth: { persistSession: false },
    })
  : null;
