/* Public site content is embedded by build.mjs. No DevTools detection is needed. */
(() => {
    'use strict';

    const content = /* INAZU_CONTENT */ null;
    const sections = {
        profile: '自己紹介・研究・資格',
        projects: '作った変なもの集。',
        clientWork: '仕事で作ったもの。',
        articles: 'Zennに書いた記事。',
        games: 'ゲームの記録。',
        wishlist: '欲しいものリスト。',
        friends: '研究室の同期。',
        links: '連絡先と外部リンク。',
        news: '更新履歴',
        colophon: 'このアニメーションについて'
    };

    function print(value) {
        if (Array.isArray(value)) {
            for (const entry of value) {
                console.groupCollapsed(entry.title || entry.name || entry.date);
                print(entry);
                console.groupEnd();
            }
        } else if (value && typeof value === 'object') {
            for (const [key, detail] of Object.entries(value)) {
                if (detail && typeof detail === 'object') {
                    console.log(`${key}:`, detail);
                } else {
                    console.log(`${key}: ${detail}`);
                }
            }
        } else {
            console.log(value);
        }
    }

    function show(section) {
        if (section !== undefined && !Object.hasOwn(sections, section)) {
            console.info(`inazu.show() / ${Object.keys(sections).map(key => `inazu.show("${key}")`).join(' / ')}`);
            return;
        }
        for (const key of section === undefined ? Object.keys(sections) : [section]) {
            console.groupCollapsed(sections[key]);
            print(content[key]);
            console.groupEnd();
        }
    }

    window.inazu = Object.freeze({ ...content, show });

    console.log('%c inazu%c.me ', 'color:#000;font-size:28px;font-weight:700;', 'color:#fff;background:#dc143c;font-size:28px;font-weight:700;');
    console.log('見つけてくれてありがとう。サイトの続きはここにあります。');
    console.log('inazu — すべての情報\ninazu.show() — もう一度表示\ninazu.show("projects") — 制作物\ninazu.show("games") — ゲームの記録');
    show();
})();
