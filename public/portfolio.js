const revealTargets = document.querySelectorAll('.reveal');
const tiltTargets = document.querySelectorAll('[data-tilt]');
const hero = document.querySelector('[data-hero]');
const backgroundControls = document.querySelector('[data-background-controls]');
const backgroundToggle = document.querySelector('[data-background-toggle]');
const backgroundSlotMenu = document.querySelector('[data-background-slot-menu]');
const backgroundSlotTrigger = document.querySelector('[data-background-slot-trigger]');
const backgroundSlotValue = document.querySelector('[data-background-slot-value]');
const backgroundSlotOptions = document.querySelector('[data-background-slot-options]');
const backgroundSlotButtons = Array.from(document.querySelectorAll('[data-background-slot-mode]'));
const pageCanvas = document.querySelector('[data-page-canvas]');
const celebrationCanvas = document.querySelector('[data-celebration-canvas]');
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const glassCopyTargets = Array.from(document.querySelectorAll('.text-glass-copy'));
const FALLBACK_BACKGROUND_PHOTO = 'assets/hero-dinner.jpg';
const BACKGROUND_SLOTS = ['morning', 'lunch', 'night'];
const BACKGROUND_SLOT_MODES = ['current', ...BACKGROUND_SLOTS];
const BACKGROUND_SLOT_LABELS = {
    current: '自動',
    morning: '朝',
    lunch: '昼',
    night: '夜'
};
const BACKGROUND_QUEUE_STORAGE_KEY = 'inazu:background-queues:v1';
const BACKGROUND_SLOT_MODE_STORAGE_KEY = 'inazu:background-slot-mode:v1';
const BACKGROUND_VIEW_STORAGE_KEY = 'inazu:background-view:v1';
const LEGACY_LAST_BACKGROUND_STORAGE_KEY = 'inazu:last-background-photo';
let backgroundRenderer = null;
let celebrationRenderer = null;
let backgroundSlotMode = readStoredBackgroundSlotMode();
let backgroundViewEnabled = readStoredBackgroundView();
let backgroundSlotMenuOpen = false;
let loadedBackgroundPhotos = null;

function getMealSlot(date = new Date()) {
    const hour = date.getHours();

    if (hour >= 5 && hour < 11) {
        return 'morning';
    }

    if (hour >= 11 && hour < 17) {
        return 'lunch';
    }

    return 'night';
}

function normalizeBackgroundPhotos(data) {
    const photos = {};

    for (const slot of BACKGROUND_SLOTS) {
        const values = Array.isArray(data?.[slot]) ? data[slot] : [];
        photos[slot] = values.filter((value) => {
            return typeof value === 'string' && value.startsWith(`assets/backgrounds/${slot}/`);
        });
    }

    return photos;
}

function isBackgroundPhotoForSlot(photo, slot) {
    return typeof photo === 'string' && photo.startsWith(`assets/backgrounds/${slot}/`);
}

function isBackgroundSlotMode(mode) {
    return BACKGROUND_SLOT_MODES.includes(mode);
}

function getBackgroundSlotLabel(mode) {
    return BACKGROUND_SLOT_LABELS[mode] || BACKGROUND_SLOT_LABELS.current;
}

function readStoredBackgroundSlotMode() {
    try {
        const value = window.localStorage.getItem(BACKGROUND_SLOT_MODE_STORAGE_KEY);

        return isBackgroundSlotMode(value) ? value : 'current';
    } catch (error) {
        return 'current';
    }
}

function writeStoredBackgroundSlotMode(mode) {
    try {
        window.localStorage.setItem(BACKGROUND_SLOT_MODE_STORAGE_KEY, mode);

        return true;
    } catch (error) {
        return false;
    }
}

function setBackgroundSlotMode(mode) {
    if (!isBackgroundSlotMode(mode)) return;

    backgroundSlotMode = mode;
    writeStoredBackgroundSlotMode(mode);
}

function getActiveBackgroundSlot(date = new Date()) {
    if (backgroundSlotMode === 'current') {
        return getMealSlot(date);
    }

    return backgroundSlotMode;
}

function readStoredBackgroundView() {
    try {
        return window.localStorage.getItem(BACKGROUND_VIEW_STORAGE_KEY) === 'true';
    } catch (error) {
        return false;
    }
}

function writeStoredBackgroundView(enabled) {
    try {
        window.localStorage.setItem(BACKGROUND_VIEW_STORAGE_KEY, enabled ? 'true' : 'false');

        return true;
    } catch (error) {
        return false;
    }
}

function setBackgroundView(enabled) {
    backgroundViewEnabled = enabled;
    writeStoredBackgroundView(enabled);
    document.body.classList.toggle('background-view', enabled);
    celebrationRenderer?.setSpawnEnabled(!enabled);
}

function arraysEqual(first, second) {
    if (!Array.isArray(first) || !Array.isArray(second) || first.length !== second.length) {
        return false;
    }

    return first.every((value, index) => value === second[index]);
}

function shufflePhotos(photos, avoidFirstPhoto = '') {
    const shuffled = [...photos];

    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }

    if (avoidFirstPhoto && shuffled.length > 1 && shuffled[0] === avoidFirstPhoto) {
        const swapIndex = shuffled.findIndex((photo) => photo !== avoidFirstPhoto);

        if (swapIndex > 0) {
            [shuffled[0], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[0]];
        }
    }

    return shuffled;
}

function readBackgroundQueueState() {
    try {
        const value = window.localStorage.getItem(BACKGROUND_QUEUE_STORAGE_KEY);
        const state = value ? JSON.parse(value) : null;

        if (!state || typeof state !== 'object' || !state.slots || typeof state.slots !== 'object') {
            return { slots: {} };
        }

        return state;
    } catch (error) {
        return { slots: {} };
    }
}

function writeBackgroundQueueState(state) {
    try {
        window.localStorage.setItem(BACKGROUND_QUEUE_STORAGE_KEY, JSON.stringify(state));

        return true;
    } catch (error) {
        return false;
    }
}

function readLegacyLastBackground(slot) {
    try {
        const value = window.localStorage.getItem(LEGACY_LAST_BACKGROUND_STORAGE_KEY);
        const parsed = value ? JSON.parse(value) : null;

        if (!parsed || parsed.slot !== slot || !isBackgroundPhotoForSlot(parsed.photo, slot)) {
            return '';
        }

        return parsed.photo;
    } catch (error) {
        return '';
    }
}

function readInitialBackgroundPhoto(slot) {
    const state = readBackgroundQueueState();
    const slotState = state.slots[slot] || {};
    const storedPhoto = typeof slotState.lastPhoto === 'string' ? slotState.lastPhoto : '';
    const storedCandidates = Array.isArray(slotState.candidates) ? slotState.candidates : [];

    if (isBackgroundPhotoForSlot(storedPhoto, slot) && (!storedCandidates.length || storedCandidates.includes(storedPhoto))) {
        return storedPhoto;
    }

    return readLegacyLastBackground(slot);
}

function pickRandomPhoto(candidates) {
    if (!candidates.length) return FALLBACK_BACKGROUND_PHOTO;

    return candidates[Math.floor(Math.random() * candidates.length)] || FALLBACK_BACKGROUND_PHOTO;
}

function pickQueuedPhoto(candidates, slot) {
    if (!candidates.length) return FALLBACK_BACKGROUND_PHOTO;
    if (candidates.length === 1) return candidates[0];

    const state = readBackgroundQueueState();
    const slotState = state.slots[slot] || {};
    const previousPhoto = typeof slotState.lastPhoto === 'string' ? slotState.lastPhoto : '';
    const shouldRebuildQueue = !arraysEqual(slotState.candidates, candidates);
    let queue = shouldRebuildQueue
        ? shufflePhotos(candidates, previousPhoto)
        : Array.isArray(slotState.remaining)
            ? slotState.remaining.filter((photo) => candidates.includes(photo))
            : [];

    if (!queue.length) {
        queue = shufflePhotos(candidates, previousPhoto);
    }

    const photo = queue.shift() || pickRandomPhoto(candidates);
    const nextState = {
        ...state,
        slots: {
            ...state.slots,
            [slot]: {
                candidates: [...candidates],
                remaining: queue,
                lastPhoto: photo
            }
        }
    };

    if (!writeBackgroundQueueState(nextState)) {
        return pickRandomPhoto(candidates);
    }

    return photo;
}

function createInitialBackground(date = new Date(), slot = getActiveBackgroundSlot(date)) {
    const photo = readInitialBackgroundPhoto(slot);

    if (photo) {
        return { slot, activeSlot: slot, photo };
    }

    return { slot, activeSlot: 'fallback', photo: FALLBACK_BACKGROUND_PHOTO };
}

function resolveBackgroundPhoto(backgroundPhotos, date = new Date(), slot = getActiveBackgroundSlot(date)) {
    const candidates = backgroundPhotos[slot] || [];
    const selected = {
        slot,
        activeSlot: candidates.length ? slot : 'fallback',
        photo: pickQueuedPhoto(candidates, slot)
    };
    return selected;
}

function applyBackgroundPhoto(background) {
    document.documentElement.style.setProperty('--page-photo-url', `url("${background.photo}")`);
    document.body.dataset.mealSlot = background.activeSlot;
}

async function loadBackgroundPhotos() {
    const response = await fetch('/api/backgrounds', { cache: 'no-store' });

    if (!response.ok) {
        throw new Error(`Background API returned ${response.status}`);
    }

    return normalizeBackgroundPhotos(await response.json());
}

function applyResolvedBackground(backgroundPhotos = loadedBackgroundPhotos) {
    if (!backgroundPhotos) return;

    selectedBackground = resolveBackgroundPhoto(backgroundPhotos);
    applyBackgroundPhoto(selectedBackground);
    backgroundRenderer?.setPhoto?.(selectedBackground.photo);
}

setBackgroundView(backgroundViewEnabled);
let selectedBackground = createInitialBackground();
applyBackgroundPhoto(selectedBackground);

loadBackgroundPhotos()
    .then((backgroundPhotos) => {
        loadedBackgroundPhotos = backgroundPhotos;
        applyResolvedBackground(backgroundPhotos);
    })
    .catch((error) => {
        console.warn('Background photo API failed; keeping the initial photo.', error);
    });

const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
    }
}, {
    threshold: 0.12
});

for (const target of revealTargets) {
    observer.observe(target);
}

function setBackgroundSlotMenuOpen(open) {
    backgroundSlotMenuOpen = Boolean(open);
    backgroundSlotMenu?.classList.toggle('is-open', backgroundSlotMenuOpen);
    backgroundSlotTrigger?.setAttribute('aria-expanded', backgroundSlotMenuOpen ? 'true' : 'false');

    if (backgroundSlotOptions) {
        backgroundSlotOptions.hidden = !backgroundSlotMenuOpen;
    }
}

function syncBackgroundControls() {
    if (backgroundToggle) {
        backgroundToggle.setAttribute('aria-pressed', backgroundViewEnabled ? 'true' : 'false');
        backgroundToggle.textContent = backgroundViewEnabled ? 'サイトに戻る' : '写真だけ見る';
    }

    if (backgroundSlotValue) {
        backgroundSlotValue.textContent = getBackgroundSlotLabel(backgroundSlotMode);
    }

    if (backgroundSlotTrigger) {
        backgroundSlotTrigger.setAttribute('aria-label', `背景画像の時間帯: ${getBackgroundSlotLabel(backgroundSlotMode)}`);
    }

    for (const button of backgroundSlotButtons) {
        const isSelected = button.dataset.backgroundSlotMode === backgroundSlotMode;
        button.setAttribute('aria-checked', isSelected ? 'true' : 'false');
    }
}

if (backgroundToggle) {
    backgroundToggle.addEventListener('click', () => {
        setBackgroundView(!backgroundViewEnabled);
        syncBackgroundControls();
        backgroundRenderer?.renderNow();
    });
}

if (backgroundSlotTrigger) {
    backgroundSlotTrigger.addEventListener('click', () => {
        setBackgroundSlotMenuOpen(!backgroundSlotMenuOpen);
    });
}

for (const button of backgroundSlotButtons) {
    button.addEventListener('click', () => {
        setBackgroundSlotMode(button.dataset.backgroundSlotMode);
        setBackgroundSlotMenuOpen(false);
        syncBackgroundControls();
        applyResolvedBackground();
    });
}

document.addEventListener('click', (event) => {
    if (!backgroundSlotMenuOpen || backgroundControls?.contains(event.target)) return;

    setBackgroundSlotMenuOpen(false);
});

document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !backgroundSlotMenuOpen) return;

    setBackgroundSlotMenuOpen(false);
    backgroundSlotTrigger?.focus();
});

syncBackgroundControls();

function appendGlassToken(container, token) {
    if (token.type === 'text') {
        container.appendChild(document.createTextNode(token.value));
        return;
    }

    const template = document.createElement('template');
    template.innerHTML = token.html;
    const node = template.content.firstChild;
    if (node) {
        container.appendChild(node);
    }
}

function extractGlassTokens(node) {
    const tokens = [];

    for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
            for (const char of child.textContent ?? '') {
                tokens.push({
                    type: 'text',
                    value: char
                });
            }
            continue;
        }

        if (child.nodeType === Node.ELEMENT_NODE) {
            tokens.push({
                type: 'html',
                html: child.outerHTML
            });
        }
    }

    return tokens;
}

function buildGlassMask(width, height, rects) {
    const svgRects = rects.map((rect) => {
        return `<rect x="${rect.x.toFixed(1)}" y="${rect.y.toFixed(1)}" width="${rect.width.toFixed(1)}" height="${rect.height.toFixed(1)}" rx="${rect.radius.toFixed(1)}" ry="${rect.radius.toFixed(1)}" fill="white"/>`;
    }).join('');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width.toFixed(1)} ${height.toFixed(1)}">${svgRects}</svg>`;
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

function layoutGlassCopy(target) {
    if (!target.dataset.originalHtml) {
        target.dataset.originalHtml = target.innerHTML;
    }

    target.classList.remove('is-line-built');
    target.innerHTML = target.dataset.originalHtml;

    const tokens = extractGlassTokens(target);
    if (!tokens.length) return;

    target.innerHTML = '';
    const measures = [];

    for (const token of tokens) {
        const measure = document.createElement('span');
        measure.className = 'text-glass-measure';
        appendGlassToken(measure, token);
        target.appendChild(measure);
        measures.push(measure);
    }

    const lines = [];
    let currentTop = null;

    measures.forEach((measure, index) => {
        const top = Math.round(measure.getBoundingClientRect().top);
        if (currentTop === null || Math.abs(top - currentTop) > 2) {
            lines.push([]);
            currentTop = top;
        }
        lines[lines.length - 1].push(tokens[index]);
    });

    target.innerHTML = '';
    target.classList.add('is-line-built');

    const shape = document.createElement('span');
    shape.className = 'text-glass-shape';

    const highlight = document.createElement('span');
    highlight.className = 'text-glass-highlight';

    const surfaces = document.createElement('span');
    surfaces.className = 'text-glass-surfaces';

    const content = document.createElement('span');
    content.className = 'text-glass-content';

    for (const lineTokens of lines) {
        const line = document.createElement('span');
        line.className = 'text-glass-line';
        for (const token of lineTokens) {
            appendGlassToken(line, token);
        }
        content.appendChild(line);
    }

    target.append(surfaces, shape, highlight, content);

    const lineElements = Array.from(content.children);
    const padX = 10;
    const padY = 4;
    const joinOverlap = 12;
    const maxWidth = Math.ceil(content.offsetWidth + padX * 2);
    const maxHeight = Math.ceil(content.offsetHeight + padY * 2);

    shape.style.left = `${-padX}px`;
    shape.style.top = `${-padY}px`;
    shape.style.width = `${maxWidth}px`;
    shape.style.height = `${maxHeight}px`;

    highlight.style.left = `${-padX}px`;
    highlight.style.top = `${-padY}px`;
    highlight.style.width = `${maxWidth}px`;
    highlight.style.height = `${maxHeight}px`;

    const rects = lineElements.map((line, index) => {
        const x = line.offsetLeft;
        const y = Math.max(0, line.offsetTop - (index === 0 ? 0 : joinOverlap));
        const height = line.offsetHeight + padY * 2 + (index === 0 ? 0 : joinOverlap);
        return {
            x,
            y,
            width: line.offsetWidth + padX * 2,
            height,
            radius: Math.min((line.offsetHeight + padY * 2) * 0.5, 30)
        };
    });

    const mask = buildGlassMask(maxWidth, maxHeight, rects);
    target.style.setProperty('--text-glass-mask', mask);

    surfaces.innerHTML = '';
    const surfaceInset = 2;
    for (const rect of rects) {
        const surface = document.createElement('span');
        surface.className = 'text-glass-surface';
        const insetWidth = Math.max(rect.width - surfaceInset * 2, 8);
        const insetHeight = Math.max(rect.height - surfaceInset * 2, 8);
        const insetRadius = Math.max(rect.radius - surfaceInset, 8);
        surface.style.left = `${rect.x - padX + surfaceInset}px`;
        surface.style.top = `${rect.y - padY + surfaceInset}px`;
        surface.style.width = `${insetWidth}px`;
        surface.style.height = `${insetHeight}px`;
        surface.style.borderRadius = `${insetRadius}px`;
        surfaces.appendChild(surface);
    }
}

let glassCopyLayoutFrame = 0;

function scheduleGlassCopyLayout() {
    cancelAnimationFrame(glassCopyLayoutFrame);
    glassCopyLayoutFrame = requestAnimationFrame(() => {
        for (const target of glassCopyTargets) {
            layoutGlassCopy(target);
        }
    });
}

if (glassCopyTargets.length) {
    scheduleGlassCopyLayout();
    window.addEventListener('resize', scheduleGlassCopyLayout);
    document.fonts?.ready?.then(scheduleGlassCopyLayout);
}

for (const card of tiltTargets) {
    card.addEventListener('pointermove', (event) => {
        if (prefersReducedMotion.matches) return;

        const rect = card.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;
        const rotateX = (0.5 - y) * 7;
        const rotateY = (x - 0.5) * 10;
        card.style.transform = `perspective(1200px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-4px)`;
    });

    card.addEventListener('pointerleave', () => {
        card.style.transform = '';
    });
}

if (hero) {
    hero.addEventListener('pointermove', (event) => {
        if (prefersReducedMotion.matches) return;

        const rect = hero.getBoundingClientRect();
        const px = (event.clientX - rect.left) / rect.width;
        const py = (event.clientY - rect.top) / rect.height;
        const x = (px - 0.42) * 44;
        const y = (py - 0.48) * 28;
        hero.style.setProperty('--hero-shift-x', `${x}px`);
        hero.style.setProperty('--hero-shift-y', `${y}px`);
    });

    hero.addEventListener('pointerleave', () => {
        hero.style.setProperty('--hero-shift-x', '0px');
        hero.style.setProperty('--hero-shift-y', '0px');
    });
}

if (celebrationCanvas) {
    celebrationRenderer = initCelebrationCanvas(celebrationCanvas, prefersReducedMotion.matches);
}

if (pageCanvas) {
    backgroundRenderer = initPageGlassWebGL(pageCanvas, prefersReducedMotion.matches, celebrationRenderer?.getCanvas?.() || null, selectedBackground.photo);
}

function initCelebrationCanvas(canvas, reducedMotion) {
    const ctx = canvas.getContext('2d');

    if (!ctx) {
        canvas.remove();
        return null;
    }

    const particleCount = reducedMotion ? 80 : 220;
    const particles = [];
    let width = 0;
    let height = 0;
    let dpr = 1;
    let rafId = 0;
    let lastTime = performance.now();
    let spawnEnabled = !document.body.classList.contains('background-view');

    function rand(min, max) {
        return Math.random() * (max - min) + min;
    }

    function pick(array) {
        return array[Math.floor(Math.random() * array.length)];
    }

    function spawnParticle(initial = false) {
        const kind = Math.random() < 0.64 ? 'petal' : 'confetti';
        const baseSize = kind === 'petal' ? rand(12, 24) : rand(5, 16);
        const y = initial ? rand(-height * 0.15, height + height * 0.1) : rand(-height * 0.28, -20);
        const x = rand(-width * 0.08, width * 1.08);

        return {
            kind,
            x,
            y,
            size: baseSize,
            speedY: rand(26, 78),
            speedX: rand(-10, 10),
            swing: rand(0.8, 2.2),
            swingRange: rand(10, 42),
            phase: rand(0, Math.PI * 2),
            rotation: rand(0, Math.PI * 2),
            spin: rand(-1.8, 1.8),
            flip: rand(0.45, 1),
            alpha: kind === 'petal' ? rand(0.45, 0.92) : rand(0.35, 0.84),
            active: true,
            color: kind === 'petal'
                ? pick([
                    '255, 228, 236',
                    '255, 213, 226',
                    '255, 241, 246',
                    '255, 232, 216',
                    '255, 219, 238'
                ])
                : pick([
                    '255, 91, 179',
                    '255, 210, 26',
                    '90, 206, 255',
                    '143, 122, 255',
                    '93, 255, 187',
                    '255, 129, 73',
                    '255, 255, 255',
                    '255, 78, 122'
                ])
        };
    }

    function resetParticle(particle) {
        Object.assign(particle, spawnParticle(false));
        particle.y = rand(-height * 0.35, -20);
        particle.active = true;
    }

    function retireParticle(particle) {
        particle.active = false;
        particle.y = height + 200;
    }

    function resize() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = Math.max(1, Math.round(width * dpr));
        canvas.height = Math.max(1, Math.round(height * dpr));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function drawPetal(particle) {
        const flutter = 0.78 + Math.sin(particle.phase + particle.rotation * 1.2) * 0.16;

        ctx.save();
        ctx.translate(particle.x, particle.y);
        ctx.rotate(particle.rotation);
        ctx.scale(1, flutter * particle.flip);
        for (let i = 0; i < 5; i += 1) {
            ctx.save();
            ctx.rotate((Math.PI * 2 * i) / 5);
            ctx.beginPath();
            ctx.ellipse(0, -particle.size * 0.26, particle.size * 0.16, particle.size * 0.34, 0, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${particle.color}, ${particle.alpha})`;
            ctx.fill();
            ctx.restore();
        }
        ctx.beginPath();
        ctx.arc(0, 0, particle.size * 0.11, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 235, 164, ${particle.alpha * 0.85})`;
        ctx.fill();
        ctx.restore();
    }

    function drawConfetti(particle) {
        const widthScale = 0.45 + Math.sin(particle.phase + particle.rotation * 1.8) * 0.3;
        const drawWidth = Math.max(particle.size * (0.65 + widthScale), 2.4);
        const drawHeight = Math.max(particle.size * 0.44, 1.6);

        ctx.save();
        ctx.translate(particle.x, particle.y);
        ctx.rotate(particle.rotation);
        ctx.fillStyle = `rgba(${particle.color}, ${particle.alpha})`;
        ctx.fillRect(-drawWidth * 0.5, -drawHeight * 0.5, drawWidth, drawHeight);
        ctx.restore();
    }

    function renderFrame() {
        ctx.clearRect(0, 0, width, height);

        for (const particle of particles) {
            if (!particle.active) continue;
            if (particle.kind === 'petal') {
                drawPetal(particle);
            } else {
                drawConfetti(particle);
            }
        }
    }

    function update(deltaSeconds) {
        const time = performance.now() * 0.001;
        const wind = Math.sin(time * 0.55 + window.scrollY * 0.003) * 14;

        for (const particle of particles) {
            if (!particle.active) continue;

            particle.phase += deltaSeconds * particle.swing;
            particle.rotation += deltaSeconds * particle.spin;

            const drift = Math.sin(particle.phase) * particle.swingRange;
            particle.x += (particle.speedX + wind + drift * 0.14) * deltaSeconds;
            particle.y += particle.speedY * deltaSeconds;

            if (particle.y > height + 40 || particle.x < -width * 0.16 || particle.x > width * 1.16) {
                if (spawnEnabled) {
                    resetParticle(particle);
                } else {
                    retireParticle(particle);
                }
            }
        }
    }

    function loop(now) {
        const deltaSeconds = Math.min((now - lastTime) / 1000, 0.033);
        lastTime = now;
        update(deltaSeconds);
        renderFrame();
        rafId = window.requestAnimationFrame(loop);
    }

    resize();

    for (let i = 0; i < particleCount; i += 1) {
        particles.push(spawnParticle(true));
    }

    renderFrame();
    rafId = window.requestAnimationFrame(loop);

    window.addEventListener('resize', () => {
        resize();
        renderFrame();
    }, { passive: true });

    return {
        getCanvas() {
            return canvas;
        },
        setSpawnEnabled(nextEnabled) {
            spawnEnabled = nextEnabled;

            if (spawnEnabled) {
                for (const particle of particles) {
                    if (!particle.active) {
                        resetParticle(particle);
                    }
                }
            }
        },
        destroy() {
            if (rafId) {
                window.cancelAnimationFrame(rafId);
            }
        }
    };
}

function initPageGlassWebGL(canvas, reducedMotion, celebrationSource, photoSource) {
    const gl = canvas.getContext('webgl', {
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance'
    });

    if (!gl) {
        console.warn('Page WebGL is not available; falling back to the static photo.');
        canvas.remove();
        return null;
    }

    const MAX_GLASS_SURFACES = 48;
    const glassSelector = '.site-mark, .site-nav, .hero, .panel, .card, .contact-card, .button, .background-slot-trigger, .background-slot-options, .background-slot-option, .background-toggle, .text-glass-label, .text-glass-title, .text-glass-surface';
    const rectData = new Float32Array(MAX_GLASS_SURFACES * 4);
    const radiusData = new Float32Array(MAX_GLASS_SURFACES);
    const priorityData = new Float32Array(MAX_GLASS_SURFACES);
    const pointer = { x: 0.46, y: 0.34 };
    const imageSize = { width: 1, height: 1 };
    let scrollAmount = window.scrollY / Math.max(window.innerHeight, 1);
    let rafId = 0;
    let isReady = false;
    let isLooping = false;
    let photoLoadId = 0;
    let lastFrameTime = 0;

    const vertexSource = `
        attribute vec2 a_position;
        varying vec2 v_uv;

        void main() {
            v_uv = a_position * 0.5 + 0.5;
            gl_Position = vec4(a_position, 0.0, 1.0);
        }
    `;

    const fragmentSource = `
        precision highp float;

        const int MAX_GLASS_SURFACES = ${MAX_GLASS_SURFACES};

        varying vec2 v_uv;

        uniform vec2 u_resolution;
        uniform vec2 u_pointer;
        uniform float u_time;
        uniform float u_scroll;
        uniform float u_motion;
        uniform float u_image_aspect;
        uniform float u_glass_count;
        uniform sampler2D u_image;
        uniform sampler2D u_overlay;
        uniform vec4 u_glass_rects[MAX_GLASS_SURFACES];
        uniform float u_glass_radii[MAX_GLASS_SURFACES];
        uniform float u_glass_priority[MAX_GLASS_SURFACES];

        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);

            return mix(
                mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
                u.y
            );
        }

        float fbm(vec2 p) {
            float value = 0.0;
            float amplitude = 0.5;

            for (int i = 0; i < 5; i++) {
                value += amplitude * noise(p);
                p = p * 2.02 + vec2(14.2, -8.9);
                amplitude *= 0.52;
            }

            return value;
        }

        float sdRoundedRect(vec2 point, vec4 rect, float radius) {
            vec2 halfSize = rect.zw * 0.5;
            vec2 local = point - (rect.xy + halfSize);
            vec2 q = abs(local) - max(halfSize - vec2(radius), vec2(1.0));
            return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
        }

        vec2 coverUv(vec2 uv) {
            float viewportAspect = u_resolution.x / max(u_resolution.y, 1.0);
            vec2 adjusted = uv;

            if (viewportAspect > u_image_aspect) {
                float scale = u_image_aspect / viewportAspect;
                adjusted.y = uv.y * scale + (1.0 - scale) * 0.5;
            } else {
                float scale = viewportAspect / u_image_aspect;
                adjusted.x = uv.x * scale + (1.0 - scale) * 0.5;
            }

            adjusted = (adjusted - 0.5) / 1.03 + 0.5;
            return clamp(adjusted, 0.0, 1.0);
        }

        vec3 gradePhoto(vec3 color) {
            float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
            color = mix(vec3(luma), color, 0.88);
            return clamp(color * 1.16, 0.0, 1.0);
        }

        vec3 samplePhoto(vec2 uv) {
            return gradePhoto(texture2D(u_image, coverUv(uv)).rgb);
        }

        vec4 sampleOverlay(vec2 uv) {
            return texture2D(u_overlay, clamp(uv, 0.0, 1.0));
        }

        vec3 sampleScene(vec2 uv) {
            vec3 photo = samplePhoto(uv);
            vec4 overlay = sampleOverlay(uv);
            return mix(photo, overlay.rgb, overlay.a);
        }

        vec4 renderGlassSurface(vec2 fragPx, vec2 uv, vec3 baseColor, vec4 rect, float radius, float dist, float priority) {
            float edgeBoost = mix(0.66, 1.0, priority);
            float chromaBoost = mix(0.54, 0.9, priority);
            float outerFeather = mix(2.0, 3.6, priority);
            float surfaceCoverage = 1.0 - smoothstep(0.0, outerFeather, dist);

            if (surfaceCoverage <= 0.001) {
                return vec4(baseColor, 0.0);
            }

            vec2 rectUv = clamp((fragPx - rect.xy) / max(rect.zw, vec2(1.0)), 0.0, 1.0);
            vec2 centerUv = rectUv * 2.0 - 1.0;
            vec2 edgeDir = normalize(centerUv + vec2(0.0001));
            float edgeBand = 1.0 - smoothstep(0.0, 25.0, abs(dist));
            float innerBody = smoothstep(3.0, 60.0, -dist);
            float glassMask = max(innerBody * 0.84, pow(edgeBand, 0.72) * (0.82 + priority * 0.12)) * surfaceCoverage;
            float rim = pow(edgeBand, 0.64) * surfaceCoverage * edgeBoost;
            float body = (0.14 + (1.0 - smoothstep(22.0, 92.0, -dist)) * 0.14) * glassMask;
            float sideDominance = step(abs(centerUv.y), abs(centerUv.x));
            vec2 axisNormal = normalize(vec2(sign(centerUv.x) * sideDominance, sign(centerUv.y) * (1.0 - sideDominance)) + edgeDir * 0.22 + vec2(0.0001));
            float tubeBand = smoothstep(0.42, 0.98, max(abs(centerUv.x), abs(centerUv.y)));
            float tubeMask = clamp(tubeBand * (0.36 + edgeBand * 0.64), 0.0, 1.0);
            float tubeRim = rim * tubeMask;
            float chromaRim = pow(edgeBand, 1.08) * (0.24 + tubeMask * 0.62) * surfaceCoverage * chromaBoost;

            vec2 noiseUv = rectUv * 15.8 + vec2(92.0, 31.0);
            float nA = fbm(noiseUv);
            float nB = fbm(noiseUv + vec2(7.4, -3.8));
            float nC = fbm(noiseUv * 3.05 + vec2(-4.1, 6.2));
            float nD = fbm(noiseUv * 3.05 + vec2(5.6, -7.1));
            vec2 turbulence = vec2((nA + nC * 0.5) / 1.5, (nB + nD * 0.5) / 1.5) - 0.5;
            vec2 softened = vec2(
                fbm(noiseUv * 1.32 + vec2(0.35, 0.0)),
                fbm(noiseUv * 1.32 + vec2(7.75, -3.45))
            ) - 0.5;
            vec2 fineNoise = vec2(
                fbm(noiseUv * 4.6 + vec2(-1.8, 2.3)),
                fbm(noiseUv * 4.6 + vec2(3.6, -2.1))
            ) - 0.5;
            turbulence = mix(turbulence, softened, 0.42);
            turbulence = mix(turbulence, fineNoise, 0.24);

            vec2 pxOffset =
                vec2(turbulence.x * 0.56, turbulence.y * 1.06) * (1.4 + body * 2.3 + tubeRim * 15.0) +
                axisNormal * tubeRim * 10.0 +
                edgeDir * tubeRim * 3.0;

            vec2 uvOffset = pxOffset / max(u_resolution, vec2(1.0));
            vec3 refractedA = sampleScene(uv + uvOffset);
            vec3 refractedB = sampleScene(uv - uvOffset * 0.22);
            vec3 glass = mix(refractedA, refractedB, 0.22);
            vec2 chromaOffset = (uvOffset * (0.22 + chromaRim * 1.45)) + (axisNormal * chromaRim * 4.4 / max(u_resolution, vec2(1.0)));
            vec3 chromaSplit = vec3(
                sampleScene(uv + uvOffset + chromaOffset).r,
                glass.g,
                sampleScene(uv + uvOffset - chromaOffset).b
            );

            glass = mix(baseColor, glass, 0.9 * glassMask);
            glass = mix(glass, chromaSplit, clamp(chromaRim * 0.72, 0.0, 0.78));
            glass += vec3(0.18, 0.2, 0.24) * tubeRim * 0.16;
            glass += vec3(0.06) * body * 0.05;

            return vec4(clamp(glass, 0.0, 1.0), glassMask);
        }

        void main() {
            vec3 base = sampleScene(v_uv);

            if (u_glass_count < 0.5) {
                gl_FragColor = vec4(base, 1.0);
                return;
            }

            vec2 fragPx = vec2(v_uv.x * u_resolution.x, (1.0 - v_uv.y) * u_resolution.y);
            float nearestScoreA = 1.0e9;
            float nearestScoreB = 1.0e9;
            float nearestDistA = 1.0e9;
            float nearestDistB = 1.0e9;
            float nearestRadiusA = 0.0;
            float nearestRadiusB = 0.0;
            float nearestPriorityA = 0.0;
            float nearestPriorityB = 0.0;
            vec4 nearestRectA = vec4(0.0);
            vec4 nearestRectB = vec4(0.0);

            for (int i = 0; i < MAX_GLASS_SURFACES; i++) {
                if (float(i) >= u_glass_count) break;

                vec4 rect = u_glass_rects[i];
                float dist = sdRoundedRect(fragPx, rect, u_glass_radii[i]);
                float absDist = abs(dist);
                float edgePriority = (1.0 - smoothstep(0.0, 18.0, absDist)) * u_glass_priority[i] * 10.0;
                float score = absDist - edgePriority;

                if (score < nearestScoreA) {
                    nearestScoreB = nearestScoreA;
                    nearestDistB = nearestDistA;
                    nearestRadiusB = nearestRadiusA;
                    nearestPriorityB = nearestPriorityA;
                    nearestRectB = nearestRectA;

                    nearestScoreA = score;
                    nearestDistA = dist;
                    nearestRadiusA = u_glass_radii[i];
                    nearestPriorityA = u_glass_priority[i];
                    nearestRectA = rect;
                } else if (score < nearestScoreB) {
                    nearestScoreB = score;
                    nearestDistB = dist;
                    nearestRadiusB = u_glass_radii[i];
                    nearestPriorityB = u_glass_priority[i];
                    nearestRectB = rect;
                }
            }

            vec4 surfaceA = renderGlassSurface(fragPx, v_uv, base, nearestRectA, nearestRadiusA, nearestDistA, nearestPriorityA);
            if (surfaceA.a <= 0.001) {
                gl_FragColor = vec4(base, 1.0);
                return;
            }

            vec3 accumColor = surfaceA.rgb * surfaceA.a;
            float accumMask = surfaceA.a;

            if (nearestScoreB < 1.0e8) {
                vec4 surfaceB = renderGlassSurface(fragPx, v_uv, base, nearestRectB, nearestRadiusB, nearestDistB, nearestPriorityB);
                float secondaryMask = surfaceB.a * (1.0 - surfaceA.a * 0.35);
                accumColor += surfaceB.rgb * secondaryMask;
                accumMask += secondaryMask;
            }

            vec3 mixedGlass = accumColor / max(accumMask, 0.0001);
            vec3 color = mix(base, mixedGlass, clamp(accumMask, 0.0, 1.0));
            gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
        }
    `;

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

    if (!vertexShader || !fragmentShader) {
        canvas.remove();
        return null;
    }

    const program = createProgram(gl, vertexShader, fragmentShader);

    if (!program) {
        canvas.remove();
        return null;
    }

    gl.useProgram(program);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1,
         1, -1,
        -1,  1,
        -1,  1,
         1, -1,
         1,  1
    ]), gl.STATIC_DRAW);

    const positionLocation = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    const resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
    const pointerLocation = gl.getUniformLocation(program, 'u_pointer');
    const timeLocation = gl.getUniformLocation(program, 'u_time');
    const scrollLocation = gl.getUniformLocation(program, 'u_scroll');
    const motionLocation = gl.getUniformLocation(program, 'u_motion');
    const imageAspectLocation = gl.getUniformLocation(program, 'u_image_aspect');
    const imageLocation = gl.getUniformLocation(program, 'u_image');
    const overlayLocation = gl.getUniformLocation(program, 'u_overlay');
    const glassCountLocation = gl.getUniformLocation(program, 'u_glass_count');
    const glassRectsLocation = gl.getUniformLocation(program, 'u_glass_rects[0]');
    const glassRadiiLocation = gl.getUniformLocation(program, 'u_glass_radii[0]');
    const glassPriorityLocation = gl.getUniformLocation(program, 'u_glass_priority[0]');

    const photoTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, photoTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array([18, 18, 18, 255])
    );

    gl.uniform1i(imageLocation, 0);

    const overlayTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, overlayTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array([0, 0, 0, 0])
    );

    gl.uniform1i(overlayLocation, 1);

    function resizeCanvas() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const width = Math.max(1, Math.round(window.innerWidth * dpr));
        const height = Math.max(1, Math.round(window.innerHeight * dpr));

        if (canvas.width === width && canvas.height === height) {
            return;
        }

        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
    }

    function collectGlassSurfaces() {
        if (document.body.classList.contains('background-view')) {
            return 0;
        }

        rectData.fill(0);
        radiusData.fill(0);
        priorityData.fill(0);

        const scaleX = canvas.width / Math.max(window.innerWidth, 1);
        const scaleY = canvas.height / Math.max(window.innerHeight, 1);
        let index = 0;
        const glassTargets = Array.from(document.querySelectorAll(glassSelector));

        for (const element of glassTargets) {
            if (index >= MAX_GLASS_SURFACES) break;

            const style = window.getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') < 0.02) {
                continue;
            }

            const rect = element.getBoundingClientRect();
            if (rect.width < 4 || rect.height < 4) continue;
            if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= window.innerWidth || rect.top >= window.innerHeight) {
                continue;
            }

            const radius = Math.min(
                parseFloat(style.borderTopLeftRadius) || 0,
                rect.width * 0.5,
                rect.height * 0.5
            );

            const dataIndex = index * 4;
            rectData[dataIndex] = rect.left * scaleX;
            rectData[dataIndex + 1] = rect.top * scaleY;
            rectData[dataIndex + 2] = rect.width * scaleX;
            rectData[dataIndex + 3] = rect.height * scaleY;
            radiusData[index] = radius * Math.min(scaleX, scaleY);
            priorityData[index] = element.matches('.site-mark, .site-nav, .hero, .panel') ? 1 : 0;
            index += 1;
        }

        return index;
    }

    function render(time = performance.now()) {
        if (!isReady) return;

        resizeCanvas();

        const glassCount = collectGlassSurfaces();

        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(program);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, photoTexture);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, overlayTexture);

        if (celebrationSource) {
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, celebrationSource);
        }

        gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
        gl.uniform2f(pointerLocation, pointer.x, pointer.y);
        gl.uniform1f(timeLocation, time * 0.001);
        gl.uniform1f(scrollLocation, scrollAmount);
        gl.uniform1f(motionLocation, reducedMotion ? 0.22 : 1.0);
        gl.uniform1f(imageAspectLocation, imageSize.width / Math.max(imageSize.height, 1));
        gl.uniform1f(glassCountLocation, glassCount);
        gl.uniform4fv(glassRectsLocation, rectData);
        gl.uniform1fv(glassRadiiLocation, radiusData);
        gl.uniform1fv(glassPriorityLocation, priorityData);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        lastFrameTime = time;
    }

    function loop(time) {
        render(time);
        rafId = window.requestAnimationFrame(loop);
    }

    function renderNow() {
        render(lastFrameTime || performance.now());
    }

    function updatePointer(event) {
        pointer.x = Math.min(Math.max(event.clientX / Math.max(window.innerWidth, 1), 0), 1);
        pointer.y = Math.min(Math.max(event.clientY / Math.max(window.innerHeight, 1), 0), 1);

        if (reducedMotion) {
            renderNow();
        }
    }

    function resetPointer() {
        pointer.x = 0.46;
        pointer.y = 0.34;

        if (reducedMotion) {
            renderNow();
        }
    }

    function updateScroll() {
        scrollAmount = window.scrollY / Math.max(window.innerHeight, 1);

        if (reducedMotion) {
            renderNow();
        }
    }

    window.addEventListener('resize', () => {
        resizeCanvas();
        renderNow();
    });
    window.addEventListener('scroll', updateScroll, { passive: true });
    window.addEventListener('pointermove', updatePointer, { passive: true });
    window.addEventListener('pointerleave', resetPointer);

    resizeCanvas();

    function loadPhoto(source) {
        const nextPhoto = source || FALLBACK_BACKGROUND_PHOTO;
        const loadId = photoLoadId + 1;
        const image = new Image();
        photoLoadId = loadId;
        image.decoding = 'async';
        image.onload = () => {
            if (loadId !== photoLoadId) return;

            imageSize.width = image.naturalWidth || 1;
            imageSize.height = image.naturalHeight || 1;

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, photoTexture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

            isReady = true;
            document.body.classList.add('is-webgl-ready');
            renderNow();

            if (!reducedMotion && !isLooping) {
                isLooping = true;
                rafId = window.requestAnimationFrame(loop);
            }
        };
        image.onerror = () => {
            if (loadId !== photoLoadId) return;

            if (nextPhoto !== FALLBACK_BACKGROUND_PHOTO) {
                loadPhoto(FALLBACK_BACKGROUND_PHOTO);
                return;
            }

            console.warn('Page WebGL image load failed; keeping the static photo background.');
            canvas.remove();
        };
        image.src = nextPhoto;
    }

    loadPhoto(photoSource);

    return {
        renderNow,
        setPhoto: loadPhoto,
        destroy() {
            if (rafId) {
                window.cancelAnimationFrame(rafId);
            }
            isLooping = false;
        }
    };
}

function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        return shader;
    }

    console.warn('Page WebGL shader compile failed:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
}

function createProgram(gl, vertexShader, fragmentShader) {
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
        return program;
    }

    console.warn('Page WebGL program link failed:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
}
