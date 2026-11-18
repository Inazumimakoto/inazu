import test from 'node:test';
import assert from 'node:assert/strict';
import { answerQuestion } from '../answer.mjs';
import content from '../content.json' with { type: 'json' };
import news from '../../../../public/assets/news.json' with { type: 'json' };

const question = 'どんな研究をしていますか？';
const key = 'test-credential';
const reply = 'ネットワーク系の研究をしています。';
const message = (text, annotations = []) => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text, annotations }] });
const completed = {
    model: 'gpt-6-luna', service_tier: 'default', status: 'completed',
    usage: { input_tokens: 1000, output_tokens: 51, input_tokens_details: { cached_tokens: 300, cache_write_tokens: 400 } },
    output: [message(reply + '\n[[inazu:profile]] ネットワーク系の研究')]
};
const url = 'https://example.org/page';
const lookup = { id: 'lookup', type: 'web_search_call', status: 'completed', action: {
    type: 'search', queries: ['some\ntext', '次の検索'], sources: [
        { type: 'url', url }, { type: 'url', url: 'https://example.org/other' }, { type: 'url', url: 'ftp://bad.com' }
    ]
} };
const opened = { id: 'page', type: 'web_search_call', status: 'completed', action: { type: 'open_page', url } };
const found = { id: 'find', type: 'web_search_call', status: 'completed', action: { type: 'find_in_page', url, pattern: '開催日' } };
const summary = '📅開催日が決まりました。';
const cite = { type: 'url_citation', start_index: 1, end_index: 4, url, title: 'イベント開催日' };
const withResult = (data, prompt = question) => answerQuestion(prompt, key, async () => Response.json(data));

test('one bounded Responses call carries only the public corpus and the question, with hosted web access', async () => {
    let calls = 0;
    const longQuestion = '🌱'.repeat(1024);
    const result = await answerQuestion(longQuestion, key, async (target, options) => {
        calls++;
        assert.equal(target, 'https://api.openai.com/v1/responses');
        assert.equal(options.redirect, 'manual');
        assert.equal(options.headers.Authorization, 'Bearer ' + key);
        assert.equal(options.body.includes(key), false);
        assert.ok(Buffer.byteLength(options.body) <= 49_152);
        const body = JSON.parse(options.body);
        assert.equal(body.model, completed.model);
        assert.equal(body.service_tier, 'default');
        assert.equal(body.store, false);
        assert.equal(body.max_output_tokens, 2048);
        assert.equal(body.max_tool_calls, 3);
        assert.equal(body.tool_choice, 'auto');
        assert.deepEqual(body.reasoning, { effort: 'low' });
        assert.deepEqual(body.tools, [{ type: 'web_search', search_context_size: 'low' }]);
        assert.deepEqual(body.include, ['web_search_call.action.sources']);
        assert.equal(body.previous_response_id, undefined);
        assert.deepEqual(body.input[1], { role: 'user', content: longQuestion });
        const corpus = JSON.parse(body.input[0].content.split('\n').slice(1).join('\n'));
        assert.deepEqual(corpus, { ...content, news: news.entries });
        return Response.json(completed);
    });
    assert.equal(calls, 1);
    assert.deepEqual(result, {
        answer: reply, section: 'profile', actions: [], sources: [], citations: [],
        costNanoUsd: 108_500, uncertaintyNanoUsd: 0
    });
});

test('invalid question or missing key does not start generation', async () => {
    let calls = 0;
    for (const [value, credential] of [['a'.repeat(2049), key], ['  ', key], [null, key], [question, '']]) {
        await assert.rejects(answerQuestion(value, credential, () => { calls++; }), { costNanoUsd: 0 });
    }
    assert.equal(calls, 0);
});

test('private addresses, embedded credentials and non-HTTP URLs are not forwarded', async () => {
    let calls = 0;
    for (const candidate of [
        'https://user:password@example.org/page', 'http://intranet', 'http://my.local', 'http://0x7f000001/page',
        'https://169.254.169.254/', 'http://[::ffff:127.0.0.1]/', 'http://[fc00::1]/',
        'https://example.org/path?api_key=private', 'file:///path', 'ftp://example.org/file'
    ]) {
        const result = await answerQuestion('次のURLを読んで ' + candidate, key, () => { calls++; });
        assert.equal(result.costNanoUsd, 0);
        assert.match(result.answer, /公開HTTP/);
        assert.deepEqual(result.actions, []);
    }
    assert.equal(calls, 0);
});

test('profile quote is checked against its section; ordinary questions can be answered freely', async () => {
    for (const footer of ['[[inazu:profile]] この根拠は公開されていません', '[[inazu:unknown]] 名前', '[[inazu:profile]] ']) {
        const result = await withResult({ ...completed, output: [message('偽の回答\n' + footer)] });
        assert.equal(result.section, null);
        assert.match(result.answer, /公開プロフィール/);
    }
    const result = await withResult({ ...completed, output: [message('2 + 2 = 4')] }, '2+2?');
    assert.equal(result.answer, '2 + 2 = 4');
    assert.deepEqual(result.actions, []);
});

test('URL reading requires an actual open and a citation for the requested page', async () => {
    for (const [calls, annotations] of [
        [[], []], [[lookup], [cite]], [[opened], []],
        [[opened], [{ ...cite, url: 'https://example.org/another-article' }]],
        [[{ ...opened, status: 'failed' }], [cite]],
        [[opened], [{ ...cite, start_index: 999, end_index: 1111 }]]
    ]) {
        const result = await withResult({ ...completed, output: [...calls, message('推測', annotations)] }, url + ' を読んで');
        assert.match(result.answer, /確認できなかった/);
        assert.deepEqual(result.citations, []);
    }
    let fetches = 0;
    const tracked = url + '?utm_source=chatgpt.com';
    const result = await answerQuestion('「' + url + '#time」を要約して', key, async (target, options) => {
        fetches++;
        assert.equal(target, 'https://api.openai.com/v1/responses');
        assert.deepEqual(JSON.parse(options.body).tool_choice, { type: 'web_search' });
        return Response.json({ ...completed, output: [lookup, opened, found, message(summary, [
            { ...cite, url: tracked }, { ...cite, url: 'javascript:alert(1)' }
        ])] });
    });
    assert.equal(fetches, 1);
    assert.equal(result.answer, summary);
    assert.equal(result.section, null);
    assert.deepEqual(result.citations, [{ start: 2, end: 5, url: tracked }]);
    assert.equal(result.answer.slice(result.citations[0].start, result.citations[0].end), '開催日');
    assert.deepEqual(result.actions, [{ type: 'search', query: 'some text / 次の検索' }, { type: 'open', url }, { type: 'find', url, query: '開催日' }]);
    assert.deepEqual(result.sources, [
        { title: cite.title, url: tracked },
        { title: 'example.org', url: 'https://example.org/other' }
    ]);
    assert.equal(result.costNanoUsd, 10_108_500);
});

test('stream forwards actual actions before the final result, even with split UTF-8 and CRLF', async () => {
    const encoder = new TextEncoder();
    const makeFrame = obj => 'event: ' + obj.type + '\r\ndata: ' + JSON.stringify(obj) + '\r\n\r\n';
    const lookupFrame = makeFrame({ type: 'response.output_item.done', item: lookup });
    const resultData = { ...completed, output: [lookup, message(summary, [cite])] };
    let release;
    const proceed = new Promise(resolve => { release = resolve; });
    let observed;
    const firstAction = new Promise(resolve => { observed = resolve; });
    const actual = [];
    const resultPromise = answerQuestion(question, key, async (_, options) => {
        assert.equal(JSON.parse(options.body).stream, true);
        return new Response(new ReadableStream({ async start(controller) {
            const bytes = encoder.encode(': keepalive\r\n\r\n' + lookupFrame + lookupFrame);
            for (const b of bytes) controller.enqueue(Uint8Array.of(b));
            await proceed;
            controller.enqueue(encoder.encode(makeFrame({ type: 'response.completed', response: resultData })));
            controller.close();
        } }), { headers: { 'Content-Type': 'text/event-stream' } });
    }, action => { actual.push(action); observed(); });
    await firstAction;
    assert.deepEqual(actual, [{ type: 'search', query: 'some text / 次の検索' }]);
    release();
    const result = await resultPromise;
    assert.equal(result.answer, summary);
    assert.deepEqual(result.actions, actual);
});

test('incomplete and invalid outputs preserve measured charges; unknown usage retains the reservation', async () => {
    for (const data of [
        { ...completed, status: 'incomplete' },
        { ...completed, output: [message('')] },
        { ...completed, output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'withheld' }] }] }
    ]) {
        await assert.rejects(withResult(data), err => err.costNanoUsd === 108_500 && !err.message.includes('withheld'));
    }
    const result = await withResult({ ...completed, usage: null });
    assert.equal(result.answer, reply);
    assert.equal(result.costNanoUsd, undefined);
});

test('provider errors and truncated or oversized streams retain the right hold without exposing upstream text', async () => {
    for (const [status, cost] of [[307, undefined], [401, 0], [429, 0], [503, undefined]]) {
        let calls = 0;
        await assert.rejects(answerQuestion(question, key, async () => {
            calls++;
            return { ok: false, status, json() { assert.fail('read HTTP error body'); } };
        }), err => err.code === 'upstream_http' && err.upstreamStatus === status && err.costNanoUsd === cost);
        assert.equal(calls, 1);
    }
    for (const [body, type] of [
        ['private upstream response', 'application/json'],
        ['data: {"type":"response.created"}\n\n', 'text/event-stream'],
        ['data: ' + 'a'.repeat(1024 * 1024), 'text/event-stream']
    ]) {
        await assert.rejects(answerQuestion(question, key, async () => new Response(body, { headers: { 'Content-Type': type } }), () => {}), {
            code: 'invalid_upstream_response', message: 'invalid_upstream_response'
        });
    }
    await assert.rejects(answerQuestion(question, key, async () => { throw new Error(key + question); }), {
        code: 'upstream_unreachable', message: 'upstream_unreachable'
    });
});
