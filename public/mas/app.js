const topicForm = document.querySelector('[data-topic-form]');
const topicInput = document.querySelector('#topic-input');
const worldStatus = document.querySelector('[data-world-status]');
const logList = document.querySelector('[data-log-list]');

if (topicForm) {
    topicForm.addEventListener('submit', (event) => {
        event.preventDefault();

        const topic = topicInput?.value.trim() || 'ローカルMASの最初の遊び方';
        worldStatus.textContent = `topic received: ${topic}`;
        logList.innerHTML = `<li>Topic accepted: ${topic}</li>`;
    });
}
