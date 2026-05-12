const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function getOrCreateSalt(saltPath) {
    fs.mkdirSync(path.dirname(saltPath), { recursive: true });

    try {
        const existing = fs.readFileSync(saltPath, 'utf8').trim();
        if (existing) return existing;
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }

    const salt = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(saltPath, `${salt}\n`, { mode: 0o600 });
    return salt;
}

function hashIpForDay(ip, dayJst, salt) {
    return crypto
        .createHash('sha256')
        .update(`${dayJst}:${ip}:${salt}`)
        .digest('hex')
        .slice(0, 32);
}

function normalizeIp(ip) {
    const value = String(ip || '').trim();
    if (!value) return 'unknown';

    const first = value.split(',')[0].trim();
    const bracketedIpv6 = first.match(/^\[([^\]]+)\](?::\d+)?$/);
    const withoutPort = bracketedIpv6
        ? bracketedIpv6[1]
        : first.replace(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/, '$1');

    if (withoutPort.startsWith('::ffff:')) {
        return withoutPort.slice('::ffff:'.length);
    }

    return withoutPort.replace(/%.+$/, '');
}

function maskIp(ip) {
    const normalized = normalizeIp(ip);

    if (normalized === 'unknown') return 'unknown';

    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(normalized)) {
        const parts = normalized.split('.');
        return `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
    }

    if (normalized.includes(':')) {
        const expanded = expandIpv6(normalized);
        if (!expanded) return 'ipv6::/64';
        return `${expanded.slice(0, 4).join(':')}::/64`;
    }

    return 'unknown';
}

function expandIpv6(ip) {
    const lower = ip.toLowerCase();
    if (!/^[0-9a-f:]+$/.test(lower)) return null;

    const [head = '', tail = ''] = lower.split('::');
    const headParts = head ? head.split(':').filter(Boolean) : [];
    const tailParts = tail ? tail.split(':').filter(Boolean) : [];
    const fillLength = Math.max(0, 8 - headParts.length - tailParts.length);
    const parts = [...headParts, ...Array(fillLength).fill('0'), ...tailParts];

    if (parts.length !== 8) return null;

    return parts.map((part) => part.padStart(4, '0'));
}

function getHeader(req, name) {
    const value = req.headers[name.toLowerCase()];
    if (Array.isArray(value)) return value[0] || '';
    return value || '';
}

function getClientIp(req) {
    return normalizeIp(
        getHeader(req, 'cf-connecting-ip') ||
        getHeader(req, 'x-forwarded-for') ||
        req.ip ||
        req.socket?.remoteAddress ||
        ''
    );
}

function getRefererHost(req) {
    const referer = getHeader(req, 'referer');
    if (!referer) return '';

    try {
        return new URL(referer).hostname.toLowerCase();
    } catch (error) {
        return '';
    }
}

module.exports = {
    getClientIp,
    getHeader,
    getOrCreateSalt,
    getRefererHost,
    hashIpForDay,
    maskIp,
    normalizeIp
};
