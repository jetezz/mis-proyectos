import { createBrowserClient } from '@supabase/ssr';

/**
 * Cliente Supabase para el BROWSER.
 *
 * Astro SSR expone las variables al cliente solo si tienen prefijo PUBLIC_.
 * Pero en el contexto del módulo (que se bundlea en el servidor durante build),
 * podemos leerlas directamente de import.meta.env.
 *
 * Usa createBrowserClient de @supabase/ssr que almacena la sesión en COOKIES
 * (no localStorage), lo que permite que el servidor la lea en el frontmatter.
 */
const supabaseUrl =
  import.meta.env.PUBLIC_SUPABASE_URL ||
  import.meta.env.SUPABASE_URL ||
  (typeof window !== 'undefined' ? (window as any).__SUPABASE_URL__ : '');

const supabaseAnonKey =
  import.meta.env.PUBLIC_SUPABASE_ANON_KEY ||
  import.meta.env.SUPABASE_ANON_KEY ||
  (typeof window !== 'undefined' ? (window as any).__SUPABASE_ANON_KEY__ : '');

export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);

/**
 * Obtiene el JWT del usuario actual para enviarlo al backend API.
 */
export async function getAccessToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}
