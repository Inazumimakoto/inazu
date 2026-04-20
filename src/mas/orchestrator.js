const crypto = require('crypto');
const { generateMasUtterance, getMasBackendLabel } = require('./utterance');

const AGENT_BLUEPRINTS = Object.freeze([
    {
        id: 'pulse',
        name: 'Pulse',
        role: '肯定派',
        color: '#7df0ff',
        basePosition: { x: -5.8, y: 0, z: 3.6 }
    },
    {
        id: 'shard',
        name: 'Shard',
        role: '懐疑派',
        color: '#ff8a6b',
        basePosition: { x: 5.5, y: 0, z: 2.6 }
    },
    {
        id: 'mica',
        name: 'Mica',
        role: '要約役',
        color: '#ffd36a',
        basePosition: { x: -0.2, y: 0, z: -5.7 }
    }
]);

const TURN_BLUEPRINTS = Object.freeze([
    {
        speakerId: 'pulse',
        listenerId: 'shard',
        debateStage: 'opening',
        goal: '賛成か反対かの立場を先に言い、理由を一つだけ添える。'
    },
    {
        speakerId: 'shard',
        listenerId: 'pulse',
        debateStage: 'rebuttal',
        goal: '直前の主張の弱い点を一つ指摘し、反対または条件付き反対を返す。'
    },
    {
        speakerId: 'mica',
        listenerId: 'pulse',
        debateStage: 'summary',
        goal: 'ここまでの対立点を整理し、次に考えるべき論点を一つに絞る。'
    },
    {
        speakerId: 'pulse',
        listenerId: 'mica',
        debateStage: 'follow_up',
        goal: '絞られた論点に答え、具体例か判断基準を一つだけ足す。'
    },
    {
        speakerId: 'shard',
        listenerId: 'mica',
        debateStage: 'counter',
        goal: 'その具体例や基準の穴、例外、条件を一つだけ指摘する。'
    },
    {
        speakerId: 'mica',
        listenerId: 'shard',
        debateStage: 'closing',
        goal: '賛成側と慎重側の条件を短くまとめ、暫定結論を示す。'
    }
]);

const TICK_MS = 120;
const MOVE_SPEED_PER_TICK = 0.52;
const POSITION_EPSILON = 0.12;
const MIN_SPEAK_DURATION_MS = 3600;
const MAX_SPEAK_DURATION_MS = 9800;
const RETURN_TIMEOUT_MS = 1600;
const WORLD_IDLE_TTL_MS = 10 * 60 * 1000;
const WORLD_UNSUBSCRIBED_TTL_MS = 45 * 1000;
const MAX_LOG_ENTRIES = 10;

function normalizeTopic(topic) {
    const value = typeof topic === 'string' ? topic.trim().replace(/\s+/g, ' ') : '';
    return value;
}

function clonePoint(point) {
    return { x: point.x, y: point.y, z: point.z };
}

function moveTowards(point, target, maxStep) {
    const dx = target.x - point.x;
    const dy = target.y - point.y;
    const dz = target.z - point.z;
    const distance = Math.hypot(dx, dy, dz);

    if (distance <= maxStep || distance === 0) {
        point.x = target.x;
        point.y = target.y;
        point.z = target.z;
        return;
    }

    const ratio = maxStep / distance;
    point.x += dx * ratio;
    point.y += dy * ratio;
    point.z += dz * ratio;
}

function distanceBetween(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function normalizeVector(point) {
    const length = Math.hypot(point.x, point.y, point.z) || 1;
    return {
        x: point.x / length,
        y: point.y / length,
        z: point.z / length
    };
}

function randomBetween(min, max) {
    return min + Math.random() * (max - min);
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function samePair(a, b) {
    if (!a || !b) {
        return false;
    }

    return (
        a.speakerId === b.speakerId && a.listenerId === b.listenerId
    ) || (
        a.speakerId === b.listenerId && a.listenerId === b.speakerId
    );
}

function getMeetingTargets(speaker, listener) {
    const midpoint = {
        x: (speaker.basePosition.x + listener.basePosition.x) * 0.5,
        y: 0,
        z: (speaker.basePosition.z + listener.basePosition.z) * 0.5
    };
    const direction = normalizeVector({
        x: listener.basePosition.x - speaker.basePosition.x,
        y: 0,
        z: listener.basePosition.z - speaker.basePosition.z
    });
    const normal = {
        x: -direction.z,
        y: 0,
        z: direction.x
    };
    const spacing = randomBetween(1.2, 1.95);
    const lateralShift = randomBetween(-1.15, 1.15);
    const depthShift = randomBetween(-0.38, 0.38);
    const shiftedMidpoint = {
        x: midpoint.x + normal.x * lateralShift + direction.x * depthShift,
        y: 0,
        z: midpoint.z + normal.z * lateralShift + direction.z * depthShift
    };

    return {
        speakerTarget: {
            x: shiftedMidpoint.x - direction.x * (spacing / 2),
            y: 0,
            z: shiftedMidpoint.z - direction.z * (spacing / 2)
        },
        listenerTarget: {
            x: shiftedMidpoint.x + direction.x * (spacing / 2),
            y: 0,
            z: shiftedMidpoint.z + direction.z * (spacing / 2)
        }
    };
}

function calculateSpeakDuration(text) {
    const normalized = String(text || '').trim();
    const charCount = normalized.length;
    const punctuationCount = (normalized.match(/[。！？!?]/g) || []).length;
    const duration = 1800 + (charCount * 90) + (punctuationCount * 420);

    return clamp(duration, MIN_SPEAK_DURATION_MS, MAX_SPEAK_DURATION_MS);
}

function createAgentState(blueprint) {
    return {
        id: blueprint.id,
        name: blueprint.name,
        role: blueprint.role,
        color: blueprint.color,
        basePosition: clonePoint(blueprint.basePosition),
        position: clonePoint(blueprint.basePosition),
        targetPosition: clonePoint(blueprint.basePosition),
        bubbleVisible: false,
        bubbleText: ''
    };
}

class MasWorld {
    constructor(id) {
        this.id = id;
        this.subscribers = new Set();
        this.interval = null;
        this.lastSnapshot = '';
        this.lastSubscriberAt = Date.now();
        this.lastActivityAt = Date.now();
        this.topic = '';
        this.status = 'awaiting topic input';
        this.phase = 'waiting_topic';
        this.isRunning = false;
        this.turnIndex = 0;
        this.activeTurn = null;
        this.phaseEndsAt = 0;
        this.log = [];
        this.backendLabel = getMasBackendLabel();
        this.agents = AGENT_BLUEPRINTS.map(createAgentState);
    }

    ensureInterval() {
        if (this.interval) {
            return;
        }

        this.interval = setInterval(() => this.tick(), TICK_MS);
    }

    stopInterval() {
        if (!this.interval) {
            return;
        }

        clearInterval(this.interval);
        this.interval = null;
    }

    destroy() {
        this.stopInterval();

        for (const response of this.subscribers) {
            try {
                response.end();
            } catch {
                // Ignore already closed sockets.
            }
        }

        this.subscribers.clear();
    }

    isExpired(now = Date.now()) {
        if (now - this.lastActivityAt > WORLD_IDLE_TTL_MS) {
            return true;
        }

        if (this.subscribers.size === 0 && now - this.lastSubscriberAt > WORLD_UNSUBSCRIBED_TTL_MS) {
            return true;
        }

        return false;
    }

    touch() {
        this.lastActivityAt = Date.now();
    }

    getAgent(id) {
        return this.agents.find((agent) => agent.id === id);
    }

    resetTargets() {
        for (const agent of this.agents) {
            agent.targetPosition = clonePoint(agent.basePosition);
        }
    }

    hideBubbles() {
        for (const agent of this.agents) {
            agent.bubbleVisible = false;
            agent.bubbleText = '';
        }
    }

    pushLog(text) {
        this.log.unshift(text);
        this.log = this.log.slice(0, MAX_LOG_ENTRIES);
        this.touch();
    }

    awaitTopic() {
        this.stopInterval();
        this.topic = '';
        this.status = 'awaiting topic input';
        this.phase = 'waiting_topic';
        this.isRunning = false;
        this.turnIndex = 0;
        this.activeTurn = null;
        this.phaseEndsAt = 0;
        this.log = [];
        this.backendLabel = getMasBackendLabel();
        this.agents = AGENT_BLUEPRINTS.map(createAgentState);
        this.hideBubbles();
        this.resetTargets();
        this.touch();
        this.broadcast(true);
    }

    reset(topic) {
        this.topic = normalizeTopic(topic);
        if (!this.topic) {
            this.awaitTopic();
            return;
        }

        this.status = `topic loaded: ${this.topic}`;
        this.phase = 'queued';
        this.isRunning = true;
        this.turnIndex = 0;
        this.activeTurn = null;
        this.phaseEndsAt = 0;
        this.log = [];
        this.backendLabel = getMasBackendLabel();
        this.agents = AGENT_BLUEPRINTS.map(createAgentState);
        this.hideBubbles();
        this.resetTargets();
        this.pushLog(`Topic accepted: ${this.topic}`);
        this.lastSubscriberAt = Date.now();
        this.ensureInterval();
        this.broadcast(true);
    }

    subscribe(response) {
        this.subscribers.add(response);
        this.lastSubscriberAt = Date.now();
        this.touch();
        response.write(`retry: 1000\n`);
        this.sendSnapshot(response, true);
    }

    unsubscribe(response) {
        this.subscribers.delete(response);
        this.lastSubscriberAt = Date.now();
    }

    sendSnapshot(response, force = false) {
        const payload = JSON.stringify(this.getSnapshot());
        if (!force && payload === this.lastSnapshot) {
            return;
        }

        this.lastSnapshot = payload;
        response.write(`data: ${payload}\n\n`);
    }

    broadcast(force = false) {
        if (this.subscribers.size === 0) {
            return;
        }

        const payload = JSON.stringify(this.getSnapshot());
        if (!force && payload === this.lastSnapshot) {
            return;
        }

        this.lastSnapshot = payload;
        for (const response of Array.from(this.subscribers)) {
            try {
                response.write(`data: ${payload}\n\n`);
            } catch {
                this.subscribers.delete(response);
            }
        }
    }

    getSnapshot() {
        return {
            worldId: this.id,
            topic: this.topic,
            status: this.status,
            phase: this.phase,
            isRunning: this.isRunning,
            llmMode: this.backendLabel,
            activeSpeakerId: this.activeTurn?.speakerId || null,
            activeListenerId: this.activeTurn?.listenerId || null,
            agents: this.agents.map((agent) => ({
                id: agent.id,
                name: agent.name,
                role: agent.role,
                color: agent.color,
                basePosition: clonePoint(agent.basePosition),
                position: clonePoint(agent.position),
                targetPosition: clonePoint(agent.targetPosition),
                bubbleVisible: agent.bubbleVisible,
                bubbleText: agent.bubbleText
            })),
            log: [...this.log]
        };
    }

    updateAgentPositions() {
        for (const agent of this.agents) {
            moveTowards(agent.position, agent.targetPosition, MOVE_SPEED_PER_TICK);
        }
    }

    beginTurn() {
        if (this.turnIndex >= TURN_BLUEPRINTS.length) {
            this.completeDiscussion();
            return;
        }

        const turn = {
            ...TURN_BLUEPRINTS[this.turnIndex],
            line: '',
            ready: false,
            promise: null
        };

        const speaker = this.getAgent(turn.speakerId);
        const listener = this.getAgent(turn.listenerId);
        const { speakerTarget, listenerTarget } = getMeetingTargets(speaker, listener);

        this.resetTargets();
        speaker.targetPosition = speakerTarget;
        listener.targetPosition = listenerTarget;

        this.activeTurn = turn;
        this.phase = 'approaching';
        this.status = `${speaker.name} is approaching ${listener.name}`;
        this.pushLog(`${speaker.name} -> ${listener.name}: moving into range`);
        this.requestUtterance(turn);
    }

    async requestUtterance(turn) {
        if (turn.promise) {
            return;
        }

        const speaker = this.getAgent(turn.speakerId);
        const listener = this.getAgent(turn.listenerId);
        const transcript = [...this.log].reverse();

        turn.promise = generateMasUtterance({
            topic: this.topic,
            speaker,
            listener,
            turnIndex: this.turnIndex,
            transcript,
            turnGoal: turn.goal,
            debateStage: turn.debateStage
        }).then((result) => {
            if (this.activeTurn !== turn) {
                return;
            }

            turn.line = result.text;
            turn.ready = true;
            this.backendLabel = result.backendLabel;

            if (this.phase === 'awaiting_line') {
                this.startSpeaking();
            } else {
                this.broadcast(true);
            }
        }).catch((error) => {
            console.error('[MAS] utterance generation failed:', error);
            if (this.activeTurn !== turn) {
                return;
            }

            turn.line = `${this.topic} については、まず最小構成で様子を見るのがよさそうだ。`;
            turn.ready = true;
            this.backendLabel = 'server orchestrator / emergency fallback';
            if (this.phase === 'awaiting_line') {
                this.startSpeaking();
            } else {
                this.broadcast(true);
            }
        });
    }

    startSpeaking() {
        if (!this.activeTurn?.ready) {
            return;
        }

        const speaker = this.getAgent(this.activeTurn.speakerId);
        this.hideBubbles();
        speaker.bubbleVisible = true;
        speaker.bubbleText = this.activeTurn.line;
        this.phase = 'speaking';
        this.phaseEndsAt = Date.now() + calculateSpeakDuration(this.activeTurn.line);
        this.status = `${speaker.name} speaking on ${this.topic}`;
        this.pushLog(`${speaker.name}: ${this.activeTurn.line}`);
    }

    completeDiscussion() {
        this.resetTargets();
        this.stopInterval();
        this.isRunning = false;
        this.phase = 'complete';
        this.activeTurn = null;
        this.status = `discussion complete: ${this.topic}`;
        this.pushLog(`Prototype complete for topic: ${this.topic}`);
    }

    getNextTurnBlueprint() {
        return TURN_BLUEPRINTS[this.turnIndex + 1] || null;
    }

    tick() {
        this.updateAgentPositions();

        if (!this.isRunning && this.phase !== 'returning') {
            this.broadcast();
            return;
        }

        if (this.phase === 'queued') {
            this.beginTurn();
            this.broadcast(true);
            return;
        }

        if (!this.activeTurn) {
            this.broadcast();
            return;
        }

        const speaker = this.getAgent(this.activeTurn.speakerId);
        const listener = this.getAgent(this.activeTurn.listenerId);

        if (this.phase === 'approaching') {
            const speakerReady = distanceBetween(speaker.position, speaker.targetPosition) < POSITION_EPSILON;
            const listenerReady = distanceBetween(listener.position, listener.targetPosition) < POSITION_EPSILON;

            if (speakerReady && listenerReady) {
                if (this.activeTurn.ready) {
                    this.startSpeaking();
                } else {
                    this.phase = 'awaiting_line';
                    this.status = `${speaker.name} is thinking about ${this.topic}`;
                }
                this.broadcast(true);
                return;
            }
        }

        if (this.phase === 'speaking' && Date.now() >= this.phaseEndsAt) {
            const nextTurn = this.getNextTurnBlueprint();
            if (samePair(this.activeTurn, nextTurn)) {
                this.turnIndex += 1;
                this.activeTurn = null;
                this.phase = 'queued';
                this.status = `${speaker.name} and ${listener.name} continue in place`;
                this.pushLog(`${speaker.name} と ${listener.name} はその場で会話を続ける`);
                this.broadcast(true);
                return;
            }

            this.resetTargets();
            this.phase = 'returning';
            this.phaseEndsAt = Date.now() + RETURN_TIMEOUT_MS;
            this.status = `${speaker.name} and ${listener.name} returning to nodes`;
            this.broadcast(true);
            return;
        }

        if (this.phase === 'returning') {
            const speakerHome = distanceBetween(speaker.position, speaker.basePosition) < POSITION_EPSILON;
            const listenerHome = distanceBetween(listener.position, listener.basePosition) < POSITION_EPSILON;

            if ((speakerHome && listenerHome) || Date.now() >= this.phaseEndsAt) {
                this.activeTurn = null;
                this.turnIndex += 1;
                this.phase = 'queued';
                this.broadcast(true);
                return;
            }
        }

        this.broadcast();
    }
}

class MasWorldManager {
    constructor() {
        this.worlds = new Map();
        this.cleanupTimer = setInterval(() => this.cleanupExpiredWorlds(), 30 * 1000);
        this.cleanupTimer.unref?.();
    }

    createWorld(topic) {
        const world = new MasWorld(crypto.randomUUID());
        world.reset(topic);
        this.worlds.set(world.id, world);
        return world;
    }

    getWorld(id) {
        return this.worlds.get(id) || null;
    }

    restartWorld(id, topic) {
        const world = this.getWorld(id);
        if (!world) {
            return null;
        }

        world.reset(topic);
        return world;
    }

    destroyWorld(id) {
        const world = this.getWorld(id);
        if (!world) {
            return;
        }

        world.destroy();
        this.worlds.delete(id);
    }

    cleanupExpiredWorlds() {
        for (const [worldId, world] of this.worlds.entries()) {
            if (!world.isExpired()) {
                continue;
            }

            this.destroyWorld(worldId);
        }
    }
}

module.exports = {
    masWorlds: new MasWorldManager()
};
