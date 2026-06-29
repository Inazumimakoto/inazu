const newsList = document.querySelector('[data-news-list]');
const newsCount = document.querySelector('[data-news-count]');

loadNews();

async function loadNews() {
    try {
        const response = await fetch('/assets/news.json', { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`News feed returned ${response.status}`);
        }

        const data = await response.json();
        render(normalizeEntries(data));
    } catch (error) {
        renderError(error);
    }
}

function normalizeEntries(data) {
    const entries = Array.isArray(data?.entries) ? data.entries : [];

    return entries
        .filter((entry) => entry && typeof entry.date === 'string' && typeof entry.text === 'string')
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

function render(entries) {
    newsList.innerHTML = '';

    if (!entries.length) {
        setCount(0);
        const empty = document.createElement('li');
        empty.className = 'empty';
        empty.textContent = 'まだ更新履歴はありません。';
        newsList.appendChild(empty);
        return;
    }

    setCount(entries.length);

    for (const entry of entries) {
        const item = document.createElement('li');
        item.className = 'news-item';
        item.innerHTML = `
            <span class="news-date">${escapeHtml(entry.date)}</span>
            <span class="news-text">${escapeHtml(entry.text)}</span>
        `;
        newsList.appendChild(item);
    }
}

function setCount(count) {
    if (newsCount) {
        newsCount.textContent = `${count} ${count === 1 ? 'entry' : 'entries'}`;
    }
}

function renderError(error) {
    if (newsCount) newsCount.textContent = 'Failed to load';
    newsList.innerHTML = '';
    const item = document.createElement('li');
    item.className = 'empty';
    item.textContent = error.message;
    newsList.appendChild(item);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
