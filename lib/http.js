// Shared helpers for the catering and newsletter serverless functions.
//
// Kept deliberately tiny — no external dependencies, no framework. Works for
// Vercel's Node runtime (Node 18+).

const MAX_BODY_BYTES = 32 * 1024; // 32 KB is plenty for either form

// Single in-memory rate-limit store. Survives within a warm serverless
// instance only; a cold start resets it. That's enough to block naive
// spam loops without bringing in a paid KV store.
const buckets = new Map();

function isValidEmail(email) {
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Reads the request body as JSON or x-www-form-urlencoded, bailing if the
// body exceeds MAX_BODY_BYTES.
async function readBody(req) {
    if (req.body && typeof req.body === 'object') return req.body;
    if (typeof req.body === 'string') {
        try { return JSON.parse(req.body); } catch { /* fall through */ }
    }
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
        total += chunk.length;
        if (total > MAX_BODY_BYTES) {
            const err = new Error('Request body too large');
            err.statusCode = 413;
            throw err;
        }
        chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw) return {};
    const contentType = (req.headers['content-type'] || '').toLowerCase();
    if (contentType.includes('application/json')) {
        try { return JSON.parse(raw); } catch { return {}; }
    }
    if (contentType.includes('application/x-www-form-urlencoded')) {
        return Object.fromEntries(new URLSearchParams(raw));
    }
    try { return JSON.parse(raw); } catch { return {}; }
}

// Allowed origins for form submissions. Requests with no Origin/Referer
// (curl, server-to-server) are also accepted — the rate limiter is the
// backstop for those.
const ALLOWED_HOSTS = new Set([
    'elyrapaletas.com',
    'www.elyrapaletas.com',
    'localhost',
    '127.0.0.1',
]);

function isAllowedOrigin(req) {
    const origin = req.headers.origin || req.headers.referer;
    if (!origin) return true; // no header — let the rate limiter handle it
    try {
        const { hostname } = new URL(origin);
        return ALLOWED_HOSTS.has(hostname) || hostname.endsWith('.vercel.app');
    } catch {
        return false;
    }
}

function clientIp(req) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length > 0) {
        return fwd.split(',')[0].trim();
    }
    return req.socket?.remoteAddress || 'unknown';
}

// Token-bucket-ish: `max` requests per `windowMs` per key.
// Returns true if the request is allowed.
function rateLimit(key, max, windowMs) {
    const now = Date.now();
    const entry = buckets.get(key);
    if (!entry || now - entry.start > windowMs) {
        buckets.set(key, { count: 1, start: now });
        // Opportunistically evict stale buckets to bound memory.
        if (buckets.size > 1000) {
            for (const [k, v] of buckets) {
                if (now - v.start > windowMs) buckets.delete(k);
            }
        }
        return true;
    }
    if (entry.count >= max) return false;
    entry.count += 1;
    return true;
}

export {
    isValidEmail,
    escapeHtml,
    readBody,
    isAllowedOrigin,
    clientIp,
    rateLimit,
};
