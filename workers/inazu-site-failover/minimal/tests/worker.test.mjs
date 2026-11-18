import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, Response as LocalResponse } from 'miniflare';

test('workerd posts to the provider and records the returned token usage', async t => {
    const { outputFiles } = await build({
        entryPoints: [fileURLToPath(new URL('../worker.mjs', import.meta.url))],
        bundle: true, write: false, format: 'esm', external: ['cloudflare:workers']
    });

    const answer = 'ネットワーク系の研究をしています。';
    const calls = [];
    function provider(request) {
        calls.push([request.method, request.url]);
        const reply = { answer, evidence: answer, section: 'profile' };
        return LocalResponse.json({
            status: 'completed',
            output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(reply) }] }],
            usage: { input_tokens: 1000, output_tokens: 200, input_tokens_details: { cache_write_tokens: 0 } }
        });
    }
    const simulator = new Miniflare({
        cf: false,
        workers: [{
            config: {
                name: 'chat-test', compatibilityDate: '2026-05-09',
                manifest: { mainModule: 'worker.mjs', modules: { 'worker.mjs': { type: 'esm', contents: outputFiles[0].text } } },
                env: {
                    OPENAI_API_KEY: { type: 'text', value: 'local-test' },
                    CHAT_LEDGER: { type: 'durable-object', worker: 'chat-test', exportName: 'ChatLedger' }
                },
                exports: { ChatLedger: { type: 'durable-object', storage: 'sqlite' } }
            },
            dev: { outboundService: { type: 'fetcher', handler: provider } }
        }]
    });
    t.after(() => simulator.dispose());
    const origin = 'http://localhost';
    const reply = await simulator.dispatchFetch(origin + '/api/chat', {
        method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: '何を研究していますか？' })
    });
    assert.deepEqual(calls, [['POST', 'https://api.openai.com/v1/responses']]);
    assert.equal(reply.status, 200);
    const result = await reply.json();
    assert.equal(result.answer, answer);
    assert.equal(result.section, 'profile');
    assert.equal(result.usage.estimatedUsd, 0.0002);
    const usage = await (await simulator.dispatchFetch(origin + '/api/usage')).json();
    assert.equal(usage.estimatedUsd, result.usage.estimatedUsd);
    assert.equal(usage.reservedUsd, 0);
});
