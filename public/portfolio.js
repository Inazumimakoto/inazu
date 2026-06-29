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
const analyticsPill = document.querySelector('[data-analytics-pill]');
const analyticsVisitors = document.querySelector('[data-analytics-visitors]');
const analyticsViews = document.querySelector('[data-analytics-views]');
const newsCard = document.querySelector('[data-news-card]');
const newsList = document.querySelector('[data-news-list]');
const celebrationCanvas = document.querySelector('[data-celebration-canvas]');
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
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
let celebrationRenderer = null;
let backgroundSlotMode = readStoredBackgroundSlotMode();
let backgroundViewEnabled = readStoredBackgroundView();
let backgroundSlotMenuOpen = false;
let loadedBackgroundPhotos = null;

loadPublicAnalyticsCount();
loadLatestNews();

async function loadPublicAnalyticsCount() {
    if (!analyticsPill || !analyticsVisitors || !analyticsViews) {
        return;
    }

    try {
        const response = await fetch('/api/analytics/summary?range=all', { cache: 'no-store' });
        if (!response.ok) return;

        const summary = await response.json();
        analyticsVisitors.textContent = formatAnalyticsNumber(summary?.totals?.uniqueVisitors);
        analyticsViews.textContent = formatAnalyticsNumber(summary?.totals?.pageviews);
        analyticsPill.hidden = false;
    } catch (error) {
        // Keep the counter hidden when analytics is unavailable.
    }
}

function formatAnalyticsNumber(value) {
    return new Intl.NumberFormat('en-US').format(Number(value || 0));
}

async function loadLatestNews() {
    if (!newsCard || !newsList) {
        return;
    }

    try {
        const response = await fetch('/assets/news.json', { cache: 'no-store' });
        if (!response.ok) return;

        const data = await response.json();
        const entries = (Array.isArray(data?.entries) ? data.entries : [])
            .filter((entry) => entry && typeof entry.date === 'string' && typeof entry.text === 'string')
            .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
            .slice(0, 2);

        if (!entries.length) return;

        // Render each entry as a list row (content left, date right) — same shape
        // as the Credentials card. textContent keeps it injection-safe.
        newsList.innerHTML = '';
        for (const entry of entries) {
            const row = document.createElement('li');
            const text = document.createElement('span');
            text.textContent = entry.text;
            const date = document.createElement('span');
            date.textContent = entry.date;
            row.append(text, date);
            newsList.appendChild(row);
        }

        newsCard.hidden = false;
        // The card starts hidden, so the reveal observer may not re-fire — show it directly.
        newsCard.classList.add('is-visible');
    } catch (error) {
        // Keep the news card hidden when the feed is unavailable.
    }
}

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
