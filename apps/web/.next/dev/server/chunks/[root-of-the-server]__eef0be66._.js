module.exports = [
"[externals]/next/dist/server/app-render/work-async-storage.external.js [external] (next/dist/server/app-render/work-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-async-storage.external.js", () => require("next/dist/server/app-render/work-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-unit-async-storage.external.js [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/work-unit-async-storage.external.js", () => require("next/dist/server/app-render/work-unit-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/lib/incremental-cache/tags-manifest.external.js [external] (next/dist/server/lib/incremental-cache/tags-manifest.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/lib/incremental-cache/tags-manifest.external.js", () => require("next/dist/server/lib/incremental-cache/tags-manifest.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/after-task-async-storage.external.js [external] (next/dist/server/app-render/after-task-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/server/app-render/after-task-async-storage.external.js", () => require("next/dist/server/app-render/after-task-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/node:async_hooks [external] (node:async_hooks, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:async_hooks", () => require("node:async_hooks"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[project]/apps/web/app/lib/session.ts [middleware] (ecmascript)", ((__turbopack_context__) => {
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
"[project]/apps/web/proxy.ts [middleware] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "config",
    ()=>config,
    "proxy",
    ()=>proxy
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$0$2e$7_$40$babel$2b$core$40$7$2e$29$2e$7_$40$opentelemetry$2b$api$40$1$2e$9$2e$1_react$2d$dom$40$19$2e$2$2e$0_react$40$19$2e$2$2e$0_$5f$react$40$19$2e$2$2e$0$2f$node_modules$2f$next$2f$server$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.0.7_@babel+core@7.29.7_@opentelemetry+api@1.9.1_react-dom@19.2.0_react@19.2.0__react@19.2.0/node_modules/next/server.js [middleware] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$session$2e$ts__$5b$middleware$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/app/lib/session.ts [middleware] (ecmascript)");
;
;
async function proxy(request) {
    const action = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$session$2e$ts__$5b$middleware$5d$__$28$ecmascript$29$__["resolveSession"])({
        access: request.cookies.get(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$session$2e$ts__$5b$middleware$5d$__$28$ecmascript$29$__["ACCESS_COOKIE"])?.value,
        refresh: request.cookies.get(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$session$2e$ts__$5b$middleware$5d$__$28$ecmascript$29$__["REFRESH_COOKIE"])?.value
    }, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$session$2e$ts__$5b$middleware$5d$__$28$ecmascript$29$__["refreshTokens"]);
    if (action.action === 'pass') return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$0$2e$7_$40$babel$2b$core$40$7$2e$29$2e$7_$40$opentelemetry$2b$api$40$1$2e$9$2e$1_react$2d$dom$40$19$2e$2$2e$0_react$40$19$2e$2$2e$0_$5f$react$40$19$2e$2$2e$0$2f$node_modules$2f$next$2f$server$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["NextResponse"].next();
    if (action.action === 'clear') {
        const response = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$0$2e$7_$40$babel$2b$core$40$7$2e$29$2e$7_$40$opentelemetry$2b$api$40$1$2e$9$2e$1_react$2d$dom$40$19$2e$2$2e$0_react$40$19$2e$2$2e$0_$5f$react$40$19$2e$2$2e$0$2f$node_modules$2f$next$2f$server$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["NextResponse"].next();
        (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$session$2e$ts__$5b$middleware$5d$__$28$ecmascript$29$__["clearSession"])(response);
        return response;
    }
    // Put the fresh token on the *request* as well as the response. Without
    // this, the render this request triggers still reads the old cookie — which
    // is absent — and the page shows a sign-in prompt once before the new cookie
    // takes effect on the next navigation.
    request.cookies.set(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$session$2e$ts__$5b$middleware$5d$__$28$ecmascript$29$__["ACCESS_COOKIE"], action.tokens.accessToken);
    const response = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$0$2e$7_$40$babel$2b$core$40$7$2e$29$2e$7_$40$opentelemetry$2b$api$40$1$2e$9$2e$1_react$2d$dom$40$19$2e$2$2e$0_react$40$19$2e$2$2e$0_$5f$react$40$19$2e$2$2e$0$2f$node_modules$2f$next$2f$server$2e$js__$5b$middleware$5d$__$28$ecmascript$29$__["NextResponse"].next({
        request
    });
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$session$2e$ts__$5b$middleware$5d$__$28$ecmascript$29$__["writeSession"])(response, action.tokens);
    return response;
}
const config = {
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
     */ '/((?!api/auth|_next/static|_next/image|favicon.ico).*)'
    ]
};
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__eef0be66._.js.map