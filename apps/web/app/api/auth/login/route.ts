import { NextResponse } from 'next/server';

const apiBaseUrl = process.env['IPMS_API_BASE_URL'] ?? 'http://127.0.0.1:3000';

export async function POST(request: Request) {
  const body: unknown = await request.json();
  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store',
    });
    if (!response.ok) return NextResponse.json({ message: 'Invalid username or password' }, { status: response.status });
    const tokens = await response.json() as { accessToken: string; refreshToken: string; expiresIn: number };
    const result = NextResponse.json({ ok: true });
    const secure = process.env['NODE_ENV'] === 'production';
    result.cookies.set('ipms_access_token', tokens.accessToken, { httpOnly: true, sameSite: 'lax', secure, maxAge: tokens.expiresIn, path: '/' });
    result.cookies.set('ipms_refresh_token', tokens.refreshToken, { httpOnly: true, sameSite: 'lax', secure, maxAge: 2_592_000, path: '/' });
    return result;
  } catch {
    return NextResponse.json({ message: 'The API is not available' }, { status: 503 });
  }
}
