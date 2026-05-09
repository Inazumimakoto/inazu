const DEFAULT_MAC_ORIGIN = 'https://mac-site-origin.inazu.me';
const DEFAULT_PI_ORIGIN = 'https://pi-site-origin.inazu.me';
const DEFAULT_ORIGIN_TIMEOUT_MS = 1500;

const RETRYABLE_METHODS = new Set(['GET', 'HEAD']);

export default {
    async fetch(request, env) {
        const requestUrl = new URL(request.url);
        const timeoutMs = getTimeoutMs(env);
        const canRetry = RETRYABLE_METHODS.has(request.method.toUpperCase());

        const macResult = await fetchOrigin({
            request,
            originUrl: buildOriginUrl(env.MAC_ORIGIN || DEFAULT_MAC_ORIGIN, requestUrl),
            timeoutMs
        });

        if (isUsableOriginResponse(macResult.response)) {
            return withOriginHeader(macResult.response, 'mac');
        }

        if (!canRetry) {
            return macResult.response
                ? withOriginHeader(macResult.response, 'mac-error')
                : builtInFallback(request, 503, 'mac-unreachable');
        }

        const piResult = await fetchOrigin({
            request,
            originUrl: buildOriginUrl(env.PI_ORIGIN || DEFAULT_PI_ORIGIN, requestUrl),
            timeoutMs
        });

        if (isUsableOriginResponse(piResult.response)) {
            return withOriginHeader(piResult.response, 'pi');
        }

        return builtInFallback(request, 200, 'worker-fallback');
    }
};

function getTimeoutMs(env) {
    const value = Number(env.ORIGIN_TIMEOUT_MS || DEFAULT_ORIGIN_TIMEOUT_MS);
    if (!Number.isFinite(value) || value < 100) {
        return DEFAULT_ORIGIN_TIMEOUT_MS;
    }

    return Math.min(value, 5000);
}

function buildOriginUrl(origin, requestUrl) {
    const base = origin.endsWith('/') ? origin : `${origin}/`;
    const url = new URL(requestUrl.pathname.replace(/^\//, ''), base);
    url.search = requestUrl.search;
    return url;
}

async function fetchOrigin({ request, originUrl, timeoutMs }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const headers = new Headers(request.headers);
        headers.set('x-inazu-worker', 'site-failover');

        const init = {
            method: request.method,
            headers,
            redirect: 'manual',
            signal: controller.signal
        };

        if (!RETRYABLE_METHODS.has(request.method.toUpperCase())) {
            init.body = request.body;
        }

        const response = await fetch(originUrl, init);
        return { response, error: null };
    } catch (error) {
        return { response: null, error };
    } finally {
        clearTimeout(timeout);
    }
}

function isUsableOriginResponse(response) {
    return response && response.status < 500;
}

function withOriginHeader(response, origin) {
    const headers = new Headers(response.headers);
    headers.set('x-inazu-origin', origin);

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
    });
}

function builtInFallback(request, status, origin) {
    const headers = new Headers({
        'cache-control': 'no-store',
        'x-inazu-origin': origin
    });

    if (request.method.toUpperCase() === 'HEAD') {
        return new Response(null, { status, headers });
    }

    headers.set('content-type', 'text/html; charset=utf-8');

    return new Response(`<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>inazu.me fallback</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #0f1115;
      color: #f6f1e8;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    }
    main {
      width: min(680px, calc(100vw - 40px));
    }
    h1 {
      margin: 0 0 16px;
      font-size: clamp(32px, 8vw, 72px);
      letter-spacing: 0;
    }
    p {
      margin: 0 0 12px;
      color: #c9c3b8;
      font-size: 16px;
      line-height: 1.8;
    }
    code {
      color: #8bd3ff;
    }
  </style>
</head>
<body>
  <main>
    <h1>inazu.me</h1>
    <p>現在、home Mac と Raspberry Pi fallback の両方に接続できないため、Cloudflare Worker から最小ページを表示しています。</p>
    <p><code>worker fallback mode</code></p>
  </main>
</body>
</html>
`, { status, headers });
}
