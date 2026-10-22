const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const http = require('node:http');
const express = require('express');
const { createPresenceStore, createPresenceRouter, PRESENCE_TTL_MS } = require('../src/presence');

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15';

test('heartbeats deduplicate tabs, refresh only their visitor, and expire at 90 seconds', () => {
    let time = 0;
    const store = createPresenceStore({ now: () => time });
    assert.equal(store.heartbeat('first-browser'), 1);
    assert.equal(store.heartbeat('second-browser'), 2);
    time = 25000;
    assert.equal(store.heartbeat('first-browser'), 2);
    time = PRESENCE_TTL_MS - 1;
    assert.equal(store.count(), 2);
    time = PRESENCE_TTL_MS;
    assert.equal(store.count(), 1);
    time = 25000 + PRESENCE_TTL_MS;
    assert.equal(store.count(), 0);
});

test('store is bounded, still refreshes existing visitors at capacity, and frees expired slots', () => {
    let time = 0;
    const store = createPresenceStore({ maxVisitors: 2, now: () => time });
    assert.equal(store.heartbeat('a'), 1);
    assert.equal(store.heartbeat('b'), 2);
    assert.equal(store.heartbeat('c'), null);
    time = 25000;
    assert.equal(store.heartbeat('a'), 2);
    time = PRESENCE_TTL_MS;
    assert.equal(store.heartbeat('c'), 2);
});

async function createFixture(t, options = {}) {
    const app = express();
    app.set('trust proxy', 1);
    app.use('/api/analytics/presence', createPresenceRouter({
        allowedHosts: ['127.0.0.1', 'localhost', 'inazu.me', 'www.inazu.me', 'mac-site-origin.inazu.me'],
        proxyOrigins: {
            'https://mac-site-origin.inazu.me': ['https://inazu.me', 'https://www.inazu.me']
        },
        ...options
    }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => {
        server.close(resolve);
        server.closeAllConnections();
    }));
    const base = `http://127.0.0.1:${server.address().port}`;

    const request = async function ({ visitorId = randomUUID(), method = 'POST', body, headers = {}, path = '' } = {}) {
        const result = await new Promise((resolve, reject) => {
            const requestHeaders = {
                'content-type': 'application/json',
                'user-agent': BROWSER_UA,
                origin: base,
                'sec-fetch-site': 'same-origin',
                ...headers
            };
            for (const name of Object.keys(requestHeaders)) {
                if (requestHeaders[name] === null) delete requestHeaders[name];
            }
            const req = http.request(`${base}/api/analytics/presence${path}`, {
                method,
                headers: requestHeaders
            }, res => {
                let text = '';
                res.setEncoding('utf8');
                res.on('data', chunk => { text += chunk; });
                res.on('end', () => resolve({
                    response: { status: res.statusCode, headers: new Headers(res.headers) },
                    json: JSON.parse(text)
                }));
                res.on('error', reject);
            });
            req.on('error', reject);
            req.end(['GET', 'HEAD'].includes(method) ? undefined : body ?? JSON.stringify({ visitorId }));
        });
        assert.equal(result.response.headers.get('cache-control'), 'no-store');
        return result;
    };

    request.stream = ({ headers = {} } = {}) => new Promise((resolve, reject) => {
        const req = http.get(`${base}/api/analytics/presence/stream`, {
            headers: {
                accept: 'text/event-stream',
                'user-agent': BROWSER_UA,
                'sec-fetch-site': 'same-origin',
                ...headers
            }
        }, response => {
            const frames = [];
            const waiters = new Set();
            let buffer = '';
            response.setEncoding('utf8');
            response.on('data', chunk => {
                buffer += chunk;
                let end;
                while ((end = buffer.indexOf('\n\n')) !== -1) {
                    frames.push(buffer.slice(0, end));
                    buffer = buffer.slice(end + 2);
                }
                for (const check of waiters) check();
            });
            response.on('error', () => {});
            t.after(() => { response.destroy(); req.destroy(); });
            resolve({
                response,
                frames,
                counts: () => frames.filter(frame => frame.startsWith('data: ')).map(frame => JSON.parse(frame.slice(6)).count),
                waitFor(predicate) {
                    return new Promise((resolveWait, rejectWait) => {
                        const timeout = setTimeout(() => {
                            waiters.delete(check);
                            rejectWait(new Error(`Timed out waiting for stream: ${JSON.stringify(frames)}`));
                        }, 1500);
                        function check() {
                            if (!predicate(frames)) return;
                            clearTimeout(timeout);
                            waiters.delete(check);
                            resolveWait();
                        }
                        waiters.add(check);
                        check();
                    });
                },
                close() { response.destroy(); req.destroy(); }
            });
        });
        req.on('error', reject);
    });
    return request;
}

test('endpoint returns only the aggregate, including requester, and deduplicates UUID casing', async t => {
    const request = await createFixture(t);
    const visitorId = randomUUID();
    assert.deepEqual((await request({ visitorId })).json, { count: 1 });
    assert.deepEqual((await request({ visitorId: visitorId.toUpperCase() })).json, { count: 1 });
    assert.deepEqual((await request()).json, { count: 2 });
});

test('endpoint validates UUIDs, JSON shape, type, syntax and request size without counting them', async t => {
    const request = await createFixture(t);
    for (const body of ['{}', '[]', 'null', '{', '{"visitorId":123}', '{"visitorId":"not-a-uuid"}',
        JSON.stringify({ visitorId: '00000000-0000-0000-0000-000000000000' }),
        JSON.stringify({ visitorId: randomUUID(), extra: true })]) {
        assert.equal((await request({ body })).response.status, 400, body);
    }
    assert.equal((await request({ headers: { 'content-type': 'text/plain' } })).response.status, 415);
    assert.equal((await request({ body: JSON.stringify({ visitorId: 'a'.repeat(1200) }) })).response.status, 413);
    assert.deepEqual((await request()).json, { count: 1 });
});

test('endpoint rejects foreign, missing, malformed and cross-site origins', async t => {
    const request = await createFixture(t);
    for (const origin of ['https://other.example', 'null', '', 'http://localhost', 'http://127.0.0.1',
        'http://127.0.0.1/path', 'https://inazu.me/path', 'https://user@inazu.me', 'file://inazu.me']) {
        assert.equal((await request({ headers: { origin } })).response.status, 403, origin);
    }
    assert.equal((await request({ headers: { 'sec-fetch-site': 'cross-site' } })).response.status, 403);
    assert.deepEqual((await request()).json, { count: 1 });
});

test('endpoint checks public hosts and permits only POST', async t => {
    const request = await createFixture(t);
    const wrongHost = await request({ headers: { host: 'chat.inazu.me', origin: 'http://chat.inazu.me' } });
    assert.equal(wrongHost.response.status, 404);
    for (const method of ['GET', 'PUT', 'OPTIONS']) {
        const { response } = await request({ method });
        assert.equal(response.status, 405);
        assert.equal(response.headers.get('allow'), 'POST');
    }
});

test('endpoint accepts HTTPS proxy requests and the configured Cloudflare failover route', async t => {
    const request = await createFixture(t);
    const visitorId = randomUUID();
    const proxyHeaders = {
        'x-forwarded-host': 'inazu.me',
        'x-forwarded-proto': 'https',
        origin: 'https://inazu.me'
    };
    assert.deepEqual((await request({ visitorId, headers: proxyHeaders })).json, { count: 1 });
    assert.equal((await request({ headers: { ...proxyHeaders, origin: 'http://inazu.me' } })).response.status, 403);
    const workerHeaders = {
        host: 'mac-site-origin.inazu.me',
        'x-forwarded-proto': 'https',
        'x-inazu-worker': 'site-failover',
        origin: 'https://inazu.me'
    };
    assert.deepEqual((await request({ visitorId, headers: workerHeaders })).json, { count: 1 });
    assert.equal((await request({ headers: { ...workerHeaders, 'x-inazu-worker': '' } })).response.status, 403);
    assert.equal((await request({ headers: { ...workerHeaders, origin: 'https://other.example' } })).response.status, 403);
});

test('endpoint rejects empty user agents and known bots', async t => {
    const request = await createFixture(t);
    for (const userAgent of ['', 'curl/8.0', 'Mozilla/5.0 Googlebot/2.1', 'GPTBot/1.0', 'python-requests/2']) {
        assert.equal((await request({ headers: { 'user-agent': userAgent } })).response.status, 403);
    }
    assert.deepEqual((await request()).json, { count: 1 });
});

test('endpoint limits repeated requests without recording the rejected identifier', async t => {
    const store = createPresenceStore();
    const request = await createFixture(t, { store, rateLimitMax: 2 });
    assert.equal((await request()).response.status, 200);
    assert.equal((await request()).response.status, 200);
    assert.equal((await request()).response.status, 429);
    assert.equal(store.count(), 2);
});

test('endpoint reports capacity failures without returning a misleading count', async t => {
    const request = await createFixture(t, { store: createPresenceStore({ maxVisitors: 1 }) });
    assert.equal((await request()).response.status, 200);
    const { response, json } = await request();
    assert.equal(response.status, 503);
    assert.equal('count' in json, false);
});

test('SSE immediately sends the count and pushes joins without duplicate heartbeat events', async t => {
    const request = await createFixture(t);
    const visitorId = randomUUID();
    await request({ visitorId });
    const stream = await request.stream();
    assert.equal(stream.response.statusCode, 200);
    assert.match(stream.response.headers['content-type'], /^text\/event-stream/);
    assert.equal(stream.response.headers['cache-control'], 'no-store, no-transform');
    assert.equal(stream.response.headers['x-accel-buffering'], 'no');
    assert.equal(stream.response.headers['set-cookie'], undefined);
    await stream.waitFor(frames => frames.length === 1);
    assert.deepEqual(stream.counts(), [1]);

    await request();
    await stream.waitFor(frames => frames.length === 2);
    assert.deepEqual(stream.counts(), [1, 2]);
    await request({ visitorId });
    assert.deepEqual(stream.counts(), [1, 2]);
});

test('SSE publishes expiry without another request and keeps idle connections alive', async t => {
    let time = 0;
    const store = createPresenceStore({ now: () => time, expiryCheckMs: 10 });
    const request = await createFixture(t, { store, keepaliveMs: 20 });
    await request();
    const stream = await request.stream();
    await stream.waitFor(frames => frames.some(frame => frame === 'data: {"count":1}'));
    time = PRESENCE_TTL_MS;
    await stream.waitFor(frames => frames.some(frame => frame === 'data: {"count":0}'));
    await stream.waitFor(frames => frames.some(frame => frame === ': keepalive'));
    assert.deepEqual(stream.counts(), [1, 0]);
});

test('SSE disconnect removes subscribers and releases global and IP connection capacity', async t => {
    const store = createPresenceStore();
    let subscribed = 0;
    let disconnected;
    const disconnect = new Promise(resolve => { disconnected = resolve; });
    const originalSubscribe = store.subscribe;
    store.subscribe = listener => {
        subscribed += 1;
        const unsubscribe = originalSubscribe(listener);
        return () => {
            subscribed -= 1;
            unsubscribe();
            disconnected();
        };
    };
    const request = await createFixture(t, { store, maxStreams: 1, maxStreamsPerIp: 1 });
    const first = await request.stream();
    await first.waitFor(frames => frames.length === 1);
    assert.equal(subscribed, 1);
    const full = await request({ method: 'GET', path: '/stream' });
    assert.equal(full.response.status, 503);
    assert.equal(full.response.headers.get('retry-after'), '30');
    first.close();
    await disconnect;
    assert.equal(subscribed, 0);
    const second = await request.stream();
    await second.waitFor(frames => frames.length === 1);
    assert.equal(second.response.statusCode, 200);
    assert.equal(subscribed, 1);
});

test('store stops its expiry timer after its last subscriber leaves', async () => {
    let reads = 0;
    const store = createPresenceStore({ now: () => { reads += 1; return 0; }, expiryCheckMs: 5 });
    const unsubscribe = store.subscribe(() => {});
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(reads > 1);
    unsubscribe();
    const afterUnsubscribe = reads;
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(reads, afterUnsubscribe);
});

test('SSE without Origin requires same-origin browser metadata and rejects bots, wrong hosts and methods', async t => {
    const request = await createFixture(t);
    for (const headers of [
        { origin: null, 'sec-fetch-site': null },
        { origin: null, 'sec-fetch-site': 'cross-site' },
        { origin: 'https://other.example' },
        { 'user-agent': 'Googlebot/2.1' }
    ]) {
        assert.equal((await request({ method: 'GET', path: '/stream', headers })).response.status, 403);
    }
    assert.equal((await request({ method: 'GET', path: '/stream', headers: { host: 'chat.inazu.me' } })).response.status, 404);
    const wrongMethod = await request({ path: '/stream' });
    assert.equal(wrongMethod.response.status, 405);
    assert.equal(wrongMethod.response.headers.get('allow'), 'GET');
    // A stream does not record a visitor; only the heartbeat does.
    const stream = await request.stream();
    await stream.waitFor(frames => frames.length === 1);
    assert.deepEqual(stream.counts(), [0]);
});
