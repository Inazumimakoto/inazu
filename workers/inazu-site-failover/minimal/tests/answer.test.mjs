import test from 'node:test';
import assert from 'node:assert/strict';
import { answerQuestion } from '../answer.mjs';
import content from '../content.json' with { type: 'json' };
import news from '../../../../public/assets/news.json' with { type: 'json' };

const question = 'どんな研究をしていますか？';
const key = 'test-credential';
const reply = { answer: 'ネットワーク系の研究をしています。', section: 'profile', evidence: 'ネットワーク系の研究' };
const message = value => ({
    type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(value) }]
});
const completed = {
    model: 'gpt-6-luna', service_tier: 'default', status: 'completed',
    usage: { input_tokens: 1000, output_tokens: 51, input_tokens_details: { cached_tokens: 300, cache_write_tokens: 400 } },
    output: [message(reply)]
};
const withResult = data => answerQuestion(question, key, async () => Response.json(data));

test('single bounded request carries only the public corpus and the question to OpenAI', async () => {
    let calls = 0;
    const longQuestion = '🌱'.repeat(512); // Exactly 2 KiB of UTF-8.
    const result = await answerQuestion(longQuestion, key, async (url, options) => {
        calls++;
        assert.equal(url, 'https://api.openai.com/v1/responses');
        assert.equal(options.redirect, 'error');
        assert.equal(options.headers.Authorization, 'Bearer ' + key);
        assert.equal(options.body.includes(key), false);
        assert.ok(Buffer.byteLength(options.body) <= 32_768);
        const body = JSON.parse(options.body);
        assert.equal(body.max_output_tokens, 384);
        assert.equal(body.model, completed.model);
        assert.equal(body.service_tier, 'default');
        assert.equal(body.store, false);
        assert.deepEqual(body.reasoning, { effort: 'none' });
        assert.equal(body.tools, undefined);
        assert.equal(body.previous_response_id, undefined);
        assert.deepEqual(body.input[1], { role: 'user', content: longQuestion });
        const corpus = JSON.parse(body.input[0].content.split('\n').slice(1).join('\n'));
        assert.deepEqual(corpus, { ...content, news: news.entries });
        assert.equal(body.text.format.strict, true);
        assert.deepEqual(body.text.format.schema.properties.section.enum.toSorted(), Object.keys(corpus).toSorted());
        return Response.json(completed);
    });
    assert.equal(calls, 1);
    // 300 ordinary inputs, 300 cache reads, 400 cache writes, 51 output tokens.
    assert.deepEqual(result, { answer: reply.answer, section: 'profile', costMicroUsd: 109 });
});

test('invalid inputs do not start generation', async () => {
    let calls = 0;
    for (const [value, credential] of [['🌱'.repeat(513), key], ['  ', key], [null, key], [question, '']]) {
        await assert.rejects(answerQuestion(value, credential, () => { calls++; }), { costMicroUsd: 0 });
    }
    assert.equal(calls, 0);
});

test('bounds the complete serialized request including JSON escape sequences', async () => {
    let calls = 0;
    await assert.rejects(answerQuestion('\u0001'.repeat(2048), key, () => { calls++; }), {
        code: 'request_too_large', costMicroUsd: 0
    });
    assert.equal(calls, 0);
});

test('ungrounded answers give the site fallback', async () => {
    for (const evidence of ['', 'この根拠は公開されていません', 'affiliation']) {
        const result = await withResult({ ...completed, output: [message({ ...reply, evidence })] });
        assert.equal(result.section, 'profile');
        assert.match(result.answer, /公開プロフィール/);
        assert.equal(result.costMicroUsd, 109);
    }
});

test('invalid output and refusal preserve measured charges', async () => {
    for (const result of [
        { ...completed, status: 'incomplete' },
        { ...completed, output: [message({ ...reply, section: 'show' })] },
        { ...completed, output: [{ ...message(reply), content: [{ type: 'refusal', refusal: 'withheld text' }] }] },
        { ...completed, output: [{ ...message(reply), content: [{ type: 'output_text', text: 'broken JSON' }] }] }
    ]) {
        await assert.rejects(withResult(result), err => err.costMicroUsd === 109 && !err.message.includes('withheld'));
    }
});

test('estimates with missing cache counters, a dated snapshot, or an omitted service tier', async () => {
    const totals = { input_tokens: 1000, output_tokens: 51 };
    for (const [usage, expected] of [
        [totals, 151],
        [{ ...totals, input_tokens_details: { cached_tokens: 300 } }, 116],
        [{ ...totals, input_tokens_details: { cached_tokens: 300, cache_write_tokens: 400,
            cache_write_tokens_details: { ttl_12h_tokens: 120, ttl_30m_tokens: 280 } } }, 124]
    ]) {
        const result = await withResult({ ...completed, model: 'gpt-6-luna-2026-10-14', service_tier: null, usage });
        assert.equal(result.costMicroUsd, expected);
    }
    assert.equal((await withResult({ ...completed, service_tier: undefined })).costMicroUsd, 109);
});

test('valid answer is available while unknowable cost retains the hold', async () => {
    for (const result of [
        { ...completed, usage: null },
        { ...completed, usage: { ...completed.usage, input_tokens: 100 } },
        { ...completed, service_tier: 'fast' },
        { ...completed, model: 'another-model' }
    ]) {
        assert.deepEqual(await withResult(result), { answer: reply.answer, section: 'profile', costMicroUsd: undefined });
    }
});

test('unreadable provider responses keep their reservation and hide parse errors', async () => {
    await assert.rejects(answerQuestion(question, key, async () => new Response('private upstream response')), err => {
        return err.costMicroUsd === undefined && err.code === 'invalid_upstream_response' && !err.message.includes('private');
    });
});

test('provider failures never retry, read an HTTP error body or reveal exception details', async () => {
    for (const [status, cost] of [[401, 0], [429, 0], [503, undefined]]) {
        let calls = 0;
        await assert.rejects(answerQuestion(question, key, async () => {
            calls++;
            return { ok: false, status, json() { assert.fail('read HTTP error body'); } };
        }), err => err.code === 'upstream_http' && err.upstreamStatus === status && err.costMicroUsd === cost);
        assert.equal(calls, 1);
    }
    let calls = 0;
    await assert.rejects(answerQuestion(question, key, async () => {
        calls++;
        throw new Error(key + question);
    }), err => err.costMicroUsd === undefined && err.message === 'upstream_unreachable' && !err.cause);
    assert.equal(calls, 1);
});
