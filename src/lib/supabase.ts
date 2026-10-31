import { createClient } from '@supabase/supabase-js';

const DEFAULT_SUPABASE_URL = 'https://pjrzncnhhlfaxuvlcdse.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqcnpuY25oaGxmYXh1dmxjZHNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMyMDAwNjksImV4cCI6MjEwODc3NjA2OX0.oPP4UNDdVEZzZbRNyTsjNAX3cVc2EzOwIi8LS2y8nfNA';

/**
 * `import.meta.env` only exists under Vite. Reading it defensively keeps this
 * module importable by the test runner (and by any future SSR/prerender step)
 * without changing the build-time env handling.
 */
const env = ((): Record<string, string | undefined> => {
  try {
    return (import.meta.env ?? {}) as Record<string, string | undefined>;
  } catch {
    return {};
  }
})();

const supabaseUrl = env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});
