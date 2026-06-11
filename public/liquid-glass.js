// Aave-style liquid glass: each glass surface gets an SVG filter whose
// displacement map is a small PNG generated from the surface's shape.
// The red / green channels encode how far each backdrop pixel bends
// horizontally / vertically, so refraction happens in the compositor and
// the content underneath stays selectable and clickable.
// Reference: https://aave.com/design/building-glass-for-the-web
(() => {
    const GLASS_SELECTOR = [
        '.site-mark',
        '.site-nav',
        '.button',
        '.analytics-pill',
        '.card',
        '.contact-card',
        '.background-slot-trigger',
        '.background-toggle',
        '.background-slot-options'
    ].join(', ');

    const GLASS_BLUR = 2;
    const GLASS_SATURATE = 1.3;

    // Only Chromium renders SVG filters inside backdrop-filter. Safari and
    // Firefox parse url() but paint nothing, so CSS.supports alone lies.
    const supportsRefraction =
        typeof CSS !== 'undefined' &&
        CSS.supports('backdrop-filter', 'url(#liquid-glass)') &&
        Boolean(navigator.userAgentData?.brands?.some((entry) => /chromium/i.test(entry.brand)));

    document.documentElement.classList.add(supportsRefraction ? 'glass-refraction' : 'glass-fallback');

    if (!supportsRefraction) return;

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const svgRoot = document.createElementNS(SVG_NS, 'svg');
    svgRoot.setAttribute('class', 'liquid-glass-defs');
    svgRoot.setAttribute('width', '0');
    svgRoot.setAttribute('height', '0');
    svgRoot.setAttribute('aria-hidden', 'true');
    const defs = document.createElementNS(SVG_NS, 'defs');
    svgRoot.appendChild(defs);
    document.body.appendChild(svgRoot);

    const filtersByKey = new Map();
    const keyByElement = new WeakMap();
    let filterSeq = 0;

    function roundedRectDistance(x, y, halfWidth, halfHeight, radius) {
        const qx = Math.abs(x) - (halfWidth - radius);
        const qy = Math.abs(y) - (halfHeight - radius);
        return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius;
    }

    function buildDisplacementMap(width, height, radius, bezel, maxDisplacement) {
        // Displacement values vary smoothly, so large surfaces can use a
        // half-resolution map and let feImage stretch it.
        const scale = width * height > 240000 ? 0.5 : 1;
        const mapWidth = Math.max(2, Math.round(width * scale));
        const mapHeight = Math.max(2, Math.round(height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = mapWidth;
        canvas.height = mapHeight;
        const ctx = canvas.getContext('2d');
        const image = ctx.createImageData(mapWidth, mapHeight);
        const data = image.data;
        const halfWidth = width / 2;
        const halfHeight = height / 2;
        const eps = 1;

        for (let py = 0; py < mapHeight; py += 1) {
            const y = (py + 0.5) / scale - halfHeight;
            for (let px = 0; px < mapWidth; px += 1) {
                const x = (px + 0.5) / scale - halfWidth;
                const index = (py * mapWidth + px) * 4;
                const distance = roundedRectDistance(x, y, halfWidth, halfHeight, radius);
                let red = 128;
                let green = 128;

                if (distance > -bezel) {
                    // Outward normal from the SDF gradient.
                    const gx = roundedRectDistance(x + eps, y, halfWidth, halfHeight, radius)
                        - roundedRectDistance(x - eps, y, halfWidth, halfHeight, radius);
                    const gy = roundedRectDistance(x, y + eps, halfWidth, halfHeight, radius)
                        - roundedRectDistance(x, y - eps, halfWidth, halfHeight, radius);
                    const length = Math.hypot(gx, gy) || 1;

                    // Circular bezel profile: flat in the middle, bending
                    // hardest right at the rim, easing smoothly into the body.
                    const u = Math.min(Math.max(1 + distance / bezel, 0), 1);
                    const ratio = 1 - Math.sqrt(1 - u * u);

                    // A convex bezel refracts the view toward the centre of
                    // the glass, which is what magnifies the rim.
                    red = Math.round(128 - (gx / length) * ratio * 127);
                    green = Math.round(128 - (gy / length) * ratio * 127);
                }

                data[index] = red;
                data[index + 1] = green;
                data[index + 2] = 128;
                data[index + 3] = 255;
            }
        }

        ctx.putImageData(image, 0, 0);
        return canvas.toDataURL();
    }

    function createSvgNode(name, attributes) {
        const node = document.createElementNS(SVG_NS, name);
        for (const [key, value] of Object.entries(attributes)) {
            node.setAttribute(key, String(value));
        }
        return node;
    }

    function ensureFilter(key, width, height, radius, bezel, maxDisplacement) {
        let entry = filtersByKey.get(key);
        if (entry) return entry;

        filterSeq += 1;
        const id = `liquid-glass-${filterSeq}`;
        const filter = createSvgNode('filter', {
            id,
            x: 0,
            y: 0,
            width,
            height,
            filterUnits: 'userSpaceOnUse',
            'color-interpolation-filters': 'sRGB'
        });

        const map = createSvgNode('feImage', {
            x: 0,
            y: 0,
            width,
            height,
            preserveAspectRatio: 'none',
            result: 'map'
        });
        map.setAttribute('href', buildDisplacementMap(width, height, radius, bezel, maxDisplacement));

        filter.append(
            map,
            createSvgNode('feGaussianBlur', {
                in: 'SourceGraphic',
                stdDeviation: GLASS_BLUR,
                result: 'soft'
            }),
            // scale maps the encoded 0..255 channel back to ±maxDisplacement px.
            createSvgNode('feDisplacementMap', {
                in: 'soft',
                in2: 'map',
                scale: (maxDisplacement * 255 / 127).toFixed(2),
                xChannelSelector: 'R',
                yChannelSelector: 'G',
                result: 'refracted'
            }),
            createSvgNode('feColorMatrix', {
                in: 'refracted',
                type: 'saturate',
                values: GLASS_SATURATE
            })
        );

        defs.appendChild(filter);
        entry = { id, node: filter, refs: 0 };
        filtersByKey.set(key, entry);
        return entry;
    }

    function releaseFilter(key) {
        const entry = filtersByKey.get(key);
        if (!entry) return;

        entry.refs -= 1;
        if (entry.refs <= 0) {
            entry.node.remove();
            filtersByKey.delete(key);
        }
    }

    function updateElement(element) {
        const width = Math.round(element.offsetWidth);
        const height = Math.round(element.offsetHeight);
        if (width < 12 || height < 12) return;

        const style = window.getComputedStyle(element);
        const radius = Math.min(parseFloat(style.borderTopLeftRadius) || 0, width / 2, height / 2);
        const bezel = Math.max(4, Math.min(radius, Math.min(width, height) / 2, 24));
        const maxDisplacement = Math.min(Math.max(bezel * 1.2, 8), 32);
        const key = [width, height, Math.round(radius), Math.round(bezel)].join('|');
        const previousKey = keyByElement.get(element);
        if (previousKey === key) return;

        const entry = ensureFilter(key, width, height, radius, bezel, maxDisplacement);
        entry.refs += 1;
        if (previousKey) {
            releaseFilter(previousKey);
        }
        keyByElement.set(element, key);
        element.style.backdropFilter = `url("#${entry.id}")`;
    }

    const pendingElements = new Set();
    let updateFrame = 0;

    function scheduleUpdate(element) {
        pendingElements.add(element);
        if (updateFrame) return;

        updateFrame = requestAnimationFrame(() => {
            updateFrame = 0;
            const elements = [...pendingElements];
            pendingElements.clear();
            for (const target of elements) {
                updateElement(target);
            }
        });
    }

    const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
            scheduleUpdate(entry.target);
        }
    });

    for (const element of document.querySelectorAll(GLASS_SELECTOR)) {
        observer.observe(element);
    }
})();
