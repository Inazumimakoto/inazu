export function appendNewsText(container, entry) {
    const text = typeof entry?.text === 'string' ? entry.text : '';
    const linkText = entry?.linkText === undefined ? text : entry.linkText;
    const linkStart = typeof linkText === 'string' && linkText.length > 0
        ? text.indexOf(linkText)
        : -1;
    let url = null;

    if (typeof entry?.url === 'string' && entry.url.trim()) {
        try {
            const candidate = new URL(entry.url, location.origin);
            if (candidate.protocol === 'http:' || candidate.protocol === 'https:') {
                url = candidate;
            }
        } catch (error) {
            // Invalid destinations keep the original notice as plain text.
        }
    }

    if (!url || linkStart < 0) {
        container.append(document.createTextNode(text));
        return;
    }

    const link = document.createElement('a');
    link.className = 'news-link';
    link.href = url.href;
    link.textContent = linkText;
    if (url.origin !== location.origin) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
    }

    container.append(
        document.createTextNode(text.slice(0, linkStart)),
        link,
        document.createTextNode(text.slice(linkStart + linkText.length))
    );
}
