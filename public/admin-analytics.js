const rangeButtons = document.querySelectorAll('[data-range]');
const limitSelect = document.querySelector('[data-limit]');
const generatedAt = document.querySelector('[data-generated-at]');
const rawEvents = document.querySelector('[data-raw-events]');

let currentRange = '7d';

rangeButtons.forEach((button) => {
    button.addEventListener('click', () => {
        currentRange = button.dataset.range;
        rangeButtons.forEach((item) => item.classList.toggle('is-active', item === button));
        loadRawEvents();
    });
});

limitSelect?.addEventListener('change', loadRawEvents);

loadRawEvents();

async function loadRawEvents() {
    setLoading();

    try {
        const params = new URLSearchParams({
            range: currentRange,
            limit: limitSelect?.value || '200'
        });
        const response = await fetch(`/api/admin/analytics/raw?${params.toString()}`, {
            cache: 'no-store'
        });

        if (!response.ok) {
            throw new Error(`Raw analytics API returned ${response.status}`);
        }

        const data = await response.json();
        generatedAt.textContent = `Updated ${formatDateTime(data.generatedAt)}`;
        renderRows(data.events || []);
    } catch (error) {
        generatedAt.textContent = 'Failed to load';
        rawEvents.innerHTML = `<tr><td colspan="10" class="empty">${escapeHtml(error.message)}</td></tr>`;
    }
}

function setLoading() {
    generatedAt.textContent = 'Loading';
}

function renderRows(rows) {
    rawEvents.innerHTML = '';

    if (!rows.length) {
        rawEvents.innerHTML = '<tr><td colspan="10" class="empty">No raw events yet.</td></tr>';
        return;
    }

    for (const event of rows) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="mono">${escapeHtml(formatDateTime(event.timestamp))}</td>
            <td>${escapeHtml(event.host)}</td>
            <td class="mono">${escapeHtml(event.method)}</td>
            <td class="mono raw-path">${escapeHtml(event.path)}</td>
            <td class="${statusClass(event.status)}">${event.status} · ${formatNumber(event.durationMs)}ms</td>
            <td class="mono">${escapeHtml(event.ip)}</td>
            <td class="mono raw-ua">${escapeHtml(event.userAgent || '-')}</td>
            <td>${escapeHtml(event.isBot ? `${event.botName || 'BOT'} / ${event.botCategory}` : 'Human')}</td>
            <td>${escapeHtml(event.country || '-')}</td>
            <td class="mono">${escapeHtml(event.cfRay || '-')}</td>
        `;
        rawEvents.appendChild(row);
    }
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
        minute: '2-digit',
        second: '2-digit'
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
