const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const vm = require('node:vm');

const source = readFileSync(require.resolve('../public/presence.js'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
const response = (count, options = {}) => ({
    ok: options.ok ?? true,
    headers: { get: () => options.contentType ?? 'application/json' },
    json: options.json ?? (async () => ({ count }))
});

function sharedBrowser() {
    const values = new Map();
    let lock = Promise.resolve();
    return {
        storage: {
            getItem: key => values.get(key) ?? null,
            setItem: (key, value) => values.set(key, value)
        },
        locks: { request: (_key, callback) => {
            const result = lock.then(callback);
            lock = result.catch(() => {});
            return result;
        } }
    };
}

function createTab({ browser = sharedBrowser(), fetchResponse = async () => response(3), summaryVisible = false, hasIndicator = true, withStream = false } = {}) {
    let now = 1_000_000;
    let sequence = 0;
    const timers = new Map();
    const requests = [];
    const streams = [];
    const documentEvents = new Map();
    const windowEvents = new Map();
    const count = { textContent: '' };
    const indicator = { hidden: true, querySelector: () => count };
    const pill = {
        hidden: !summaryVisible,
        querySelector: () => !indicator.hidden ? indicator : summaryVisible ? {} : null
    };
    const document = {
        visibilityState: 'visible',
        querySelectorAll: () => hasIndicator ? [indicator] : [],
        querySelector: () => hasIndicator ? pill : null,
        addEventListener: (name, callback) => documentEvents.set(name, callback)
    };
    const navigator = { locks: browser.locks, onLine: true };
    class FakeEventSource {
        static OPEN = 1;
        constructor(url) {
            this.url = url;
            this.readyState = 0;
            streams.push(this);
        }
        open() { this.readyState = 1; }
        message(data) { this.onmessage({ data: typeof data === 'string' ? data : JSON.stringify(data) }); }
        error() { this.readyState = 0; this.onerror(); }
        close() { this.readyState = 2; }
    }
    vm.runInNewContext(source, {
        document,
        window: { addEventListener: (name, callback) => windowEvents.set(name, callback) },
        localStorage: browser.storage,
        navigator,
        ...(withStream ? { EventSource: FakeEventSource } : {}),
        crypto: { randomUUID },
        Date: { now: () => now },
        AbortController,
        setTimeout: (callback, delay) => {
            const id = ++sequence;
            timers.set(id, { callback, due: now + delay });
            return id;
        },
        clearTimeout: id => timers.delete(id),
        fetch: (url, options) => {
            requests.push({ url, ...options, visitorId: JSON.parse(options.body).visitorId });
            return fetchResponse(requests.length, options);
        }
    });
    return {
        requests, streams, indicator, count, pill,
        dispatch: name => windowEvents.get(name)({ persisted: true }),
        async visibility(state) {
            document.visibilityState = state;
            documentEvents.get('visibilitychange')();
            await settle();
        },
        async page(name) {
            windowEvents.get(name)({ persisted: true });
            await settle();
        },
        async online(value) {
            navigator.onLine = value;
            windowEvents.get(value ? 'online' : 'offline')();
            await settle();
        },
        async advance(duration) {
            const target = now + duration;
            for (;;) {
                const next = [...timers.entries()].filter(([, timer]) => timer.due <= target)
                    .sort((a, b) => a[1].due - b[1].due)[0];
                if (!next) break;
                const [id, timer] = next;
                now = timer.due;
                timers.delete(id);
                timer.callback();
                await settle();
            }
            now = target;
            await settle();
        }
    };
}

test('simultaneous tabs share a browser ID and display presence without cumulative analytics', async () => {
    const browser = sharedBrowser();
    const first = createTab({ browser, fetchResponse: async () => response(1234) });
    const second = createTab({ browser });
    await settle();
    assert.equal(first.requests[0].visitorId, second.requests[0].visitorId);
    assert.equal(first.requests[0].url, '/api/analytics/presence');
    assert.equal(first.requests[0].cache, 'no-store');
    assert.equal(first.count.textContent, '1,234');
    assert.equal(first.indicator.hidden, false);
    assert.equal(first.pill.hidden, false);
});

test('hidden tabs stop polling and hide presence, then refresh immediately on return', async () => {
    const tab = createTab();
    await settle();
    await tab.advance(25_000);
    assert.equal(tab.requests.length, 2);
    await tab.visibility('hidden');
    assert.equal(tab.indicator.hidden, true);
    assert.equal(tab.pill.hidden, true);
    await tab.advance(100_000);
    assert.equal(tab.requests.length, 2);
    await tab.visibility('visible');
    assert.equal(tab.requests.length, 3);
    assert.equal(tab.indicator.hidden, false);
});

test('network, HTTP, non-JSON and invalid-count failures hide stale presence and recover', async t => {
    const failures = [
        ['network', () => Promise.reject(new Error('offline'))],
        ['HTTP', () => response(3, { ok: false })],
        ['HTML fallback', () => response(3, { contentType: 'text/html' })],
        ['malformed JSON', () => response(3, { json: async () => { throw new SyntaxError(); } })],
        ['zero count', () => response(0)],
        ['fractional count', () => response(1.5)],
        ['string count', () => response('3')]
    ];
    for (const [name, failure] of failures) {
        await t.test(name, async () => {
            const tab = createTab({ fetchResponse: async call => call === 2 ? failure() : response(3) });
            await settle();
            await tab.advance(25_000);
            assert.equal(tab.indicator.hidden, true);
            assert.equal(tab.pill.hidden, true);
            assert.notEqual(tab.count.textContent, '0');
            await tab.advance(25_000);
            assert.equal(tab.indicator.hidden, false);
        });
    }
});

test('presence failure keeps available cumulative analytics visible', async () => {
    const tab = createTab({ summaryVisible: true, fetchResponse: async () => { throw new Error('offline'); } });
    await settle();
    assert.equal(tab.indicator.hidden, true);
    assert.equal(tab.pill.hidden, false);
});

test('pagehide pauses polling and pageshow restores a page from the back-forward cache', async () => {
    const tab = createTab();
    await settle();
    await tab.page('pagehide');
    await tab.advance(60_000);
    assert.equal(tab.requests.length, 1);
    assert.equal(tab.indicator.hidden, true);
    await tab.page('pageshow');
    assert.equal(tab.requests.length, 2);
    assert.equal(tab.indicator.hidden, false);
});

test('pending heartbeats time out, hide the old count, and retry', async () => {
    let pendingSignal;
    const tab = createTab({ fetchResponse: async (call, { signal }) => {
        if (call !== 2) return response(3);
        pendingSignal = signal;
        return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    } });
    await settle();
    await tab.advance(25_000);
    assert.equal(pendingSignal.aborted, false);
    await tab.advance(8_000);
    assert.equal(pendingSignal.aborted, true);
    assert.equal(tab.indicator.hidden, true);
    await tab.advance(25_000);
    assert.equal(tab.requests.length, 3);
    assert.equal(tab.indicator.hidden, false);
});

test('a response received after the tab is hidden cannot restore the indicator', async () => {
    let finish;
    const tab = createTab({ fetchResponse: call => call === 1
        ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(response(4)) });
    await settle();
    await tab.visibility('hidden');
    finish(response(3));
    await settle();
    assert.equal(tab.indicator.hidden, true);
    await tab.advance(100_000);
    assert.equal(tab.requests.length, 1);
    await tab.visibility('visible');
    assert.equal(tab.count.textContent, '4');
});

test('blocked browser storage still permits stable presence within a tab', async () => {
    const tab = createTab({ browser: {
        storage: { getItem: () => { throw new Error('storage blocked'); } }
    } });
    await settle();
    await tab.advance(25_000);
    assert.equal(tab.requests.length, 2);
    assert.equal(tab.requests[0].visitorId, tab.requests[1].visitorId);
    assert.equal(tab.indicator.hidden, false);
});

test('a returning browser renews its ID after thirty minutes of inactivity', async () => {
    const tab = createTab();
    await settle();
    const firstId = tab.requests[0].visitorId;
    await tab.visibility('hidden');
    await tab.advance(30 * 60_000 + 1);
    await tab.visibility('visible');
    assert.notEqual(tab.requests[1].visitorId, firstId);
});

test('pages without an indicator still contribute their visible browser', async () => {
    const tab = createTab({ hasIndicator: false });
    await settle();
    assert.equal(tab.requests.length, 1);
    await tab.advance(25_000);
    assert.equal(tab.requests.length, 2);
});

test('server events update the visible count immediately, including zero', async () => {
    const tab = createTab({ withStream: true });
    await settle();
    const stream = tab.streams[0];
    assert.equal(stream.url, '/api/analytics/presence/stream');
    stream.open();
    stream.message({ count: 7 });
    assert.equal(tab.count.textContent, '7');
    assert.equal(tab.requests.length, 1);
    stream.message({ count: 0 });
    assert.equal(tab.count.textContent, '0');
    assert.equal(tab.indicator.hidden, false);
});

test('a stale heartbeat response cannot overwrite a newer open-stream count', async () => {
    let finish;
    const tab = createTab({ withStream: true, fetchResponse: call => call === 2
        ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(response(3)) });
    await settle();
    tab.streams[0].open();
    await tab.advance(25_000);
    tab.streams[0].message({ count: 5 });
    finish(response(3));
    await settle();
    assert.equal(tab.count.textContent, '5');
    assert.equal(tab.streams.length, 1);
});

test('a stream error closes the connection and the next heartbeat reconnects', async () => {
    const tab = createTab({ withStream: true });
    await settle();
    const stream = tab.streams[0];
    stream.open();
    stream.error();
    assert.equal(stream.readyState, 2);
    await tab.advance(25_000);
    assert.equal(tab.requests.length, 2);
    assert.equal(tab.streams.length, 2);
    tab.streams[1].open();
    tab.streams[1].message({ count: 6 });
    stream.message({ count: 99 });
    assert.equal(tab.count.textContent, '6');
});

test('hidden, cached and offline pages close their stream and reconnect when active', async t => {
    const transitions = [
        ['visibility', tab => tab.visibility('hidden'), tab => tab.visibility('visible')],
        ['back-forward cache', tab => tab.page('pagehide'), tab => tab.page('pageshow')],
        ['network', tab => tab.online(false), tab => tab.online(true)]
    ];
    for (const [name, pause, resume] of transitions) {
        await t.test(name, async () => {
            const tab = createTab({ withStream: true });
            await settle();
            const stream = tab.streams[0];
            stream.open();
            await pause(tab);
            assert.equal(stream.readyState, 2);
            assert.equal(tab.indicator.hidden, true);
            await tab.advance(60_000);
            assert.equal(tab.requests.length, 1);
            await resume(tab);
            assert.equal(tab.requests.length, 2);
            assert.equal(tab.streams.length, 2);
            assert.equal(tab.indicator.hidden, false);
        });
    }
});

test('malformed pushed counts hide presence, close the stream and allow recovery', async t => {
    for (const data of ['invalid JSON', { count: -1 }, { count: '3' }]) {
        await t.test(JSON.stringify(data), async () => {
            const tab = createTab({ withStream: true });
            await settle();
            const stream = tab.streams[0];
            stream.open();
            stream.message(data);
            assert.equal(stream.readyState, 2);
            assert.equal(tab.indicator.hidden, true);
            await tab.advance(25_000);
            assert.equal(tab.streams.length, 2);
            assert.equal(tab.indicator.hidden, false);
        });
    }
});

test('restoring during an aborted request retries immediately without waiting twenty-five seconds', async () => {
    const tab = createTab({ withStream: true, fetchResponse: (call, { signal }) => call === 2
        ? new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
        : Promise.resolve(response(3)) });
    await settle();
    tab.streams[0].open();
    await tab.advance(25_000);
    tab.dispatch('pagehide');
    tab.dispatch('pageshow');
    await settle();
    await tab.advance(0);
    assert.equal(tab.requests.length, 3);
    assert.equal(tab.streams.length, 2);
    assert.equal(tab.indicator.hidden, false);
});
