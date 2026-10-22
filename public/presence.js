(() => {
    const ENDPOINT = '/api/analytics/presence';
    const INTERVAL_MS = 25_000;
    const REQUEST_TIMEOUT_MS = 8_000;
    const ID_LIFETIME_MS = 30 * 60_000;
    const STORAGE_KEY = 'inazu:presence:v1';
    const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const indicators = document.querySelectorAll('[data-presence]');
    const pill = document.querySelector('[data-analytics-pill]');
    let fallbackId;
    let timer;
    let inFlight;
    let stream;
    let resumePending = false;
    let suspended = false;

    function render(count) {
        for (const indicator of indicators) {
            indicator.hidden = count === null;
            if (count !== null) {
                indicator.querySelector('[data-presence-count]').textContent = count.toLocaleString('ja-JP');
            }
        }
        if (pill) {
            pill.hidden = !pill.querySelector('[data-presence]:not([hidden]), [data-analytics-summary-item]:not([hidden])');
        }
    }

    function readOrCreateId() {
        const now = Date.now();
        try {
            let stored;
            try {
                stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
            } catch {
                // Replace an unreadable record on the next successful write.
            }
            const id = UUID_PATTERN.test(stored?.id || '') &&
                Number.isFinite(stored?.expiresAt) && stored.expiresAt > now &&
                stored.expiresAt <= now + ID_LIFETIME_MS
                ? stored.id : crypto.randomUUID();
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ id, expiresAt: now + ID_LIFETIME_MS }));
            fallbackId = id;
            return id;
        } catch {
            // Private/storage-restricted browsers can still maintain this tab's presence.
            fallbackId ||= crypto.randomUUID();
            return fallbackId;
        }
    }

    function getVisitorId() {
        // Serialize first visits so tabs opened together share the same ID.
        return navigator.locks
            ? navigator.locks.request(STORAGE_KEY, readOrCreateId)
            : Promise.resolve(readOrCreateId());
    }

    function isVisible() {
        return !suspended && navigator.onLine !== false && document.visibilityState === 'visible';
    }

    function closeStream() {
        stream?.close();
        stream = null;
    }

    function connectStream() {
        if (!indicators.length || stream || !isVisible() || typeof EventSource === 'undefined') return;
        const connection = new EventSource(`${ENDPOINT}/stream`);
        stream = connection;
        connection.onmessage = (event) => {
            if (stream !== connection || !isVisible()) return;
            try {
                const data = JSON.parse(event.data);
                if (!Number.isSafeInteger(data?.count) || data.count < 0) {
                    throw new Error('Invalid presence count');
                }
                render(data.count);
            } catch {
                closeStream();
                render(null);
            }
        };
        connection.onerror = () => {
            if (stream !== connection) return;
            // Heartbeats keep updating the count and retry the stream next time.
            closeStream();
        };
    }

    async function heartbeat() {
        clearTimeout(timer);
        if (!isVisible()) return;
        if (inFlight) {
            resumePending ||= inFlight.signal.aborted;
            return;
        }
        const controller = new AbortController();
        inFlight = controller;
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const visitorId = await getVisitorId();
            if (!isVisible() || controller.signal.aborted) return;
            const response = await fetch(ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                cache: 'no-store',
                body: JSON.stringify({ visitorId }),
                signal: controller.signal
            });
            if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
                throw new Error('Presence unavailable');
            }
            const data = await response.json();
            if (!Number.isSafeInteger(data?.count) || data.count < 1) {
                throw new Error('Invalid presence count');
            }
            if (isVisible()) {
                // An open stream has the latest snapshot; an older POST response
                // must not overwrite a more recent join/leave event.
                if (!stream || stream.readyState !== EventSource.OPEN) render(data.count);
                connectStream();
            }
        } catch {
            closeStream();
            render(null);
        } finally {
            clearTimeout(timeout);
            inFlight = null;
            if (isVisible()) timer = setTimeout(heartbeat, resumePending ? 0 : INTERVAL_MS);
            resumePending = false;
        }
    }

    document.addEventListener('visibilitychange', () => {
        clearTimeout(timer);
        if (isVisible()) {
            void heartbeat();
        } else {
            closeStream();
            render(null);
        }
    });
    window.addEventListener('pagehide', () => {
        suspended = true;
        clearTimeout(timer);
        inFlight?.abort();
        closeStream();
        render(null);
    });
    window.addEventListener('pageshow', () => {
        suspended = false;
        void heartbeat();
    });
    window.addEventListener('offline', () => {
        clearTimeout(timer);
        inFlight?.abort();
        closeStream();
        render(null);
    });
    window.addEventListener('online', () => {
        void heartbeat();
    });

    void heartbeat();
})();
