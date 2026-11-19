# inazu-site-failover Worker

`inazu.me/*` に置く簡易フェイルオーバー Worker。

## 挙動

```text
request to inazu.me/*
  -> mac-site-origin.inazu.me に同じ path で fetch
  -> Mac が timeout / 5xx なら pi-site-origin.inazu.me に同じ path で fetch
  -> Pi も timeout / 5xx なら Worker 内蔵の簡素HTMLを返す
```

`404` や `403` は origin の意図したレスポンスとして扱い、fallback しない。  
fallback するのは `5xx` または network/timeout error。

## 緊急メンテナンス

`wrangler.jsonc` の `vars.MAINTENANCE_MODE` を `true` にして deploy すると、Worker が全パス・全メソッドに `503 Service Unavailable` を返す。
管理画面・管理APIも対象で、Mac と Pi への接続は一切行わない。文字列の `"true"` でも有効になる。

APIを含む全パスで、本文はプレーンテキストの「メンテ中です」のみ。タグや改行は付けない。
`Content-Type: text/plain; charset=utf-8`、`Cache-Control: no-store`、`Retry-After: 3600`、`x-inazu-origin: maintenance` を付ける。
`HEAD` は同じステータスとヘッダーを返し、本文は返さない。`Retry-After` は再アクセスの目安であり、復旧時刻の約束ではない。

```bash
curl -I https://inazu.me/
curl -i https://inazu.me/api/admin/status
```

この設定が保護するのは Worker の routes に登録されたホストだけ。オリジン用ホストや別サブドメインからの直接アクセスを止めるには、アプリ停止や Tunnel 側の制限も別途必要。
復旧確認後に `MAINTENANCE_MODE` を `false` にして再 deploy すると通常の転送へ戻る。

ネットワーク通信を行わない回帰テストは、リポジトリのルートから次で実行する。

```bash
node --test workers/inazu-site-failover/test/index.test.mjs
```

## Deploy

```bash
cd workers/inazu-site-failover
npx wrangler deploy
```

`wrangler login` の OAuth が失敗する場合は、Cloudflare Dashboard で API token を作り、1回だけ環境変数で渡して deploy する。

```bash
cd workers/inazu-site-failover
CLOUDFLARE_API_TOKEN='作ったAPI token' npx wrangler deploy
```

## 確認

通常時:

```bash
curl -I -A 'Mozilla/5.0' https://inazu.me/
```

レスポンスヘッダー:

```text
x-inazu-origin: mac
```

Mac を止めた時:

```text
x-inazu-origin: pi
```

Mac と Pi の両方を止めた時:

```text
x-inazu-origin: worker-fallback
```

## 注意

この初期版は down-state cache を持たない。Mac が死んでいる間は、リクエストごとに Mac origin の timeout を待ってから Pi に fallback する。

動作確認後に、短時間の circuit breaker を足す。
