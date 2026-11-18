import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Miniflare } from 'miniflare';
import { RESERVATION_MICRO_USD } from '../cost.mjs';

const ledgerSource = await readFile(new URL('../ledger.mjs', import.meta.url), 'utf8');
const costSource = await readFile(new URL('../cost.mjs', import.meta.url), 'utf8');
const fixtureSource = `
    import { ChatLedger } from './ledger.mjs';
    export class TestLedger extends ChatLedger {
        setTime(ms) { Date.now = () => ms; }
        seedDay(day, count) {
            this.ctx.storage.sql.exec('INSERT INTO days VALUES (?, ?)', day, count);
        }
        dayUse(day) {
            return this.ctx.storage.sql.exec('SELECT used FROM days WHERE day = ?', day).one().used;
        }
        seedSpend(period, spent) {
            this.ctx.storage.sql.exec('INSERT INTO months (period, spent) VALUES (?, ?)', period, spent);
        }
    }
`;
const client = 'a'.repeat(64);

async function openLedger(t, storage, fixture = fixtureSource) {
    const simulator = new Miniflare({
        cf: false,
        resourcePersistencePath: storage,
        workers: [{ config: {
            name: 'ledger-test', compatibilityDate: '2026-05-09',
            manifest: { mainModule: 'fixture.mjs', modules: {
                'fixture.mjs': { type: 'esm', contents: fixture },
                'ledger.mjs': { type: 'esm', contents: ledgerSource },
                'cost.mjs': { type: 'esm', contents: costSource }
            } },
            env: { LEDGER: { type: 'durable-object', worker: 'ledger-test', exportName: 'TestLedger' } },
            exports: { TestLedger: { type: 'durable-object', storage: 'sqlite' } }
        } }]
    });
    t.after(() => simulator.dispose());
    const namespace = await simulator.getDurableObjectNamespace('LEDGER', 'ledger-test');
    return { ledger: namespace.getByName('global'), close: () => simulator.dispose() };
}

test('concurrent admissions obey the rolling minute across JST midnight', async (t) => {
    const { ledger } = await openLedger(t);
    const midnight = Date.parse('2027-01-01T00:00:00+09:00');
    await ledger.setTime(midnight - 2_000);
    const replies = await Promise.all(Array.from({ length: 6 }, () => ledger.reserve(client)));
    assert.equal(replies.filter(reply => reply.ok).length, 5);
    assert.equal(replies.find(reply => !reply.ok).reason, 'rate');
    await ledger.setTime(midnight + 57_999);
    const denied = await ledger.reserve(client);
    assert.equal(denied.retryAfter, 1);
    await ledger.setTime(midnight + 58_000);
    const accepted = await ledger.reserve(client);
    assert.equal(accepted.ok, true);
    assert.equal(accepted.usage.period, '2027-01');
    assert.equal(accepted.usage.reservedUsd, 0.01);
    const late = await ledger.settle(replies.find(reply => reply.ok).reservation, 220);
    assert.equal(late.estimatedUsd, 0);
    assert.equal(late.reservedUsd, 0.01);
});

test('nano-dollar settlements accumulate exactly and keep uncertainty out of spend', async t => {
    const { ledger } = await openLedger(t);
    await ledger.setTime(Date.parse('2027-05-01T12:00:00+09:00'));
    for (let i = 1; i <= 4; i++) {
        const admission = await ledger.reserveNano(client);
        assert.equal(admission.usage.reservedUsd,
            (RESERVATION_MICRO_USD * 1000 + (i - 1) * 25) / 1e9);
        const settled = await ledger.settleNano(admission.reservation, 125, true, 25);
        assert.equal(settled.estimatedUsd, i * 125 / 1e9);
        assert.equal(settled.reservedUsd, i * 25 / 1e9);
        const replayed = await ledger.settleNano(admission.reservation, 42, false);
        assert.equal(replayed.estimatedUsd, settled.estimatedUsd);
        assert.equal(replayed.reservedUsd, settled.reservedUsd);
    }
    assert.equal(await ledger.dayUse('2027-05-01'), 4);
});

test('new tool reservations include concurrent calls at the monthly boundary', async t => {
    const { ledger } = await openLedger(t);
    await ledger.setTime(Date.parse('2027-05-01T12:00:00+09:00'));
    const seeded = 100_000_000 - RESERVATION_MICRO_USD;
    await ledger.seedSpend('2027-05', seeded);
    const admissions = await Promise.all([ledger.reserveNano(client), ledger.reserveNano(client)]);
    const admitted = admissions.find(x => x.ok);
    assert.equal(admissions.filter(x => x.ok).length, 1);
    assert.equal(admissions.find(x => !x.ok).reason, 'budget');
    assert.equal(admitted.usage.reservedUsd, RESERVATION_MICRO_USD / 1e6);
    assert.equal((await ledger.settleNano(admitted.reservation, null, false)).estimatedUsd, seeded / 1e6);
    assert.equal((await ledger.reserveNano(client)).reason, 'budget');
    await ledger.settleNano(admitted.reservation, 0, false);
    assert.equal((await ledger.reserveNano(client)).ok, true);
});

test('the deployed SQLite schema upgrades in place with old holds, spend and daily outcomes', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'inazu-pre-upgrade-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const legacy = await openLedger(t, directory, `
        import { DurableObject } from 'cloudflare:workers';
        export class TestLedger extends DurableObject {
            seed() { this.ctx.storage.sql.exec(\`
                CREATE TABLE months (period TEXT PRIMARY KEY, spent INTEGER DEFAULT 0, held INTEGER DEFAULT 0);
                CREATE TABLE holds (id TEXT PRIMARY KEY, period TEXT, amount INTEGER, pending_day TEXT);
                CREATE TABLE days (day TEXT PRIMARY KEY, used INTEGER);
                INSERT INTO months VALUES ('2027-05', 15, 10000);
                INSERT INTO holds VALUES ('in-flight', '2027-05', 10000, '2027-05-01');
                INSERT INTO days VALUES ('2027-05-01', 1);
            \`); }
        }
    `);
    await legacy.ledger.seed();
    await legacy.close();
    const { ledger } = await openLedger(t, directory);
    await ledger.setTime(Date.parse('2027-05-01T12:00:00+09:00'));
    assert.equal((await ledger.getUsage()).reservedUsd, 0.01);
    const settled = await ledger.settle('in-flight', 120, false);
    assert.equal(settled.estimatedUsd, 0.000135);
    assert.equal(settled.reservedUsd, 0);
    assert.equal(await ledger.dayUse('2027-05-01'), 0);
    const next = await ledger.reserveNano(client);
    assert.equal((await ledger.settleNano(next.reservation, 125)).estimatedUsd, 0.000135125);
});

test('only one request claims the final daily slot and JST midnight renews it', async (t) => {
    const { ledger } = await openLedger(t);
    const midnight = Date.parse('2027-01-02T00:00:00+09:00');
    await ledger.setTime(midnight - 200);
    await ledger.seedDay('2027-01-01', 999);
    const replies = await Promise.all([ledger.reserve(client), ledger.reserve('b'.repeat(64))]);
    assert.equal(replies.filter(reply => reply.ok).length, 1);
    const denied = replies.find(reply => !reply.ok);
    assert.equal(denied.reason, 'daily');
    assert.equal(denied.retryAfter, 1);
    await ledger.setTime(midnight);
    const newDay = await ledger.reserve(client);
    assert.equal(newDay.ok, true);
    const previousDay = replies.find(reply => reply.ok);
    await ledger.settle(previousDay.reservation, 502.5, false);
    assert.equal(await ledger.dayUse('2027-01-01'), 999);
    assert.equal(await ledger.dayUse('2027-01-02'), 1);
    await ledger.settle(newDay.reservation, undefined, true);
    await ledger.settle(newDay.reservation, 100, false);
    assert.equal(await ledger.dayUse('2027-01-02'), 1);
});

test('failed answers release daily slots exactly once while the rolling IP limit still applies', async (t) => {
    const { ledger } = await openLedger(t);
    await ledger.setTime(Date.parse('2027-02-03T11:00:00+09:00'));
    await ledger.seedDay('2027-02-03', 999);
    const first = await ledger.reserve(client);
    const failures = await Promise.all([
        ledger.settle(first.reservation, null, false),
        ledger.settle(first.reservation, null, false)
    ]);
    assert.equal(failures[0].reservedUsd, 0.01);
    assert.equal(await ledger.dayUse('2027-02-03'), 999);
    for (let i = 0; i < 4; i++) {
        const retried = await ledger.reserve(client);
        assert.equal(retried.ok, true);
        await ledger.settle(retried.reservation, 0, false);
    }
    assert.equal((await ledger.reserve(client)).reason, 'rate');
    const last = await ledger.reserve('b'.repeat(64));
    assert.equal(last.ok, true);
    await ledger.settle(first.reservation, 260, false);
    assert.equal((await ledger.reserve('c'.repeat(64))).reason, 'daily');
    const final = await ledger.settle(last.reservation, 380);
    assert.equal(final.estimatedUsd, 0.00064);
    assert.equal(final.reservedUsd, 0);
});

test('holds and settlements survive a restart and preserve the monthly budget', async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'inazu-ledger-test-'));
    try {
        const first = await openLedger(t, directory);
        const now = Date.parse('2027-03-31T23:59:59+09:00');
        await first.ledger.setTime(now);
        await first.ledger.seedSpend('2027-03', 99_980_001);
        const [a, b] = await Promise.all([first.ledger.reserve(client), first.ledger.reserve(client)]);
        const admitted = a.ok ? a : b;
        const denied = a.ok ? b : a;
        assert.equal(admitted.ok, true);
        assert.equal(denied.reason, 'budget');
        assert.equal(denied.usage.estimatedUsd, 99.980001);
        assert.equal(denied.usage.reservedUsd, 0.01);
        const id = admitted.reservation;
        await first.close();

        const { ledger } = await openLedger(t, directory);
        await ledger.setTime(now);
        assert.equal(await ledger.dayUse('2027-03-31'), 1);
        assert.equal((await ledger.settle(id, null, false)).reservedUsd, 0.01);
        assert.equal(await ledger.dayUse('2027-03-31'), 0);
        assert.equal((await ledger.reserve(client)).reason, 'budget');
        const settled = await ledger.settle(id, 0.4);
        assert.equal(settled.estimatedUsd, 99.980002);
        assert.equal(settled.reservedUsd, 0);
        assert.equal((await ledger.settle(id, 8_000)).estimatedUsd, 99.980002);
        assert.equal(await ledger.dayUse('2027-03-31'), 0);
        assert.equal((await ledger.reserve(client)).ok, true);
        await ledger.setTime(now + 1_000);
        const nextMonth = await ledger.getUsage();
        assert.equal(nextMonth.period, '2027-04');
        assert.equal(nextMonth.estimatedUsd, 0);
        assert.equal(nextMonth.reservedUsd, 0);
    } finally {
        t.after(() => rm(directory, { recursive: true, force: true }));
    }
});
