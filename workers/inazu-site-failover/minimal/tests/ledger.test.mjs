import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Miniflare } from 'miniflare';

const ledgerSource = await readFile(new URL('../ledger.mjs', import.meta.url), 'utf8');
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

async function openLedger(t, storage) {
    const simulator = new Miniflare({
        cf: false,
        resourcePersistencePath: storage,
        workers: [{ config: {
            name: 'ledger-test', compatibilityDate: '2026-05-09',
            manifest: { mainModule: 'fixture.mjs', modules: {
                'fixture.mjs': { type: 'esm', contents: fixtureSource },
                'ledger.mjs': { type: 'esm', contents: ledgerSource }
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
