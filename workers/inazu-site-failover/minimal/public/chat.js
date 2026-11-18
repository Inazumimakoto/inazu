(() => {
    'use strict';

    const form = document.querySelector('#chat-form');
    const input = document.querySelector('#question');
    const send = form.querySelector('button');
    const status = document.querySelector('#chat-status');
    const asked = document.querySelector('#asked');
    const log = document.querySelector('#tool-log');
    const reply = document.querySelector('#chat-reply');
    const sourceSection = document.querySelector('#chat-sources');
    const sourceList = document.querySelector('#source-list');
    const moreSources = document.querySelector('#more-sources');
    const extraSourceList = moreSources.querySelector('ol');
    const profile = document.querySelector('#public-profile');
    const command = document.querySelector('#console-command');
    const amount = document.querySelector('#usage-amount');
    const responseCost = document.querySelector('#response-cost');
    const sections = new Set(['profile', 'projects', 'clientWork', 'articles', 'games', 'wishlist', 'friends', 'links', 'news', 'colophon']);
    const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 9 });
    const budget = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 9 });
    const publicData = window.inazu?.profile;
    let usageRequest = null;
    let showingAvailability = true;

    if (publicData) {
        profile.querySelector('p').textContent = [publicData.name, publicData.affiliation, publicData.bio].join('　');
    }

    function updateUsage(usage) {
        if (!Number.isFinite(usage?.estimatedUsd) || !Number.isFinite(usage?.budgetUsd)) return false;
        amount.textContent = `${dollars.format(usage.estimatedUsd)} / ${budget.format(usage.budgetUsd)}`;
        if (/^\d{4}-(0[1-9]|1[0-2])$/.test(usage.period)) {
            const month = Number(usage.period.slice(5));
            document.querySelector('#usage-label').textContent = `${month}月のチャット推定額（JST）`;
        }
        return true;
    }

    function showMessage(message) {
        status.hidden = false;
        reply.classList.remove('pending');
        reply.textContent = message;
        profile.hidden = !publicData;
    }

    async function refreshUsage() {
        if (send.disabled || usageRequest) return;
        const signal = AbortSignal.timeout(10000);
        usageRequest = signal;
        try {
            const response = await fetch('/api/usage', { cache: 'no-store', signal });
            const usage = await response.json();
            if (usageRequest !== signal) return;
            if (!response.ok || !updateUsage(usage)) throw new Error();
            if (!showingAvailability) return;
            if (usage.available === false) {
                showMessage('AIの回答は現在休止中です。');
            } else {
                status.hidden = true;
                profile.hidden = true;
            }
        } catch {
            if (usageRequest !== signal) return;
            amount.textContent = '取得できません';
            if (showingAvailability) showMessage('現在、チャットの利用状況を確認できません。');
        } finally {
            if (usageRequest === signal) usageRequest = null;
        }
    }

    function webUrl(value) {
        if (typeof value !== 'string' || !/^https?:\/\//i.test(value) || /[\s\\\u0000-\u001f\u007f]/u.test(value)) return null;
        try {
            const url = new URL(value);
            return url.hostname && !url.username && !url.password ? url : null;
        } catch {
            return null;
        }
    }

    function externalLink(url, label) {
        const link = document.createElement('a');
        link.href = url.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = label;
        return link;
    }

    function actionRow(action) {
        const labels = { search: 'ウェブ検索', open: 'ページ閲覧', find: 'ページ内検索' };
        if (!action || !Object.hasOwn(labels, action.type)) return;
        const row = document.createElement('li');
        const label = document.createElement('span');
        label.className = 'tool-label';
        label.textContent = labels[action.type];
        const target = document.createElement('span');
        target.className = 'tool-target';
        if (typeof action.query === 'string' && action.query) target.append(action.query);
        const url = webUrl(action.url);
        if (url) {
            if (target.hasChildNodes()) target.append(' · ');
            const link = externalLink(url, url.host + (url.pathname === '/' ? '' : url.pathname));
            link.title = url.href;
            target.append(link);
        }
        row.append(label, target);
        return row;
    }

    function renderAnswer(result) {
        const sources = new Map();
        function addSource(rawUrl, title) {
            const url = webUrl(rawUrl);
            if (!url) return null;
            if (!sources.has(url.href)) {
                const label = typeof title === 'string' && title.trim() ? title.trim() : url.host;
                sources.set(url.href, { url, label, index: sources.size + 1 });
            }
            return sources.get(url.href);
        }
        for (const item of result.sources ?? []) addSource(item?.url, item?.title);

        const answer = result.answer;
        const citations = [];
        for (const item of result.citations ?? []) {
            if (!Number.isInteger(item?.start) || !Number.isInteger(item.end) ||
                item.start < 0 || item.end < item.start || item.end > answer.length) continue;
            const source = addSource(item.url);
            if (source) citations.push({ start: item.start, end: item.end, source });
        }

        reply.classList.remove('pending');
        reply.replaceChildren();
        let cursor = 0;
        for (const { start, end, source } of citations.sort((a, b) => a.end - b.end || a.start - b.start)) {
            // Keep the cited wording. Replace a provider's literal link marker with our source number.
            const span = answer.slice(start, end).trim();
            const marker = /^\(?\[[^\]\n]*\]\((https?:\/\/\S+?)\)\)?$/i.exec(span);
            const standalone = /^\[\d+\]$/.test(span) || (marker && webUrl(marker[1])?.href === source.url.href);
            reply.append(answer.slice(cursor, standalone && start >= cursor ? start : end));
            const link = externalLink(source.url, `[${source.index}]`);
            link.className = 'citation';
            link.setAttribute('aria-label', `出典${source.index}、${source.label}`);
            reply.append(link);
            cursor = end;
        }
        reply.append(answer.slice(cursor));
        for (const { url, label, index } of sources.values()) {
            const item = document.createElement('li');
            item.append(externalLink(url, label));
            if (label !== url.host) {
                const domain = document.createElement('span');
                domain.className = 'source-host';
                domain.textContent = url.host;
                item.append(domain);
            }
            (index < extraSourceList.start ? sourceList : extraSourceList).append(item);
        }
        const extra = extraSourceList.childElementCount;
        moreSources.hidden = extra === 0;
        moreSources.querySelector('summary').textContent = `ほかの参照先（${extra}件）`;
        sourceSection.hidden = !sources.size;
    }

    async function readResult(response) {
        if (!response.headers.get('content-type')?.includes('application/x-ndjson')) return response.json();
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = '';
        try {
            for (;;) {
                const { value, done } = await reader.read();
                pending += decoder.decode(value, { stream: !done });
                const lines = pending.split('\n');
                pending = done ? '' : lines.pop();
                for (const line of lines) {
                    if (!line.trim()) continue;
                    const event = JSON.parse(line);
                    if (event.type === 'tool') {
                        const row = actionRow(event.action);
                        if (row) {
                            log.hidden = false;
                            log.append(row);
                        }
                    }
                    if (event.type === 'result' || event.type === 'error') return event;
                }
                if (done) throw new Error('Missing chat result');
            }
        } finally {
            reader.releaseLock();
        }
    }

    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (send.disabled) return;
        const question = input.value.trim();
        if (!question) {
            input.setCustomValidity('質問を入力してください。');
            input.reportValidity();
            return;
        }
        usageRequest = null;
        showingAvailability = false;
        let receivedUsage = false;
        send.disabled = true;
        profile.hidden = true;
        responseCost.hidden = true;
        sourceSection.hidden = true;
        sourceList.replaceChildren();
        extraSourceList.replaceChildren();
        moreSources.open = false;
        log.hidden = true;
        log.replaceChildren();
        status.hidden = false;
        asked.hidden = false;
        asked.textContent = `質問「${question}」`;
        reply.textContent = '回答を作成しています…';
        reply.classList.add('pending');
        command.textContent = 'inazu.show()';
        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/x-ndjson, application/json' },
                body: JSON.stringify({ question }),
                signal: AbortSignal.timeout(100000)
            });
            const result = await readResult(response);
            receivedUsage = updateUsage(result.usage);
            if (Array.isArray(result.actions)) {
                const rows = result.actions.map(actionRow).filter(Boolean);
                if (rows.length !== log.childElementCount || rows.some((row, i) => !row.isEqualNode(log.children[i]))) {
                    log.replaceChildren(...rows);
                }
                log.hidden = !rows.length;
            }
            if (Number.isFinite(result.responseCostUsd) || result.responseCostUsd === null) {
                document.querySelector('#response-amount').textContent = result.responseCostUsd === null
                    ? '未確定' : dollars.format(result.responseCostUsd);
                responseCost.hidden = false;
            }
            if (!response.ok || result.type === 'error' || typeof result.answer !== 'string' || !result.answer.trim()) {
                showMessage(typeof result.error === 'string' ? result.error : '回答を取得できませんでした。もう一度お試しください。');
                return;
            }
            renderAnswer(result);
            if (sections.has(result.section)) command.textContent = `inazu.show("${result.section}")`;
            if (input.value.trim() === question) input.value = '';
        } catch {
            showMessage('回答を取得できませんでした。通信状況を確認して、もう一度お試しください。');
        } finally {
            send.disabled = false;
            if (!receivedUsage) refreshUsage();
        }
    });
    input.addEventListener('input', () => input.setCustomValidity(''));
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) refreshUsage();
    });
    window.addEventListener('focus', refreshUsage);
    window.addEventListener('pageshow', event => {
        if (event.persisted) refreshUsage();
    });
    form.hidden = false;
    document.querySelector('#chat-usage').hidden = false;
    refreshUsage();
})();
