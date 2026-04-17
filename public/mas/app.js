import * as THREE from '/scripts/three/three.module.js';

const sceneCanvas = document.querySelector('[data-scene-canvas]');
const hudLayer = document.querySelector('[data-hud-layer]');
const topicForm = document.querySelector('[data-topic-form]');
const topicInput = document.querySelector('#topic-input');
const worldStatus = document.querySelector('[data-world-status]');
const logList = document.querySelector('[data-log-list]');

const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const hoveredRoot = { current: null };
const agents = [];
const agentById = new Map();
const speechState = {
    activeTopic: '',
    isRunning: false,
    eventIndex: 0,
    phase: 'idle',
    phaseEndsAt: 0,
    activeEvent: null,
    queue: [],
    lastStatus: 'booting prototype'
};

const renderer = new THREE.WebGLRenderer({
    canvas: sceneCanvas,
    antialias: true,
    alpha: true
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x051018);
scene.fog = new THREE.Fog(0x051018, 14, 34);

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
camera.position.set(0, 9, 18);

const worldGroup = new THREE.Group();
scene.add(worldGroup);

const hoverLift = 0.28;
const agentScaleActive = 1.04;

function setWorldStatus(text) {
    speechState.lastStatus = text;
    if (worldStatus) {
        worldStatus.textContent = text;
    }
}

function appendLogLine(text) {
    if (!logList) return;

    const item = document.createElement('li');
    item.textContent = text;
    logList.prepend(item);

    while (logList.children.length > 8) {
        logList.removeChild(logList.lastElementChild);
    }
}

function createHudTag(className, color) {
    const node = document.createElement('div');
    node.className = className;
    node.style.setProperty('--tag-color', color);
    hudLayer?.appendChild(node);
    return node;
}

function createFloor() {
    const floor = new THREE.Mesh(
        new THREE.CylinderGeometry(11, 12.6, 0.6, 48, 1, false),
        new THREE.MeshStandardMaterial({
            color: 0x08161d,
            roughness: 0.84,
            metalness: 0.16
        })
    );
    floor.position.y = -0.4;
    worldGroup.add(floor);

    const outerRing = new THREE.Mesh(
        new THREE.TorusGeometry(9.2, 0.08, 12, 84),
        new THREE.MeshBasicMaterial({ color: 0x7df0ff, transparent: true, opacity: 0.36 })
    );
    outerRing.rotation.x = Math.PI / 2;
    worldGroup.add(outerRing);

    const innerRing = new THREE.Mesh(
        new THREE.TorusGeometry(4.8, 0.06, 12, 64),
        new THREE.MeshBasicMaterial({ color: 0xffbf69, transparent: true, opacity: 0.42 })
    );
    innerRing.rotation.x = Math.PI / 2;
    innerRing.position.y = 0.04;
    worldGroup.add(innerRing);

    const spokes = new THREE.Group();
    for (let index = 0; index < 8; index += 1) {
        const spoke = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, 0.02, 8.4),
            new THREE.MeshBasicMaterial({ color: 0x1a4756, transparent: true, opacity: 0.45 })
        );
        spoke.rotation.y = (Math.PI / 4) * index;
        spoke.position.y = 0.06;
        spokes.add(spoke);
    }
    worldGroup.add(spokes);
}

function createLightRig() {
    const hemi = new THREE.HemisphereLight(0xbfefff, 0x081318, 1.1);
    scene.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(6, 10, 4);
    scene.add(key);

    const cyanGlow = new THREE.PointLight(0x7df0ff, 18, 24, 2);
    cyanGlow.position.set(-8, 6, 5);
    scene.add(cyanGlow);

    const warmGlow = new THREE.PointLight(0xffbf69, 16, 20, 2);
    warmGlow.position.set(7, 5, -4);
    scene.add(warmGlow);
}

function createAgentVisual(colorHex) {
    const root = new THREE.Group();

    const pedestal = new THREE.Mesh(
        new THREE.CylinderGeometry(0.82, 0.98, 0.26, 24),
        new THREE.MeshStandardMaterial({
            color: 0x0a1720,
            roughness: 0.56,
            metalness: 0.28
        })
    );
    pedestal.position.y = 0.13;
    root.add(pedestal);

    const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.48, 1.55, 6, 18),
        new THREE.MeshStandardMaterial({
            color: new THREE.Color(colorHex).multiplyScalar(0.48),
            emissive: new THREE.Color(colorHex).multiplyScalar(0.18),
            roughness: 0.28,
            metalness: 0.12
        })
    );
    body.position.y = 1.58;
    root.add(body);

    const visor = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 24, 24),
        new THREE.MeshBasicMaterial({
            color: colorHex,
            transparent: true,
            opacity: 0.92
        })
    );
    visor.position.set(0, 2.18, 0.3);
    root.add(visor);

    const halo = new THREE.Mesh(
        new THREE.TorusGeometry(0.76, 0.06, 12, 48),
        new THREE.MeshBasicMaterial({
            color: colorHex,
            transparent: true,
            opacity: 0.52
        })
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 2.1;
    root.add(halo);

    const pulseRing = new THREE.Mesh(
        new THREE.TorusGeometry(1.04, 0.05, 12, 56),
        new THREE.MeshBasicMaterial({
            color: colorHex,
            transparent: true,
            opacity: 0.24
        })
    );
    pulseRing.rotation.x = Math.PI / 2;
    pulseRing.position.y = 0.14;
    root.add(pulseRing);

    root.userData = {
        halo,
        pulseRing,
        body
    };

    return root;
}

function createAgent(config) {
    const root = createAgentVisual(config.color);
    root.position.copy(config.basePosition);
    root.userData.agentId = config.id;
    worldGroup.add(root);

    const label = createHudTag('agent-tag', config.color);
    label.textContent = config.name;
    label.classList.add('is-visible');

    const bubble = createHudTag('speech-bubble', config.color);

    const agent = {
        ...config,
        root,
        label,
        bubble,
        velocity: new THREE.Vector3(),
        targetPosition: config.basePosition.clone(),
        currentLine: '',
        bubbleVisible: false
    };

    agents.push(agent);
    agentById.set(config.id, agent);
}

function seedAgents() {
    createAgent({
        id: 'pulse',
        name: 'Pulse',
        role: '肯定派',
        color: '#7df0ff',
        basePosition: new THREE.Vector3(-5.8, 0, 3.6)
    });

    createAgent({
        id: 'shard',
        name: 'Shard',
        role: '懐疑派',
        color: '#ff8a6b',
        basePosition: new THREE.Vector3(5.5, 0, 2.6)
    });

    createAgent({
        id: 'mica',
        name: 'Mica',
        role: '要約役',
        color: '#ffd36a',
        basePosition: new THREE.Vector3(-0.2, 0, -5.7)
    });
}

function createBackdropColumns() {
    const columnGeometry = new THREE.CylinderGeometry(0.12, 0.12, 5.5, 12);
    const columnMaterial = new THREE.MeshBasicMaterial({
        color: 0x163746,
        transparent: true,
        opacity: 0.48
    });

    for (let index = 0; index < 14; index += 1) {
        const angle = (Math.PI * 2 * index) / 14;
        const radius = 13 + (index % 2 === 0 ? 0 : 1.4);
        const column = new THREE.Mesh(columnGeometry, columnMaterial);
        column.position.set(Math.cos(angle) * radius, 2.4, Math.sin(angle) * radius);
        worldGroup.add(column);
    }
}

function projectToScreen(position) {
    const projected = position.clone().project(camera);
    const rect = sceneCanvas.getBoundingClientRect();

    return {
        x: ((projected.x + 1) / 2) * rect.width,
        y: ((-projected.y + 1) / 2) * rect.height,
        visible: projected.z < 1
    };
}

function updateHud() {
    for (const agent of agents) {
        const labelPosition = projectToScreen(agent.root.position.clone().add(new THREE.Vector3(0, 3, 0)));
        agent.label.style.transform = `translate(${labelPosition.x}px, ${labelPosition.y}px) translate(-50%, -50%)`;
        agent.label.style.opacity = labelPosition.visible && !agent.bubbleVisible ? '1' : '0';

        const bubblePosition = projectToScreen(agent.root.position.clone().add(new THREE.Vector3(0, 4.2, 0)));
        agent.bubble.style.transform = `translate(${bubblePosition.x}px, ${bubblePosition.y}px) translate(-50%, -100%)`;
        agent.bubble.style.opacity = agent.bubbleVisible && bubblePosition.visible ? '1' : '0';
    }
}

function resizeRenderer() {
    const rect = sceneCanvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));

    if (sceneCanvas.width === width && sceneCanvas.height === height) {
        return;
    }

    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
}

function describeTopic(topic) {
    return topic.replace(/\s+/g, ' ').trim();
}

function buildDummyQueue(topic) {
    const cleanTopic = describeTopic(topic);

    return [
        {
            speakerId: 'pulse',
            listenerId: 'shard',
            line: `まずは「${cleanTopic}」を動く形まで持っていこう。3体でも十分おもしろい入口になる。`
        },
        {
            speakerId: 'shard',
            listenerId: 'pulse',
            line: `でも ${cleanTopic} は演出だけ先行すると薄い。誰がいつ話すかの制御を先に決めないと破綻する。`
        },
        {
            speakerId: 'mica',
            listenerId: 'pulse',
            line: `論点は二つ。${cleanTopic} の見せ方と、会話順のルールを最小に絞ること。`
        },
        {
            speakerId: 'pulse',
            listenerId: 'mica',
            line: `なら最初は topic を受けたら近づいて一言ずつ返す。そこから段階的に賢くすればいい。`
        },
        {
            speakerId: 'shard',
            listenerId: 'mica',
            line: `その代わり同時発話は避けたい。いまは turn-based にして待ち時間を見た方が安全だ。`
        },
        {
            speakerId: 'mica',
            listenerId: 'shard',
            line: `結論。${cleanTopic} は今の設計で始められる。次はダミー発話を llama.cpp 呼び出しに差し替える。`
        }
    ];
}

function getMeetingTargets(speaker, listener) {
    const midpoint = speaker.basePosition.clone().lerp(listener.basePosition, 0.5);
    const direction = listener.basePosition.clone().sub(speaker.basePosition).normalize();
    const spacing = 1.4;

    return {
        speakerTarget: midpoint.clone().addScaledVector(direction, -spacing / 2),
        listenerTarget: midpoint.clone().addScaledVector(direction, spacing / 2)
    };
}

function hideBubbles() {
    for (const agent of agents) {
        agent.bubbleVisible = false;
        agent.bubble.classList.remove('is-visible');
        agent.bubble.innerHTML = '';
    }
}

function resetAgentTargets() {
    for (const agent of agents) {
        agent.targetPosition.copy(agent.basePosition);
    }
}

function startSpeechEvent(event) {
    const speaker = agentById.get(event.speakerId);
    const listener = agentById.get(event.listenerId);
    if (!speaker || !listener) {
        return;
    }

    const { speakerTarget, listenerTarget } = getMeetingTargets(speaker, listener);
    resetAgentTargets();
    speaker.targetPosition.copy(speakerTarget);
    listener.targetPosition.copy(listenerTarget);

    speechState.activeEvent = event;
    speechState.phase = 'approaching';
    setWorldStatus(`${speaker.name} is approaching ${listener.name}`);
    appendLogLine(`${speaker.name} -> ${listener.name}: moving into range`);
}

function showBubble(agent, line) {
    agent.currentLine = line;
    agent.bubble.innerHTML = `<strong>${agent.name}</strong><span>${line}</span>`;
    agent.bubbleVisible = true;
    agent.bubble.classList.add('is-visible');
}

function advanceQueue() {
    if (speechState.eventIndex >= speechState.queue.length) {
        speechState.phase = 'complete';
        speechState.isRunning = false;
        speechState.activeEvent = null;
        resetAgentTargets();
        setWorldStatus(`discussion complete: ${speechState.activeTopic}`);
        appendLogLine(`Prototype complete for topic: ${speechState.activeTopic}`);
        return;
    }

    const nextEvent = speechState.queue[speechState.eventIndex];
    speechState.eventIndex += 1;
    startSpeechEvent(nextEvent);
}

function beginConversation(topic) {
    const cleanTopic = describeTopic(topic) || 'ローカルMASの最初の遊び方';
    speechState.activeTopic = cleanTopic;
    speechState.queue = buildDummyQueue(cleanTopic);
    speechState.eventIndex = 0;
    speechState.phase = 'queued';
    speechState.phaseEndsAt = 0;
    speechState.isRunning = true;
    logList.innerHTML = '';
    hideBubbles();
    resetAgentTargets();
    appendLogLine(`Topic accepted: ${cleanTopic}`);
    setWorldStatus(`topic loaded: ${cleanTopic}`);
    advanceQueue();
}

function tickConversation(nowSeconds) {
    if (!speechState.activeEvent) {
        return;
    }

    const speaker = agentById.get(speechState.activeEvent.speakerId);
    const listener = agentById.get(speechState.activeEvent.listenerId);
    if (!speaker || !listener) {
        return;
    }

    if (speechState.phase === 'approaching') {
        const speakerReady = speaker.root.position.distanceTo(speaker.targetPosition) < 0.08;
        const listenerReady = listener.root.position.distanceTo(listener.targetPosition) < 0.08;

        if (speakerReady && listenerReady) {
            hideBubbles();
            showBubble(speaker, speechState.activeEvent.line);
            speechState.phase = 'speaking';
            speechState.phaseEndsAt = nowSeconds + 3.1;
            setWorldStatus(`${speaker.name} speaking on ${speechState.activeTopic}`);
            appendLogLine(`${speaker.name}: ${speechState.activeEvent.line}`);
        }
        return;
    }

    if (speechState.phase === 'speaking' && nowSeconds >= speechState.phaseEndsAt) {
        hideBubbles();
        resetAgentTargets();
        speechState.phase = 'returning';
        speechState.phaseEndsAt = nowSeconds + 1.5;
        setWorldStatus(`${speaker.name} and ${listener.name} returning to nodes`);
        return;
    }

    if (speechState.phase === 'returning') {
        const speakerHome = speaker.root.position.distanceTo(speaker.basePosition) < 0.12;
        const listenerHome = listener.root.position.distanceTo(listener.basePosition) < 0.12;

        if ((speakerHome && listenerHome) || nowSeconds >= speechState.phaseEndsAt) {
            speechState.activeEvent = null;
            speechState.phase = 'queued';
            advanceQueue();
        }
    }
}

function updateAgents(elapsedSeconds, deltaSeconds) {
    for (const [index, agent] of agents.entries()) {
        const wobble = Math.sin(elapsedSeconds * 1.8 + index * 1.4) * 0.08;
        const hoverTarget = agent.targetPosition.clone();
        hoverTarget.y += wobble + (hoveredRoot.current === agent.root ? hoverLift : 0);

        const toTarget = hoverTarget.sub(agent.root.position);
        const distance = toTarget.length();
        const step = Math.min(distance, deltaSeconds * 3.8);
        if (distance > 0.0001) {
            agent.root.position.add(toTarget.normalize().multiplyScalar(step));
        }

        const facingTarget = speechState.activeEvent
            && (speechState.activeEvent.speakerId === agent.id || speechState.activeEvent.listenerId === agent.id)
            ? agentById.get(
                speechState.activeEvent.speakerId === agent.id
                    ? speechState.activeEvent.listenerId
                    : speechState.activeEvent.speakerId
            )?.root.position
            : new THREE.Vector3(0, 0.2, 0);

        if (facingTarget) {
            const direction = facingTarget.clone().sub(agent.root.position);
            const yaw = Math.atan2(direction.x, direction.z);
            agent.root.rotation.y += (yaw - agent.root.rotation.y) * Math.min(1, deltaSeconds * 4.2);
        }

        const scaleTarget = hoveredRoot.current === agent.root ? agentScaleActive : 1;
        agent.root.scale.lerp(new THREE.Vector3(scaleTarget, scaleTarget, scaleTarget), Math.min(1, deltaSeconds * 5));

        const { halo, pulseRing, body } = agent.root.userData;
        halo.rotation.z += deltaSeconds * 0.6;
        pulseRing.scale.setScalar(1 + Math.sin(elapsedSeconds * 3 + index) * 0.04);
        pulseRing.material.opacity = speechState.activeEvent?.speakerId === agent.id ? 0.42 : 0.2;
        body.material.emissiveIntensity = speechState.activeEvent?.speakerId === agent.id ? 0.35 : 0.08;
    }
}

function updatePointer(event) {
    const rect = sceneCanvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function pickHoveredAgent() {
    raycaster.setFromCamera(pointer, camera);
    const intersections = raycaster.intersectObjects(agents.map((agent) => agent.root), true);
    const hit = intersections[0];

    if (!hit) {
        hoveredRoot.current = null;
        return;
    }

    let current = hit.object;
    while (current && !current.userData?.agentId) {
        current = current.parent;
    }

    hoveredRoot.current = current?.userData?.agentId
        ? agentById.get(current.userData.agentId)?.root ?? null
        : null;
}

function animate() {
    resizeRenderer();
    const deltaSeconds = clock.getDelta();
    const elapsedSeconds = clock.elapsedTime;

    pickHoveredAgent();
    tickConversation(elapsedSeconds);
    updateAgents(elapsedSeconds, deltaSeconds);

    const orbitRadius = 18;
    camera.position.x = Math.sin(elapsedSeconds * 0.12) * orbitRadius;
    camera.position.z = Math.cos(elapsedSeconds * 0.12) * orbitRadius;
    camera.position.y = 9 + Math.sin(elapsedSeconds * 0.16) * 0.6;
    camera.lookAt(0, 2, 0);

    renderer.render(scene, camera);
    updateHud();
}

topicForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    beginConversation(topicInput?.value || '');
});

sceneCanvas?.addEventListener('pointermove', updatePointer);
sceneCanvas?.addEventListener('pointerleave', () => {
    hoveredRoot.current = null;
    pointer.set(10, 10);
});

window.addEventListener('resize', resizeRenderer);

createFloor();
createLightRig();
createBackdropColumns();
seedAgents();
resizeRenderer();
setWorldStatus(speechState.lastStatus);
appendLogLine('Prototype waiting for topic input.');
renderer.setAnimationLoop(animate);
beginConversation(topicInput?.value || '');
