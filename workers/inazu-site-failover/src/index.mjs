const DEFAULT_MAC_ORIGIN = 'https://mac-site-origin.inazu.me';
const DEFAULT_PI_ORIGIN = 'https://pi-site-origin.inazu.me';
const DEFAULT_ORIGIN_TIMEOUT_MS = 1500;

const RETRYABLE_METHODS = new Set(['GET', 'HEAD']);

// Admin traffic must never fail over: the Pi knows nothing about admin
// routes (it would answer 404), and uploads can legitimately take far
// longer than the public-page timeout while the Mac re-encodes photos.
const ADMIN_PATH_PREFIXES = ['/admin/', '/api/admin/'];
const ADMIN_TIMEOUT_MS = 60000;

function isAdminPath(pathname) {
    return ADMIN_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export default {
    async fetch(request, env) {
        const requestUrl = new URL(request.url);

        if (isAdminPath(requestUrl.pathname)) {
            const macResult = await fetchOrigin({
                request,
                originUrl: buildOriginUrl(env.MAC_ORIGIN || DEFAULT_MAC_ORIGIN, requestUrl),
                timeoutMs: ADMIN_TIMEOUT_MS
            });

            return macResult.response
                ? withOriginHeader(macResult.response, 'mac')
                : builtInFallback(request, 503, 'mac-unreachable');
        }

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
    :root {
      color-scheme: dark;
      --bg: #101214;
      --panel: #171a1f;
      --panel-2: #1f232a;
      --text: #f7f1e8;
      --muted: #c8c0b5;
      --subtle: #8d8790;
      --line: #343943;
      --accent: #8bd3ff;
      --warn: #ffd48a;
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      line-height: 1.65;
    }
    a {
      color: inherit;
      text-decoration: none;
    }
    .shell {
      width: min(1040px, calc(100vw - 40px));
      margin: 0 auto;
      padding: 40px 0 56px;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      padding-bottom: 56px;
    }
    .mark {
      font-size: 20px;
      font-weight: 800;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      color: var(--warn);
      font: 700 13px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--warn);
    }
    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1.3fr) minmax(280px, 0.7fr);
      gap: 40px;
      align-items: end;
      padding-bottom: 56px;
      border-bottom: 1px solid var(--line);
    }
    main {
      display: block;
    }
    h1 {
      margin: 0;
      font-size: clamp(54px, 12vw, 132px);
      line-height: 0.9;
      letter-spacing: 0;
    }
    .lead {
      max-width: 680px;
      margin: 28px 0 0;
      color: var(--muted);
      font-size: clamp(17px, 2.4vw, 22px);
      line-height: 1.8;
    }
    .note {
      padding: 22px;
      background: var(--panel);
      border: 1px solid var(--line);
    }
    .note strong {
      display: block;
      margin-bottom: 10px;
      color: var(--text);
      font-size: 16px;
    }
    .note p {
      margin: 0;
      color: var(--muted);
      font-size: 14px;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
      padding-top: 28px;
    }
    section {
      padding: 28px;
      background: var(--panel);
      border: 1px solid var(--line);
    }
    .wide {
      grid-column: 1 / -1;
    }
    h2 {
      margin: 0 0 14px;
      font-size: 18px;
    }
    p {
      margin: 0;
      color: var(--muted);
    }
    .list {
      display: grid;
      gap: 10px;
      margin: 18px 0 0;
      padding: 0;
      list-style: none;
    }
    .list li {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      padding-top: 10px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 14px;
    }
    .list span:first-child {
      color: var(--subtle);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
    }
    .flow {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 18px;
      color: var(--muted);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 13px;
    }
    .step {
      padding: 8px 10px;
      background: var(--panel-2);
      border: 1px solid var(--line);
    }
    .arrow {
      align-self: center;
      color: var(--accent);
    }
    .links {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 18px;
    }
    .link {
      padding: 10px 12px;
      background: var(--panel-2);
      border: 1px solid var(--line);
      color: var(--text);
      font-size: 14px;
    }
    footer {
      padding-top: 28px;
      color: var(--subtle);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
    }
    code {
      color: var(--accent);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    @media (max-width: 760px) {
      .shell {
        width: min(100% - 28px, 1040px);
        padding-top: 28px;
      }
      header {
        align-items: flex-start;
        flex-direction: column;
        padding-bottom: 42px;
      }
      .hero {
        grid-template-columns: 1fr;
        gap: 24px;
        padding-bottom: 40px;
      }
      .grid {
        grid-template-columns: 1fr;
      }
      section {
        padding: 22px;
      }
      .wide {
        grid-column: auto;
      }
      .list li {
        flex-direction: column;
        gap: 4px;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <a class="mark" href="/">inazu.me</a>
      <div class="status"><span class="dot"></span>worker fallback mode</div>
    </header>

    <main>
      <div class="hero">
        <div>
          <h1>inazu.me</h1>
          <p class="lead">
            home Mac と Raspberry Pi fallback の両方に接続できないため、
            Cloudflare Worker から最小プロフィールを表示しています。
          </p>
        </div>

        <aside class="note">
          <strong>現在の状態</strong>
          <p>
            Worker が Mac origin と Pi origin の両方から正常な応答を受け取れませんでした。
            このページは Cloudflare edge だけで返しています。
          </p>
        </aside>
      </div>

      <div class="grid">
        <section>
          <h2>Profile</h2>
          <p>
            4月からM1です。ネットワーク系の研究をしています。AIとセキュリティが好きで、
            ローカルLLMや変なWebアプリをよく作っています。
          </p>
          <ul class="list">
            <li><span>focus</span><strong>network / security / local LLM</strong></li>
            <li><span>site</span><strong>Cloudflare Worker fallback</strong></li>
            <li><span>mode</span><strong>last resort</strong></li>
          </ul>
        </section>

        <section>
          <h2>What happened?</h2>
          <p>
            普段の <code>inazu.me</code> は自宅の Mac で動きます。
            Mac が落ちた時は Pi が肩代わりしますが、今はその Pi にも届いていません。
          </p>
          <div class="flow" aria-label="fallback flow">
            <span class="step">User</span>
            <span class="arrow">-&gt;</span>
            <span class="step">Worker</span>
            <span class="arrow">-/-></span>
            <span class="step">Mac / Pi</span>
          </div>
        </section>

        <section class="wide">
          <h2>Links</h2>
          <p>
            本番ページが復帰するまでは、外部リンクだけ置いておきます。
            <code>chat.inazu.me</code> は home Mac 側のローカルLLMに依存しているため、今は使えない可能性があります。
          </p>
          <div class="links">
            <a class="link" href="https://github.com/Inazumimakoto" target="_blank" rel="noreferrer">GitHub</a>
            <a class="link" href="https://x.com/makoto0109a" target="_blank" rel="noreferrer">X</a>
            <a class="link" href="https://instagram.com/inazutagram" target="_blank" rel="noreferrer">Instagram</a>
            <a class="link" href="https://zenn.dev/inazumimakoto" target="_blank" rel="noreferrer">Zenn</a>
          </div>
        </section>
      </div>
    </main>

    <footer>
      served by Cloudflare Worker / no origin available
    </footer>
  </div>
</body>
</html>
`, { status, headers });
}
