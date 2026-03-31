# inazu.me / chat.inazu.me

`inazu.me` のポートフォリオサイトと、`chat.inazu.me` のローカル LLM チャットアプリを同じ Node.js サーバーで配信しているリポジトリです。

- `inazu.me`: ポートフォリオサイト
- `chat.inazu.me`: Cloudflare Turnstile を通して使うチャットボットアプリ

## Overview

このプロジェクトは Express サーバー 1 台でホスト名ごとに表示内容を切り替えます。

- `https://inazu.me/` は [`public/index.html`](public/index.html) を返します
- `https://chat.inazu.me/` は最初に [`public/verify.html`](public/verify.html) を返します
- 認証通過後に [`public/chat.html`](public/chat.html) から `/api/chat` を叩いて Ollama と会話します

チャット側は Cloudflare Turnstile、セッション管理、簡易 Bot ブロック、レート制限を挟んだ上で、ローカルの Ollama にストリーミングでプロキシします。

## Stack

- Node.js + Express
- Ollama
- Cloudflare Turnstile
- express-session
- express-rate-limit
- marked

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

## Notes For Local Development

この実装は本番寄りです。`express-session` の cookie が `secure: true` なので、チャットの認証フローをローカルで完全に試す場合は HTTPS 環境か、ローカル用の cookie 設定調整が必要です。

ポートフォリオ側の見た目調整だけなら、そのまま `localhost:3000` で確認できます。

## Model

[`Modelfile`](Modelfile) から `nazumi` モデルを作成して使います。サーバー側では `/api/chat` で固定で `nazumi` を呼び出しています。

```bash
ollama create nazumi -f Modelfile
```

## Project Structure

```text
.
├── server.js
├── Modelfile
├── package.json
└── public
    ├── index.html
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
- [`public/index.html`](public/index.html): `inazu.me` のポートフォリオ
- [`public/verify.html`](public/verify.html): Turnstile 認証画面
- [`public/chat.html`](public/chat.html): `chat.inazu.me` の UI
- [`public/script.js`](public/script.js): チャット送信、SSE 受信、再認証処理

## Runtime Files

- `usage.log`: チャット利用時のログをサーバーが追記します

## Scripts

```bash
npm start
npm run dev
```

どちらも [`server.js`](server.js) を起動します。
