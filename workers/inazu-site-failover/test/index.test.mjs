import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/index.mjs';

const PUBLIC_ORIGIN = 'https://inazu.me';
const MAC_ORIGIN = 'https://mac.example.invalid';
const PI_ORIGIN = 'https://pi.example.invalid';
const ORIGINS = { MAC_ORIGIN, PI_ORIGIN };

function requestFor(path, method = 'GET', headers) {
    return new Request(`${PUBLIC_ORIGIN}${path}`, { method, headers });
}

for (const enabled of [true, 'true']) {
    test(`maintenance ${JSON.stringify(enabled)} blocks every method and path before fetching`, async (t) => {
        const fetchMock = t.mock.method(globalThis, 'fetch', () => {
            throw new Error('Maintenance must not contact an origin');
        });
        const paths = ['/', '/news', '/admin/', '/api', '/api/admin/uploads', '/https://evil.invalid/', '///evil.invalid'];
        const methods = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'PROPFIND'];

        for (const path of paths) {
            for (const method of methods) {
                const response = await worker.fetch(requestFor(path, method), {
                    MAINTENANCE_MODE: enabled,
                    // Invalid origins also prove the gate runs before URL construction.
                    MAC_ORIGIN: 'invalid origin',
                    PI_ORIGIN: 'invalid origin'
                });
                assert.equal(response.status, 503, `${method} ${path}`);
                assert.equal(response.headers.get('cache-control'), 'no-store');
                assert.equal(response.headers.get('retry-after'), '3600');
                assert.equal(response.headers.get('x-inazu-origin'), 'maintenance');
                assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
                if (method === 'HEAD') {
                    assert.equal(response.body, null);
                    assert.equal(await response.text(), '');
                } else {
                    assert.equal(await response.text(), 'メンテ中です');
                }
            }
        }
        assert.equal(fetchMock.mock.callCount(), 0);
    });
}

test('cookies, authorization, headers and query flags cannot bypass maintenance', async (t) => {
    const fetchMock = t.mock.method(globalThis, 'fetch', () => new Response('private admin data'));
    const request = requestFor('/admin/?maintenance=false&bypass=true', 'GET', {
        cookie: 'session=test',
        authorization: 'Bearer test',
        'x-inazu-worker': 'site-failover',
        'x-maintenance-bypass': 'true'
    });
    const response = await worker.fetch(request, { ...ORIGINS, MAINTENANCE_MODE: true });
    assert.equal(response.status, 503);
    assert.equal(fetchMock.mock.callCount(), 0);
});

test('disabled or unset maintenance preserves normal origin traffic', async (t) => {
    const fetchMock = t.mock.method(globalThis, 'fetch', () => new Response('available'));
    for (const disabled of [undefined, false, 'false']) {
        const response = await worker.fetch(requestFor('/news'), { ...ORIGINS, MAINTENANCE_MODE: disabled });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('x-inazu-origin'), 'mac');
        assert.equal(await response.text(), 'available');
    }
    assert.equal(fetchMock.mock.callCount(), 3);
});

const paths = ['/', '/news', '/assets/photo%20name.png', '/admin/', '/api/admin/status'];

for (const path of paths) {
    test(`origin remains fixed for ${path}`, async (t) => {
        const fetchMock = t.mock.method(globalThis, 'fetch', () => new Response('ok'));
        const request = requestFor(`${path}?next=https%3A%2F%2Fevil.invalid%2F&value=1`);
        await worker.fetch(request, ORIGINS);
        assert.equal(fetchMock.mock.callCount(), 1);
        const [target, options] = fetchMock.mock.calls[0].arguments;
        const input = new URL(request.url);
        assert.equal(target.origin, MAC_ORIGIN);
        assert.equal(target.protocol, 'https:');
        assert.equal(target.pathname, input.pathname);
        assert.equal(target.search, input.search);
        assert.equal(options.redirect, 'manual');
    });
}

test('read fallback preserves the path and query', async (t) => {
    const fetchMock = t.mock.method(globalThis, 'fetch', (url) => new Response('upstream', {
        status: url.origin === MAC_ORIGIN ? 503 : 200
    }));
    const request = requestFor('/news?value=1');
    const response = await worker.fetch(request, ORIGINS);
    assert.equal(response.headers.get('x-inazu-origin'), 'pi');
    assert.equal(fetchMock.mock.callCount(), 2);
    for (const [index, origin] of [MAC_ORIGIN, PI_ORIGIN].entries()) {
        const [target] = fetchMock.mock.calls[index].arguments;
        assert.equal(target.origin, origin);
        assert.equal(target.pathname, '/news');
        assert.equal(target.search, '?value=1');
    }
});

test('admin requests never fall back to Pi', async (t) => {
    const fetchMock = t.mock.method(globalThis, 'fetch', () => new Response('unavailable', { status: 503 }));
    for (const path of ['/admin/', '/api/admin/status']) {
        const response = await worker.fetch(requestFor(path), ORIGINS);
        assert.equal(response.status, 503);
        assert.equal(response.headers.get('x-inazu-origin'), 'mac');
    }
    assert.equal(fetchMock.mock.callCount(), 2);
    for (const call of fetchMock.mock.calls) {
        assert.equal(call.arguments[0].origin, MAC_ORIGIN);
    }
});

test('non-read requests are sent to Mac once without failover', async (t) => {
    const fetchMock = t.mock.method(globalThis, 'fetch', () => new Response('unavailable', { status: 503 }));
    const request = new Request(`${PUBLIC_ORIGIN}/api/chat`, { method: 'POST', body: '{"message":"test"}' });
    const response = await worker.fetch(request, ORIGINS);
    assert.equal(response.status, 503);
    assert.equal(fetchMock.mock.callCount(), 1);
    const [target, options] = fetchMock.mock.calls[0].arguments;
    assert.equal(target.origin, MAC_ORIGIN);
    assert.equal(options.method, 'POST');
    assert.equal(options.body, request.body);
});

test('HEAD retains its method and empty body through normal failover', async (t) => {
    const fetchMock = t.mock.method(globalThis, 'fetch', (url) => new Response(null, {
        status: url.origin === MAC_ORIGIN ? 503 : 200
    }));
    const response = await worker.fetch(requestFor('/news', 'HEAD'), ORIGINS);
    assert.equal(response.status, 200);
    assert.equal(response.body, null);
    assert.equal(fetchMock.mock.callCount(), 2);
    for (const call of fetchMock.mock.calls) {
        assert.equal(call.arguments[1].method, 'HEAD');
        assert.equal(call.arguments[1].body, undefined);
    }
});
