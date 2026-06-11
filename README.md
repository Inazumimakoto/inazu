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

`inazu.me` の背景写真は時間帯ごとに自動列挙されます。写真の追加・削除は管理画面から行います。

- 管理画面: `https://inazu.me/admin/backgrounds`（Basic 認証）
- 認証情報: `ADMIN_USER` / `ADMIN_PASSWORD`（未設定なら `ANALYTICS_ADMIN_USER` / `ANALYTICS_ADMIN_PASSWORD` にフォールバック。アナリティクス管理画面と共通）

アップロードされた写真はサーバー側で `sharp` により必ず再エンコードされます。EXIF/GPS などのメタデータ除去・向きの焼き込み・最大 2400px への縮小（`BACKGROUND_MAX_SIZE` / `BACKGROUND_QUALITY` で調整可）を行い、ファイル名もサーバー側で生成するため、手動のサニタイズは不要です。

写真は `public/assets/backgrounds/{morning,lunch,night}/` に保存されますが、このディレクトリは `.gitignore` 済みで **git では管理されません**（実体は配信サーバーのディスク上にのみ存在します）。Time Machine などでのバックアップを忘れずに。

サーバーを経由せず手動でファイルを直接置く場合は、従来どおり公開前にサニタイズしてください（ImageMagick が必要です）。

```bash
npm run sanitize-backgrounds
```

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
- `https://inazu.me/admin/analytics/raw` はBasic認証付きの管理者用rawログ画面です。生IP、完全User-Agent、query string付きpathを表示します
- pageview は `GET/HEAD` のHTMLページアクセスだけを数えます。リロードなどのHTML `304 Not Modified` もpageviewとして数えます
- visitor は `IP + User-Agent分類` の重複なし件数です。同じIP/同じブラウザ分類なら日付が変わっても同一visitorとして扱います
- `/analytics*`、`/api/analytics*`、静的asset、JSON APIはpageviewから除外します
- 公開APIの `GET /api/analytics/summary?range=7d|30d|all` は生IP、完全User-Agent、完全referer、query stringを返しません
- Mac停止中に Worker / Pi fallback が返したアクセスは、完全ローカル運用を優先するため記録されません

管理者用rawログ画面には、`.env` に次を設定してからサーバーを再起動してください。

```env
ANALYTICS_ADMIN_USER=inazu
ANALYTICS_ADMIN_PASSWORD=your_private_password
```

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
