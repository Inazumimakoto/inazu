const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = 3000;
const OLLAMA_URL = 'http://localhost:11434';
const LOG_FILE = path.join(__dirname, 'usage.log');

app.use(express.json());
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

    // Get Ollama memory usage
    let ollamaMemGB = '?';
    try {
        const { execSync } = require('child_process');
        const psOutput = execSync('ps -o rss= -p $(pgrep -f "ollama") 2>/dev/null | awk \'{sum+=$1} END {print sum}\'', { encoding: 'utf8' });
        const ollamaKB = parseInt(psOutput.trim()) || 0;
        ollamaMemGB = (ollamaKB / 1024 / 1024).toFixed(2);
    } catch (e) {
        ollamaMemGB = 'N/A';
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

// Chat API endpoint - proxies to Ollama
app.post('/api/chat', async (req, res) => {
    const { message, history } = req.body;

    if (!message) {
        return res.status(400).json({ error: 'Message is required' });
    }

    // Log the request
    logRequest(req, message);

    try {
        // Build messages array with history (system prompt is embedded in nazumi model)
        const messages = history || [];
        messages.push({ role: 'user', content: message });

        const response = await fetch(`${OLLAMA_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'nazumi',
                messages: messages,
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

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            res.write(`data: ${chunk}\n\n`);
        }

        res.write('data: [DONE]\n\n');
        res.end();

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
