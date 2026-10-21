import { appendNewsText } from './news-content.js?v=news-links-20261020-1';

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
    newsList.replaceChildren();

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
        const date = document.createElement('span');
        date.className = 'news-date';
        date.textContent = entry.date;
        const text = document.createElement('span');
        text.className = 'news-text';
        appendNewsText(text, entry);
        item.append(date, text);
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
    newsList.replaceChildren();
    const item = document.createElement('li');
    item.className = 'empty';
    item.textContent = error.message;
    newsList.appendChild(item);
}
