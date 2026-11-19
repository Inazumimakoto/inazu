(() => {
    const orbit = document.querySelector('.orbit');
    const coin = orbit.querySelector('.orbit__coin--1');
    const counter = document.querySelector('.rotations');
    const value = counter.querySelector('.rotations__total');
    const pulses = counter.querySelector('.rotations__pulses');
    const lapOffsets = [17, 50, 83]; // Percentage positions across the digits.
    const numberFormat = new Intl.NumberFormat('ja-JP');
    const endpoint = new URL('/api/rotations', location.href);
    endpoint.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';

    let socket = null;
    let retryTimer;
    let failures = 0;
    let pageActive = true;
    let nextLapSlot = 0;

    function showLap(own) {
        const pulse = document.createElement('span');
        pulse.className = own ? 'rotations__pulse rotations__pulse--own' : 'rotations__pulse';
        pulse.textContent = '+1';
        if (!pulses.childElementCount) nextLapSlot = Math.floor(Math.random() * lapOffsets.length);
        const offset = lapOffsets[nextLapSlot];
        nextLapSlot = (nextLapSlot + 1) % lapOffsets.length;
        pulse.style.left = `${offset + Math.random() * 10 - 5}%`;
        pulse.style.setProperty('--lap-drift', `${Math.random() * 10 - 5}px`);
        pulses.append(pulse);
    }

    function hideCounter() {
        counter.classList.remove('is-live');
        pulses.replaceChildren();
    }

    function connect() {
        retryTimer = undefined;
        if (socket || !pageActive || document.hidden || !navigator.onLine) return;
        const connection = new WebSocket(endpoint);
        socket = connection;
        let connectedAt;

        connection.addEventListener('open', () => { connectedAt = performance.now(); });
        connection.addEventListener('message', ({ data }) => {
            if (connection !== socket) return;
            const message = JSON.parse(data);
            if (message.type !== 'total' || !Number.isSafeInteger(message.total)) return;
            value.textContent = numberFormat.format(message.total);
            counter.classList.add('is-live');
            // A snapshot on connection has no owner. Each subsequent lap does.
            if (typeof message.own === 'boolean') showLap(message.own);
        });
        connection.addEventListener('close', ({ code }) => {
            if (connection !== socket) return;
            socket = null;
            hideCounter();
            if (code === 1000 || code === 1008) return;
            if (performance.now() - connectedAt >= 60_000) failures = 0;
            if (failures >= 5) return;
            const delay = 1000 * 2 ** failures + Math.random() * 1000;
            failures++;
            retryTimer = setTimeout(connect, delay);
        });
    }

    function disconnect() {
        clearTimeout(retryTimer);
        retryTimer = undefined;
        failures = 0;
        const old = socket;
        socket = null;
        old?.close(1000);
        hideCounter();
    }

    function syncConnection() {
        orbit.classList.toggle('is-paused', document.hidden);
        if (!pageActive || document.hidden || !navigator.onLine) disconnect();
        else if (retryTimer === undefined) connect();
    }

    coin.addEventListener('animationiteration', ({ animationName }) => {
        if (animationName === 'triangulate' && !document.hidden &&
            socket?.readyState === WebSocket.OPEN && socket.bufferedAmount === 0) {
            socket.send('lap');
        }
    });
    pulses.addEventListener('animationend', ({ target }) => target.remove());
    document.addEventListener('visibilitychange', syncConnection);
    window.addEventListener('offline', syncConnection);
    window.addEventListener('online', syncConnection);
    window.addEventListener('pagehide', () => {
        pageActive = false;
        disconnect();
    });
    window.addEventListener('pageshow', () => {
        pageActive = true;
        syncConnection();
    });
    syncConnection();
})();
