const path = require('path');
const { classifyUserAgent } = require('./classify');
const { AnalyticsStore, formatJstDay, normalizeRange } = require('./store');
const {
    getClientIp,
    getHeader,
    getOrCreateSalt,
    getRefererHost,
    hashIpForDay,
    maskIp
} = require('./privacy');

const STATIC_EXTENSIONS = new Set([
    '.css', '.js', '.mjs', '.map',
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.avif',
    '.woff', '.woff2', '.ttf', '.otf',
    '.txt', '.xml', '.json', '.webmanifest'
]);

function createAnalytics({ dbPath, saltPath, trackedHosts, getHostname }) {
    const salt = getOrCreateSalt(saltPath);
    const store = new AnalyticsStore({ dbPath });
    const trackedHostSet = new Set([...trackedHosts].map((host) => host.toLowerCase()));

    return {
        middleware: createMiddleware({ store, salt, trackedHostSet, getHostname }),
        getSummary(range) {
            return store.getSummary(normalizeRange(range));
        },
        getRecentRaw(limit) {
            return store.getRecentRaw(limit);
        },
        close() {
            store.close();
        }
    };
}

function createMiddleware({ store, salt, trackedHostSet, getHostname }) {
    return function analyticsMiddleware(req, res, next) {
        const hostname = getHostname(req);

        if (!trackedHostSet.has(hostname) || shouldIgnore(req.path)) {
            return next();
        }

        const startedAt = process.hrtime.bigint();
        const startedDate = new Date();
        const userAgent = getHeader(req, 'user-agent');
        const ip = getClientIp(req);
        const pathWithQuery = req.originalUrl || req.url || req.path || '/';
        const pathNoQuery = getPathname(pathWithQuery);

        res.on('finish', () => {
            try {
                const durationMs = Number((process.hrtime.bigint() - startedAt) / 1000000n);
                const dayJst = formatJstDay(startedDate);
                const classification = classifyUserAgent(userAgent);

                store.recordEvent({
                    timestamp: startedDate.toISOString(),
                    dayJst,
                    host: hostname,
                    method: req.method,
                    path: pathWithQuery.slice(0, 2048),
                    pathNoQuery: pathNoQuery.slice(0, 512),
                    status: res.statusCode,
                    durationMs,
                    ip,
                    ipHash: hashIpForDay(ip, dayJst, salt),
                    ipMasked: maskIp(ip),
                    userAgent: String(userAgent || '').slice(0, 1024),
                    uaFamily: classification.uaFamily,
                    device: classification.device,
                    browser: classification.browser,
                    os: classification.os,
                    isBot: classification.isBot,
                    botName: classification.botName,
                    botCategory: classification.botCategory,
                    referer: String(getHeader(req, 'referer') || '').slice(0, 1024),
                    refererHost: getRefererHost(req),
                    country: String(getHeader(req, 'cf-ipcountry') || '').slice(0, 8),
                    cfRay: String(getHeader(req, 'cf-ray') || '').slice(0, 128),
                    xInazuWorker: String(getHeader(req, 'x-inazu-worker') || '').slice(0, 64),
                    isPageview: isPageviewRequest(req, res, pathNoQuery)
                });
            } catch (error) {
                console.error('[ANALYTICS LOG ERROR]', error);
            }
        });

        return next();
    };
}

function shouldIgnore(requestPath) {
    return requestPath.startsWith('/analytics') ||
        requestPath.startsWith('/api/analytics/');
}

function isPageviewRequest(req, res, pathNoQuery) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    if (res.statusCode < 200 || res.statusCode >= 400) return false;
    if (pathNoQuery.startsWith('/api/')) return false;
    if (shouldIgnore(pathNoQuery)) return false;

    const ext = path.extname(pathNoQuery).toLowerCase();
    if (STATIC_EXTENSIONS.has(ext)) return false;

    const contentType = String(res.getHeader('content-type') || '').toLowerCase();
    return contentType.includes('text/html');
}

function getPathname(pathWithQuery) {
    try {
        return new URL(pathWithQuery, 'http://inazu.local').pathname || '/';
    } catch (error) {
        return String(pathWithQuery || '/').split('?')[0] || '/';
    }
}

module.exports = {
    createAnalytics
};
