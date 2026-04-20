const DEFAULT_BACKEND = process.env.MAS_UTTERANCE_BACKEND || 'mock';
const DEFAULT_LLAMACPP_URL = (process.env.LLAMACPP_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const DEFAULT_LLAMACPP_MODEL = process.env.LLAMACPP_MODEL || 'local-model';
const DEFAULT_LLAMACPP_API_MODE = process.env.LLAMACPP_API_MODE || 'auto';
const DEFAULT_TIMEOUT_MS = Number(process.env.LLAMACPP_TIMEOUT_MS || 15000);
const DEFAULT_MAX_TOKENS = Number(process.env.LLAMACPP_MAX_TOKENS || 96);
const DEFAULT_TEMPERATURE = Number(process.env.LLAMACPP_TEMPERATURE || 0.75);
const DEFAULT_TOP_P = Number(process.env.LLAMACPP_TOP_P || 0.92);

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeTopic(topic) {
    const value = typeof topic === 'string' ? topic.trim().replace(/\s+/g, ' ') : '';
    return value || 'ローカルMASの最初の遊び方';
}

function buildTranscriptBlock(transcript) {
    return transcript.length
        ? transcript.map((line) => `- ${line}`).join('\n')
        : '- まだ会話ログはない';
}

function buildLlamaCppSystemPrompt({ speaker, listener }) {
    return [
        `あなたは MAS シミュレーション内のエージェント ${speaker.name} です。`,
        `役割: ${speaker.role}`,
        `会話相手: ${listener.name} (${listener.role})`,
        '返答ルール:',
        '- 日本語で話す',
        '- 一言は 1〜2 文に収める',
        '- 出力は発話本文だけを 1 行で返す',
        '- 口調は役割に沿わせる',
        '- 題材から逸れすぎない',
        '- 名前ラベル、箇条書き、ト書き、囲み記号は付けない',
        '- 「返答:」「発言:」のような見出しを付けない',
        '- <think> タグ、Markdown、引用符、括弧の地の文は入れない'
    ].join('\n');
}

function buildLlamaCppUserPrompt({ topic, listener, transcript }) {
    return [
        `議題: ${normalizeTopic(topic)}`,
        `${listener.name} に向けて、次の一言だけ返してください。`,
        '出力形式: 本文のみ。1行。説明や補足は不要。',
        '直近ログ:',
        buildTranscriptBlock(transcript)
    ].join('\n');
}

function buildLlamaCppPrompt({ topic, speaker, listener, transcript }) {
    const systemPrompt = buildLlamaCppSystemPrompt({ speaker, listener });
    const userPrompt = buildLlamaCppUserPrompt({ topic, listener, transcript });

    return [
        '### System',
        systemPrompt,
        '',
        '### User',
        userPrompt
    ].join('\n');
}

function buildLlamaCppMessages(context) {
    return [
        {
            role: 'system',
            content: buildLlamaCppSystemPrompt(context)
        },
        {
            role: 'user',
            content: buildLlamaCppUserPrompt(context)
        }
    ];
}

function buildMockUtterance({ topic, speaker, turnIndex }) {
    const cleanTopic = normalizeTopic(topic);

    const linesBySpeaker = {
        pulse: [
            `まずは「${cleanTopic}」を動く形まで持っていこう。3体でも十分おもしろい入口になる。`,
            `なら最初は topic を受けたら近づいて一言ずつ返す。そこから段階的に賢くすればいい。`
        ],
        shard: [
            `でも ${cleanTopic} は演出だけ先行すると薄い。誰がいつ話すかの制御を先に決めないと破綻する。`,
            'その代わり同時発話は避けたい。いまは turn-based にして待ち時間を見た方が安全だ。'
        ],
        mica: [
            `論点は二つ。${cleanTopic} の見せ方と、会話順のルールを最小に絞ること。`,
            `結論。${cleanTopic} は今の設計で始められる。次はダミー発話を llama.cpp 呼び出しに差し替える。`
        ]
    };

    const lines = linesBySpeaker[speaker.id] || [`${cleanTopic} について話したい。`];
    return lines[Math.min(turnIndex, lines.length - 1)];
}

function stripOuterWrappers(text) {
    let value = text;

    for (let index = 0; index < 4; index += 1) {
        const next = value
            .replace(/^["'`「『【［（(<\s]+/, '')
            .replace(/["'`」』】］）>)\s]+$/, '')
            .trim();

        if (next === value) {
            break;
        }

        value = next;
    }

    return value;
}

function sanitizeUtteranceLine(text) {
    return text
        .replace(/^>\s*/, '')
        .replace(/^(?:[-*•・]|\d+[.)])\s*/u, '')
        .replace(/^[【\[]?\s*(?:Pulse|Shard|Mica|パルス|シャード|ミカ)\s*[】\]]?\s*[:：-]\s*/iu, '')
        .replace(/^(?:speaker|agent|assistant|話者|発話|返答|回答|セリフ)\s*[:：-]\s*/iu, '')
        .replace(/^(?:\([^)]{0,24}\)|（[^）]{0,24}）|【[^】]{0,24}】|\[[^\]]{0,24}\])\s*/u, '')
        .trim();
}

function sanitizeUtterance(text) {
    const lines = String(text || '')
        .replace(/\r/g, '\n')
        .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
        .replace(/<\/?think>/gi, ' ')
        .replace(/```(?:[\w-]+)?/g, ' ')
        .replace(/<\/?[^>\n]+>/g, ' ')
        .split('\n')
        .map((line) => sanitizeUtteranceLine(line))
        .filter(Boolean);

    const normalized = stripOuterWrappers(
        lines.join(' ')
            .replace(/\s+/g, ' ')
            .replace(/^[*_~`]+/, '')
            .replace(/[*_~`]+$/, '')
            .trim()
    );

    return normalized || '';
}

async function postJson(url, payload) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
        });

        return response;
    } finally {
        clearTimeout(timeout);
    }
}

async function generateViaChatCompletions(context) {
    const response = await postJson(`${DEFAULT_LLAMACPP_URL}/v1/chat/completions`, {
        model: DEFAULT_LLAMACPP_MODEL,
        messages: buildLlamaCppMessages(context),
        max_tokens: DEFAULT_MAX_TOKENS,
        temperature: DEFAULT_TEMPERATURE,
        top_p: DEFAULT_TOP_P,
        stream: false
    });

    if (!response.ok) {
        const error = new Error(`llama.cpp chat endpoint error: ${response.status}`);
        error.status = response.status;
        throw error;
    }

    const payload = await response.json();
    const content = sanitizeUtterance(
        payload?.choices?.[0]?.message?.content
        || payload?.choices?.[0]?.text
        || ''
    );

    if (!content) {
        throw new Error('llama.cpp chat endpoint returned an empty response');
    }

    return {
        text: content,
        backendLabel: 'server orchestrator / llama.cpp chat'
    };
}

async function generateViaCompletion(context) {
    const prompt = buildLlamaCppPrompt(context);

    const response = await postJson(`${DEFAULT_LLAMACPP_URL}/completion`, {
        prompt,
        n_predict: DEFAULT_MAX_TOKENS,
        temperature: DEFAULT_TEMPERATURE,
        top_p: DEFAULT_TOP_P,
        stop: ['\n', '</s>'],
        cache_prompt: true
    });

    if (!response.ok) {
        const error = new Error(`llama.cpp completion endpoint error: ${response.status}`);
        error.status = response.status;
        throw error;
    }

    const payload = await response.json();
    const content = sanitizeUtterance(payload?.content || payload?.response || payload?.choices?.[0]?.text || '');

    if (!content) {
        throw new Error('llama.cpp completion endpoint returned an empty response');
    }

    return {
        text: content,
        backendLabel: 'server orchestrator / llama.cpp completion'
    };
}

async function generateViaLlamaCpp(context) {
    if (DEFAULT_LLAMACPP_API_MODE === 'chat') {
        return generateViaChatCompletions(context);
    }

    if (DEFAULT_LLAMACPP_API_MODE === 'completion') {
        return generateViaCompletion(context);
    }

    try {
        return await generateViaChatCompletions(context);
    } catch (error) {
        if (error.status && error.status !== 404 && error.status !== 501) {
            throw error;
        }
    }

    return generateViaCompletion(context);
}

async function generateMasUtterance(context) {
    const transcript = Array.isArray(context.transcript) ? context.transcript : [];
    const nextContext = {
        ...context,
        topic: normalizeTopic(context.topic),
        transcript
    };

    if (DEFAULT_BACKEND === 'llama.cpp') {
        try {
            return await generateViaLlamaCpp(nextContext);
        } catch (error) {
            console.error('[MAS] llama.cpp fallback to mock:', error.message);
        }
    }

    await sleep(420 + ((context.turnIndex % 3) * 180));
    return {
        text: buildMockUtterance(nextContext),
        backendLabel: DEFAULT_BACKEND === 'llama.cpp'
            ? 'server orchestrator / mock fallback'
            : 'server orchestrator / mock utterances'
    };
}

function getMasBackendLabel() {
    return DEFAULT_BACKEND === 'llama.cpp'
        ? 'server orchestrator / llama.cpp'
        : 'server orchestrator / mock utterances';
}

module.exports = {
    buildLlamaCppPrompt,
    generateMasUtterance,
    getMasBackendLabel
};
