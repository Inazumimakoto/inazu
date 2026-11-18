(() => {
    'use strict';

    const form = document.querySelector('#chat-form');
    const input = document.querySelector('#question');
    const send = form.querySelector('button');
    const status = document.querySelector('#chat-status');
    const profile = document.querySelector('#public-profile');
    const command = document.querySelector('#console-command');
    const amount = document.querySelector('#usage-amount');
    const sections = new Set(['profile', 'projects', 'clientWork', 'articles', 'games', 'wishlist', 'friends', 'links', 'news', 'colophon']);
    const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 });
    const budget = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 });
    let revision = 0;
    let loadingUsage = false;
    let showingAvailability = true;

    const publicData = window.inazu?.profile;
    if (publicData) {
        profile.querySelector('p').textContent = [publicData.name, publicData.affiliation, publicData.bio].join('　');
    }

    function updateUsage(usage) {
        if (!Number.isFinite(usage?.estimatedUsd) || !Number.isFinite(usage?.budgetUsd)) return false;
        const estimate = usage.estimatedUsd > 0 && usage.estimatedUsd < 0.0001 ? '< $0.0001' : dollars.format(usage.estimatedUsd);
        amount.textContent = `${estimate} / ${budget.format(usage.budgetUsd)}`;
        if (/^\d{4}-(0[1-9]|1[0-2])$/.test(usage.period)) {
            const month = Number(usage.period.slice(5));
            document.querySelector('#usage-label').textContent = `${month}月のチャット推定額（JST）`;
        }
        return true;
    }

    function showMessage(message) {
        status.textContent = message;
        command.textContent = 'inazu.show()';
        profile.hidden = !publicData;
    }

    async function refreshUsage() {
        if (send.disabled || loadingUsage) return;
        loadingUsage = true;
        const current = ++revision;
        try {
            const response = await fetch('/api/usage', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
            const usage = await response.json();
            if (revision !== current) return;
            if (!response.ok || !updateUsage(usage)) throw new Error();
            if (!showingAvailability) return;
            if (usage.available === false) {
                showMessage('AIの回答は現在休止中です。');
            } else {
                status.replaceChildren();
                profile.hidden = true;
            }
        } catch {
            if (revision !== current) return;
            amount.textContent = '取得できません';
            if (showingAvailability) showMessage('現在、チャットの利用状況を確認できません。');
        } finally {
            loadingUsage = false;
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
        ++revision;
        showingAvailability = false;
        send.disabled = true;
        profile.hidden = true;
        status.textContent = '回答を作成しています…';
        command.textContent = 'inazu.show()';
        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question }),
                signal: AbortSignal.timeout(45000)
            });
            const result = await response.json();
            updateUsage(result.usage);
            if (!response.ok || typeof result.answer !== 'string' || !result.answer.trim()) {
                showingAvailability = response.status === 503;
                showMessage(typeof result.error === 'string' ? result.error : '回答を取得できませんでした。もう一度お試しください。');
                return;
            }
            const asked = document.createElement('p');
            asked.className = 'asked';
            asked.textContent = `質問「${question}」`;
            const answer = document.createElement('p');
            answer.textContent = result.answer;
            status.replaceChildren(asked, answer);
            if (sections.has(result.section)) command.textContent = `inazu.show("${result.section}")`;
            if (input.value.trim() === question) input.value = '';
        } catch {
            showMessage('回答を取得できませんでした。通信状況を確認して、もう一度お試しください。');
        } finally {
            send.disabled = false;
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
