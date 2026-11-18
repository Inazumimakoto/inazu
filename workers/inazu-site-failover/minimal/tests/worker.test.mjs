import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, Response as LocalResponse } from 'miniflare';

async function startWorker(t, provider) {
    const { outputFiles } = await build({
        entryPoints: [fileURLToPath(new URL('../worker.mjs', import.meta.url))],
        bundle: true, write: false, format: 'esm', external: ['cloudflare:workers']
    });

    const simulator = new Miniflare({
        cf: false,
        workers: [{
            config: {
                name: 'chat-test', compatibilityDate: '2026-05-09',
                manifest: { mainModule: 'worker.mjs', modules: { 'worker.mjs': { type: 'esm', contents: outputFiles[0].text } } },
                env: {
                    OPEN_API_KEY: { type: 'text', value: 'local-test' },
                    CHAT_LEDGER: { type: 'durable-object', worker: 'chat-test', exportName: 'ChatLedger' }
                },
                exports: { ChatLedger: { type: 'durable-object', storage: 'sqlite' } }
            },
            dev: { outboundService: { type: 'fetcher', handler: provider } }
        }]
    });
    t.after(() => simulator.dispose());
    return simulator;
}

const origin = 'http://localhost';
const usageCounters = { input_tokens: 1000, output_tokens: 200, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } };
function post(simulator, question, accept = 'application/json') {
    return simulator.dispatchFetch(origin + '/api/chat', {
        method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Accept: accept },
        body: JSON.stringify({ question })
    });
}

test('workerd returns the profile and records the generation cost for JSON clients', async t => {
    const answer = 'ネットワーク系の研究をしています。';
    const calls = [];
    const simulator = await startWorker(t, request => {
        calls.push([request.method, request.url]);
        return LocalResponse.json({
            model: 'gpt-6-luna', status: 'completed', usage: usageCounters,
            output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: answer + '\n[[inazu:profile]] ネットワーク系の研究' }] }]
        });
    });
    const reply = await post(simulator, '何を研究していますか？');
    assert.deepEqual(calls, [['POST', 'https://api.openai.com/v1/responses']]);
    assert.equal(reply.status, 200);
    const result = await reply.json();
    assert.equal(result.answer, answer);
    assert.equal(result.section, 'profile');
    assert.equal(result.responseCostUsd, 0.0002);
    assert.equal(result.usage.estimatedUsd, 0.0002);
    const usage = await (await simulator.dispatchFetch(origin + '/api/usage')).json();
    assert.equal(usage.available, true);
    assert.equal(usage.estimatedUsd, result.usage.estimatedUsd);
    assert.equal(usage.reservedUsd, 0);
});

test('browser stream delivers a tool action before the answer, then settles the search fee once', { timeout: 10_000 }, async t => {
    const url = 'https://example.org/document';
    const call = { type: 'web_search_call', id: 'ws_1', status: 'completed', action: { type: 'search', query: '公開文書' } };
    const title = '公開文書';
    const citation = { type: 'url_citation', start_index: 0, end_index: 4, url, title };
    const message = { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '公開文書を参照しました。', annotations: [citation] }] };
    const completed = {
        status: 'completed', model: 'gpt-6-luna', output: [call, message],
        usage: usageCounters, tool_usage: { web_search: { num_requests: 1 } }
    };
    let finish;
    const encodeEvent = event => new TextEncoder().encode('data: ' + JSON.stringify(event) + '\n\n');
    const simulator = await startWorker(t, async request => {
        assert.equal((await request.json()).stream, true);
        return new LocalResponse(new ReadableStream({ start(controller) {
            controller.enqueue(encodeEvent({ type: 'response.output_item.done', item: call }));
            finish = () => {
                controller.enqueue(encodeEvent({ type: 'response.completed', response: completed }));
                controller.close();
            };
        } }), { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const response = await post(simulator, '公開文書を検索して', 'application/x-ndjson');
    assert.match(response.headers.get('content-type'), /application\/x-ndjson/);
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let events = '';
    while (!events.includes('\n')) events += (await reader.read()).value;
    const first = JSON.parse(events.trim());
    assert.equal(first.type, 'tool');
    assert.equal(first.action.type, 'search');
    finish();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        events += value;
    }
    const last = events.trim().split('\n').map(line => JSON.parse(line)).at(-1);
    assert.equal(last.type, 'result');
    assert.equal(last.sources[0].url, url);
    assert.equal(last.responseCostUsd, 0.0102);
    assert.equal(last.usage.estimatedUsd, 0.0102);
    assert.equal(last.usage.reservedUsd, 0);
});
