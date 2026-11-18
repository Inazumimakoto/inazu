import { answerQuestion } from './answer.mjs';
export { ChatLedger } from './ledger.mjs';

const MAX_BODY_BYTES = 16_384;
const MAX_QUESTION_LENGTH = 2_048;
const connectionError = 'チャットに接続できません。少し待ってからもう一度お試しください。';
const limitMessages = {
    rate: '短時間に質問が集中しています。1分ほど待ってください。',
    daily: '本日の受付上限に達しました。日本時間の午前0時に再開します。',
    budget: '今月のチャット予算の残りが少ないため、現在は質問を受け付けていません。'
};

function json(data, status = 200, headers = {}) {
    return Response.json(data, { status, headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...headers
    } });
}

async function readQuestion(request) {
    if (!request.body) return null;
    const reader = request.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0;
    let body = '';
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > MAX_BODY_BYTES) {
                await reader.cancel();
                return null;
            }
            body += decoder.decode(value, { stream: true });
        }
        const data = JSON.parse(body + decoder.decode());
        if (typeof data?.question !== 'string') return null;
        const question = data.question.trim();
        return question.length > 0 && question.length <= MAX_QUESTION_LENGTH ? question : null;
    } catch {
        return null;
    } finally {
        reader.releaseLock();
    }
}

async function clientKey(request, secret) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    // Only trust the address set by Cloudflare; missing addresses share one quota.
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const digest = await crypto.subtle.sign('HMAC', key, encoder.encode('portfolio-chat/ip/' + ip));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function streamAnswer(generate, ctx) {
    let cancelled = false;
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        start(controller) {
            function send(event) {
                if (!cancelled) controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
            }
            async function run() {
                try {
                    const reply = await generate(action => send({ type: 'tool', action }));
                    send({ type: reply.error ? 'error' : 'result', ...reply });
                } catch {
                    send({ type: 'error', error: connectionError });
                } finally {
                    if (!cancelled) controller.close();
                }
            }
            // Finish accounting even if the visitor navigates away while the model is working.
            ctx.waitUntil(run());
        },
        cancel() { cancelled = true; }
    });
    return new Response(stream, { headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        'X-Content-Type-Options': 'nosniff',
        'Vary': 'Accept'
    } });
}

async function handleApi(request, env, url, ctx) {
    const isUsage = url.pathname === '/api/usage';
    const method = isUsage ? 'GET' : 'POST';
    if (request.method !== method) return json({ error: '対応していないリクエストです。' }, 405, { Allow: method });
    const ledger = env.CHAT_LEDGER.getByName('portfolio');
    const apiKey = env.OPENAI_API_KEY || env.OPEN_API_KEY;
    if (isUsage) return json({ ...await ledger.getUsage(), available: Boolean(apiKey) });

    if (request.headers.get('Origin') !== url.origin) return json({ error: 'サイトから送信してください。' }, 403);
    if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        return json({ error: 'JSONで送信してください。' }, 415);
    }
    const question = await readQuestion(request);
    if (!question) return json({ error: '質問は1〜2,048文字で入力してください。' }, 400);
    if (!apiKey) return json({ error: 'AIは準備中です。公開プロフィールを読めます。' }, 503);

    const admission = await ledger.reserveNano(await clientKey(request, apiKey));
    if (!admission.ok) {
        return json({ error: limitMessages[admission.reason], usage: admission.usage }, 429, {
            'Retry-After': String(admission.retryAfter)
        });
    }

    async function generate(onTool) {
        let result;
        try {
            result = await answerQuestion(question, apiKey, fetch, onTool);
        } catch (error) {
            // Release the answer slot even if the provider could have charged for a timeout.
            const usage = await ledger.settleNano(admission.reservation, error.costNanoUsd ?? null, false, error.uncertaintyNanoUsd ?? 0);
            console.warn('Portfolio answer unavailable', {
                code: error.code ?? 'model_error', upstreamStatus: error.upstreamStatus ?? null
            });
            return { error: '今はAIから回答を取得できません。しばらくしてからもう一度お試しください。', usage };
        }
        const usage = await ledger.settleNano(admission.reservation, result.costNanoUsd ?? null, true, result.uncertaintyNanoUsd ?? 0);
        return {
            answer: result.answer, section: result.section,
            actions: result.actions, sources: result.sources, citations: result.citations,
            responseCostUsd: result.costNanoUsd == null ? null : result.costNanoUsd / 1e9,
            usage
        };
    }
    const accepts = request.headers.get('Accept') ?? '';
    if (accepts.split(',').some(type => type.trim().split(';')[0] === 'application/x-ndjson')) {
        return streamAnswer(generate, ctx);
    }
    const reply = await generate();
    return json(reply, reply.error ? 502 : 200, { Vary: 'Accept' });
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        if (url.pathname !== '/api/chat' && url.pathname !== '/api/usage') return env.ASSETS.fetch(request);
        try {
            return await handleApi(request, env, url, ctx);
        } catch {
            return json({ error: connectionError }, 503);
        }
    }
};
