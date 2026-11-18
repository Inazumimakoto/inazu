import { DurableObject } from 'cloudflare:workers';

const DAILY_LIMIT = 1_000;
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;
const DAY_MS = 86_400_000;
const JST_OFFSET_MS = 9 * 3_600_000;
const MICRO_USD = 1_000_000;
const MONTHLY_BUDGET = 100 * MICRO_USD;
const RESERVATION_COST = 10_000;

function jstDate(now) {
    return new Date(now + JST_OFFSET_MS).toISOString().slice(0, 10);
}

function monthStart(day, offset) {
    const year = Number(day.slice(0, 4));
    const month = Number(day.slice(5, 7)) - 1;
    return Date.UTC(year, month + offset, 1) - JST_OFFSET_MS;
}

function monthlyTotals(sql, period) {
    return sql.exec('SELECT spent, held FROM months WHERE period = ?', period).toArray()[0]
        ?? { spent: 0, held: 0 };
}

function usageFor(period, { spent, held }) {
    return {
        estimatedUsd: spent / MICRO_USD,
        reservedUsd: held / MICRO_USD,
        budgetUsd: MONTHLY_BUDGET / MICRO_USD,
        period,
        dailyLimit: DAILY_LIMIT
    };
}

export class ChatLedger extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        ctx.storage.sql.exec(`
            CREATE TABLE IF NOT EXISTS months (
                period TEXT PRIMARY KEY,
                spent INTEGER NOT NULL DEFAULT 0 CHECK (spent >= 0),
                held INTEGER NOT NULL DEFAULT 0 CHECK (held >= 0)
            );
            CREATE TABLE IF NOT EXISTS days (day TEXT PRIMARY KEY, used INTEGER NOT NULL CHECK (used >= 0));
            CREATE TABLE IF NOT EXISTS rate_events (client_key TEXT NOT NULL, admitted_ms INTEGER NOT NULL);
            CREATE INDEX IF NOT EXISTS rate_by_client ON rate_events(client_key, admitted_ms);
            CREATE INDEX IF NOT EXISTS rate_by_time ON rate_events(admitted_ms);
            CREATE TABLE IF NOT EXISTS holds (
                id TEXT PRIMARY KEY, period TEXT NOT NULL, amount INTEGER NOT NULL, pending_day TEXT
            );
            CREATE INDEX IF NOT EXISTS holds_by_month ON holds(period);
        `);
    }

    getUsage() {
        const period = jstDate(Date.now()).slice(0, 7);
        return usageFor(period, monthlyTotals(this.ctx.storage.sql, period));
    }

    reserve(clientKey) {
        if (typeof clientKey !== 'string' || !/^[0-9a-f]{64}$/.test(clientKey)) {
            throw new TypeError('A hashed client identifier is required.');
        }

        const now = Date.now();
        const day = jstDate(now);
        const period = day.slice(0, 7);
        const sql = this.ctx.storage.sql;
        return this.ctx.storage.transactionSync(() => {
            const totals = monthlyTotals(sql, period);
            const usage = usageFor(period, totals);
            const denied = (reason, until) => ({
                ok: false, reason, retryAfter: Math.max(1, Math.ceil((until - now) / 1000)), usage
            });
            const dayRow = sql.exec('SELECT used FROM days WHERE day = ?', day).toArray()[0];
            if (dayRow && dayRow.used >= DAILY_LIMIT) {
                return denied('daily', Date.parse(day + 'T00:00:00+09:00') + DAY_MS);
            }
            if (totals.spent + totals.held + RESERVATION_COST > MONTHLY_BUDGET) {
                const canSettle = totals.held > 0 && totals.spent + RESERVATION_COST <= MONTHLY_BUDGET;
                const reset = monthStart(day, 1);
                return denied('budget', canSettle ? Math.min(now + RATE_WINDOW_MS, reset) : reset);
            }
            const since = now - RATE_WINDOW_MS;
            const recent = sql.exec(`
                SELECT COUNT(*) AS count, MIN(admitted_ms) AS oldest FROM rate_events
                WHERE client_key = ? AND admitted_ms > ?
            `, clientKey, since).one();
            if (recent.count >= RATE_LIMIT) {
                return denied('rate', recent.oldest + RATE_WINDOW_MS);
            }

            // Keep the prior month so requests spanning midnight can settle in their admission month.
            const oldestPeriod = jstDate(monthStart(day, -1)).slice(0, 7);
            sql.exec('DELETE FROM holds WHERE period < ?', oldestPeriod);
            sql.exec('DELETE FROM months WHERE period < ?', oldestPeriod);
            sql.exec('DELETE FROM days WHERE day < ?', oldestPeriod + '-01');
            sql.exec('DELETE FROM rate_events WHERE admitted_ms <= ?', since);

            const reservation = crypto.randomUUID();
            sql.exec('INSERT INTO rate_events (client_key, admitted_ms) VALUES (?, ?)', clientKey, now);
            sql.exec(`INSERT INTO days (day, used) VALUES (?, 1)
                ON CONFLICT(day) DO UPDATE SET used = used + 1`, day);
            sql.exec('INSERT INTO holds (id, period, amount, pending_day) VALUES (?, ?, ?, ?)',
                reservation, period, RESERVATION_COST, day);
            sql.exec(`INSERT INTO months (period, held) VALUES (?, ?)
                ON CONFLICT(period) DO UPDATE SET held = held + excluded.held`, period, RESERVATION_COST);
            return { ok: true, reservation, usage: usageFor(period, { ...totals, held: totals.held + RESERVATION_COST }) };
        });
    }

    settle(reservation, actualCostMicroUsd, answered = true) {
        if (typeof answered !== 'boolean') throw new TypeError('A boolean answer outcome is required.');
        const knownCost = typeof actualCostMicroUsd === 'number' && actualCostMicroUsd >= 0 &&
            Number.isSafeInteger(Math.ceil(actualCostMicroUsd));
        const sql = this.ctx.storage.sql;
        return this.ctx.storage.transactionSync(() => {
            const hold = sql.exec('SELECT period, amount, pending_day FROM holds WHERE id = ?', reservation).toArray()[0];
            if (!hold) return this.getUsage();

            if (hold.pending_day && !answered) {
                sql.exec('UPDATE days SET used = used - 1 WHERE day = ? AND used > 0', hold.pending_day);
            }
            if (knownCost) {
                sql.exec('UPDATE months SET held = held - ?, spent = spent + ? WHERE period = ?',
                    hold.amount, Math.ceil(actualCostMicroUsd), hold.period);
                sql.exec('DELETE FROM holds WHERE id = ?', reservation);
            } else if (hold.pending_day) {
                // Finalize the daily outcome once; keep the monthly hold until the cost is known.
                sql.exec('UPDATE holds SET pending_day = NULL WHERE id = ?', reservation);
            }
            return this.getUsage();
        });
    }
}
