import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const legacyPublic = fileURLToPath(new URL('../../../public/', import.meta.url));
const dist = join(here, 'dist');
const content = JSON.parse(await readFile(join(here, 'content.json'), 'utf8'));
content.news = JSON.parse(await readFile(join(legacyPublic, 'assets/news.json'), 'utf8')).entries;

await rm(dist, { recursive: true, force: true });
await cp(join(here, 'public'), dist, { recursive: true });
await mkdir(join(dist, 'assets'), { recursive: true });

// Explicit allowlist: never upload the home server's application or private files.
for (const file of ['favicon.ico', 'assets/site-icon.png', 'assets/apple-touch-icon.png', 'assets/loader', 'assets/games']) {
    await cp(join(legacyPublic, file), join(dist, file), { recursive: true });
}

const consoleSource = await readFile(join(here, 'public/console.js'), 'utf8');
const placeholder = '/* INAZU_CONTENT */ null';
if (!consoleSource.includes(placeholder)) throw new Error('Missing console content placeholder');
await writeFile(join(dist, 'console.js'), consoleSource.replace(placeholder, () => JSON.stringify(content)));

const html = await readFile(join(dist, 'index.html'), 'utf8');
await writeFile(join(dist, '404.html'), html.replace('<title>inazu.me</title>', '<title>inazu.me</title>\n    <meta name="robots" content="noindex">'));
console.log(`Built minimal inazu.me: ${Object.keys(content).length} console sections, ${content.news.length} news entries.`);
