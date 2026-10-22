const express = require('express');
const rateLimit = require('express-rate-limit');
const { classifyUserAgent } = require('./analytics/classify');

const PRESENCE_TTL_MS = 90 * 1000;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createPresenceStore({
    ttlMs = PRESENCE_TTL_MS,
    maxVisitors = 10000,
    now = Date.now,
    expiryCheckMs = 1000
} = {}) {
    const visitors = new Map();
    const listeners = new Set();
    let expiryTimer = null;
    let lastCount = 0;

    function prune(timestamp) {
        // Refreshes move entries to the end, so expired entries come first.
        for (const [visitorId, lastSeen] of visitors) {
            if (timestamp - lastSeen < ttlMs) break;
            visitors.delete(visitorId);
        }
    }

    function notify() {
        if (visitors.size === lastCount) return;
        lastCount = visitors.size;
        for (const listener of listeners) listener(lastCount);
    }

    function currentCount() {
        prune(now());
        notify();
        return visitors.size;
    }

    return {
        heartbeat(visitorId) {
            const timestamp = now();
            prune(timestamp);
            if (!visitors.has(visitorId) && visitors.size >= maxVisitors) return null;

            visitors.delete(visitorId);
            visitors.set(visitorId, timestamp);
            notify();
            return visitors.size;
        },
        count: currentCount,
        subscribe(listener) {
            const count = currentCount();
            listeners.add(listener);
            listener(count);
            if (!expiryTimer) {
                expiryTimer = setInterval(currentCount, expiryCheckMs);
                expiryTimer.unref?.();
            }

            return () => {
                listeners.delete(listener);
                if (listeners.size === 0 && expiryTimer) {
                    clearInterval(expiryTimer);
                    expiryTimer = null;
                }
            };
        }
    };
}

function getRequestOrigin(req) {
    const trustProxy = req.app.get('trust proxy fn');
    const forwardedHost = trustProxy?.(req.socket.remoteAddress, 0) && req.get('x-forwarded-host');
    const host = (forwardedHost || req.get('host') || '').split(',')[0].trim();
    return new URL(`${req.protocol}://${host}`).origin;
}

function isAllowedOrigin(req, proxyOrigins) {
    try {
        const origin = req.get('origin');
        if (!origin || origin === 'null') return false;
        // Reject malformed origins with paths, credentials, or non-HTTP schemes.
        const parsed = new URL(origin);
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) return false;

        const requestOrigin = getRequestOrigin(req);
        if (origin === requestOrigin) return true;

        // The failover Worker fetches the origin hostname while preserving the
        // browser's original Origin. Limit that exception to configured origins.
        return req.get('x-inazu-worker') === 'site-failover' &&
            (proxyOrigins[requestOrigin] || []).includes(origin);
    } catch (error) {
        return false;
    }
}

function createPresenceRouter({
    allowedHosts,
    proxyOrigins = {},
    store = createPresenceStore(),
    rateLimitMax = 600,
    maxStreams = 1000,
    maxStreamsPerIp = 100,
    keepaliveMs = 20000
}) {
    const router = express.Router();
    const hosts = new Set(allowedHosts);
    const streamsPerIp = new Map();
    let streamCount = 0;

    router.use((req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');

        if (!hosts.has((req.hostname || '').toLowerCase())) {
            return res.status(404).json({ error: 'Not found' });
        }
        const isStreamPath = req.path === '/stream' || req.path === '/stream/';
        if (req.method !== (isStreamPath ? 'GET' : 'POST')) {
            res.setHeader('Allow', isStreamPath ? 'GET' : 'POST');
            return res.status(405).json({ error: 'Method not allowed' });
        }
        const fetchSite = req.get('sec-fetch-site');
        // Same-origin EventSource GET requests commonly omit the Origin header.
        const sameOriginStream = isStreamPath && !req.get('origin') && fetchSite === 'same-origin';
        if ((fetchSite && fetchSite !== 'same-origin') ||
            (!sameOriginStream && !isAllowedOrigin(req, proxyOrigins))) {
            return res.status(403).json({ error: 'Invalid request origin' });
        }
        if (classifyUserAgent(req.get('user-agent')).isBot) {
            return res.status(403).json({ error: 'Access denied' });
        }
        return next();
    });

    // Enough for many visitors behind one NAT, while limiting identifier churn.
    router.use(rateLimit({
        windowMs: 60 * 1000,
        limit: rateLimitMax,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { error: 'Too many presence requests' }
    }));

    router.get('/stream', (req, res) => {
        const ip = rateLimit.ipKeyGenerator(req.ip);
        const ipStreams = streamsPerIp.get(ip) || 0;
        if (streamCount >= maxStreams || ipStreams >= maxStreamsPerIp) {
            res.setHeader('Retry-After', '30');
            return res.status(503).json({ error: 'Presence stream is temporarily unavailable' });
        }

        streamCount += 1;
        streamsPerIp.set(ip, ipStreams + 1);
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, no-transform');
        res.setHeader('X-Accel-Buffering', 'no');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        let closed = false;
        let unsubscribe = () => {};
        let keepalive = null;
        function cleanup() {
            if (closed) return;
            closed = true;
            unsubscribe();
            clearInterval(keepalive);
            streamCount -= 1;
            const remaining = streamsPerIp.get(ip) - 1;
            if (remaining > 0) streamsPerIp.set(ip, remaining);
            else streamsPerIp.delete(ip);
        }
        function write(message) {
            if (closed) return;
            // Drop stalled connections instead of retaining an unbounded buffer.
            if (!res.write(message)) {
                cleanup();
                res.destroy();
            }
        }
        res.once('close', cleanup);
        res.once('error', cleanup);
        unsubscribe = store.subscribe(count => write(`data: ${JSON.stringify({ count })}\n\n`));
        if (closed) {
            unsubscribe();
            return;
        }
        keepalive = setInterval(() => write(': keepalive\n\n'), keepaliveMs);
        keepalive.unref?.();
    });

    router.use((req, res, next) => {
        if (!req.is('application/json')) {
            return res.status(415).json({ error: 'Expected JSON' });
        }
        return next();
    });
    router.use(express.json({ limit: '1kb' }));

    router.post('/', (req, res) => {
        const body = req.body;
        if (!body || Array.isArray(body) || Object.keys(body).length !== 1 ||
            typeof body.visitorId !== 'string' || !UUID_V4.test(body.visitorId)) {
            return res.status(400).json({ error: 'Invalid visitor ID' });
        }

        const count = store.heartbeat(body.visitorId.toLowerCase());
        if (count === null) {
            return res.status(503).json({ error: 'Presence is temporarily unavailable' });
        }
        return res.json({ count });
    });

    router.use((err, req, res, next) => {
        if (err.type === 'entity.too.large') {
            return res.status(413).json({ error: 'Request body is too large' });
        }
        if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
            return res.status(400).json({ error: 'Malformed request body' });
        }
        return next(err);
    });

    return router;
}

module.exports = { createPresenceStore, createPresenceRouter, PRESENCE_TTL_MS };
