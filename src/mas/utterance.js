const DEFAULT_BACKEND = process.env.MAS_UTTERANCE_BACKEND || 'mock';
const DEFAULT_LLAMACPP_URL = (process.env.LLAMACPP_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const DEFAULT_LLAMACPP_MODEL = process.env.LLAMACPP_MODEL || 'local-model';
const DEFAULT_LLAMACPP_API_MODE = process.env.LLAMACPP_API_MODE || 'auto';
const DEFAULT_TIMEOUT_MS = Number(process.env.LLAMACPP_TIMEOUT_MS || 15000);
const DEFAULT_MAX_TOKENS = Number(process.env.LLAMACPP_MAX_TOKENS || 72);
const DEFAULT_TEMPERATURE = Number(process.env.LLAMACPP_TEMPERATURE || 0.5);
const DEFAULT_TOP_P = Number(process.env.LLAMACPP_TOP_P || 0.85);
const DEFAULT_TOP_K = Number(process.env.LLAMACPP_TOP_K || 20);
const DEFAULT_MIN_P = Number(process.env.LLAMACPP_MIN_P || 0);
const DEFAULT_REPEAT_PENALTY = Number(process.env.LLAMACPP_REPEAT_PENALTY || 1.14);
const DEFAULT_REPEAT_LAST_N = Number(process.env.LLAMACPP_REPEAT_LAST_N || 128);

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeTopic(topic) {
    const value = typeof topic === 'string' ? topic.trim().replace(/\s+/g, ' ') : '';
    return value || 'ローカルMASの最初の遊び方';
}

function isDialogueLine(line) {
    return /^(?:Pulse|Shard|Mica|パルス|シャード|ミカ)\s*:/u.test(String(line || '').trim());
}

function getRoleStyleGuide(speaker) {
    const guideById = {
        pulse: [
            '前向きに賛成し、具体例か基準を一つだけ出す。'
        ],
        shard: [
            '慎重に疑い、条件・例外・弱点を一つだけ出す。'
        ],
        mica: [
            '要点整理役として、対立点を短くまとめる。'
        ]
    };

    return guideById[speaker.id] || [
        '役割に沿った立場をはっきり出す。'
    ];
}

function getRecentSpeakerLine({ speaker, transcript }) {
    const speakerPrefix = `${speaker.name}:`;
    for (let index = transcript.length - 1; index >= 0; index -= 1) {
        const line = transcript[index];
        if (typeof line === 'string' && isDialogueLine(line) && line.startsWith(speakerPrefix)) {
            return line.slice(speakerPrefix.length).trim();
        }
    }

    return '';
}

function getStageGuide(stage) {
    const stageGuides = {
        opening: '最初の立場表明',
        rebuttal: '相手への反論',
        summary: '論点の整理',
        follow_up: '論点への具体化',
        counter: '条件付きの再反論',
        closing: '暫定結論'
    };

    return stageGuides[stage] || '役割どおりに返答';
}

function buildLlamaCppSystemPrompt({ speaker, listener, debateStage }) {
    return [
        `あなたは ${speaker.name}。役割は ${speaker.role}。相手は ${listener.name}。`,
        `段階: ${getStageGuide(debateStage)}`,
        ...getRoleStyleGuide(speaker),
        '日本語で 1〜2 文だけ返す。議題の復唱、オウム返し、名前ラベル、説明は禁止。'
    ].join('\n');
}

function buildLlamaCppUserPrompt({ topic, speaker, listener, transcript, turnGoal, debateStage }) {
    const recentSpeakerLine = getRecentSpeakerLine({ speaker, transcript });
    const recentListenerLine = getRecentSpeakerLine({ speaker: listener, transcript });

    return [
        `議題: ${normalizeTopic(topic)}`,
        `段階: ${getStageGuide(debateStage)}`,
        `役目: ${turnGoal || getStageGuide(debateStage)}`,
        recentListenerLine ? `${listener.name} の直前: ${recentListenerLine}` : '',
        recentSpeakerLine ? `自分の直前: ${recentSpeakerLine}` : '',
        '返答:'
    ].filter(Boolean).join('\n');
}

function buildSingleTurnInstruction(context) {
    return [
        buildLlamaCppSystemPrompt(context),
        buildLlamaCppUserPrompt(context)
    ].join('\n');
}

function buildLlamaCppPrompt(context) {
    return buildSingleTurnInstruction(context);
}

function buildLlamaCppMessages(context) {
    return [
        {
            role: 'user',
            content: buildSingleTurnInstruction(context)
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

function dedupeConsecutiveSentences(text) {
    const sentences = String(text || '')
        .split(/(?<=[。！？!?])/u)
        .map((sentence) => sentence.trim())
        .filter(Boolean);

    if (sentences.length <= 1) {
        return String(text || '').trim();
    }

    const deduped = [];
    for (const sentence of sentences) {
        if (deduped[deduped.length - 1] === sentence) {
            continue;
        }
        deduped.push(sentence);
    }

    return deduped.join(' ').trim();
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

    return dedupeConsecutiveSentences(normalized || '');
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
        top_k: DEFAULT_TOP_K,
        min_p: DEFAULT_MIN_P,
        repeat_penalty: DEFAULT_REPEAT_PENALTY,
        repeat_last_n: DEFAULT_REPEAT_LAST_N,
        reasoning_format: 'none',
        chat_template_kwargs: {
            enable_thinking: false
        },
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
        top_k: DEFAULT_TOP_K,
        min_p: DEFAULT_MIN_P,
        repeat_penalty: DEFAULT_REPEAT_PENALTY,
        repeat_last_n: DEFAULT_REPEAT_LAST_N,
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
