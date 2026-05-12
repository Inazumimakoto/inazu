const rangeButtons = document.querySelectorAll('[data-range]');
const dailyChart = document.querySelector('[data-daily-chart]');
const topPaths = document.querySelector('[data-top-paths]');
const bots = document.querySelector('[data-bots]');
const statusBreakdown = document.querySelector('[data-status-breakdown]');
const originBreakdown = document.querySelector('[data-origin-breakdown]');
const recent = document.querySelector('[data-recent]');
const generatedAt = document.querySelector('[data-generated-at]');

let currentRange = '7d';

rangeButtons.forEach((button) => {
    button.addEventListener('click', () => {
        currentRange = button.dataset.range;
        rangeButtons.forEach((item) => item.classList.toggle('is-active', item === button));
        loadAnalytics();
    });
});

loadAnalytics();

async function loadAnalytics() {
    setLoading();

    try {
        const response = await fetch(`/api/analytics/summary?range=${encodeURIComponent(currentRange)}`, {
            cache: 'no-store'
        });

        if (!response.ok) {
            throw new Error(`Analytics API returned ${response.status}`);
        }

        const data = await response.json();
        render(data);
    } catch (error) {
        renderError(error);
    }
}

function setLoading() {
    generatedAt.textContent = 'Loading';
}

function render(data) {
    setKpi('allPageviews', data.totals.pageviews);
    setKpi('todayPageviews', data.today.pageviews);
    setKpi('last7Pageviews', data.last7Days.pageviews);
    setKpi('last30Pageviews', data.last30Days.pageviews);
    setKpi('selectedUnique', data.selected.uniqueVisitors);
    setKpi('selectedBots', data.selected.botRequests);

    generatedAt.textContent = `Updated ${formatDateTime(data.generatedAt)}`;
    renderDaily(data.daily);
    renderTopPaths(data.topPaths);
    renderBots(data.bots);
    renderStatus(data.statusBreakdown);
    renderOrigins(data.originBreakdown);
    renderRecent(data.recent);
}

function setKpi(name, value) {
    const element = document.querySelector(`[data-kpi="${name}"]`);
    if (element) element.textContent = formatNumber(value);
}

function renderDaily(rows) {
    dailyChart.innerHTML = '';
    if (!rows.length) {
        dailyChart.appendChild(emptyMessage('No access data yet.'));
        return;
    }

    const max = Math.max(...rows.map((row) => row.pageviews), 1);
    rows.forEach((row) => {
        const item = document.createElement('div');
        item.className = 'daily-row';
        item.innerHTML = `
            <span class="mono">${escapeHtml(row.day.slice(5))}</span>
            <span class="bar-track" aria-label="${row.pageviews} pageviews">
                <span class="bar-fill" style="--bar-width: ${Math.max(4, (row.pageviews / max) * 100)}%"></span>
            </span>
            <strong>${formatNumber(row.pageviews)} pv</strong>
            <span class="daily-unique">${formatNumber(row.uniqueVisitors)} uv</span>
        `;
        dailyChart.appendChild(item);
    });
}

function renderTopPaths(rows) {
    topPaths.innerHTML = '';
    if (!rows.length) {
        topPaths.appendChild(emptyListItem('No pageviews yet.'));
        return;
    }

    rows.forEach((row) => {
        const item = document.createElement('li');
        item.className = 'rank-item';
        item.innerHTML = `
            <div>
                <div class="rank-name mono">${escapeHtml(row.path)}</div>
                <div class="rank-meta">${formatNumber(row.uniqueVisitors)} unique visitors</div>
            </div>
            <div class="rank-value">${formatNumber(row.pageviews)}</div>
        `;
        topPaths.appendChild(item);
    });
}

function renderBots(rows) {
    bots.innerHTML = '';
    if (!rows.length) {
        bots.appendChild(emptyListItem('No BOT requests yet.'));
        return;
    }

    rows.forEach((row) => {
        const item = document.createElement('li');
        item.className = 'rank-item';
        item.innerHTML = `
            <div>
                <div class="rank-name">${escapeHtml(row.name)}</div>
                <div class="rank-meta">${escapeHtml(row.category)} · ${formatNumber(row.blocked)} blocked · last ${formatDateTime(row.lastSeen)}</div>
            </div>
            <div class="rank-value">${formatNumber(row.requests)}</div>
        `;
        bots.appendChild(item);
    });
}

function renderStatus(rows) {
    statusBreakdown.innerHTML = '';
    if (!rows.length) {
        statusBreakdown.appendChild(emptyMessage('No status data yet.'));
        return;
    }

    rows.forEach((row) => {
        statusBreakdown.appendChild(statusItem(row.status, row.requests));
    });
}

function renderOrigins(rows) {
    originBreakdown.innerHTML = '';
    if (!rows.length) {
        originBreakdown.appendChild(emptyMessage('No route data yet.'));
        return;
    }

    rows.forEach((row) => {
        originBreakdown.appendChild(statusItem(row.origin, row.requests));
    });
}

function renderRecent(rows) {
    recent.innerHTML = '';
    if (!rows.length) {
        const row = document.createElement('tr');
        row.innerHTML = '<td colspan="7" class="empty">No recent access yet.</td>';
        recent.appendChild(row);
        return;
    }

    rows.forEach((entry) => {
        const row = document.createElement('tr');
        const type = entry.isBot ? `${entry.botName || 'BOT'} / ${entry.botCategory}` : 'Human';
        row.innerHTML = `
            <td class="mono">${escapeHtml(formatDateTime(entry.timestamp))}</td>
            <td class="mono">${escapeHtml(entry.path)}</td>
            <td class="${statusClass(entry.status)}">${entry.status} · ${formatNumber(entry.durationMs)}ms</td>
            <td class="mono">${escapeHtml(entry.ip || 'unknown')}</td>
            <td>${escapeHtml([entry.device, entry.browser, entry.os].filter(Boolean).join(' · '))}</td>
            <td>${escapeHtml(type)}</td>
            <td>${escapeHtml(entry.refererHost || '-')}</td>
        `;
        recent.appendChild(row);
    });
}

function statusItem(name, value) {
    const item = document.createElement('div');
    item.className = 'status-item';
    item.innerHTML = `
        <div class="status-name">${escapeHtml(String(name))}</div>
        <div class="status-value">${formatNumber(value)}</div>
    `;
    return item;
}

function emptyListItem(message) {
    const item = document.createElement('li');
    item.className = 'empty';
    item.textContent = message;
    return item;
}

function emptyMessage(message) {
    const item = document.createElement('div');
    item.className = 'empty';
    item.textContent = message;
    return item;
}

function renderError(error) {
    generatedAt.textContent = 'Failed to load';
    dailyChart.innerHTML = '';
    dailyChart.appendChild(emptyMessage(error.message));
}

function statusClass(status) {
    if (status >= 500) return 'status-error';
    if (status >= 400) return 'status-warn';
    return 'status-ok';
}

function formatNumber(value) {
    return new Intl.NumberFormat('en-US').format(Number(value || 0));
}

function formatDateTime(value) {
    if (!value) return '-';
    return new Intl.DateTimeFormat('ja-JP', {
        timeZone: 'Asia/Tokyo',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    }).format(new Date(value));
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
