const revealTargets = document.querySelectorAll('.reveal');
const tiltTargets = document.querySelectorAll('[data-tilt]');
const hero = document.querySelector('[data-hero]');
const heroCanvas = document.querySelector('[data-hero-canvas]');
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

if (hero && heroCanvas) {
    initHeroWebGL(heroCanvas, hero, prefersReducedMotion.matches);
}

function initHeroWebGL(canvas, host, reducedMotion) {
    const gl = canvas.getContext('webgl', {
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance'
    });

    if (!gl) {
        canvas.remove();
        return;
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
        uniform float u_time;
        uniform float u_reduced_motion;

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

        void main() {
            vec2 uv = v_uv;
            vec2 p = uv * 2.0 - 1.0;
            float aspect = u_resolution.x / max(u_resolution.y, 1.0);
            p.x *= aspect;

            vec2 pointer = u_pointer * 2.0 - 1.0;
            pointer.x *= aspect;

            float t = u_time * mix(0.18, 0.035, u_reduced_motion);
            float fieldA = fbm(p * 1.15 + vec2(t, -t * 0.7));
            float fieldB = fbm((p + vec2(1.8, -0.6)) * 1.9 - vec2(t * 1.4, t * 0.25));
            vec2 flow = vec2(fieldA - 0.5, fieldB - 0.5);
            vec2 warped = p + flow * 0.52;

            float orbA = 1.0 - smoothstep(0.08, 0.98, length(warped - vec2(-0.75 + sin(t * 1.4) * 0.08, -0.12 + cos(t * 1.3) * 0.07)));
            float orbB = 1.0 - smoothstep(0.14, 1.02, length(warped - vec2(0.78 + cos(t * 0.9) * 0.06, 0.34 + sin(t * 1.1) * 0.05)));
            float beam = 1.0 - smoothstep(-0.28, 0.28, abs(warped.y + sin(warped.x * 1.8 + t * 1.5) * 0.26));
            float grain = fbm(warped * 2.8 + vec2(4.0, -3.0));
            float pointerGlow = smoothstep(0.56, 0.0, length(warped - pointer * vec2(0.5, 0.36))) * (1.0 - u_reduced_motion);

            vec3 color = vec3(0.03, 0.035, 0.03);
            color += vec3(0.13, 0.18, 0.08) * orbA;
            color += vec3(0.06, 0.09, 0.07) * orbB;
            color += vec3(0.18, 0.22, 0.12) * beam * 0.42;
            color += vec3(0.14, 0.2, 0.1) * pointerGlow * 0.9;
            color += vec3(0.08, 0.1, 0.08) * grain * 0.16;

            float vignette = smoothstep(1.55, 0.2, length(p));
            color *= mix(0.72, 1.0, vignette);
            color = clamp(color, 0.0, 1.0);

            gl_FragColor = vec4(color, 0.98);
        }
    `;

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

    if (!vertexShader || !fragmentShader) {
        canvas.remove();
        return;
    }

    const program = createProgram(gl, vertexShader, fragmentShader);

    if (!program) {
        canvas.remove();
        return;
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
    const resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
    const pointerLocation = gl.getUniformLocation(program, 'u_pointer');
    const reducedMotionLocation = gl.getUniformLocation(program, 'u_reduced_motion');

    const pointer = { x: 0.42, y: 0.34 };

    function updateSize() {
        const rect = host.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.max(1, Math.round(rect.width * dpr));
        canvas.height = Math.max(1, Math.round(rect.height * dpr));
        gl.viewport(0, 0, canvas.width, canvas.height);
    }

    function render(time) {
        gl.clearColor(0.0, 0.0, 0.0, 0.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
        gl.uniform2f(pointerLocation, pointer.x, pointer.y);
        gl.uniform1f(timeLocation, time * 0.001);
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
        const rect = host.getBoundingClientRect();
        pointer.x = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0.0), 1.0);
        pointer.y = 1.0 - Math.min(Math.max((event.clientY - rect.top) / rect.height, 0.0), 1.0);
    }

    function resetPointer() {
        pointer.x = 0.42;
        pointer.y = 0.34;
    }

    host.addEventListener('pointermove', updatePointer);
    host.addEventListener('pointerleave', resetPointer);
    window.addEventListener('resize', updateSize);

    if (window.ResizeObserver) {
        const observer = new ResizeObserver(updateSize);
        observer.observe(host);
    }

    updateSize();

    if (reducedMotion) {
        render(0);
        return;
    }

    frameId = window.requestAnimationFrame(loop);
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
