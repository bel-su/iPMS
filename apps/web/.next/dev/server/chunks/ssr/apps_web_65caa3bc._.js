module.exports = [
"[project]/apps/web/app/lib/session.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
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
"[project]/apps/web/app/lib/api-client.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "authFetch",
    ()=>authFetch
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$0$2e$7_$40$babel$2b$core$40$7$2e$29$2e$7_$40$opentelemetry$2b$api$40$1$2e$9$2e$1_react$2d$dom$40$19$2e$2$2e$0_react$40$19$2e$2$2e$0_$5f$react$40$19$2e$2$2e$0$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$server$2d$only$2f$empty$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.0.7_@babel+core@7.29.7_@opentelemetry+api@1.9.1_react-dom@19.2.0_react@19.2.0__react@19.2.0/node_modules/next/dist/compiled/server-only/empty.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$0$2e$7_$40$babel$2b$core$40$7$2e$29$2e$7_$40$opentelemetry$2b$api$40$1$2e$9$2e$1_react$2d$dom$40$19$2e$2$2e$0_react$40$19$2e$2$2e$0_$5f$react$40$19$2e$2$2e$0$2f$node_modules$2f$next$2f$headers$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.0.7_@babel+core@7.29.7_@opentelemetry+api@1.9.1_react-dom@19.2.0_react@19.2.0__react@19.2.0/node_modules/next/headers.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$session$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/app/lib/session.ts [app-rsc] (ecmascript)");
;
;
;
const UNREACHABLE = 'The iPMS API could not be reached.';
const UNEXPECTED = 'The iPMS API returned an unexpected error.';
function buildQuery(query) {
    if (!query) return '';
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)){
        if (value !== undefined) params.set(key, value);
    }
    const serialized = params.toString();
    return serialized ? `?${serialized}` : '';
}
/**
 * Pulls what can be trusted out of a failed response, and nothing else.
 *
 * Only the fields of the platform's own error envelope are kept. Returning the
 * raw body instead would hand a page whatever an upstream produced — a stack
 * trace, a proxy's HTML error page — as something renderable.
 */ async function describeFailure(response) {
    try {
        const payload = await response.json();
        const envelope = payload?.error;
        if (envelope && typeof envelope['message'] === 'string' && envelope['message'].length > 0) {
            return {
                message: envelope['message'],
                ...typeof envelope['code'] === 'string' ? {
                    code: envelope['code']
                } : {},
                ...typeof envelope['correlationId'] === 'string' ? {
                    correlationId: envelope['correlationId']
                } : {}
            };
        }
    } catch  {
    // Not JSON, or not the envelope — fall through to the generic message.
    }
    return {
        message: UNEXPECTED
    };
}
async function authFetch(path, request = {}) {
    const token = (await (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$0$2e$7_$40$babel$2b$core$40$7$2e$29$2e$7_$40$opentelemetry$2b$api$40$1$2e$9$2e$1_react$2d$dom$40$19$2e$2$2e$0_react$40$19$2e$2$2e$0_$5f$react$40$19$2e$2$2e$0$2f$node_modules$2f$next$2f$headers$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cookies"])()).get(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$session$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ACCESS_COOKIE"])?.value;
    if (!token) return {
        state: 'unauthenticated'
    };
    let response;
    try {
        response = await fetch(`${(0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$session$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["apiBaseUrl"])()}${path}${buildQuery(request.query)}`, {
            method: request.method ?? 'GET',
            headers: {
                authorization: `Bearer ${token}`,
                ...request.json === undefined ? {} : {
                    'content-type': 'application/json'
                }
            },
            ...request.json === undefined ? {} : {
                body: JSON.stringify(request.json)
            },
            cache: 'no-store'
        });
    } catch  {
        return {
            state: 'unavailable',
            status: null,
            message: UNREACHABLE
        };
    }
    if (response.status === 401) return {
        state: 'unauthenticated'
    };
    if (response.status === 403) {
        const { message, correlationId } = await describeFailure(response);
        return {
            state: 'forbidden',
            message,
            ...correlationId === undefined ? {} : {
                correlationId
            }
        };
    }
    if (!response.ok) {
        return {
            state: 'unavailable',
            status: response.status,
            ...await describeFailure(response)
        };
    }
    // 204 and 205 carry no body, and JSON.parse('') throws — a successful write
    // must not be reported as a broken API.
    try {
        const text = await response.text();
        return {
            state: 'ready',
            data: text ? JSON.parse(text) : undefined
        };
    } catch  {
        return {
            state: 'unavailable',
            status: response.status,
            message: UNEXPECTED
        };
    }
}
}),
"[project]/apps/web/app/lib/project-api.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "archiveProject",
    ()=>archiveProject,
    "assignTask",
    ()=>assignTask,
    "createMilestone",
    ()=>createMilestone,
    "createProject",
    ()=>createProject,
    "createSite",
    ()=>createSite,
    "createTask",
    ()=>createTask,
    "createTaskType",
    ()=>createTaskType,
    "deleteMilestone",
    ()=>deleteMilestone,
    "deleteProject",
    ()=>deleteProject,
    "deleteSite",
    ()=>deleteSite,
    "deleteTask",
    ()=>deleteTask,
    "deleteTaskType",
    ()=>deleteTaskType,
    "getProject",
    ()=>getProject,
    "getProjectDashboard",
    ()=>getProjectDashboard,
    "listProjects",
    ()=>listProjects,
    "listTasks",
    ()=>listTasks,
    "updateMilestone",
    ()=>updateMilestone,
    "updateProject",
    ()=>updateProject,
    "updateSite",
    ()=>updateSite,
    "updateTask",
    ()=>updateTask,
    "updateTaskType",
    ()=>updateTaskType
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$0$2e$7_$40$babel$2b$core$40$7$2e$29$2e$7_$40$opentelemetry$2b$api$40$1$2e$9$2e$1_react$2d$dom$40$19$2e$2$2e$0_react$40$19$2e$2$2e$0_$5f$react$40$19$2e$2$2e$0$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$server$2d$only$2f$empty$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.0.7_@babel+core@7.29.7_@opentelemetry+api@1.9.1_react-dom@19.2.0_react@19.2.0__react@19.2.0/node_modules/next/dist/compiled/server-only/empty.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$api$2d$client$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/app/lib/api-client.ts [app-rsc] (ecmascript)");
;
;
async function getProjectDashboard() {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$api$2d$client$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["authFetch"])('/api/v1/dashboard');
}
async function listProjects() {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$api$2d$client$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["authFetch"])('/api/v1/projects');
}
async function getProject(id) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$api$2d$client$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["authFetch"])(`/api/v1/projects/${id}`);
}
async function createProject(project) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$api$2d$client$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["authFetch"])('/api/v1/projects', {
        method: 'POST',
        json: project
    });
}
async function updateProject(id, changes) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$api$2d$client$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["authFetch"])(`/api/v1/projects/${id}`, {
        method: 'PATCH',
        json: changes
    });
}
async function createSite(projectId, site) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$api$2d$client$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["authFetch"])(`/api/v1/projects/${projectId}/sites`, {
        method: 'POST',
        json: site
    });
}
async function createTaskType(projectId, taskType) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$api$2d$client$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["authFetch"])(`/api/v1/projects/${projectId}/task-types`, {
        method: 'POST',
        json: taskType
    });
}
async function createMilestone(projectId, milestone) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$api$2d$client$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["authFetch"])(`/api/v1/projects/${projectId}/milestones`, {
        method: 'POST',
        json: milestone
    });
}
async function createTask(projectId, task) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$api$2d$client$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["authFetch"])(`/api/v1/projects/${projectId}/tasks`, {
        method: 'POST',
        json: task
    });
}
async function assignTask(taskId, assignment) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$api$2d$client$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["authFetch"])(`/api/v1/tasks/${taskId}/assign`, {
        method: 'POST',
        json: assignment
    });
}
async function listTasks(projectId, filter = {}) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$api$2d$client$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["authFetch"])(`/api/v1/projects/${projectId}/tasks`, {
        query: filter
    });
}
async function updateSite(id, changes) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$api$2d$client$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["authFetch"])(`/api/v1/sites/${id}`, {
        method: 'PATCH',
        json: changes
    });
}
async function updateTaskType(id, changes) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$api$2d$client$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["authFetch"])(`/api/v1/task-types/${id}`, {
        method: 'PATCH',
        json: changes
    });
}
async function updateMilestone(id, changes) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$api$2d$client$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["authFetch"])(`/api/v1/milestones/${id}`, {
        method: 'PATCH',
        json: changes
    });
}
async function updateTask(id, changes) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$api$2d$client$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["authFetch"])(`/api/v1/tasks/${id}`, {
        method: 'PATCH',
        json: changes
    });
}
async function archiveProject(id) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$api$2d$client$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["authFetch"])(`/api/v1/projects/${id}/archive`, {
        method: 'POST'
    });
}
async function deleteProject(id) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$api$2d$client$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["authFetch"])(`/api/v1/projects/${id}`, {
        method: 'DELETE'
    });
}
async function deleteSite(id) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$api$2d$client$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["authFetch"])(`/api/v1/sites/${id}`, {
        method: 'DELETE'
    });
}
async function deleteTaskType(id) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$api$2d$client$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["authFetch"])(`/api/v1/task-types/${id}`, {
        method: 'DELETE'
    });
}
async function deleteMilestone(id) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$api$2d$client$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["authFetch"])(`/api/v1/milestones/${id}`, {
        method: 'DELETE'
    });
}
async function deleteTask(id) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$api$2d$client$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["authFetch"])(`/api/v1/tasks/${id}`, {
        method: 'DELETE'
    });
}
}),
"[project]/apps/web/app/projects/form-state.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * What a form shows between submissions — and nothing else.
 *
 * Deliberately free of imports. Both sides of the boundary need these: the
 * client components render a `FormState` and seed `useActionState` with
 * `EMPTY`, while the server actions return one. Putting `revalidatePath` in
 * this module would pull it into the browser bundle through those client
 * components, which Next refuses to build. The server-side half lives in
 * `settle.ts`.
 */ __turbopack_context__.s([
    "EMPTY",
    ()=>EMPTY
]);
const EMPTY = {};
}),
"[project]/apps/web/app/projects/actions.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/* __next_internal_action_entry_do_not_use__ [{"60ce18bc245c05d36ae199343d9baacbc86371fcb5":"createProjectAction"},"",""] */ __turbopack_context__.s([
    "createProjectAction",
    ()=>createProjectAction
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$0$2e$7_$40$babel$2b$core$40$7$2e$29$2e$7_$40$opentelemetry$2b$api$40$1$2e$9$2e$1_react$2d$dom$40$19$2e$2$2e$0_react$40$19$2e$2$2e$0_$5f$react$40$19$2e$2$2e$0$2f$node_modules$2f$next$2f$dist$2f$build$2f$webpack$2f$loaders$2f$next$2d$flight$2d$loader$2f$server$2d$reference$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.0.7_@babel+core@7.29.7_@opentelemetry+api@1.9.1_react-dom@19.2.0_react@19.2.0__react@19.2.0/node_modules/next/dist/build/webpack/loaders/next-flight-loader/server-reference.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$0$2e$7_$40$babel$2b$core$40$7$2e$29$2e$7_$40$opentelemetry$2b$api$40$1$2e$9$2e$1_react$2d$dom$40$19$2e$2$2e$0_react$40$19$2e$2$2e$0_$5f$react$40$19$2e$2$2e$0$2f$node_modules$2f$next$2f$dist$2f$api$2f$navigation$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.0.7_@babel+core@7.29.7_@opentelemetry+api@1.9.1_react-dom@19.2.0_react@19.2.0__react@19.2.0/node_modules/next/dist/api/navigation.react-server.js [app-rsc] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$0$2e$7_$40$babel$2b$core$40$7$2e$29$2e$7_$40$opentelemetry$2b$api$40$1$2e$9$2e$1_react$2d$dom$40$19$2e$2$2e$0_react$40$19$2e$2$2e$0_$5f$react$40$19$2e$2$2e$0$2f$node_modules$2f$next$2f$dist$2f$client$2f$components$2f$navigation$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.0.7_@babel+core@7.29.7_@opentelemetry+api@1.9.1_react-dom@19.2.0_react@19.2.0__react@19.2.0/node_modules/next/dist/client/components/navigation.react-server.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$project$2d$api$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/app/lib/project-api.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$projects$2f$form$2d$state$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/app/projects/form-state.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$0$2e$7_$40$babel$2b$core$40$7$2e$29$2e$7_$40$opentelemetry$2b$api$40$1$2e$9$2e$1_react$2d$dom$40$19$2e$2$2e$0_react$40$19$2e$2$2e$0_$5f$react$40$19$2e$2$2e$0$2f$node_modules$2f$next$2f$dist$2f$build$2f$webpack$2f$loaders$2f$next$2d$flight$2d$loader$2f$action$2d$validate$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/.pnpm/next@16.0.7_@babel+core@7.29.7_@opentelemetry+api@1.9.1_react-dom@19.2.0_react@19.2.0__react@19.2.0/node_modules/next/dist/build/webpack/loaders/next-flight-loader/action-validate.js [app-rsc] (ecmascript)");
;
;
;
;
async function createProjectAction(_previous, form) {
    const code = (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$projects$2f$form$2d$state$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["optional"])(form, 'code');
    const name = (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$projects$2f$form$2d$state$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["optional"])(form, 'name');
    if (!code || !name) return {
        error: 'A code and a name are required.'
    };
    const clientName = (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$projects$2f$form$2d$state$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["optional"])(form, 'clientName');
    const phase = (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$projects$2f$form$2d$state$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["optional"])(form, 'phase');
    const startDate = (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$projects$2f$form$2d$state$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["optional"])(form, 'startDate');
    const targetDate = (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$projects$2f$form$2d$state$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["optional"])(form, 'targetDate');
    const result = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$lib$2f$project$2d$api$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["createProject"])({
        code,
        name,
        ...clientName === undefined ? {} : {
            clientName
        },
        ...phase === undefined ? {} : {
            phase
        },
        ...startDate === undefined ? {} : {
            startDate: new Date(startDate)
        },
        ...targetDate === undefined ? {} : {
            targetDate: new Date(targetDate)
        }
    });
    const state = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$projects$2f$form$2d$state$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["settle"])(result, '/projects');
    if (state.error) return state;
    if (result.state === 'ready') (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$0$2e$7_$40$babel$2b$core$40$7$2e$29$2e$7_$40$opentelemetry$2b$api$40$1$2e$9$2e$1_react$2d$dom$40$19$2e$2$2e$0_react$40$19$2e$2$2e$0_$5f$react$40$19$2e$2$2e$0$2f$node_modules$2f$next$2f$dist$2f$client$2f$components$2f$navigation$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["redirect"])(`/projects/${result.data.id}`);
    return state;
}
;
(0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$0$2e$7_$40$babel$2b$core$40$7$2e$29$2e$7_$40$opentelemetry$2b$api$40$1$2e$9$2e$1_react$2d$dom$40$19$2e$2$2e$0_react$40$19$2e$2$2e$0_$5f$react$40$19$2e$2$2e$0$2f$node_modules$2f$next$2f$dist$2f$build$2f$webpack$2f$loaders$2f$next$2d$flight$2d$loader$2f$action$2d$validate$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ensureServerEntryExports"])([
    createProjectAction
]);
(0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f2e$pnpm$2f$next$40$16$2e$0$2e$7_$40$babel$2b$core$40$7$2e$29$2e$7_$40$opentelemetry$2b$api$40$1$2e$9$2e$1_react$2d$dom$40$19$2e$2$2e$0_react$40$19$2e$2$2e$0_$5f$react$40$19$2e$2$2e$0$2f$node_modules$2f$next$2f$dist$2f$build$2f$webpack$2f$loaders$2f$next$2d$flight$2d$loader$2f$server$2d$reference$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerServerReference"])(createProjectAction, "60ce18bc245c05d36ae199343d9baacbc86371fcb5", null);
}),
"[project]/apps/web/.next-internal/server/app/projects/new/page/actions.js { ACTIONS_MODULE0 => \"[project]/apps/web/app/projects/actions.ts [app-rsc] (ecmascript)\" } [app-rsc] (server actions loader, ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([]);
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$projects$2f$actions$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/app/projects/actions.ts [app-rsc] (ecmascript)");
;
}),
"[project]/apps/web/.next-internal/server/app/projects/new/page/actions.js { ACTIONS_MODULE0 => \"[project]/apps/web/app/projects/actions.ts [app-rsc] (ecmascript)\" } [app-rsc] (server actions loader, ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "60ce18bc245c05d36ae199343d9baacbc86371fcb5",
    ()=>__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$projects$2f$actions$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["createProjectAction"]
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f2e$next$2d$internal$2f$server$2f$app$2f$projects$2f$new$2f$page$2f$actions$2e$js__$7b$__ACTIONS_MODULE0__$3d3e$__$225b$project$5d2f$apps$2f$web$2f$app$2f$projects$2f$actions$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$2922$__$7d$__$5b$app$2d$rsc$5d$__$28$server__actions__loader$2c$__ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i('[project]/apps/web/.next-internal/server/app/projects/new/page/actions.js { ACTIONS_MODULE0 => "[project]/apps/web/app/projects/actions.ts [app-rsc] (ecmascript)" } [app-rsc] (server actions loader, ecmascript) <locals>');
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$app$2f$projects$2f$actions$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/app/projects/actions.ts [app-rsc] (ecmascript)");
}),
];

//# sourceMappingURL=apps_web_65caa3bc._.js.map