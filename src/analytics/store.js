const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DAY_MS = 24 * 60 * 60 * 1000;

class AnalyticsStore {
    constructor({ dbPath }) {
        this.dbPath = dbPath;
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('synchronous = NORMAL');
        this.db.pragma('busy_timeout = 5000');
        this.ensureSchema();
        this.prepareStatements();
    }

    ensureSchema() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS access_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                day_jst TEXT NOT NULL,
                host TEXT NOT NULL,
                method TEXT NOT NULL,
                path TEXT NOT NULL,
                path_no_query TEXT NOT NULL,
                status INTEGER NOT NULL,
                duration_ms INTEGER NOT NULL,
                ip TEXT NOT NULL,
                ip_hash TEXT NOT NULL,
                ip_masked TEXT NOT NULL,
                user_agent TEXT NOT NULL,
                ua_family TEXT NOT NULL,
                device TEXT NOT NULL,
                browser TEXT NOT NULL,
                os TEXT NOT NULL,
                is_bot INTEGER NOT NULL,
                bot_name TEXT NOT NULL,
                bot_category TEXT NOT NULL,
                referer TEXT NOT NULL,
                referer_host TEXT NOT NULL,
                country TEXT NOT NULL,
                cf_ray TEXT NOT NULL,
                x_inazu_worker TEXT NOT NULL,
                is_pageview INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_access_events_timestamp
                ON access_events (timestamp);
            CREATE INDEX IF NOT EXISTS idx_access_events_day_pageview
                ON access_events (day_jst, is_pageview);
            CREATE INDEX IF NOT EXISTS idx_access_events_bot_timestamp
                ON access_events (is_bot, timestamp);
            CREATE INDEX IF NOT EXISTS idx_access_events_path_day
                ON access_events (path_no_query, day_jst);
            CREATE INDEX IF NOT EXISTS idx_access_events_unique_day
                ON access_events (day_jst, ip_hash, ua_family);
        `);
    }

    prepareStatements() {
        this.insertEvent = this.db.prepare(`
            INSERT INTO access_events (
                timestamp, day_jst, host, method, path, path_no_query, status, duration_ms,
                ip, ip_hash, ip_masked, user_agent, ua_family, device, browser, os,
                is_bot, bot_name, bot_category, referer, referer_host, country, cf_ray,
                x_inazu_worker, is_pageview
            ) VALUES (
                @timestamp, @dayJst, @host, @method, @path, @pathNoQuery, @status, @durationMs,
                @ip, @ipHash, @ipMasked, @userAgent, @uaFamily, @device, @browser, @os,
                @isBot, @botName, @botCategory, @referer, @refererHost, @country, @cfRay,
                @xInazuWorker, @isPageview
            )
        `);
    }

    recordEvent(event) {
        this.insertEvent.run({
            ...event,
            isBot: event.isBot ? 1 : 0,
            isPageview: event.isPageview ? 1 : 0
        });
    }

    getSummary(range = '7d') {
        const normalizedRange = normalizeRange(range);
        const rangeClause = getRangeClause(normalizedRange);
        const today = formatJstDay(new Date());

        return {
            generatedAt: new Date().toISOString(),
            range: normalizedRange,
            totals: this.getMetrics('1 = 1', []),
            today: this.getMetrics('day_jst = ?', [today]),
            last7Days: this.getMetrics('timestamp >= ?', [new Date(Date.now() - 7 * DAY_MS).toISOString()]),
            last30Days: this.getMetrics('timestamp >= ?', [new Date(Date.now() - 30 * DAY_MS).toISOString()]),
            selected: this.getMetrics(rangeClause.where, rangeClause.params),
            daily: this.getDailySeries(rangeClause),
            topPaths: this.getTopPaths(rangeClause),
            bots: this.getBotRanking(rangeClause),
            statusBreakdown: this.getStatusBreakdown(rangeClause),
            originBreakdown: this.getOriginBreakdown(rangeClause),
            recent: this.getRecent(rangeClause, 80)
        };
    }

    getMetrics(where, params) {
        return this.db.prepare(`
            SELECT
                COUNT(*) AS requests,
                COALESCE(SUM(is_pageview), 0) AS pageviews,
                COUNT(DISTINCT CASE
                    WHEN is_pageview = 1 THEN ip || ':' || ua_family
                END) AS uniqueVisitors,
                COALESCE(SUM(is_bot), 0) AS botRequests,
                COALESCE(SUM(CASE WHEN is_bot = 1 AND status = 403 THEN 1 ELSE 0 END), 0) AS blockedBots
            FROM access_events
            WHERE ${where}
        `).get(...params);
    }

    getDailySeries(rangeClause) {
        return this.db.prepare(`
            SELECT
                day_jst AS day,
                COUNT(*) AS requests,
                COALESCE(SUM(is_pageview), 0) AS pageviews,
                COUNT(DISTINCT CASE
                    WHEN is_pageview = 1 THEN ip || ':' || ua_family
                END) AS uniqueVisitors,
                COALESCE(SUM(is_bot), 0) AS botRequests
            FROM access_events
            WHERE ${rangeClause.where}
            GROUP BY day_jst
            ORDER BY day_jst ASC
        `).all(...rangeClause.params);
    }

    getTopPaths(rangeClause) {
        return this.db.prepare(`
            SELECT
                path_no_query AS path,
                COUNT(*) AS pageviews,
                COUNT(DISTINCT ip || ':' || ua_family) AS uniqueVisitors
            FROM access_events
            WHERE ${rangeClause.where}
                AND is_pageview = 1
            GROUP BY path_no_query
            ORDER BY pageviews DESC, path_no_query ASC
            LIMIT 12
        `).all(...rangeClause.params);
    }

    getBotRanking(rangeClause) {
        return this.db.prepare(`
            SELECT
                COALESCE(NULLIF(bot_name, ''), 'Unknown bot') AS name,
                bot_category AS category,
                COUNT(*) AS requests,
                COALESCE(SUM(CASE WHEN status = 403 THEN 1 ELSE 0 END), 0) AS blocked,
                MAX(timestamp) AS lastSeen
            FROM access_events
            WHERE ${rangeClause.where}
                AND is_bot = 1
            GROUP BY name, category
            ORDER BY requests DESC, blocked DESC, name ASC
            LIMIT 20
        `).all(...rangeClause.params);
    }

    getStatusBreakdown(rangeClause) {
        return this.db.prepare(`
            SELECT status, COUNT(*) AS requests
            FROM access_events
            WHERE ${rangeClause.where}
            GROUP BY status
            ORDER BY requests DESC, status ASC
            LIMIT 12
        `).all(...rangeClause.params);
    }

    getOriginBreakdown(rangeClause) {
        return this.db.prepare(`
            SELECT
                CASE
                    WHEN x_inazu_worker != '' THEN x_inazu_worker
                    ELSE 'direct'
                END AS origin,
                COUNT(*) AS requests
            FROM access_events
            WHERE ${rangeClause.where}
            GROUP BY origin
            ORDER BY requests DESC, origin ASC
        `).all(...rangeClause.params);
    }

    getRecent(rangeClause, limit) {
        return this.db.prepare(`
            SELECT
                timestamp,
                method,
                path_no_query AS path,
                status,
                duration_ms AS durationMs,
                ip_masked AS ip,
                device,
                browser,
                os,
                is_bot AS isBot,
                bot_name AS botName,
                bot_category AS botCategory,
                referer_host AS refererHost,
                country
            FROM access_events
            WHERE ${rangeClause.where}
            ORDER BY timestamp DESC
            LIMIT ?
        `).all(...rangeClause.params, limit);
    }

    getRecentRaw(limit = 20) {
        return this.db.prepare(`
            SELECT
                timestamp,
                host,
                method,
                path,
                status,
                duration_ms AS durationMs,
                ip,
                user_agent AS userAgent,
                bot_name AS botName,
                bot_category AS botCategory,
                country,
                cf_ray AS cfRay
            FROM access_events
            ORDER BY timestamp DESC
            LIMIT ?
        `).all(limit);
    }

    getRawEvents(range = '7d', limit = 200) {
        const rangeClause = getRangeClause(normalizeRange(range));
        const safeLimit = clampLimit(limit, 1, 500);

        return this.db.prepare(`
            SELECT
                timestamp,
                day_jst AS dayJst,
                host,
                method,
                path,
                status,
                duration_ms AS durationMs,
                ip,
                user_agent AS userAgent,
                ua_family AS uaFamily,
                device,
                browser,
                os,
                is_bot AS isBot,
                bot_name AS botName,
                bot_category AS botCategory,
                referer,
                referer_host AS refererHost,
                country,
                cf_ray AS cfRay,
                x_inazu_worker AS xInazuWorker,
                is_pageview AS isPageview
            FROM access_events
            WHERE ${rangeClause.where}
            ORDER BY timestamp DESC
            LIMIT ?
        `).all(...rangeClause.params, safeLimit);
    }

    close() {
        this.db.close();
    }
}

function normalizeRange(range) {
    if (range === '30d' || range === 'all') return range;
    return '7d';
}

function clampLimit(value, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return max;
    return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function getRangeClause(range) {
    if (range === 'all') {
        return { where: '1 = 1', params: [] };
    }

    const days = range === '30d' ? 30 : 7;
    return {
        where: 'timestamp >= ?',
        params: [new Date(Date.now() - days * DAY_MS).toISOString()]
    };
}

function formatJstDay(date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}`;
}

module.exports = {
    AnalyticsStore,
    formatJstDay,
    normalizeRange
};
