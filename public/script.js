const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');

let conversationHistory = [];
let isStreaming = false;

// Auto-resize textarea
userInput.addEventListener('input', () => {
    userInput.style.height = 'auto';
    userInput.style.height = Math.min(userInput.scrollHeight, 200) + 'px';
});

// Handle Enter to send (Shift+Enter for newline)
userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!isStreaming && userInput.value.trim()) {
            chatForm.dispatchEvent(new Event('submit'));
        }
    }
});

// Handle form submission
chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const message = userInput.value.trim();
    if (!message || isStreaming) return;

    // Add user message to UI
    addMessage(message, 'user');
    userInput.value = '';
    userInput.style.height = 'auto';

    // Add to history
    conversationHistory.push({ role: 'user', content: message });

    // Send to API
    await sendMessage(message);
});

function addMessage(content, role, isStreaming = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    if (isStreaming) {
        contentDiv.classList.add('streaming');
    }
    contentDiv.textContent = content;

    messageDiv.appendChild(contentDiv);
    chatMessages.appendChild(messageDiv);

    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;

    return contentDiv;
}

function addLoadingMessage() {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';
    messageDiv.id = 'loading-message';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';

    messageDiv.appendChild(contentDiv);
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function removeLoadingMessage() {
    const loading = document.getElementById('loading-message');
    if (loading) loading.remove();
}

async function sendMessage(message) {
    isStreaming = true;
    sendBtn.disabled = true;

    addLoadingMessage();

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: message,
                history: conversationHistory.slice(0, -1) // Exclude the message we just added
            })
        });

        if (!response.ok) {
            throw new Error(`Error: ${response.status}`);
        }

        removeLoadingMessage();

        // Create streaming message container
        const contentDiv = addMessage('', 'assistant', true);
        let fullResponse = '';
        let thinkingContent = '';
        let isThinking = false;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);

                    if (data === '[DONE]') continue;

                    try {
                        const json = JSON.parse(data);
                        if (json.message && json.message.content) {
                            const text = json.message.content;
                            fullResponse += text;

                            // 1. Separate generic response and thinking process
                            const raw = fullResponse;

                            // Regex to capture <think>...</think> content and the rest
                            // Supporting streaming: if <think> is open but not closed, treat rest as thinking
                            let thinkContent = null;
                            let mainContent = raw;

                            const thinkMatch = raw.match(/<think>([\s\S]*?)(?:<\/think>|$)/);

                            if (thinkMatch) {
                                thinkContent = thinkMatch[1];
                                // Remove the think block from main content to avoid double rendering
                                mainContent = raw.replace(/<think>[\s\S]*?(?:<\/think>|$)/, '');
                            }

                            // 2. Build HTML
                            let html = '';

                            // Render thinking block (raw text, no markdown inside thought usually)
                            if (thinkContent) {
                                // Simple escaping for think content to prevent HTML injection inside block
                                const safeThink = thinkContent
                                    .replace(/&/g, "&amp;")
                                    .replace(/</g, "&lt;")
                                    .replace(/>/g, "&gt;");
                                html += `<div class="think-block"><div class="think-label">Thinking Process</div>${safeThink}</div>`;
                            }

                            // Render main content (Markdown)
                            if (mainContent) {
                                // Parse markdown
                                html += marked.parse(mainContent);
                            }

                            contentDiv.innerHTML = html;
                            chatMessages.scrollTop = chatMessages.scrollHeight;
                        }
                    } catch (e) {
                        // Skip non-JSON lines
                    }
                }
            }
        }

        // Remove streaming cursor
        contentDiv.classList.remove('streaming');

        // Add to history (save raw text)
        conversationHistory.push({ role: 'assistant', content: fullResponse });

    } catch (error) {
        console.error('Error:', error);
        removeLoadingMessage();
        addMessage(`エラーが発生しました: ${error.message}`, 'assistant');
    } finally {
        isStreaming = false;
        sendBtn.disabled = false;
        userInput.focus();
    }
}
