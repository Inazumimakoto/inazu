# inazu.me フェイルオーバー Runbook

`inazu.me` を **Mac が本番、Raspberry Pi が簡易フォールバック、最後に Cloudflare Worker 内蔵ページ** という構成にするための作業メモ。

最初に対象にするのは `inazu.me` だけ。`chat.inazu.me` は Turnstile、cookie session、Ollama、streaming が絡むので後回しにする。

## 目指す構成

```text
User
  -> https://inazu.me/*
  -> Cloudflare Worker
      -> Mac の tunnel origin
      -> Pi の tunnel origin
      -> Worker 内蔵の簡素HTML
```

使うホスト名:

```text
inazu.me                 公開入口。Worker が受ける
mac-site-origin.inazu.me Mac tunnel -> http://localhost:3000
pi-site-origin.inazu.me  Pi tunnel  -> http://localhost:8080
```

`inazu.me/*` は「ページが複数ある」という意味ではなく、`inazu.me` 宛の全リクエストという意味。

実際には `server.js` 上の画面は `public/index.html` ほぼ1枚でも、ブラウザは次のようなリクエストを出す。

```text
/
/portfolio.css
/portfolio.js
/assets/...
/api/backgrounds
/robots.txt
/sitemap.xml
```

なので Worker route は `inazu.me/*` にする。

## 現在できている構成

2026-05-09 時点で、`inazu.me` の3段 fallback は動作確認済み。

```text
通常時:
https://inazu.me/ -> Worker -> Mac
x-inazu-origin: mac

Mac 停止時:
https://inazu.me/ -> Worker -> Pi
x-inazu-origin: pi

Mac 停止 + Pi Web停止時:
https://inazu.me/ -> Worker 内蔵HTML
x-inazu-origin: worker-fallback
```

確認済み origin:

```text
mac-site-origin.inazu.me -> Mac tunnel -> http://localhost:3000
pi-site-origin.inazu.me  -> Pi tunnel  -> http://localhost:8080
```

Pi:

```text
hostname: inazumi-pi
user: inazu
fallback service: inazu-fallback
fallback path: /opt/inazu-fallback/server.js
```

`server.js` 側では、Worker が叩く origin hostname を public portfolio host として扱う。

```js
const PUBLIC_PORTFOLIO_HOSTS = new Set(['inazu.me', 'www.inazu.me', 'mac-site-origin.inazu.me']);
```

## Tailscale の役割

Tailscale は公開アクセスのフェイルオーバー経路には使わない。

```text
公開アクセス:
User -> Cloudflare Worker -> Mac/Pi の cloudflared -> local server

管理アクセス:
自分の端末 -> Tailscale -> Pi に SSH
```

Pi は友人宅ネットワークから直接 Cloudflare Tunnel を張る。  
Mac から Tailscale 経由で Pi に中継する構成にはしない。Mac が死んだ瞬間に Pi への公開経路も死ぬから。

友人宅のルーターでポート開放は基本不要。Cloudflare Tunnel も Tailscale も外向き接続で動く。

この Pi は Tailscale の key expiry を無効化済み。

現地に置く前に、Tailscale 管理画面で `inazumi-pi` が expiry disabled になっていることをもう一度見る。

手元 Mac からの確認:

```bash
tailscale status
ssh inazu@inazumi-pi
```

名前解決が怪しい場合は `tailscale status` に出る `100.x.y.z` の IP で入る。

## 持っていっていいライン

Pi を友人宅に持っていくのは、手元で次を全部確認してから。

- Pi が電源再投入後に headless で起動する
- Tailscale 経由で Pi に SSH できる
- できればスマホのテザリングや別回線からも SSH できる
- Pi の簡易Webサーバーが再起動後に自動起動する
- `https://pi-site-origin.inazu.me/` で簡素ページが見える
- `https://pi-site-origin.inazu.me/healthz/site` が `200` を返す
- `inazu.me/*` の Worker route が Mac 正常時に本番ページを返す
- Mac のサイトプロセスを止めると `https://inazu.me/` が Pi の簡素ページになる
- Pi の簡易Webサーバーも止めると `https://inazu.me/` が Worker 内蔵ページになる

これが1つでも未確認なら、まだ持っていかない。

## Phase 1: Pi を手元で準備する

1. Raspberry Pi OS Lite 64-bit を入れる
2. Imager の設定で SSH を有効化する
3. hostname を決める。例: `inazu-failover-pi`
4. 手元のネットワークで起動する
5. package を更新する
6. ローカルネットワークから SSH できることを確認する
7. Tailscale を入れる
8. Pi を自分の tailnet に参加させる
9. Tailscale 管理画面で Pi の key expiry を無効化する
10. `tailscale status` と `tailscale ip` を確認する
11. Tailscale 経由で SSH できることを確認する
12. Pi を再起動して、再起動後も Tailscale SSH できることを確認する

参考:

- Tailscale Linux install: https://tailscale.com/docs/install/linux
- Tailscale SSH: https://tailscale.com/kb/1193/tailscale-ssh

## Phase 2: Pi に簡素サイトを置く

Pi の fallback サイトは、最初は徹底して簡素にする。

- HTML 1枚
- 外部CSSなし
- 画像なし
- JavaScriptなし
- `/healthz/site` は常に `200`
- systemd service で自動起動

表示内容のイメージ:

```text
inazu.me is running in fallback mode.
The home Mac is currently unreachable.
```

最初からポートフォリオ全体を Pi に複製しない。  
目的は「ネットワーク経路のフェイルオーバーが動くこと」を確認すること。

## Phase 3: Pi に Cloudflare Tunnel を入れる

1. Pi に `cloudflared` を入れる
2. Pi 用の tunnel を作る。例: `inazu-pi-site`
3. public hostname を追加する

```text
pi-site-origin.inazu.me -> http://localhost:8080
```

4. `cloudflared` を Linux service として登録する
5. Pi を再起動する
6. 再起動後も tunnel が自動復帰することを確認する

参考:

- cloudflared as a service on Linux: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/local-management/as-a-service/linux/
- cloudflared install/update: https://developers.cloudflare.com/tunnel/downloads/update-cloudflared/

## Phase 4: Mac 側 origin hostname を用意する

Mac の現行サーバーはそのまま使う。

```text
Mac Express app -> http://localhost:3000
```

Mac tunnel に次の hostname を追加する。

```text
mac-site-origin.inazu.me -> http://localhost:3000
```

今の `server.js` は `inazu.me`、`www.inazu.me`、localhost を public portfolio host として扱っている。  
もし `mac-site-origin.inazu.me` で redirect や block が起きるなら、あとで host allowlist に追加する。

## Phase 5: Worker を追加する

Worker route:

```text
inazu.me/*
```

この repo では Worker をここに置く。

```text
workers/inazu-site-failover/
```

Worker の動き:

```text
同じ path で Mac origin に投げる
Mac が失敗したら同じ path で Pi origin に投げる
Pi も失敗したら Worker 内蔵の簡素HTMLを返す
```

最初は短い timeout だけでよい。  
動いたあとで、Mac が死んでいる間に毎回 timeout 待ちしないよう、短時間の down state cache や circuit breaker を足す。

deploy:

```bash
cd workers/inazu-site-failover
npx wrangler deploy
```

`wrangler login` が Cloudflare OAuth で失敗する場合は、API token を環境変数で渡して deploy する。token は repo に書かない。

```bash
cd workers/inazu-site-failover
CLOUDFLARE_API_TOKEN='作ったAPI token' npx wrangler deploy
```

Worker のコードは Cloudflare Dashboard の Workers & Pages から確認・編集できる場合がある。

ただし、この運用では **repo の `workers/inazu-site-failover/` を source of truth にする**。Dashboard で直接編集すると、手元の git と本番がずれるので、基本は `wrangler deploy` で反映する。

参考:

- Workers routes and domains: https://developers.cloudflare.com/workers/configuration/routing/
- Wrangler configuration routes: https://developers.cloudflare.com/workers/wrangler/configuration/

## Phase 6: 手元でフェイルオーバーテストする

Pi を持っていく前に必ずやる。

1. 通常時

```text
Mac running, Pi running -> https://inazu.me/ が本番ポートフォリオを返す
```

2. Mac down

```text
Mac の pm2 process または Node server を止める
Pi running -> https://inazu.me/ が Pi の簡素ページを返す
```

3. Mac も Pi も down

```text
Mac down, Pi fallback server stopped -> https://inazu.me/ が Worker 内蔵ページを返す
```

4. 復帰

```text
Mac server を再起動 -> https://inazu.me/ が本番ポートフォリオに戻る
```

5. Pi 再起動

```text
Pi reboot -> fallback server と cloudflared が自動起動する
```

実際に見るコマンド:

```bash
curl -I -A 'Mozilla/5.0' https://inazu.me/
curl -I -A 'Mozilla/5.0' https://pi-site-origin.inazu.me/healthz/site
pm2 status inazu-chat
```

Pi 側:

```bash
systemctl status inazu-fallback --no-pager
systemctl status cloudflared --no-pager
curl http://127.0.0.1:8080/healthz/site
```

Worker 経由の origin 判定は `x-inazu-origin` ヘッダーで見る。

```text
x-inazu-origin: mac
x-inazu-origin: pi
x-inazu-origin: worker-fallback
```

Mac を一時停止する:

```bash
pm2 stop inazu-chat
```

Mac を戻す:

```bash
pm2 start inazu-chat
```

## Phase 7: 友人宅に持っていく

持っていく前:

- できれば Ethernet でつなぐ前提にする
- Wi-Fi の場合は友人宅の SSID/password を設定できる手段を用意する
- Pi、電源、ケーブルにラベルを貼る
- 電源アダプタが安定していることを確認する
- Tailscale の key expiry が無効になっていることを確認する

現地で挿したあと:

1. Tailscale 管理画面で Pi が online になっていることを確認する
2. Tailscale 経由で Pi に SSH する
3. fallback server の service status を見る
4. cloudflared の service status を見る
5. `https://pi-site-origin.inazu.me/` を開く
6. Mac のサイトを一時停止して、`https://inazu.me/` が Pi に fallback することを確認する

## 有線LAN / PoE 方針

Raspberry Pi Zero 2 W には標準の有線LANポートがない。

有線化するなら、基本は次の構成にする。

```text
Pi Zero 2 W の USB ポート
  -> microUSB OTG adapter
  -> USB Ethernet adapter
  -> LAN cable
  -> 友人宅ルーター

Pi Zero 2 W の PWR IN ポート
  -> 普通の5V電源
```

家庭用ルーターは普通 PoE 給電に対応していない前提で考える。

PoE をやりたい場合は、ルーター側に PoE switch または PoE injector、Pi 側に PoE splitter か Zero 2 W 対応の Ethernet/PoE HAT が必要になる。

今回の用途では、最初は PoE まで狙わずに次のどちらかが現実的。

```text
安定優先:
USB Ethernet adapter + 通常電源

手軽さ優先:
2.4GHz Wi-Fi + 通常電源
```

友人宅で Wi-Fi を使う場合は、Zero 2 W が 2.4GHz Wi-Fi 前提であることに注意する。

5GHz 専用SSID、WPA3-only、ゲストWi-Fiの端末分離は避ける。

## 残タスク

- Pi を再起動して `cloudflared` と `inazu-fallback` が自動復帰する最終確認
- 友人宅のネットワーク方式を決める。有線なら USB Ethernet adapter と OTG adapter を用意する
- Worker に circuit breaker を入れて、Mac 停止中に毎回 timeout を待たないようにする
- 現地設置後に Tailscale、fallback site、cloudflared、`inazu.me` fallback を確認する

## 後回し: chat.inazu.me

`inazu.me` のフェイルオーバーが退屈なくらい安定してから着手する。

追加で難しい点:

- Turnstile verification
- cookie session
- `express-session` が各ホストのメモリ内にある
- `/api/chat` が SSE streaming
- Ollama は遅いだけで死んでいないケースがある
- 会話中に Mac が死んだ場合、途中から Pi に引き継ぐのは無理

考えられる fallback:

```text
chat.inazu.me のUIは表示する
/api/chat は Mac 正常時だけ Ollama に投げる
Mac down 時は Pi または Worker が固定文の SSE を返す
```

ただし、これは `inazu.me` の経路制御が完成してから考える。
