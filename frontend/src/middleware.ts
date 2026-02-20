import { defineMiddleware } from 'astro:middleware';
import { createSupabaseServerClient } from './lib/supabase-server';

/**
 * Middleware global de autenticación.
 * 
 * - Rutas públicas: /, /login, /_*, archivos estáticos
 * - Todo lo demás requiere sesión verificada con getUser() (server-side)
 * - Inyecta `user` en Astro.locals para uso en páginas
 */
export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  // Rutas públicas que no requieren auth
  const publicPaths = ['/', '/login'];
  if (publicPaths.includes(pathname)) return next();

  // Astro internals y archivos estáticos
  if (pathname.startsWith('/_') || pathname.startsWith('/favicon')) return next();

  // API routes se manejan con su propio auth (JWT header)
  if (pathname.startsWith('/api/')) return next();

  // Verificar sesión con getUser() — valida contra el servidor, no solo el JWT local
  const supabase = createSupabaseServerClient(context.request.headers, context.cookies);
  const { data: { user }, error } = await supabase.auth.getUser();

  if (!user || error) {
    return context.redirect('/login');
  }

  // Inyectar user en locals para uso en páginas
  context.locals.user = user;

  // Headers de seguridad para preparar tunnel público
  const response = await next();
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  return response;
});
