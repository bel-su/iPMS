import { NextResponse, type NextRequest } from 'next/server';
import { ACCESS_COOKIE, REFRESH_COOKIE, clearSession, refreshTokens, resolveSession, writeSession } from './app/lib/session';

/**
 * Keeps a signed-in session alive.
 *
 * Access tokens last fifteen minutes and refresh tokens thirty days, and until
 * now the refresh token was stored at login and never redeemed: a dashboard
 * left open for a quarter of an hour started reporting the user as signed out
 * while a perfectly good refresh token sat in their browser.
 *
 * It has to happen here. A Server Component cannot set a cookie — the response
 * is already streaming by the time it renders — so a renewed pair discovered
 * during a page render would have nowhere to live. This runs before the render
 * with the response still open.
 *
 * The access cookie's own expiry is the trigger: it is written with the
 * token's lifetime, so the browser stops sending it at the moment the gateway
 * would stop accepting it. No clock comparison and no token parsing here —
 * this code never needs to read a JWT, and cannot be desynchronized from one.
 *
 * Named `proxy.ts` rather than `middleware.ts`: Next 16 deprecated the
 * middleware convention, and warns at every build while it is used. The export
 * name has to match the filename — Next looks for `proxy` in `proxy.ts` and
 * `middleware` in `middleware.ts`, falling back to the default export.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const action = await resolveSession(
    {
      access: request.cookies.get(ACCESS_COOKIE)?.value,
      refresh: request.cookies.get(REFRESH_COOKIE)?.value,
    },
    refreshTokens,
  );

  if (action.action === 'pass') return NextResponse.next();

  if (action.action === 'clear') {
    const response = NextResponse.next();
    clearSession(response);
    return response;
  }

  // Put the fresh token on the *request* as well as the response. Without
  // this, the render this request triggers still reads the old cookie — which
  // is absent — and the page shows a sign-in prompt once before the new cookie
  // takes effect on the next navigation.
  request.cookies.set(ACCESS_COOKIE, action.tokens.accessToken);
  const response = NextResponse.next({ request });
  writeSession(response, action.tokens);
  return response;
}

export const config = {
  matcher: [
    /**
     * Everything a person navigates to, and nothing else.
     *
     * `/api/auth/*` is excluded because those handlers own the session
     * themselves: renewing a pair on the way into `logout` would mint a token
     * a moment before revoking it. Static assets and image requests are
     * excluded because renewing on them would fire the gateway call several
     * times per page load, in parallel, each one racing the others to write a
     * different pair.
     */
    '/((?!api/auth|_next/static|_next/image|favicon.ico).*)',
  ],
};
