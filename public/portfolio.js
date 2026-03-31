const revealTargets = document.querySelectorAll('.reveal');
const tiltTargets = document.querySelectorAll('[data-tilt]');
const hero = document.querySelector('[data-hero]');
const backgroundToggle = document.querySelector('[data-background-toggle]');
const pageCanvas = document.querySelector('[data-page-canvas]');
const celebrationCanvas = document.querySelector('[data-celebration-canvas]');
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

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

let backgroundRenderer = null;
let celebrationRenderer = null;

function syncBackgroundControls() {
    if (!backgroundToggle) return;

    const isBackgroundView = document.body.classList.contains('background-view');
    backgroundToggle.setAttribute('aria-pressed', isBackgroundView ? 'true' : 'false');
    backgroundToggle.textContent = isBackgroundView ? 'back to site' : 'view photo';
}

if (backgroundToggle) {
    backgroundToggle.addEventListener('click', () => {
        const nextState = !document.body.classList.contains('background-view');
        document.body.classList.toggle('background-view', nextState);
        syncBackgroundControls();
        backgroundRenderer?.renderNow();
    });
}

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

if (pageCanvas) {
    backgroundRenderer = initPageGlassWebGL(pageCanvas, prefersReducedMotion.matches);
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

    const particleCount = reducedMotion ? 42 : 120;
    const particles = [];
    let width = 0;
    let height = 0;
    let dpr = 1;
    let rafId = 0;
    let lastTime = performance.now();

    function rand(min, max) {
        return Math.random() * (max - min) + min;
    }

    function pick(array) {
        return array[Math.floor(Math.random() * array.length)];
    }

    function spawnParticle(initial = false) {
        const kind = Math.random() < 0.64 ? 'petal' : 'confetti';
        const baseSize = kind === 'petal' ? rand(10, 22) : rand(5, 14);
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
            color: kind === 'petal'
                ? pick([
                    '255, 228, 236',
                    '255, 213, 226',
                    '255, 241, 246',
                    '255, 232, 216'
                ])
                : pick([
                    '255, 242, 248',
                    '255, 214, 230',
                    '255, 255, 255',
                    '214, 240, 255',
                    '255, 231, 181'
                ])
        };
    }

    function resetParticle(particle) {
        Object.assign(particle, spawnParticle(false));
        particle.y = rand(-height * 0.35, -20);
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
        const flutter = 0.68 + Math.sin(particle.phase + particle.rotation * 1.2) * 0.22;

        ctx.save();
        ctx.translate(particle.x, particle.y);
        ctx.rotate(particle.rotation);
        ctx.scale(1, flutter * particle.flip);
        ctx.beginPath();
        ctx.moveTo(0, -particle.size * 0.58);
        ctx.bezierCurveTo(
            particle.size * 0.52, -particle.size * 0.98,
            particle.size * 0.94, -particle.size * 0.02,
            0, particle.size * 0.42
        );
        ctx.bezierCurveTo(
            -particle.size * 0.94, -particle.size * 0.02,
            -particle.size * 0.52, -particle.size * 0.98,
            0, -particle.size * 0.58
        );
        ctx.fillStyle = `rgba(${particle.color}, ${particle.alpha})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(255, 255, 255, ${particle.alpha * 0.22})`;
        ctx.lineWidth = 0.9;
        ctx.stroke();
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

        if (document.body.classList.contains('background-view')) {
            return;
        }

        for (const particle of particles) {
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
            particle.phase += deltaSeconds * particle.swing;
            particle.rotation += deltaSeconds * particle.spin;

            const drift = Math.sin(particle.phase) * particle.swingRange;
            particle.x += (particle.speedX + wind + drift * 0.14) * deltaSeconds;
            particle.y += particle.speedY * deltaSeconds;

            if (particle.y > height + 40 || particle.x < -width * 0.16 || particle.x > width * 1.16) {
                resetParticle(particle);
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
        destroy() {
            if (rafId) {
                window.cancelAnimationFrame(rafId);
            }
        }
    };
}

function initPageGlassWebGL(canvas, reducedMotion) {
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

    const MAX_GLASS_SURFACES = 24;
    const glassTargets = Array.from(document.querySelectorAll('.hero, .panel, .card, .contact-card, .button, .background-toggle'));
    const rectData = new Float32Array(MAX_GLASS_SURFACES * 4);
    const radiusData = new Float32Array(MAX_GLASS_SURFACES);
    const pointer = { x: 0.46, y: 0.34 };
    const imageSize = { width: 1, height: 1 };
    let scrollAmount = window.scrollY / Math.max(window.innerHeight, 1);
    let rafId = 0;
    let isReady = false;
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
        uniform vec4 u_glass_rects[MAX_GLASS_SURFACES];
        uniform float u_glass_radii[MAX_GLASS_SURFACES];

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

        void main() {
            vec3 base = samplePhoto(v_uv);

            if (u_glass_count < 0.5) {
                gl_FragColor = vec4(base, 1.0);
                return;
            }

            vec2 fragPx = vec2(v_uv.x * u_resolution.x, (1.0 - v_uv.y) * u_resolution.y);
            float nearestScore = 1.0e9;
            float nearestDist = 1.0e9;
            vec4 nearestRect = vec4(0.0);

            for (int i = 0; i < MAX_GLASS_SURFACES; i++) {
                if (float(i) >= u_glass_count) break;

                vec4 rect = u_glass_rects[i];
                float dist = sdRoundedRect(fragPx, rect, u_glass_radii[i]);
                float score = abs(dist);

                if (score < nearestScore) {
                    nearestScore = score;
                    nearestDist = dist;
                    nearestRect = rect;
                }
            }

            float insideMask = 1.0 - step(0.0, nearestDist);

            if (insideMask <= 0.001) {
                gl_FragColor = vec4(base, 1.0);
                return;
            }

            vec2 rectUv = clamp((fragPx - nearestRect.xy) / max(nearestRect.zw, vec2(1.0)), 0.0, 1.0);
            vec2 centerUv = rectUv * 2.0 - 1.0;
            vec2 edgeDir = normalize(centerUv + vec2(0.0001));
            float edge = 1.0 - smoothstep(0.0, 26.0, -nearestDist);
            float rim = pow(edge, 0.92);
            float body = 0.22 + (1.0 - smoothstep(18.0, 88.0, -nearestDist)) * 0.2;
            float horizontalBias = smoothstep(-0.08, 0.28, abs(centerUv.y) - abs(centerUv.x) * 0.72);
            float tubeBand = smoothstep(0.34, 0.96, abs(centerUv.y));
            float tubeMask = clamp(horizontalBias * tubeBand, 0.0, 1.0);
            float tubeRim = rim * tubeMask;
            float chromaRim = pow(1.0 - smoothstep(0.0, 9.0, -nearestDist), 1.6) * tubeMask;
            vec2 tubeNormal = vec2(0.0, sign(centerUv.y));

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
                vec2(turbulence.x * 0.52, turbulence.y * 1.06) * (2.4 + body * 3.1 + tubeRim * 20.0) +
                tubeNormal * tubeRim * 12.0 +
                edgeDir * tubeRim * 4.0;

            vec2 uvOffset = pxOffset / max(u_resolution, vec2(1.0));
            vec3 refractedA = samplePhoto(v_uv + uvOffset);
            vec3 refractedB = samplePhoto(v_uv - uvOffset * 0.22);
            vec3 glass = mix(refractedA, refractedB, 0.22);
            vec2 chromaOffset = (uvOffset * (0.16 + chromaRim * 1.2)) + (tubeNormal * chromaRim * 4.2 / max(u_resolution, vec2(1.0)));
            vec3 chromaSplit = vec3(
                samplePhoto(v_uv + uvOffset + chromaOffset).r,
                glass.g,
                samplePhoto(v_uv + uvOffset - chromaOffset).b
            );

            glass = mix(base, glass, 0.9);
            glass = mix(glass, chromaSplit, chromaRim * 0.62);
            glass += vec3(0.18) * tubeRim * 0.16;
            glass += vec3(0.06) * body * 0.06;

            vec3 color = mix(base, glass, insideMask);
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
    const glassCountLocation = gl.getUniformLocation(program, 'u_glass_count');
    const glassRectsLocation = gl.getUniformLocation(program, 'u_glass_rects[0]');
    const glassRadiiLocation = gl.getUniformLocation(program, 'u_glass_radii[0]');

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

        const scaleX = canvas.width / Math.max(window.innerWidth, 1);
        const scaleY = canvas.height / Math.max(window.innerHeight, 1);
        let index = 0;

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
        gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
        gl.uniform2f(pointerLocation, pointer.x, pointer.y);
        gl.uniform1f(timeLocation, time * 0.001);
        gl.uniform1f(scrollLocation, scrollAmount);
        gl.uniform1f(motionLocation, reducedMotion ? 0.22 : 1.0);
        gl.uniform1f(imageAspectLocation, imageSize.width / Math.max(imageSize.height, 1));
        gl.uniform1f(glassCountLocation, glassCount);
        gl.uniform4fv(glassRectsLocation, rectData);
        gl.uniform1fv(glassRadiiLocation, radiusData);
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

    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
        imageSize.width = image.naturalWidth || 1;
        imageSize.height = image.naturalHeight || 1;

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, photoTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

        isReady = true;
        document.body.classList.add('is-webgl-ready');
        renderNow();

        if (!reducedMotion) {
            rafId = window.requestAnimationFrame(loop);
        }
    };
    image.onerror = () => {
        console.warn('Page WebGL image load failed; keeping the static photo background.');
        canvas.remove();
    };
    image.src = 'assets/hero-dinner.jpg';

    return {
        renderNow,
        destroy() {
            if (rafId) {
                window.cancelAnimationFrame(rafId);
            }
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
