import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateResponseCost, MAX_TOOL_CALLS, MAX_OUTPUT_TOKENS, RESERVATION_MICRO_USD } from '../cost.mjs';

const normalUsage = { input_tokens: 1000, output_tokens: 51, input_tokens_details: { cached_tokens: 300, cache_write_tokens: 400 } };
const response = { model: 'gpt-6-luna-2026-10-14', service_tier: 'default', status: 'completed', usage: normalUsage, output: [] };
const action = (type, status = 'completed') => ({ type: 'web_search_call', status, action: { type } });

test('prices cache reads, writes, uncached input and the full output without per-request rounding', () => {
    assert.deepEqual(estimateResponseCost(response), { costNanoUsd: 108500, uncertaintyNanoUsd: 0 });
    const usage = { ...normalUsage, input_tokens_details: {
        ...normalUsage.input_tokens_details, cache_write_tokens_details: { ttl_12h_tokens: 120, ttl_30m_tokens: 280 }
    } };
    assert.deepEqual(estimateResponseCost({ ...response, service_tier: null, usage }), {
        costNanoUsd: 123500, uncertaintyNanoUsd: 0
    });
    const oneToken = { input_tokens: 1, output_tokens: 0, input_tokens_details: { cache_write_tokens: 1, cached_tokens: 0 } };
    assert.equal(estimateResponseCost({ ...response, usage: oneToken }).costNanoUsd, 125);
});

test('prices the authoritative billable search counter even when actions, queries or citations differ', () => {
    const output = [action('search'), action('search'), action('open_page')];
    for (const n of [0, 1, 3]) {
        assert.deepEqual(estimateResponseCost({ ...response, output, tool_usage: { web_search: { num_requests: n } } }), {
            costNanoUsd: 108500 + n * 10_000_000, uncertaintyNanoUsd: 0
        });
    }
    assert.deepEqual(estimateResponseCost({ ...response, status: 'incomplete', output: null,
        tool_usage: { web_search: { num_requests: 1 } } }), { costNanoUsd: 10108500, uncertaintyNanoUsd: 0 });
});

test('falls back to completed search actions while excluding page actions and reserving for unknown outcomes', () => {
    assert.deepEqual(estimateResponseCost({ ...response, output: [action('search'), action('open_page'), action('find_in_page')] }), {
        costNanoUsd: 10108500, uncertaintyNanoUsd: 0
    });
    assert.deepEqual(estimateResponseCost({ ...response, output: [action('search', 'failed'), action('new_action')] }), {
        costNanoUsd: 108500, uncertaintyNanoUsd: 20000000
    });
    assert.deepEqual(estimateResponseCost({ ...response, status: 'incomplete', output: [action('search')] }), {
        costNanoUsd: 10108500, uncertaintyNanoUsd: 20000000
    });
});

test('reserves the extra possible write cost only when cache-write counts are missing', () => {
    const usage = { input_tokens: 1000, output_tokens: 51, input_tokens_details: { cached_tokens: 300 } };
    assert.deepEqual(estimateResponseCost({ ...response, usage }), { costNanoUsd: 98500, uncertaintyNanoUsd: 17500 });
});

test('long contexts use long input/cache/output rates and the reserve covers all allowed passes', () => {
    const usage = { input_tokens: 272_000, output_tokens: 2, input_tokens_details: { cache_write_tokens: 0, cached_tokens: 0 } };
    assert.equal(estimateResponseCost({ ...response, usage }).costNanoUsd, 272_000 * 100 + 1000);
    assert.equal(estimateResponseCost({ ...response, usage: { ...usage, input_tokens: 272_001 } }).costNanoUsd, 272_001 * 200 + 1500);
    const highestInput = 1_050_000 * (1 + MAX_TOOL_CALLS);
    const upper = estimateResponseCost({ ...response,
        usage: { input_tokens: highestInput, input_tokens_details: { cache_write_tokens: highestInput }, output_tokens: MAX_OUTPUT_TOKENS },
        tool_usage: { web_search: { num_requests: MAX_TOOL_CALLS } }
    });
    assert.equal(upper.costNanoUsd, RESERVATION_MICRO_USD * 1000);
});

test('unsupported pricing, missing usage and inconsistent counters preserve the original hold', () => {
    for (const invalid of [
        { service_tier: 'fast' }, { model: 'other' }, { usage: null },
        { usage: { ...normalUsage, output_tokens: -10 } }, { usage: { ...normalUsage, input_tokens: 600 } },
        { usage: { ...normalUsage, input_tokens_details: { cache_write_tokens: 42, cache_write_tokens_details: { ttl_30m_tokens: 40, ttl_12h_tokens: 5 } } } },
        { tool_usage: { web_search: { num_requests: -1 } } }
    ]) assert.equal(estimateResponseCost({ ...response, ...invalid }), undefined);
});
