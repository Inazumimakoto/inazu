require('dotenv').config();
const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { masWorlds } = require('./src/mas/orchestrator');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const OLLAMA_URL = 'http://localhost:11434';
const LOG_FILE = path.join(__dirname, 'usage.log');
const PUBLIC_DIR = path.join(__dirname, 'public');
const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const PUBLIC_PORTFOLIO_HOSTS = new Set(['inazu.me', 'www.inazu.me']);
const CHAT_HOSTS = new Set(['chat.inazu.me']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
const BACKGROUND_SLOTS = ['morning', 'lunch', 'night'];
const BACKGROUND_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const BACKGROUND_DIR = path.join(PUBLIC_DIR, 'assets', 'backgrounds');

// Trust proxy (for Cloudflare)
app.set('trust proxy', 1);

app.use(express.json());

// Session middleware with hardened cookies
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
        secure: true,           // HTTPS only (Cloudflare handles this)
        httpOnly: true,         // Not accessible via JavaScript
        sameSite: 'strict',     // CSRF protection
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// Rate limiting for API endpoints
const verifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,   // 15 minutes
    max: 30,                     // 30 failed verify attempts per window
    skipSuccessfulRequests: true,
    message: { error: 'Too many verification attempts, please try again later' }
});

const chatLimiter = rateLimit({
    windowMs: 60 * 1000,        // 1 minute
    max: 15,                     // 15 messages per minute
    message: { error: 'Too many messages, please slow down' }
});

const PROTECTED_BOT_PATTERNS = [
    /bot/i, /crawl/i, /spider/i, /scrape/i, /wget/i, /curl/i,
    /python/i, /java\//i, /ruby/i, /perl/i, /php/i,
    /googlebot/i, /bingbot/i, /yandex/i, /baidu/i, /duckduck/i,
    /facebookexternalhit/i, /twitterbot/i, /linkedinbot/i,
    /slurp/i, /msnbot/i, /ahrefsbot/i, /semrush/i, /dotbot/i,
    /bytespider/i, /gptbot/i, /claudebot/i, /anthropic/i
];

const PUBLIC_BLOCKED_BOT_PATTERNS = [
    /ahrefsbot/i, /semrush/i, /dotbot/i, /bytespider/i,
    /gptbot/i, /claudebot/i, /anthropic/i, /scrape/i
];

function getHostname(req) {
    const forwardedHost = req.headers['x-forwarded-host'];
    const rawHost = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) || req.headers.host || req.hostname || '';

    return rawHost.split(',')[0].trim().split(':')[0].toLowerCase();
}

function isPublicPortfolioHost(req) {
    const hostname = getHostname(req);

    return PUBLIC_PORTFOLIO_HOSTS.has(hostname) || isLocalHost(req);
}

function isChatHost(req) {
    return CHAT_HOSTS.has(getHostname(req));
}

function isLocalHost(req) {
    return LOCAL_HOSTS.has(getHostname(req));
}

function sendPublicFile(res, file) {
    return res.sendFile(path.join(PUBLIC_DIR, file));
}

app.get('/robots.txt', (req, res) => {
    res.type('text/plain');

    if (isChatHost(req)) {
        return res.send('User-agent: *\nDisallow: /\n');
    }

    return res.send('User-agent: *\nAllow: /\nSitemap: https://inazu.me/sitemap.xml\n');
});

// Keep chat and API protected while allowing legitimate crawlers to read the public portfolio.
app.use((req, res, next) => {
    const userAgent = req.headers['user-agent'] || '';
    const isProtectedSurface = isChatHost(req) || req.path.startsWith('/api/');
    const isPublicSurface = isPublicPortfolioHost(req);
    const shouldBlock =
        !userAgent ||
        (isProtectedSurface && PROTECTED_BOT_PATTERNS.some(pattern => pattern.test(userAgent))) ||
        (!isProtectedSurface && isPublicSurface && PUBLIC_BLOCKED_BOT_PATTERNS.some(pattern => pattern.test(userAgent))) ||
        (!isProtectedSurface && !isPublicSurface && PROTECTED_BOT_PATTERNS.some(pattern => pattern.test(userAgent)));

    if (shouldBlock) {
        console.log(`[BOT BLOCKED] ${getHostname(req)} ${req.ip} - ${userAgent.substring(0, 50)}`);
        return res.status(403).send('Access denied');
    }

    next();
});

async function listBackgroundPhotos(slot) {
    const slotDir = path.join(BACKGROUND_DIR, slot);

    try {
        const entries = await fs.promises.readdir(slotDir, { withFileTypes: true });

        return entries
            .filter((entry) => {
                if (!entry.isFile() || entry.name.startsWith('.')) return false;

                return BACKGROUND_IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase());
            })
            .map((entry) => `assets/backgrounds/${slot}/${encodeURIComponent(entry.name)}`)
            .sort((a, b) => a.localeCompare(b));
    } catch (error) {
        if (error.code === 'ENOENT') {
            return [];
        }

        throw error;
    }
}

app.get(['/', '/index.html'], (req, res) => {
    if (isChatHost(req)) {
        return sendPublicFile(res, 'verify.html');
    }

    return sendPublicFile(res, 'index.html');
});

app.get(['/verify', '/verify.html'], (req, res) => {
    if (!isChatHost(req) && !isLocalHost(req)) {
        return res.redirect(302, 'https://chat.inazu.me/');
    }

    return sendPublicFile(res, 'verify.html');
});

app.get(['/chat', '/chat.html'], (req, res) => {
    if (!isChatHost(req) && !isLocalHost(req)) {
        return res.redirect(302, 'https://chat.inazu.me/chat.html');
    }

    return sendPublicFile(res, 'chat.html');
});

app.get(['/mas', '/mas/', '/mas/index.html'], (req, res) => {
    return sendPublicFile(res, 'mas/index.html');
});

app.get('/api/backgrounds', async (req, res) => {
    try {
        const photos = {};

        for (const slot of BACKGROUND_SLOTS) {
            photos[slot] = await listBackgroundPhotos(slot);
        }

        res.setHeader('Cache-Control', 'no-store');
        return res.json(photos);
    } catch (error) {
        console.error('[BACKGROUND LIST ERROR]', error);
        return res.status(500).json({ error: 'Failed to list background photos' });
    }
});

app.post('/api/mas/worlds', (req, res) => {
    const topic = typeof req.body?.topic === 'string' ? req.body.topic : '';
    const world = masWorlds.createWorld(topic);
    return res.status(201).json(world.getSnapshot());
});

app.post('/api/mas/worlds/:worldId/topic', (req, res) => {
    const world = masWorlds.restartWorld(req.params.worldId, req.body?.topic);
    if (!world) {
        return res.status(404).json({ error: 'MAS world not found' });
    }

    return res.json(world.getSnapshot());
});

app.get('/api/mas/worlds/:worldId/stream', (req, res) => {
    const world = masWorlds.getWorld(req.params.worldId);
    if (!world) {
        return res.status(404).json({ error: 'MAS world not found' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    world.subscribe(res);

    const heartbeat = setInterval(() => {
        res.write(': keep-alive\n\n');
    }, 15000);

    req.on('close', () => {
        clearInterval(heartbeat);
        world.unsubscribe(res);
    });
});

app.use(express.static(PUBLIC_DIR, { index: false }));
app.use('/scripts/three', express.static(path.join(__dirname, 'node_modules/three/build')));
app.use('/scripts', express.static(path.join(__dirname, 'node_modules/marked')));

// Logging function
async function logRequest(req, message) {
    const now = new Date();
    const timestamp = now.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'] || 'Unknown';

    // Parse device from User-Agent
    let device = 'Unknown';
    if (userAgent.includes('iPhone')) device = 'iPhone';
    else if (userAgent.includes('Android')) device = 'Android';
    else if (userAgent.includes('Mac')) device = 'Mac';
    else if (userAgent.includes('Windows')) device = 'Windows';

    // Memory info
    const totalGB = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);
    const usedGB = ((os.totalmem() - os.freemem()) / 1024 / 1024 / 1024).toFixed(1);
    const nodeHeapMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);

    // Get Ollama memory usage (async to avoid blocking)
    let ollamaMemGB = 'N/A';
    try {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        const { stdout } = await execAsync('ps -o rss= -p $(pgrep -f "ollama") 2>/dev/null | awk \'{sum+=$1} END {print sum}\'');
        const ollamaKB = parseInt(stdout.trim()) || 0;
        ollamaMemGB = (ollamaKB / 1024 / 1024).toFixed(2);
    } catch (e) {
        // Ignore errors, keep N/A
    }

    const logEntry = {
        time: timestamp,
        ip: ip,
        device: device,
        message: message.substring(0, 100),
        systemMem: `${usedGB}GB / ${totalGB}GB`,
        ollamaMem: `${ollamaMemGB}GB`,
        nodeHeap: `${nodeHeapMB}MB`
    };

    const logLine = JSON.stringify(logEntry) + '\n';
    fs.appendFile(LOG_FILE, logLine, (err) => {
        if (err) console.error('Log write error:', err);
    });

    console.log(`[${timestamp}] ${device} ${ip} | Ollama: ${ollamaMemGB}GB | System: ${usedGB}/${totalGB}GB`);
}

// Verify endpoint - creates session after Turnstile verification
app.post('/api/verify', verifyLimiter, async (req, res) => {
    const { turnstileToken } = req.body;

    if (!TURNSTILE_SECRET) {
        console.error('[SECURITY] TURNSTILE_SECRET not configured!');
        return res.status(503).json({ error: 'Service not properly configured' });
    }

    try {
        const verifyResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                secret: TURNSTILE_SECRET,
                response: turnstileToken || ''
            })
        });
        const verifyResult = await verifyResponse.json();

        if (!verifyResult.success) {
            console.log('[TURNSTILE FAILED]', verifyResult);
            return res.status(403).json({ error: 'Human verification failed' });
        }

        // Create session
        req.session.verified = true;
        req.session.verifiedAt = Date.now();
        console.log('[VERIFIED] Session created');

        return res.json({ success: true });
    } catch (e) {
        console.error('[TURNSTILE ERROR]', e);
        return res.status(500).json({ error: 'Verification error' });
    }
});

// Chat API endpoint - proxies to Ollama
app.post('/api/chat', chatLimiter, async (req, res) => {
    const { message, history } = req.body;

    // Type validation
    if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'Message must be a non-empty string' });
    }

    // Check session instead of Turnstile token
    if (!req.session.verified) {
        console.log('[SESSION] Not verified');
        return res.status(403).json({ error: 'Please complete human verification first' });
    }

    try {
        // Validate and limit history to prevent memory/CPU abuse
        let validHistory = [];
        const MAX_HISTORY = 20;
        const MAX_MESSAGE_LENGTH = 10000;

        if (Array.isArray(history)) {
            validHistory = history
                .slice(-MAX_HISTORY) // Keep only last N messages
                .filter(msg =>
                    msg &&
                    typeof msg === 'object' &&
                    (msg.role === 'user' || msg.role === 'assistant') &&
                    typeof msg.content === 'string' &&
                    msg.content.length <= MAX_MESSAGE_LENGTH
                )
                .map(msg => ({
                    role: msg.role,
                    content: msg.content.substring(0, MAX_MESSAGE_LENGTH)
                }));
        }

        // Validate current message length
        const safeMessage = message.substring(0, MAX_MESSAGE_LENGTH);
        validHistory.push({ role: 'user', content: safeMessage });

        const response = await fetch(`${OLLAMA_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'nazumi',
                messages: validHistory,
                stream: true,
                options: {
                    // Enable thinking output for DeepSeek-R1
                    num_ctx: 8192
                }
            })
        });

        if (!response.ok) {
            throw new Error(`Ollama error: ${response.status}`);
        }

        // Set up streaming response
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let clientClosed = false;

        // Handle client disconnect - cancel Ollama stream
        req.on('close', () => {
            clientClosed = true;
            reader.cancel().catch(() => { });
            console.log('[CLIENT DISCONNECTED] Cancelled Ollama stream');
        });

        while (!clientClosed) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Process complete lines only
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (line.trim() && !clientClosed) {
                    res.write(`data: ${line}\n\n`);
                }
            }
        }

        // Send any remaining buffer
        if (buffer.trim()) {
            res.write(`data: ${buffer}\n\n`);
        }

        res.write('data: [DONE]\n\n');
        res.end();

        // Log after response completes (Ollama memory will be accurate)
        logRequest(req, message);

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`📡 Proxying to Ollama at ${OLLAMA_URL}`);
    console.log(`📝 Logging to ${LOG_FILE}`);
});
