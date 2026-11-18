import { answerQuestion } from './answer.mjs';
export { ChatLedger } from './ledger.mjs';

const MAX_BODY_BYTES = 2048;
const MAX_QUESTION_LENGTH = 300;
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

async function handleApi(request, env, url) {
    const isUsage = url.pathname === '/api/usage';
    const method = isUsage ? 'GET' : 'POST';
    if (request.method !== method) return json({ error: '対応していないリクエストです。' }, 405, { Allow: method });
    const ledger = env.CHAT_LEDGER.getByName('portfolio');
    if (isUsage) return json({ ...await ledger.getUsage(), available: Boolean(env.OPENAI_API_KEY) });

    if (request.headers.get('Origin') !== url.origin) return json({ error: 'サイトから送信してください。' }, 403);
    if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        return json({ error: 'JSONで送信してください。' }, 415);
    }
    const question = await readQuestion(request);
    if (!question) return json({ error: '質問は1〜300文字で入力してください。' }, 400);
    if (!env.OPENAI_API_KEY) return json({ error: 'AIは準備中です。公開プロフィールを読めます。' }, 503);

    const admission = await ledger.reserve(await clientKey(request, env.OPENAI_API_KEY));
    if (!admission.ok) {
        return json({ error: limitMessages[admission.reason], usage: admission.usage }, 429, {
            'Retry-After': String(admission.retryAfter)
        });
    }

    let result;
    try {
        result = await answerQuestion(question, env.OPENAI_API_KEY);
    } catch (error) {
        // Release the answer slot even if the provider could have charged for a timeout.
        await ledger.settle(admission.reservation, error.costMicroUsd ?? null, false);
        console.warn('Portfolio answer unavailable', {
            code: error.code ?? 'model_error', upstreamStatus: error.upstreamStatus ?? null
        });
        return json({ error: '今はAIから回答を取得できません。しばらくしてからもう一度お試しください。' }, 502);
    }
    const usage = await ledger.settle(admission.reservation, result.costMicroUsd ?? null);
    return json({ answer: result.answer, section: result.section, usage });
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname !== '/api/chat' && url.pathname !== '/api/usage') return env.ASSETS.fetch(request);
        try {
            return await handleApi(request, env, url);
        } catch {
            return json({ error: 'チャットに接続できません。少し待ってからもう一度お試しください。' }, 503);
        }
    }
};
