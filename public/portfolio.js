const revealTargets = document.querySelectorAll('.reveal');
const tiltTargets = document.querySelectorAll('[data-tilt]');
const hero = document.querySelector('[data-hero]');
const backgroundToggle = document.querySelector('[data-background-toggle]');
const pageCanvas = document.querySelector('[data-page-canvas]');
const heroModeButtons = document.querySelectorAll('[data-hero-mode]');
const heroModeSwitch = document.querySelector('.hero-mode-switch');
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

if (backgroundToggle) {
    backgroundToggle.addEventListener('click', () => {
        const nextState = !document.body.classList.contains('background-view');
        document.body.classList.toggle('background-view', nextState);
        backgroundToggle.setAttribute('aria-pressed', nextState ? 'true' : 'false');
        backgroundToggle.textContent = nextState ? 'back to site' : 'view photo';
    });
}

for (const card of tiltTargets) {
    card.addEventListener('pointermove', (event) => {
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

let heroBackground = null;

if (pageCanvas) {
    heroBackground = initHeroWebGL(pageCanvas, prefersReducedMotion.matches);
}

if (heroBackground && heroModeButtons.length > 0) {
    for (const button of heroModeButtons) {
        button.addEventListener('click', () => {
            const mode = button.dataset.heroMode;
            heroBackground.setMode(mode);

            for (const otherButton of heroModeButtons) {
                const isActive = otherButton === button;
                otherButton.classList.toggle('is-active', isActive);
                otherButton.setAttribute('aria-pressed', isActive ? 'true' : 'false');
            }
        });
    }
}

function initHeroWebGL(canvas, reducedMotion) {
    const gl = canvas.getContext('webgl', {
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance'
    });

    if (!gl) {
        disableHeroModes();
        canvas.remove();
        return null;
    }

    const vertexSource = `
        attribute vec2 a_position;
        varying vec2 v_uv;

        void main() {
            v_uv = a_position * 0.5 + 0.5;
            gl_Position = vec4(a_position, 0.0, 1.0);
        }
    `;

    const fragmentSource = `
        precision mediump float;

        varying vec2 v_uv;

        uniform vec2 u_resolution;
        uniform vec2 u_pointer;
        uniform float u_scroll;
        uniform float u_time;
        uniform float u_mode;
        uniform float u_reduced_motion;
        uniform sampler2D u_texture_a;
        uniform sampler2D u_texture_b;

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
                p = p * 2.03 + vec2(17.2, -9.4);
                amplitude *= 0.52;
            }

            return value;
        }

        float sdRoundedBox(vec2 p, vec2 b, float r) {
            vec2 q = abs(p) - b + vec2(r);
            return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
        }

        vec2 coverUv(vec2 uv) {
            float texAspect = 1600.0 / 900.0;
            float screenAspect = u_resolution.x / max(u_resolution.y, 1.0);
            vec2 adjusted = uv;

            if (screenAspect > texAspect) {
                float scale = texAspect / screenAspect;
                adjusted.y = uv.y * scale + (1.0 - scale) * 0.5;
            } else {
                float scale = screenAspect / texAspect;
                adjusted.x = uv.x * scale + (1.0 - scale) * 0.5;
            }

            return adjusted;
        }

        void main() {
            vec2 uv = coverUv(v_uv);
            vec2 p = uv * 2.0 - 1.0;
            float aspect = u_resolution.x / max(u_resolution.y, 1.0);
            p.x *= aspect;

            vec2 pointer = u_pointer * 2.0 - 1.0;
            pointer.x *= aspect;

            float scrollWave = u_scroll * mix(1.4, 0.45, u_reduced_motion);
            float t = u_time * mix(0.18, 0.04, u_reduced_motion) + scrollWave;
            float fieldA = fbm(p * 1.25 + vec2(t, -t * 0.55));
            float fieldB = fbm((p + vec2(1.4, -0.4)) * 1.85 - vec2(t * 1.2, t * 0.4));
            vec2 flow = vec2(fieldA - 0.5, fieldB - 0.5);
            float ring = 1.0 - smoothstep(0.0, 0.7, length(p - pointer * vec2(0.65, 0.48)));
            float pulse = 0.5 + 0.5 * sin(t * 1.7);
            float scrollBand = 1.0 - smoothstep(0.04, 0.36, abs(p.y + sin(p.x * 2.2 + scrollWave * 2.4) * 0.18));

            vec2 scrollVector = vec2(
                sin(scrollWave + p.y * 3.2) * 0.02,
                cos(scrollWave * 0.85 + p.x * 2.8) * 0.018
            );

            vec2 lensPoint = p - vec2(0.0, -0.02);
            vec2 lensSize = vec2(aspect * 0.82, 0.7);
            float lensRadius = 0.22;
            float lensDist = sdRoundedBox(lensPoint, lensSize, lensRadius);
            float lensMask = 1.0 - smoothstep(0.0, 0.045, lensDist);
            float lensEdge = 1.0 - smoothstep(0.006, 0.11, abs(lensDist));
            float lensInnerEdge = 1.0 - smoothstep(0.02, 0.16, abs(lensDist + 0.024));
            vec2 lensNormal = normalize(vec2(
                lensPoint.x / max(lensSize.x, 0.001),
                lensPoint.y / max(lensSize.y, 0.001)
            ) + vec2(0.0001));

            vec2 baseOffset = scrollVector * (0.6 + scrollBand * 0.55) + normalize(p - pointer + vec2(0.001)) * ring * 0.04;
            vec2 glassOffset = flow * 0.08 + baseOffset + lensNormal * lensEdge * 0.11;
            vec2 glassOffsetWide = flow * 0.15 - scrollVector * 0.7 - normalize(p - pointer + vec2(0.001)) * ring * 0.025 - lensNormal * lensEdge * 0.08;
            vec2 imageOffsetA = flow * 0.15 + scrollVector * 1.1 + vec2(sin(t * 0.8 + p.y * 3.8), cos(t * 0.6 + p.x * 3.0)) * 0.016;
            vec2 imageOffsetB = -flow * 0.17 - scrollVector * 1.2 + vec2(cos(t * 0.9 - p.y * 4.4), sin(t * 0.7 - p.x * 3.6)) * 0.014;

            vec3 baseScene = texture2D(u_texture_a, clamp(uv + scrollVector * 0.22, 0.0, 1.0)).rgb;
            vec3 glassBase = texture2D(u_texture_a, clamp(uv + glassOffset, 0.0, 1.0)).rgb;
            vec3 glassLayer = texture2D(u_texture_b, clamp(uv + glassOffsetWide, 0.0, 1.0)).rgb;
            vec3 glassColor = mix(baseScene, mix(glassBase, glassLayer, 0.26), lensMask);

            vec3 imageA = texture2D(u_texture_a, clamp(uv + imageOffsetA * 1.06, 0.0, 1.0)).rgb;
            vec3 imageB = texture2D(u_texture_b, clamp(uv + imageOffsetB * 0.92, 0.0, 1.0)).rgb;
            vec3 imageColor = mix(imageA, imageB, 0.34);

            float highlight = 1.0 - smoothstep(0.0, 0.95, length(glassOffset) * 8.0);
            float streak = 1.0 - smoothstep(0.08, 0.52, abs(p.y + sin(p.x * 3.0 + t * 1.15) * 0.22));
            float grain = fbm((p + flow) * 3.2 + vec2(6.0, -3.0));

            glassColor += vec3(0.12, 0.16, 0.11) * highlight * 0.55;
            glassColor += vec3(0.14, 0.18, 0.1) * streak * 0.12;
            glassColor += vec3(0.16, 0.24, 0.13) * ring * (0.18 + pulse * 0.12);
            glassColor += vec3(0.1, 0.14, 0.09) * scrollBand * 0.22;
            glassColor += vec3(0.24, 0.28, 0.18) * lensEdge * 0.36;
            glassColor += vec3(0.12, 0.15, 0.11) * lensInnerEdge * 0.14;
            glassColor -= vec3(0.02, 0.025, 0.02) * (1.0 - lensMask) * 0.22;

            imageColor += vec3(0.08, 0.12, 0.08) * ring * 0.12;
            imageColor += vec3(0.09, 0.13, 0.08) * scrollBand * 0.16;

            vec3 color = mix(glassColor, imageColor, u_mode);
            color += vec3(0.07, 0.08, 0.06) * grain * 0.08;

            float vignette = smoothstep(1.7, 0.32, length(p));
            color *= mix(0.76, 1.04, vignette);
            gl_FragColor = vec4(clamp(color, 0.0, 1.0), 0.98);
        }
    `;

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

    if (!vertexShader || !fragmentShader) {
        disableHeroModes();
        canvas.remove();
        return null;
    }

    const program = createProgram(gl, vertexShader, fragmentShader);

    if (!program) {
        disableHeroModes();
        canvas.remove();
        return null;
    }

    gl.useProgram(program);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([
            -1, -1,
             1, -1,
            -1,  1,
            -1,  1,
             1, -1,
             1,  1
        ]),
        gl.STATIC_DRAW
    );

    const positionLocation = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    const timeLocation = gl.getUniformLocation(program, 'u_time');
    const modeLocation = gl.getUniformLocation(program, 'u_mode');
    const resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
    const pointerLocation = gl.getUniformLocation(program, 'u_pointer');
    const scrollLocation = gl.getUniformLocation(program, 'u_scroll');
    const reducedMotionLocation = gl.getUniformLocation(program, 'u_reduced_motion');
    const textureALocation = gl.getUniformLocation(program, 'u_texture_a');
    const textureBLocation = gl.getUniformLocation(program, 'u_texture_b');

    gl.uniform1i(textureALocation, 0);
    gl.uniform1i(textureBLocation, 1);

    const pointer = { x: 0.42, y: 0.34 };
    let scrollValue = 0;
    const textureUrls = [
        'assets/hero-scene-1.svg',
        'assets/hero-scene-2.svg',
        'assets/hero-scene-3.svg'
    ];
    const textures = [];
    let currentMode = 'glass';
    let isReady = false;
    let lastTime = 0;

    function updateSize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.max(1, Math.round(window.innerWidth * dpr));
        canvas.height = Math.max(1, Math.round(window.innerHeight * dpr));
        gl.viewport(0, 0, canvas.width, canvas.height);
    }

    function updateScroll() {
        scrollValue = window.scrollY * 0.0014;
    }

    function render(time) {
        if (!isReady) return;

        gl.clearColor(0.0, 0.0, 0.0, 0.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        lastTime = time;

        const textureIndex = currentMode === 'image' ? 1 : 0;
        const nextTextureIndex = currentMode === 'image' ? 2 : 1;

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, textures[textureIndex]);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, textures[nextTextureIndex]);
        gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
        gl.uniform2f(pointerLocation, pointer.x, pointer.y);
        gl.uniform1f(scrollLocation, scrollValue);
        gl.uniform1f(timeLocation, time * 0.001);
        gl.uniform1f(modeLocation, currentMode === 'image' ? 1.0 : 0.0);
        gl.uniform1f(reducedMotionLocation, reducedMotion ? 1.0 : 0.0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    let frameId = 0;

    function loop(time) {
        render(time);
        if (!reducedMotion) {
            frameId = window.requestAnimationFrame(loop);
        }
    }

    function updatePointer(event) {
        pointer.x = Math.min(Math.max(event.clientX / window.innerWidth, 0.0), 1.0);
        pointer.y = 1.0 - Math.min(Math.max(event.clientY / window.innerHeight, 0.0), 1.0);
    }

    function resetPointer() {
        pointer.x = 0.42;
        pointer.y = 0.34;
    }

    window.addEventListener('pointermove', updatePointer);
    window.addEventListener('pointerleave', resetPointer);
    window.addEventListener('resize', updateSize);
    window.addEventListener('scroll', updateScroll, { passive: true });

    updateSize();
    updateScroll();

    Promise.all(textureUrls.map((url) => loadTexture(gl, url)))
        .then((loadedTextures) => {
            textures.push(...loadedTextures);
            isReady = true;
            document.body.classList.add('is-webgl-ready');

            if (reducedMotion) {
                render(0);
                return;
            }

            frameId = window.requestAnimationFrame(loop);
        })
        .catch((error) => {
            console.warn('Hero WebGL texture load failed:', error);
            disableHeroModes();
            canvas.remove();
        });

    return {
        setMode(mode) {
            currentMode = mode === 'image' ? 'image' : 'glass';

            if (isReady) {
                render(lastTime);
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

    console.warn('Hero WebGL shader compile failed:', gl.getShaderInfoLog(shader));
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

    console.warn('Hero WebGL program link failed:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
}

function disableHeroModes() {
    heroModeSwitch?.remove();
}

function loadTexture(gl, url) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = 'async';
        image.onload = () => {
            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
            resolve(texture);
        };
        image.onerror = reject;
        image.src = url;
    });
}
