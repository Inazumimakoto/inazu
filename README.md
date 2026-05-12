# inazu.me / chat.inazu.me / mas.inazu.me

`inazu.me` のポートフォリオサイト、`chat.inazu.me` のローカル LLM チャットアプリ、`mas.inazu.me` の MAS 実験ページを同じ Node.js サーバーで配信しているリポジトリです。

- `inazu.me`: ポートフォリオサイト
- `chat.inazu.me`: Cloudflare Turnstile を通して使うチャットボットアプリ
- `mas.inazu.me`: three.js で可視化するローカル MAS 実験ページ

## Overview

このプロジェクトは Express サーバー 1 台でホスト名ごとに表示内容を切り替えます。

- `https://inazu.me/` は [`public/index.html`](public/index.html) を返します
- `https://chat.inazu.me/` は最初に [`public/verify.html`](public/verify.html) を返します
- `http://localhost:3000/mas/` は [`public/mas/index.html`](public/mas/index.html) を返します
- 認証通過後に [`public/chat.html`](public/chat.html) から `/api/chat` を叩いて Ollama と会話します
- MAS 側は `/api/mas/worlds` と SSE でサーバー主導の world state を配信します

チャット側は Cloudflare Turnstile、セッション管理、簡易 Bot ブロック、レート制限を挟んだ上で、ローカルの Ollama にストリーミングでプロキシします。

## Stack

- Node.js + Express
- Ollama
- llama.cpp
- Cloudflare Turnstile
- express-session
- express-rate-limit
- marked
- three.js

## Local Setup

Node.js は `fetch` を使っているので 18 以上を前提にしています。

```bash
npm install
ollama create nazumi -f Modelfile
ollama serve
npm start
```

サーバーはデフォルトで `http://localhost:3000` で起動します。

## Environment Variables

`.env` に最低限これを入れてください。

```env
TURNSTILE_SECRET=your_turnstile_secret
SESSION_SECRET=your_random_session_secret
```

補足:

- `TURNSTILE_SECRET` がないと `/api/verify` は `503` を返します
- `SESSION_SECRET` は未設定でも起動しますが、再起動ごとに変わるので固定推奨です
- Turnstile の site key は [`public/verify.html`](public/verify.html) と [`public/chat.html`](public/chat.html) に直書きされています
- MAS 用の `llama.cpp` 設定は [`docs/mas-llamacpp.md`](docs/mas-llamacpp.md) を参照

## Notes For Local Development

この実装は本番寄りです。`express-session` の cookie が `secure: true` なので、チャットの認証フローをローカルで完全に試す場合は HTTPS 環境か、ローカル用の cookie 設定調整が必要です。

ポートフォリオや MAS の見た目調整だけなら、そのまま `localhost:3000` で確認できます。

## Portfolio Background Photos

`inazu.me` の背景写真は時間帯ごとに自動列挙されます。写真を追加するときは、次のいずれかに画像を置いてください。

```text
public/assets/backgrounds/morning/
public/assets/backgrounds/lunch/
public/assets/backgrounds/night/
```

対応拡張子は `.jpg`, `.jpeg`, `.png`, `.webp` です。位置情報などの EXIF が入った写真は、公開前にメタデータを削除してください。

写真を追加した後は、公開前に背景画像を一括でサニタイズしてください。

```bash
npm run sanitize-backgrounds
```

このコマンドは `.DS_Store` を削除し、画像の向きを焼き込んでからメタデータを削除し、最大 2400px に縮小します。ImageMagick が必要です。

## Model

[`Modelfile`](Modelfile) から `nazumi` モデルを作成して使います。サーバー側では `/api/chat` で固定で `nazumi` を呼び出しています。

```bash
ollama create nazumi -f Modelfile
```

MAS 側の `llama.cpp` 接続手順は [`docs/mas-llamacpp.md`](docs/mas-llamacpp.md) を参照してください。

## Project Structure

```text
.
├── server.js
├── src
│   └── mas
│       ├── orchestrator.js
│       └── utterance.js
├── Modelfile
├── package.json
├── docs
│   ├── mas-TODO.md
│   └── mas-llamacpp.md
└── public
    ├── index.html
    ├── mas/
    ├── portfolio.css
    ├── portfolio.js
    ├── verify.html
    ├── chat.html
    ├── style.css
    ├── script.js
    └── assets/
```

主な役割:

- [`server.js`](server.js): ホスト振り分け、認証、レート制限、Ollama プロキシ
- [`src/mas/orchestrator.js`](src/mas/orchestrator.js): MAS の world state とターン進行
- [`src/mas/utterance.js`](src/mas/utterance.js): mock / `llama.cpp` 発話生成
- [`public/index.html`](public/index.html): `inazu.me` のポートフォリオ
- [`public/verify.html`](public/verify.html): Turnstile 認証画面
- [`public/chat.html`](public/chat.html): `chat.inazu.me` の UI
- [`public/script.js`](public/script.js): チャット送信、SSE 受信、再認証処理
- [`public/mas/`](public/mas): MAS の three.js UI

## Runtime Files

- `usage.log`: チャット利用時のログをサーバーが追記します
- `logs/analytics.sqlite`: `inazu.me` のローカルアクセス解析DBです。生IP、完全User-Agent、path/queryなどの詳細はMac内だけに保存します
- `logs/analytics.salt`: 公開表示用のIPハッシュに使うローカルsaltです

## Scripts

```bash
npm start
npm run dev
npm run analytics:report
```

`npm start` と `npm run dev` はどちらも [`server.js`](server.js) を起動します。

`npm run analytics:report` はMac上で `logs/analytics.sqlite` を読み、詳細ログを含むローカル向けレポートを表示します。

## Access Analytics

`https://inazu.me/analytics` で匿名化した公開アクセス解析を表示します。

- `https://inazu.me/` のヒーロー下に、総visitor数と総view数、`/analytics` への導線を表示します
- pageview は `GET/HEAD` のHTMLページアクセスだけを数えます
- `/analytics*`、`/api/analytics*`、静的asset、JSON APIはpageviewから除外します
- 公開APIの `GET /api/analytics/summary?range=7d|30d|all` は生IP、完全User-Agent、完全referer、query stringを返しません
- Mac停止中に Worker / Pi fallback が返したアクセスは、完全ローカル運用を優先するため記録されません

## Production Server

本番の `inazu.me` / `chat.inazu.me` は pm2 の `inazu-chat` プロセスで動かしています。

```bash
pm2 list
pm2 restart inazu-chat
```

`inazu-chat` はこのリポジトリの [`server.js`](server.js) を起動し、デフォルトの `PORT=3000` で待ち受けます。Cloudflare Tunnel はこのローカル3000番へ転送します。

反映後の確認:

```bash
curl -I -A 'Googlebot' https://inazu.me/
curl -A 'Googlebot' https://inazu.me/robots.txt
curl -I https://inazu.me/sitemap.xml
```

期待値:

- `https://inazu.me/` は `200`
- `https://inazu.me/robots.txt` は `Allow: /`
- `https://inazu.me/sitemap.xml` は `200`
- `https://chat.inazu.me/` は Bot に対して引き続き `403`
