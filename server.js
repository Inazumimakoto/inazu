require('dotenv').config();
const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = 3000;
const OLLAMA_URL = 'http://localhost:11434';
const LOG_FILE = path.join(__dirname, 'usage.log');
const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

app.use(express.json());

// Session middleware
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to true if using HTTPS in production
        httpOnly: true,
        maxAge: 60 * 60 * 1000 // 1 hour
    }
}));

// Bot blocking middleware
const BOT_PATTERNS = [
    /bot/i, /crawl/i, /spider/i, /scrape/i, /wget/i, /curl/i,
    /python/i, /java\//i, /ruby/i, /perl/i, /php/i,
    /googlebot/i, /bingbot/i, /yandex/i, /baidu/i, /duckduck/i,
    /facebookexternalhit/i, /twitterbot/i, /linkedinbot/i,
    /slurp/i, /msnbot/i, /ahrefsbot/i, /semrush/i, /dotbot/i,
    /bytespider/i, /gptbot/i, /claudebot/i, /anthropic/i
];

app.use((req, res, next) => {
    const userAgent = req.headers['user-agent'] || '';

    // Block if User-Agent matches bot patterns or is empty
    if (!userAgent || BOT_PATTERNS.some(pattern => pattern.test(userAgent))) {
        console.log(`[BOT BLOCKED] ${req.ip} - ${userAgent.substring(0, 50)}`);
        return res.status(403).send('Access denied');
    }

    next();
});

app.use(express.static(path.join(__dirname, 'public')));
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
app.post('/api/verify', async (req, res) => {
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
app.post('/api/chat', async (req, res) => {
    const { message, history } = req.body;

    if (!message) {
        return res.status(400).json({ error: 'Message is required' });
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

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Process complete lines only
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep incomplete line in buffer

            for (const line of lines) {
                if (line.trim()) {
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
