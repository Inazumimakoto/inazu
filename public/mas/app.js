import * as THREE from '/scripts/three/three.module.js';

const sceneCanvas = document.querySelector('[data-scene-canvas]');
const hudLayer = document.querySelector('[data-hud-layer]');
const topicForm = document.querySelector('[data-topic-form]');
const topicInput = document.querySelector('#topic-input');
const logList = document.querySelector('[data-log-list]');
const menuButtons = Array.from(document.querySelectorAll('[data-menu-toggle]'));
const controlPanel = document.querySelector('[data-control-panel]');
const sceneTopic = document.querySelector('[data-scene-topic]');
const sceneHint = document.querySelector('[data-scene-hint]');
const menuStatus = document.querySelector('[data-menu-status]');

const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const hoverPointer = new THREE.Vector2(10, 10);
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hoveredRoot = { current: null };
const agents = [];
const agentById = new Map();
const cameraOffset = new THREE.Vector3(16, 15, 16);
const interactionState = {
    activePointerId: null,
    pointerPanning: false,
    panStartPoint: null,
    panStartTarget: null,
    touchMode: 'none',
    touchPanStartPoint: null,
    touchPanStartTarget: null,
    pinchStartDistance: 0,
    pinchStartZoom: 1,
    pinchStartPoint: null,
    pinchStartTarget: null
};

const worldState = {
    worldId: null,
    topic: '',
    status: 'connecting server orchestrator',
    phase: 'waiting_topic',
    isRunning: false,
    llmMode: 'server orchestrator / mock utterances',
    log: [],
    activeSpeakerId: null,
    activeListenerId: null
};

const clientState = {
    stream: null,
    initializing: false,
    menuOpen: false
};

const cameraState = {
    target: new THREE.Vector3(0, 1.4, 0),
    zoom: 1.02,
    minZoom: 0.72,
    maxZoom: 2.6,
    frustumHeight: 28
};

const renderer = new THREE.WebGLRenderer({
    canvas: sceneCanvas,
    antialias: true,
    alpha: true
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x051018);
scene.fog = new THREE.Fog(0x051018, 24, 48);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 120);

const worldGroup = new THREE.Group();
scene.add(worldGroup);

const hoverLift = 0.28;
const agentScaleActive = 1.04;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function setWorldStatus(text) {
    worldState.status = text;
    if (menuStatus) {
        menuStatus.textContent = text;
    }
    updateSceneMeta();
}

function setWorldMode(text) {
    worldState.llmMode = text;
}

function updateSceneMeta() {
    if (sceneTopic) {
        sceneTopic.textContent = worldState.topic
            ? `Topic: ${worldState.topic}`
            : 'No topic loaded.';
    }

    if (!sceneHint) {
        return;
    }

    if (!worldState.topic) {
        sceneHint.textContent = 'メニューから議題を入力すると、止まっていたエージェントが動き出します。';
        return;
    }

    if (worldState.isRunning) {
        sceneHint.textContent = worldState.status;
        return;
    }

    if (worldState.phase === 'complete') {
        sceneHint.textContent = '会話は一周しました。メニューから別の議題を入れると再開します。';
        return;
    }

    sceneHint.textContent = worldState.status;
}

function getEmptyLogMessage() {
    if (!worldState.topic) {
        return 'まだ会話は始まっていません。menu から議題を入力するとエージェントが動き出します。';
    }

    if (worldState.phase === 'complete') {
        return 'この議題の会話は完了しました。別の議題を入れると新しく始まります。';
    }

    return 'サーバーからの会話を待っています。';
}

function renderLog(logEntries) {
    if (!logList) {
        return;
    }

    logList.innerHTML = '';
    const entries = Array.isArray(logEntries) && logEntries.length
        ? logEntries
        : [getEmptyLogMessage()];

    for (const entry of entries) {
        const item = document.createElement('li');
        item.textContent = entry;
        logList.appendChild(item);
    }
}

function setMenuOpen(isOpen) {
    clientState.menuOpen = isOpen;
    controlPanel?.classList.toggle('is-open', isOpen);
    controlPanel?.setAttribute('aria-hidden', String(!isOpen));

    for (const button of menuButtons) {
        button.textContent = isOpen ? 'close' : 'menu';
        button.setAttribute('aria-expanded', String(isOpen));
    }
}

function toggleMenu() {
    setMenuOpen(!clientState.menuOpen);
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
        new THREE.CylinderGeometry(13.4, 15.2, 0.6, 56, 1, false),
        new THREE.MeshStandardMaterial({
            color: 0x08161d,
            roughness: 0.84,
            metalness: 0.16
        })
    );
    floor.position.y = -0.4;
    worldGroup.add(floor);

    const outerRing = new THREE.Mesh(
        new THREE.TorusGeometry(11.9, 0.08, 12, 92),
        new THREE.MeshBasicMaterial({ color: 0x7df0ff, transparent: true, opacity: 0.32 })
    );
    outerRing.rotation.x = Math.PI / 2;
    worldGroup.add(outerRing);

    const innerRing = new THREE.Mesh(
        new THREE.TorusGeometry(6.4, 0.06, 12, 72),
        new THREE.MeshBasicMaterial({ color: 0xffbf69, transparent: true, opacity: 0.36 })
    );
    innerRing.rotation.x = Math.PI / 2;
    innerRing.position.y = 0.04;
    worldGroup.add(innerRing);

    const spokes = new THREE.Group();
    for (let index = 0; index < 10; index += 1) {
        const spoke = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, 0.02, 11.8),
            new THREE.MeshBasicMaterial({ color: 0x1a4756, transparent: true, opacity: 0.4 })
        );
        spoke.rotation.y = (Math.PI / 5) * index;
        spoke.position.y = 0.06;
        spokes.add(spoke);
    }
    worldGroup.add(spokes);
}

function createLightRig() {
    const hemi = new THREE.HemisphereLight(0xbfefff, 0x081318, 1.1);
    scene.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, 1.35);
    key.position.set(8, 14, 6);
    scene.add(key);

    const cyanGlow = new THREE.PointLight(0x7df0ff, 22, 30, 2);
    cyanGlow.position.set(-11, 7, 8);
    scene.add(cyanGlow);

    const warmGlow = new THREE.PointLight(0xffbf69, 18, 24, 2);
    warmGlow.position.set(9, 6, -6);
    scene.add(warmGlow);
}

function createBackdropColumns() {
    const columnGeometry = new THREE.CylinderGeometry(0.12, 0.12, 6.5, 12);
    const columnMaterial = new THREE.MeshBasicMaterial({
        color: 0x163746,
        transparent: true,
        opacity: 0.44
    });

    for (let index = 0; index < 18; index += 1) {
        const angle = (Math.PI * 2 * index) / 18;
        const radius = 17 + (index % 2 === 0 ? 0 : 1.6);
        const column = new THREE.Mesh(columnGeometry, columnMaterial);
        column.position.set(Math.cos(angle) * radius, 2.8, Math.sin(angle) * radius);
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
    worldState.phase = snapshot.phase || 'waiting_topic';
    worldState.isRunning = Boolean(snapshot.isRunning);
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

function getCanvasNdc(clientX, clientY) {
    const rect = sceneCanvas.getBoundingClientRect();
    return {
        x: ((clientX - rect.left) / rect.width) * 2 - 1,
        y: -((clientY - rect.top) / rect.height) * 2 + 1
    };
}

function getGroundPoint(clientX, clientY) {
    const ndc = getCanvasNdc(clientX, clientY);
    raycaster.setFromCamera(ndc, camera);
    const point = new THREE.Vector3();
    return raycaster.ray.intersectPlane(groundPlane, point) ? point : null;
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

function updateCamera() {
    camera.position.copy(cameraState.target).add(cameraOffset);
    camera.lookAt(cameraState.target);
    camera.updateMatrixWorld();
}

function resizeRenderer() {
    const rect = sceneCanvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));

    if (sceneCanvas.width !== width || sceneCanvas.height !== height) {
        renderer.setSize(width, height, false);
    }

    const aspect = width / height;
    const frustumHalfHeight = cameraState.frustumHeight * 0.5;
    const frustumHalfWidth = frustumHalfHeight * aspect;

    camera.left = -frustumHalfWidth;
    camera.right = frustumHalfWidth;
    camera.top = frustumHalfHeight;
    camera.bottom = -frustumHalfHeight;
    camera.zoom = cameraState.zoom;
    camera.updateProjectionMatrix();
    updateCamera();
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

function updateHoverPointer(clientX, clientY) {
    const ndc = getCanvasNdc(clientX, clientY);
    hoverPointer.set(ndc.x, ndc.y);
}

function pickHoveredAgent() {
    if (interactionState.pointerPanning || interactionState.touchMode !== 'none') {
        hoveredRoot.current = null;
        return;
    }

    raycaster.setFromCamera(hoverPointer, camera);
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

function panCamera(startPoint, currentPoint, startTarget) {
    if (!startPoint || !currentPoint || !startTarget) {
        return;
    }

    const delta = startPoint.clone().sub(currentPoint);
    cameraState.target.copy(startTarget.clone().add(delta));
}

function onPointerDown(event) {
    if (event.pointerType === 'touch' || event.button !== 0) {
        return;
    }

    const groundPoint = getGroundPoint(event.clientX, event.clientY);
    if (!groundPoint) {
        return;
    }

    interactionState.activePointerId = event.pointerId;
    interactionState.pointerPanning = true;
    interactionState.panStartPoint = groundPoint;
    interactionState.panStartTarget = cameraState.target.clone();
    hoveredRoot.current = null;
    sceneCanvas.setPointerCapture?.(event.pointerId);
}

function onPointerMove(event) {
    if (event.pointerType === 'touch') {
        return;
    }

    updateHoverPointer(event.clientX, event.clientY);

    if (!interactionState.pointerPanning || interactionState.activePointerId !== event.pointerId) {
        return;
    }

    event.preventDefault();
    const groundPoint = getGroundPoint(event.clientX, event.clientY);
    panCamera(interactionState.panStartPoint, groundPoint, interactionState.panStartTarget);
}

function stopPointerPan(pointerId) {
    if (interactionState.activePointerId !== pointerId) {
        return;
    }

    sceneCanvas.releasePointerCapture?.(pointerId);
    interactionState.activePointerId = null;
    interactionState.pointerPanning = false;
    interactionState.panStartPoint = null;
    interactionState.panStartTarget = null;
}

function onWheel(event) {
    event.preventDefault();
    const nextZoom = cameraState.zoom * Math.exp(-event.deltaY * 0.0012);
    cameraState.zoom = clamp(nextZoom, cameraState.minZoom, cameraState.maxZoom);
    resizeRenderer();
}

function getTouchDistance(touches) {
    const [first, second] = touches;
    return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
}

function getTouchMidpoint(touches) {
    const [first, second] = touches;
    return {
        x: (first.clientX + second.clientX) * 0.5,
        y: (first.clientY + second.clientY) * 0.5
    };
}

function primeSingleTouch(touch) {
    interactionState.touchMode = 'pan';
    interactionState.touchPanStartPoint = getGroundPoint(touch.clientX, touch.clientY);
    interactionState.touchPanStartTarget = cameraState.target.clone();
}

function onTouchStart(event) {
    if (event.touches.length === 1) {
        primeSingleTouch(event.touches[0]);
        updateHoverPointer(event.touches[0].clientX, event.touches[0].clientY);
        return;
    }

    if (event.touches.length !== 2) {
        return;
    }

    event.preventDefault();
    const midpoint = getTouchMidpoint(event.touches);
    interactionState.touchMode = 'pinch';
    interactionState.pinchStartDistance = getTouchDistance(event.touches);
    interactionState.pinchStartZoom = cameraState.zoom;
    interactionState.pinchStartPoint = getGroundPoint(midpoint.x, midpoint.y);
    interactionState.pinchStartTarget = cameraState.target.clone();
    updateHoverPointer(midpoint.x, midpoint.y);
}

function onTouchMove(event) {
    if (event.touches.length === 1 && interactionState.touchMode === 'pan') {
        event.preventDefault();
        const touch = event.touches[0];
        updateHoverPointer(touch.clientX, touch.clientY);
        const groundPoint = getGroundPoint(touch.clientX, touch.clientY);
        panCamera(interactionState.touchPanStartPoint, groundPoint, interactionState.touchPanStartTarget);
        return;
    }

    if (event.touches.length !== 2) {
        return;
    }

    event.preventDefault();
    const midpoint = getTouchMidpoint(event.touches);
    updateHoverPointer(midpoint.x, midpoint.y);

    const distance = getTouchDistance(event.touches);
    const nextZoom = interactionState.pinchStartZoom * (distance / interactionState.pinchStartDistance);
    cameraState.zoom = clamp(nextZoom, cameraState.minZoom, cameraState.maxZoom);

    const groundPoint = getGroundPoint(midpoint.x, midpoint.y);
    panCamera(interactionState.pinchStartPoint, groundPoint, interactionState.pinchStartTarget);
    resizeRenderer();
}

function onTouchEnd(event) {
    if (event.touches.length === 1) {
        primeSingleTouch(event.touches[0]);
        return;
    }

    if (event.touches.length === 0) {
        interactionState.touchMode = 'none';
        interactionState.touchPanStartPoint = null;
        interactionState.touchPanStartTarget = null;
        interactionState.pinchStartPoint = null;
        interactionState.pinchStartTarget = null;
        return;
    }

    interactionState.touchMode = 'none';
}

function animate() {
    resizeRenderer();
    const deltaSeconds = clock.getDelta();
    const elapsedSeconds = clock.elapsedTime;

    pickHoveredAgent();
    updateAgents(elapsedSeconds, deltaSeconds);
    updateCamera();

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

    setWorldStatus(topic ? 'starting discussion' : 'returning agents to idle');

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

    const nextTopic = topicInput?.value?.trim() || '';

    try {
        await restartWorld(nextTopic);
        if (nextTopic) {
            setMenuOpen(false);
        }
    } catch (error) {
        console.error('[MAS] failed to submit topic:', error);
        setWorldStatus('failed to update topic');
    }
});

for (const button of menuButtons) {
    button.addEventListener('click', toggleMenu);
}

sceneCanvas?.addEventListener('pointerdown', onPointerDown);
sceneCanvas?.addEventListener('pointermove', onPointerMove);
sceneCanvas?.addEventListener('pointerup', (event) => stopPointerPan(event.pointerId));
sceneCanvas?.addEventListener('pointercancel', (event) => stopPointerPan(event.pointerId));
sceneCanvas?.addEventListener('pointerleave', () => {
    if (!interactionState.pointerPanning) {
        hoveredRoot.current = null;
        hoverPointer.set(10, 10);
    }
});
sceneCanvas?.addEventListener('wheel', onWheel, { passive: false });
sceneCanvas?.addEventListener('touchstart', onTouchStart, { passive: false });
sceneCanvas?.addEventListener('touchmove', onTouchMove, { passive: false });
sceneCanvas?.addEventListener('touchend', onTouchEnd, { passive: false });
sceneCanvas?.addEventListener('touchcancel', onTouchEnd, { passive: false });

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
setMenuOpen(false);
renderer.setAnimationLoop(animate);

createWorld('').catch((error) => {
    console.error('[MAS] failed to initialize world:', error);
    setWorldStatus('failed to initialize world');
});
