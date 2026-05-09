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
