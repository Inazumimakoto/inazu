const DEFAULT_BACKEND = process.env.MAS_UTTERANCE_BACKEND || 'mock';

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeTopic(topic) {
    const value = typeof topic === 'string' ? topic.trim().replace(/\s+/g, ' ') : '';
    return value || 'ローカルMASの最初の遊び方';
}

function buildLlamaCppPrompt({ topic, speaker, listener, transcript }) {
    const dialogue = transcript.length
        ? transcript.map((line) => `- ${line}`).join('\n')
        : '- まだ会話ログはない';

    return [
        `あなたは MAS シミュレーション内のエージェント ${speaker.name} です。`,
        `役割: ${speaker.role}`,
        `相手: ${listener.name} (${listener.role})`,
        `話題: ${normalizeTopic(topic)}`,
        '要件:',
        '- 一言は 1〜2 文に収める',
        '- 口調は役割に沿わせる',
        '- 題材から逸れすぎない',
        '- 返答は地の文だけで、名前ラベルや箇条書きは出さない',
        '直近ログ:',
        dialogue
    ].join('\n');
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

async function generateViaLlamaCpp(context) {
    const baseUrl = (process.env.LLAMACPP_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
    const prompt = buildLlamaCppPrompt(context);

    const response = await fetch(`${baseUrl}/completion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            prompt,
            n_predict: 96,
            temperature: 0.8,
            top_p: 0.92,
            stop: ['\n', '</s>']
        })
    });

    if (!response.ok) {
        throw new Error(`llama.cpp error: ${response.status}`);
    }

    const payload = await response.json();
    const content = (payload.content || payload.response || '').trim();

    if (!content) {
        throw new Error('llama.cpp returned an empty response');
    }

    return content;
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
    return buildMockUtterance(nextContext);
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
