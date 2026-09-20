module.exports = [
"[externals]/next/dist/compiled/next-server/app-route-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-route-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-unit-async-storage.external.js [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-unit-async-storage.external.js", () => require("next/dist/server/app-render/work-unit-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-async-storage.external.js [external] (next/dist/server/app-render/work-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-async-storage.external.js", () => require("next/dist/server/app-render/work-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/shared/lib/no-fallback-error.external.js [external] (next/dist/shared/lib/no-fallback-error.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/shared/lib/no-fallback-error.external.js", () => require("next/dist/shared/lib/no-fallback-error.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/after-task-async-storage.external.js [external] (next/dist/server/app-render/after-task-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/after-task-async-storage.external.js", () => require("next/dist/server/app-render/after-task-async-storage.external.js"));

module.exports = mod;
}),
"[project]/apps/web/app/lib/session.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "ACCESS_COOKIE",
    ()=>ACCESS_COOKIE,
    "REFRESH_COOKIE",
    ()=>REFRESH_COOKIE,
    "apiBaseUrl",
    ()=>apiBaseUrl,
    "clearSession",
    ()=>clearSession,
    "loginWithPassword",
    ()=>loginWithPassword,
    "refreshTokens",
    ()=>refreshTokens,
    "resolveSession",
    ()=>resolveSession,
    "revokeSession",
    ()=>revokeSession,
    "writeSession",
    ()=>writeSession
]);
const ACCESS_COOKIE = 'ipms_access_token';
const REFRESH_COOKIE = 'ipms_refresh_token';
/** Matches JWT_REFRESH_TTL's default (30 days); the gateway rejects it sooner if configured shorter. */ const REFRESH_MAX_AGE_SECONDS = 2_592_000;
function apiBaseUrl() {
    const configured = process.env['IPMS_API_BASE_URL'];
    const base = configured && configured.length > 0 ? configured : 'http://127.0.0.1:3000';
    return base.endsWith('/') ? base.slice(0, -1) : base;
}
function isTokenPair(value) {
    if (typeof value !== 'object' || value === null) return false;
    const pair = value;
    return typeof pair['accessToken'] === 'string' && pair['accessToken'].length > 0 && typeof pair['refreshToken'] === 'string' && pair['refreshToken'].length > 0 && typeof pair['expiresIn'] === 'number' && Number.isFinite(pair['expiresIn']) && pair['expiresIn'] > 0;
}
/**
 * Both token-minting calls answer the same three ways, and the difference
 * between "refused" and "could not ask" is the whole point: only the first
 * means the caller's credentials are wrong.
 */ async function mintTokens(path, body) {
    try {
        const response = await fetch(`${apiBaseUrl()}${path}`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json'
            },
            body: JSON.stringify(body),
            cache: 'no-store'
        });
        if (response.status === 401 || response.status === 403) return {
            state: 'rejected'
        };
        if (!response.ok) return {
            state: 'unavailable'
        };
        const payload = await response.json();
        return isTokenPair(payload) ? {
            state: 'ok',
            tokens: payload
        } : {
            state: 'unavailable'
        };
    } catch  {
        return {
            state: 'unavailable'
        };
    }
}
async function loginWithPassword(credentials) {
    return mintTokens('/api/v1/auth/login', credentials);
}
async function refreshTokens(refreshToken) {
    return mintTokens('/api/v1/auth/refresh', {
        refreshToken
    });
}
async function revokeSession(accessToken) {
    try {
        await fetch(`${apiBaseUrl()}/api/v1/auth/logout`, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${accessToken}`
            },
            cache: 'no-store'
        });
    } catch  {
    // Intentionally ignored — see above.
    }
}
function cookieOptions(maxAge) {
    return {
        httpOnly: true,
        sameSite: 'lax',
        secure: ("TURBOPACK compile-time value", "development") === 'production',
        path: '/',
        maxAge
    };
}
function writeSession(response, tokens) {
    response.cookies.set(ACCESS_COOKIE, tokens.accessToken, cookieOptions(tokens.expiresIn));
    response.cookies.set(REFRESH_COOKIE, tokens.refreshToken, cookieOptions(REFRESH_MAX_AGE_SECONDS));
}
function clearSession(response) {
    response.cookies.set(ACCESS_COOKIE, '', cookieOptions(0));
    response.cookies.set(REFRESH_COOKIE, '', cookieOptions(0));
}
async function resolveSession(cookies, redeem) {
    if (cookies.access) return {
        action: 'pass'
    };
    if (!cookies.refresh) return {
        action: 'pass'
    };
    const result = await redeem(cookies.refresh);
    if (result.state === 'ok') return {
        action: 'renew',
        tokens: result.tokens
    };
    // Refused means the token is dead — logged out elsewhere, or iam bumped the
    // token version. Unavailable says nothing about it, so the session stands
    // rather than signing everyone out whenever the stack restarts.
    return result.state === 'rejected' ? {
        action: 'clear'
    } : {
        action: 'pass'
    };
}
}),
"[project]/apps/web/app/api/auth/logout/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "POST",
    ()=>POST
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$0$2e$7_$40$babel$2b$core$40$7$2e$29$2e$7_$40$opentelemetry$2b$api$40$1$2e$9$2e$1_react$2d$dom$40$19$2e$2$2e$0_react$40$19$2e$2$2e$0_$5f$react$40$19$2e$2$2e$0$2f$node_modules$2f$next$2f$headers$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.0.7_@babel+core@7.29.7_@opentelemetry+api@1.9.1_react-dom@19.2.0_react@19.2.0__react@19.2.0/node_modules/next/headers.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$0$2e$7_$40$babel$2b$core$40$7$2e$29$2e$7_$40$opentelemetry$2b$api$40$1$2e$9$2e$1_react$2d$dom$40$19$2e$2$2e$0_react$40$19$2e$2$2e$0_$5f$react$40$19$2e$2$2e$0$2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.0.7_@babel+core@7.29.7_@opentelemetry+api@1.9.1_react-dom@19.2.0_react@19.2.0__react@19.2.0/node_modules/next/server.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$session$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/app/lib/session.ts [app-route] (ecmascript)");
;
;
;
async function POST(request) {
    const token = (await (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$0$2e$7_$40$babel$2b$core$40$7$2e$29$2e$7_$40$opentelemetry$2b$api$40$1$2e$9$2e$1_react$2d$dom$40$19$2e$2$2e$0_react$40$19$2e$2$2e$0_$5f$react$40$19$2e$2$2e$0$2f$node_modules$2f$next$2f$headers$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["cookies"])()).get(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$session$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ACCESS_COOKIE"])?.value;
    if (token) await (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$session$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["revokeSession"])(token);
    // 303 so the browser follows with GET, whatever method arrived here.
    const response = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$0$2e$7_$40$babel$2b$core$40$7$2e$29$2e$7_$40$opentelemetry$2b$api$40$1$2e$9$2e$1_react$2d$dom$40$19$2e$2$2e$0_react$40$19$2e$2$2e$0_$5f$react$40$19$2e$2$2e$0$2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].redirect(new URL('/login', request.url), 303);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$session$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["clearSession"])(response);
    return response;
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__beda705c._.js.map