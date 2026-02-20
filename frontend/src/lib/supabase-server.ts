import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from 'astro:env/server';
import type { AstroCookies } from 'astro';

/**
 * Crea un cliente Supabase server-side que lee y escribe cookies de la request.
 * Usar SOLO en el frontmatter (---) de las páginas Astro.
 *
 * Usa el sistema de env tipado de Astro 5 (astro:env/server) que garantiza
 * que las variables estén disponibles en runtime SSR y no se filtren al cliente.
 */
export function createSupabaseServerClient(
  requestHeaders: Headers,
  cookies: AstroCookies,
) {
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return parseCookieHeader(requestHeaders.get('Cookie') ?? '');
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookies.set(name, value, options as Parameters<AstroCookies['set']>[2]);
        });
      },
    },
  });
}
