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

function isDialogueLine(line) {
    return /^(?:Pulse|Shard|Mica|パルス|シャード|ミカ)\s*:/u.test(String(line || '').trim());
}

function buildTranscriptBlock(transcript) {
    const recentTranscript = transcript.filter(isDialogueLine).slice(-6);
    return recentTranscript.length
        ? recentTranscript.map((line) => `- ${line}`).join('\n')
        : '- まだ発話ログはない';
}

function getRoleStyleGuide(speaker) {
    const guideById = {
        pulse: [
            '- 前向きで実験を進める立場から話す',
            '- 具体的な次の一歩や試し方を一つ入れる',
            '- 明るいが雑にはしない'
        ],
        shard: [
            '- 懐疑的な立場から話す',
            '- リスク、制約、破綻点のどれかを必ず一つ指摘する',
            '- 反対するだけでなく、何を抑えればよいかも短く添える'
        ],
        mica: [
            '- 要点整理役として話す',
            '- 今までの会話を一度まとめるか、論点を言い換える',
            '- 最後に焦点を一つに絞る'
        ]
    };

    return guideById[speaker.id] || [
        '- 役割に沿った立場をはっきり出す',
        '- 同じ言い回しを繰り返さない'
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

function buildLlamaCppSystemPrompt({ speaker, listener }) {
    return [
        `あなたは MAS シミュレーション内のエージェント ${speaker.name} です。`,
        `役割: ${speaker.role}`,
        `会話相手: ${listener.name} (${listener.role})`,
        '役割の出し方:',
        ...getRoleStyleGuide(speaker),
        '返答ルール:',
        '- 日本語で話す',
        '- 一言は 1〜2 文に収める',
        '- 出力は発話本文だけを 1 行で返す',
        '- 口調は役割に沿わせる',
        '- 題材から逸れすぎない',
        '- 直前の自分の発話と同じ切り口や同じ語尾を繰り返さない',
        '- 名前ラベル、箇条書き、ト書き、囲み記号は付けない',
        '- 「返答:」「発言:」のような見出しを付けない',
        '- <think> タグ、Markdown、引用符、括弧の地の文は入れない'
    ].join('\n');
}

function buildLlamaCppUserPrompt({ topic, speaker, listener, transcript }) {
    const recentSpeakerLine = getRecentSpeakerLine({ speaker, transcript });

    return [
        `議題: ${normalizeTopic(topic)}`,
        `${listener.name} に向けて、次の一言だけ返してください。`,
        '出力形式: 本文のみ。1行。説明や補足は不要。',
        recentSpeakerLine
            ? `自分がさっき言ったこと: ${recentSpeakerLine}`
            : '自分の直前発話: まだない',
        '自分の直前発話と同じ内容を焼き直さず、別の角度で一言返すこと。',
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
