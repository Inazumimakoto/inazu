const BOT_RULES = [
    { name: 'Googlebot', category: 'search', pattern: /googlebot|google-inspectiontool/i },
    { name: 'GoogleOther', category: 'search', pattern: /googleother/i },
    { name: 'AdsBot', category: 'search', pattern: /adsbot-google/i },
    { name: 'Bingbot', category: 'search', pattern: /bingbot|bingpreview|msnbot/i },
    { name: 'DuckDuckBot', category: 'search', pattern: /duckduckbot/i },
    { name: 'YandexBot', category: 'search', pattern: /yandex(bot|images|mobilebot)?/i },
    { name: 'Baiduspider', category: 'search', pattern: /baiduspider/i },
    { name: 'Applebot', category: 'search', pattern: /applebot/i },
    { name: 'GPTBot', category: 'ai', pattern: /gptbot/i },
    { name: 'ChatGPT-User', category: 'ai', pattern: /chatgpt-user/i },
    { name: 'ClaudeBot', category: 'ai', pattern: /claudebot/i },
    { name: 'Claude-User', category: 'ai', pattern: /claude-user/i },
    { name: 'Anthropic', category: 'ai', pattern: /anthropic/i },
    { name: 'Bytespider', category: 'ai', pattern: /bytespider/i },
    { name: 'CCBot', category: 'ai', pattern: /ccbot/i },
    { name: 'PerplexityBot', category: 'ai', pattern: /perplexitybot/i },
    { name: 'Facebook crawler', category: 'social', pattern: /facebookexternalhit|facebot/i },
    { name: 'Twitterbot', category: 'social', pattern: /twitterbot/i },
    { name: 'LinkedInBot', category: 'social', pattern: /linkedinbot/i },
    { name: 'Slackbot', category: 'social', pattern: /slackbot/i },
    { name: 'Discordbot', category: 'social', pattern: /discordbot/i },
    { name: 'AhrefsBot', category: 'seo', pattern: /ahrefsbot/i },
    { name: 'SemrushBot', category: 'seo', pattern: /semrush(bot)?/i },
    { name: 'DotBot', category: 'seo', pattern: /dotbot/i },
    { name: 'MJ12bot', category: 'seo', pattern: /mj12bot/i },
    { name: 'PetalBot', category: 'seo', pattern: /petalbot/i },
    { name: 'curl', category: 'tool', pattern: /curl/i },
    { name: 'wget', category: 'tool', pattern: /wget/i },
    { name: 'Python client', category: 'tool', pattern: /python|requests|aiohttp|urllib/i },
    { name: 'Node client', category: 'tool', pattern: /node-fetch|undici|axios/i },
    { name: 'Go client', category: 'tool', pattern: /go-http-client/i },
    { name: 'Java client', category: 'tool', pattern: /java\//i },
    { name: 'Ruby client', category: 'tool', pattern: /ruby/i },
    { name: 'PHP client', category: 'tool', pattern: /php/i },
    { name: 'Scraper', category: 'suspicious', pattern: /scrape|scraper/i },
    { name: 'Generic bot', category: 'unknown-bot', pattern: /bot|crawl|crawler|spider|slurp/i }
];

function classifyUserAgent(userAgent) {
    const ua = String(userAgent || '').trim();

    if (!ua) {
        return {
            uaFamily: 'Empty UA',
            device: 'Unknown',
            browser: 'Unknown',
            os: 'Unknown',
            isBot: true,
            botName: 'Empty UA',
            botCategory: 'suspicious'
        };
    }

    const botMatch = BOT_RULES.find((rule) => rule.pattern.test(ua));
    if (botMatch) {
        return {
            uaFamily: botMatch.name,
            device: 'Bot',
            browser: botMatch.name,
            os: detectOs(ua),
            isBot: true,
            botName: botMatch.name,
            botCategory: botMatch.category
        };
    }

    const browser = detectBrowser(ua);
    const os = detectOs(ua);
    const device = detectDevice(ua);

    return {
        uaFamily: `${browser} on ${os}`,
        device,
        browser,
        os,
        isBot: false,
        botName: '',
        botCategory: 'human'
    };
}

function detectDevice(ua) {
    if (/iphone/i.test(ua)) return 'iPhone';
    if (/ipad/i.test(ua)) return 'iPad';
    if (/android/i.test(ua)) return /mobile/i.test(ua) ? 'Android phone' : 'Android tablet';
    if (/macintosh|mac os x/i.test(ua)) return 'Mac';
    if (/windows/i.test(ua)) return 'Windows PC';
    if (/linux/i.test(ua)) return 'Linux';
    return 'Unknown';
}

function detectBrowser(ua) {
    if (/edg\//i.test(ua)) return 'Edge';
    if (/opr\//i.test(ua)) return 'Opera';
    if (/crios/i.test(ua)) return 'Chrome iOS';
    if (/chrome|chromium/i.test(ua) && !/edg\//i.test(ua)) return 'Chrome';
    if (/fxios/i.test(ua)) return 'Firefox iOS';
    if (/firefox/i.test(ua)) return 'Firefox';
    if (/version\/[\d.]+.*safari/i.test(ua)) return 'Safari';
    if (/safari/i.test(ua)) return 'Safari-like';
    return 'Unknown';
}

function detectOs(ua) {
    if (/iphone|ipad|cpu (iphone )?os/i.test(ua)) return 'iOS';
    if (/android/i.test(ua)) return 'Android';
    if (/mac os x|macintosh/i.test(ua)) return 'macOS';
    if (/windows nt/i.test(ua)) return 'Windows';
    if (/linux/i.test(ua)) return 'Linux';
    return 'Unknown';
}

module.exports = {
    BOT_RULES,
    classifyUserAgent
};
