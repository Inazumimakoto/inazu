// Global Standard GPT-6 Luna prices in integer billionths of a US dollar.
// https://developers.openai.com/api/docs/models/gpt-6-luna
// https://developers.openai.com/api/docs/pricing
export const MAX_TOOL_CALLS = 3;
export const MAX_OUTPUT_TOKENS = 2048;
const INPUT = 100;
const CACHE_READ = 10;
const WRITE_30M = 125;
const WRITE_12H = 250;
const OUTPUT = 500;
const SEARCH = 10_000_000;
const LONG_CONTEXT_THRESHOLD = 272_000;
const CONTEXT = 1_050_000;

// A tool run can include the initial inference and one continuation per tool.
// Use the model's full context on every pass. The hosted search window (128k)
// and the serialized request bound make ordinary charges considerably smaller.
// Only the default 30m write policy and global Standard endpoint are requested.
const maxAggregateInput = CONTEXT * (1 + MAX_TOOL_CALLS);
export const RESERVATION_MICRO_USD = Math.ceil((
    maxAggregateInput * WRITE_30M * 2 + MAX_OUTPUT_TOKENS * OUTPUT * 1.5 + MAX_TOOL_CALLS * SEARCH
) / 1000);

function count(value) {
    return Number.isSafeInteger(value) && value >= 0;
}

function searchUsage(result) {
    // The provider excludes discounted searches and non-billable page actions.
    // https://developers.openai.com/api/reference/resources/responses/methods/create#response-tool_usage
    const metered = result.tool_usage?.web_search?.num_requests;
    if (metered != null) {
        if (!count(metered) || !Number.isSafeInteger(metered * SEARCH)) return;
        return { billable: metered, uncertain: 0 };
    }
    // Older responses may omit hosted-tool metering. Use observed searches at
    // list price, and retain room for calls whose action or outcome is unknown.
    if (!Array.isArray(result.output)) return { billable: 0, uncertain: MAX_TOOL_CALLS };
    const calls = result.output.filter(item => item?.type === 'web_search_call');
    let billable = 0;
    let free = 0;
    for (const call of calls) {
        if (call.action?.type === 'open_page' || call.action?.type === 'find_in_page') free++;
        if (call.action?.type === 'search' && call.status === 'completed') billable++;
    }
    const possible = result.status === 'completed' ? calls.length : Math.max(MAX_TOOL_CALLS, calls.length);
    return { billable, uncertain: possible - free - billable };
}

export function estimateResponseCost(result) {
    if ((result?.service_tier ?? 'default') !== 'default' ||
        !/^gpt-6-luna(?:-\d{4}-\d{2}-\d{2})?$/.test(result?.model ?? 'gpt-6-luna')) return;
    const usage = result?.usage;
    const input = usage?.input_tokens;
    const output = usage?.output_tokens;
    if (!count(input) || !count(output) || input > maxAggregateInput || output > MAX_OUTPUT_TOKENS) return;

    const details = usage.input_tokens_details;
    const read = details?.cached_tokens ?? 0;
    const lifetimes = details?.cache_write_tokens_details;
    const extended = lifetimes?.ttl_12h_tokens ?? 0;
    const short = lifetimes?.ttl_30m_tokens;
    const write = details?.cache_write_tokens ?? (extended + (short ?? 0));
    if (![read, write, extended].every(count) || read + write > input || extended > write ||
        (short != null && (!count(short) || (lifetimes?.ttl_12h_tokens != null && extended + short !== write) ||
            extended + short > write))) return;
    // This request uses 30m writes. If an explicit TTL split does arrive, bill
    // the reported units (including 12h writes) instead of the request default.
    const extendedWrites = lifetimes?.ttl_12h_tokens == null && short != null ? write - short : extended;
    const ordinary = input - read - write;
    const tokenMultiplier = input > LONG_CONTEXT_THRESHOLD ? 2 : 1;
    const inputCost = ordinary * INPUT + read * CACHE_READ +
        (write - extendedWrites) * WRITE_30M + extendedWrites * WRITE_12H;
    const outputCost = output * OUTPUT * (tokenMultiplier === 2 ? 1.5 : 1);
    const search = searchUsage(result);
    if (!search) return;
    const costNanoUsd = inputCost * tokenMultiplier + outputCost + search.billable * SEARCH;
    // Unclassified input is estimated at the ordinary rate. Retain the
    // difference up to a 30m write in the budget until the period ends.
    const missingWriteCount = details?.cache_write_tokens == null &&
        (lifetimes?.ttl_30m_tokens == null || lifetimes?.ttl_12h_tokens == null);
    const uncertaintyNanoUsd = (missingWriteCount ? ordinary * (WRITE_30M - INPUT) * tokenMultiplier : 0) +
        search.uncertain * SEARCH;
    if (Number.isSafeInteger(costNanoUsd + uncertaintyNanoUsd)) return { costNanoUsd, uncertaintyNanoUsd };
}
