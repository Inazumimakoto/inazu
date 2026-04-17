import * as THREE from '/scripts/three/three.module.js';

const sceneCanvas = document.querySelector('[data-scene-canvas]');
const hudLayer = document.querySelector('[data-hud-layer]');
const topicForm = document.querySelector('[data-topic-form]');
const topicInput = document.querySelector('#topic-input');
const worldStatus = document.querySelector('[data-world-status]');
const worldMode = document.querySelector('[data-world-mode]');
const logList = document.querySelector('[data-log-list]');

const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2(10, 10);
const hoveredRoot = { current: null };
const agents = [];
const agentById = new Map();
const worldState = {
    worldId: null,
    topic: '',
    status: 'connecting server orchestrator',
    llmMode: 'server orchestrator / mock utterances',
    log: [],
    activeSpeakerId: null,
    activeListenerId: null
};
const clientState = {
    stream: null,
    initializing: false
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
    worldState.status = text;
    if (worldStatus) {
        worldStatus.textContent = text;
    }
}

function setWorldMode(text) {
    worldState.llmMode = text;
    if (worldMode) {
        worldMode.textContent = text;
    }
}

function renderLog(logEntries) {
    if (!logList) {
        return;
    }

    logList.innerHTML = '';
    const entries = Array.isArray(logEntries) && logEntries.length
        ? logEntries
        : ['Prototype waiting for server state.'];

    for (const entry of entries) {
        const item = document.createElement('li');
        item.textContent = entry;
        logList.appendChild(item);
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

function ensureAgent(snapshot) {
    if (agentById.has(snapshot.id)) {
        return agentById.get(snapshot.id);
    }

    const root = createAgentVisual(snapshot.color);
    root.userData.agentId = snapshot.id;
    root.position.set(snapshot.position.x, snapshot.position.y, snapshot.position.z);
    worldGroup.add(root);

    const label = createHudTag('agent-tag', snapshot.color);
    label.textContent = snapshot.name;
    label.classList.add('is-visible');

    const bubble = createHudTag('speech-bubble', snapshot.color);

    const agent = {
        id: snapshot.id,
        name: snapshot.name,
        role: snapshot.role,
        root,
        label,
        bubble,
        serverPosition: new THREE.Vector3(snapshot.position.x, snapshot.position.y, snapshot.position.z),
        basePosition: new THREE.Vector3(snapshot.basePosition.x, snapshot.basePosition.y, snapshot.basePosition.z),
        bubbleVisible: false,
        bubbleText: ''
    };

    agents.push(agent);
    agentById.set(snapshot.id, agent);
    return agent;
}

function applySnapshot(snapshot) {
    worldState.worldId = snapshot.worldId;
    worldState.topic = snapshot.topic;
    worldState.status = snapshot.status;
    worldState.llmMode = snapshot.llmMode;
    worldState.log = Array.isArray(snapshot.log) ? snapshot.log : [];
    worldState.activeSpeakerId = snapshot.activeSpeakerId;
    worldState.activeListenerId = snapshot.activeListenerId;

    setWorldStatus(snapshot.status);
    setWorldMode(snapshot.llmMode);
    renderLog(snapshot.log);

    if (topicInput && document.activeElement !== topicInput) {
        topicInput.value = snapshot.topic;
    }

    for (const agentSnapshot of snapshot.agents || []) {
        const agent = ensureAgent(agentSnapshot);
        agent.name = agentSnapshot.name;
        agent.role = agentSnapshot.role;
        agent.serverPosition.set(
            agentSnapshot.position.x,
            agentSnapshot.position.y,
            agentSnapshot.position.z
        );
        agent.basePosition.set(
            agentSnapshot.basePosition.x,
            agentSnapshot.basePosition.y,
            agentSnapshot.basePosition.z
        );
        agent.bubbleVisible = agentSnapshot.bubbleVisible;
        agent.bubbleText = agentSnapshot.bubbleText;
        agent.label.textContent = agentSnapshot.name;

        if (agentSnapshot.bubbleVisible) {
            agent.bubble.innerHTML = `<strong>${agentSnapshot.name}</strong><span>${agentSnapshot.bubbleText}</span>`;
            agent.bubble.classList.add('is-visible');
        } else {
            agent.bubble.innerHTML = '';
            agent.bubble.classList.remove('is-visible');
        }
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

function updateAgents(elapsedSeconds, deltaSeconds) {
    for (const [index, agent] of agents.entries()) {
        const wobble = Math.sin(elapsedSeconds * 1.8 + index * 1.4) * 0.08;
        const targetPosition = agent.serverPosition.clone();
        targetPosition.y += wobble + (hoveredRoot.current === agent.root ? hoverLift : 0);

        agent.root.position.lerp(targetPosition, Math.min(1, deltaSeconds * 5.2));

        const counterpartId = worldState.activeSpeakerId === agent.id
            ? worldState.activeListenerId
            : worldState.activeListenerId === agent.id
                ? worldState.activeSpeakerId
                : null;
        const facingTarget = counterpartId && agentById.get(counterpartId)
            ? agentById.get(counterpartId).serverPosition
            : new THREE.Vector3(0, 0.2, 0);

        const direction = facingTarget.clone().sub(agent.root.position);
        const yaw = Math.atan2(direction.x, direction.z);
        agent.root.rotation.y += (yaw - agent.root.rotation.y) * Math.min(1, deltaSeconds * 4.2);

        const scaleTarget = hoveredRoot.current === agent.root ? agentScaleActive : 1;
        agent.root.scale.lerp(new THREE.Vector3(scaleTarget, scaleTarget, scaleTarget), Math.min(1, deltaSeconds * 5));

        const { halo, pulseRing, body } = agent.root.userData;
        halo.rotation.z += deltaSeconds * 0.6;
        pulseRing.scale.setScalar(1 + Math.sin(elapsedSeconds * 3 + index) * 0.04);
        pulseRing.material.opacity = worldState.activeSpeakerId === agent.id ? 0.42 : 0.2;
        body.material.emissiveIntensity = worldState.activeSpeakerId === agent.id ? 0.35 : 0.08;
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
    updateAgents(elapsedSeconds, deltaSeconds);

    const orbitRadius = 18;
    camera.position.x = Math.sin(elapsedSeconds * 0.12) * orbitRadius;
    camera.position.z = Math.cos(elapsedSeconds * 0.12) * orbitRadius;
    camera.position.y = 9 + Math.sin(elapsedSeconds * 0.16) * 0.6;
    camera.lookAt(0, 2, 0);

    renderer.render(scene, camera);
    updateHud();
}

async function createWorld(topic) {
    clientState.initializing = true;
    setWorldStatus('creating server world');

    const response = await fetch('/api/mas/worlds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic })
    });

    if (!response.ok) {
        throw new Error(`failed to create world: ${response.status}`);
    }

    const snapshot = await response.json();
    applySnapshot(snapshot);
    connectStream(snapshot.worldId);
    clientState.initializing = false;
}

async function restartWorld(topic) {
    if (!worldState.worldId) {
        await createWorld(topic);
        return;
    }

    setWorldStatus('restarting server world');

    const response = await fetch(`/api/mas/worlds/${worldState.worldId}/topic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic })
    });

    if (response.status === 404) {
        await createWorld(topic);
        return;
    }

    if (!response.ok) {
        throw new Error(`failed to restart world: ${response.status}`);
    }

    const snapshot = await response.json();
    applySnapshot(snapshot);
}

function connectStream(worldId) {
    clientState.stream?.close();

    const stream = new EventSource(`/api/mas/worlds/${worldId}/stream`);
    stream.onmessage = (event) => {
        try {
            applySnapshot(JSON.parse(event.data));
        } catch (error) {
            console.error('[MAS] failed to parse snapshot:', error);
        }
    };
    stream.onerror = () => {
        setWorldStatus('stream reconnecting to server world');
    };

    clientState.stream = stream;
}

topicForm?.addEventListener('submit', async (event) => {
    event.preventDefault();

    try {
        await restartWorld(topicInput?.value || '');
    } catch (error) {
        console.error('[MAS] failed to submit topic:', error);
        setWorldStatus('failed to update topic');
    }
});

sceneCanvas?.addEventListener('pointermove', updatePointer);
sceneCanvas?.addEventListener('pointerleave', () => {
    hoveredRoot.current = null;
    pointer.set(10, 10);
});

window.addEventListener('resize', resizeRenderer);
window.addEventListener('beforeunload', () => {
    clientState.stream?.close();
});

createFloor();
createLightRig();
createBackdropColumns();
resizeRenderer();
renderLog([]);
setWorldStatus(worldState.status);
setWorldMode(worldState.llmMode);
renderer.setAnimationLoop(animate);

createWorld(topicInput?.value || '').catch((error) => {
    console.error('[MAS] failed to initialize world:', error);
    setWorldStatus('failed to initialize world');
});
