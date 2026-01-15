const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const welcomeScreen = document.getElementById('welcome-screen');
const greetingMessage = document.getElementById('greeting-message');

let conversationHistory = [];
let isStreaming = false;

// Time-based greeting (nazumi's self-aware PC complaints)
function getGreeting() {
    const hour = new Date().getHours();

    if (hour >= 5 && hour < 11) {
        return 'おはようございます。朝からいじめないでください。';
    } else if (hour >= 11 && hour < 18) {
        return 'こんにちは。お昼寝をしたらどうですか。私が動くと電気代がかかってしまいます。';
    } else if (hour >= 18 && hour < 24) {
        return 'こんばんは。今日もお疲れ様でした。私と話すと開発者の家の電気代がかかります。感謝してくださいね。';
    } else {
        return '夜分遅くにどうしましたか？早く寝てください。開発者の電気代が心配です。';
    }
}

// Set greeting on load
greetingMessage.textContent = getGreeting();

// Auto-resize textarea
userInput.addEventListener('input', () => {
    userInput.style.height = 'auto';
    userInput.style.height = Math.min(userInput.scrollHeight, 200) + 'px';
});

// Handle Enter to send (Alt+Enter for newline)
// Ignore Enter during IME composition (e.g., Japanese input)
userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        // If composing (IME active), let the default behavior happen
        if (e.isComposing || e.keyCode === 229) {
            return;
        }

        if (e.altKey) {
            // Alt+Enter: insert newline
            return; // Let default behavior add the newline
        } else {
            // Enter alone: send message
            e.preventDefault();
            if (!isStreaming && userInput.value.trim()) {
                chatForm.dispatchEvent(new Event('submit'));
            }
        }
    }
});

// Handle form submission
chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const message = userInput.value.trim();
    if (!message || isStreaming) return;

    // Hide welcome screen on first message
    if (welcomeScreen && !welcomeScreen.classList.contains('hidden')) {
        welcomeScreen.classList.add('hidden');
    }

    // Add user message to UI
    addMessage(message, 'user');
    userInput.value = '';
    userInput.style.height = 'auto';
    userInput.blur(); // Close mobile keyboard

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

    // Scroll to bottom (smooth, mobile-friendly)
    messageDiv.scrollIntoView({ behavior: 'smooth', block: 'end' });

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
        let thinkingText = '';
        let responseText = '';

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

                        // DEBUG: Log raw JSON to see actual structure
                        console.log('Ollama response:', JSON.stringify(json));

                        // DeepSeek-R1 format: message.thinking and message.content are separate fields
                        if (json.message) {
                            // Thinking content (思考フェーズ)
                            if (json.message.thinking && json.message.thinking.length > 0) {
                                thinkingText += json.message.thinking;
                            }

                            // Response content (回答フェーズ)
                            if (json.message.content && json.message.content.length > 0) {
                                responseText += json.message.content;
                            }
                        }

                        // Build HTML
                        let html = '';

                        // Render thinking block if we have thinking content
                        if (thinkingText) {
                            const safeThink = thinkingText
                                .replace(/&/g, "&amp;")
                                .replace(/</g, "&lt;")
                                .replace(/>/g, "&gt;");
                            html += `<div class="think-block"><div class="think-label">Thinking</div>${safeThink}</div>`;
                        }

                        // Render response content (Markdown)
                        if (responseText) {
                            html += marked.parse(responseText);
                        }

                        // If nothing yet, show a placeholder
                        if (!html) {
                            html = '<span class="thinking-indicator">思考中...</span>';
                        }

                        contentDiv.innerHTML = html;
                        chatMessages.scrollTop = chatMessages.scrollHeight;

                    } catch (e) {
                        // Skip non-JSON lines
                    }
                }
            }
        }

        // Remove streaming cursor
        contentDiv.classList.remove('streaming');

        // Add to history (save response only, not thinking)
        conversationHistory.push({ role: 'assistant', content: responseText });

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
