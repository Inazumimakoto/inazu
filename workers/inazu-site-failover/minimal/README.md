# Minimal inazu.me

旧サイトのロード画面をもとに、猫入りの `inazu.me` バッジと三角形の周回アニメーションを表示する静的サイト。回っている3つのアイコンは、それぞれ研究室同期のサイトへのリンクです。

プロフィール、制作物、仕事、記事、資格、ゲームの記録、欲しいもの、友人、連絡先、更新履歴はブラウザの Console に出力します。`inazu` で全データ、`inazu.show()` で再表示、`inazu.show("projects")` や `inazu.show("games")` で各項目を表示できます。DevToolsを開いているかの検出処理はありません。

## 編集とビルド

- `public/index.html` と `public/style.css`: 表に出るロゴとアニメーション。
- `public/rotations.js` と `worker.mjs` が回転数を同期します。全端末が `/api/rotations` で同じ Durable Object に接続し、各画面で3つのアイコンが一巡するごとに1回を加算します。
- `public/console.js`: Console の表示と `inazu` オブジェクト。
- `content.json`: 以前のサイトの公開テキストを引き継いだデータ。旧サイトにだけ当てはまる説明は `archiveDescription` または明示した旧サイトの説明として保存。
- `../../../public/assets/news.json`: 更新履歴の単一ソース。追記する前にリポジトリの `AGENTS.md` に従ってユーザーに確認する。
- `build.mjs`: `dist/` を生成。ローダー画像、アイコン、ゲーム画像だけを既存の `public/` からコピーし、テキストと既存の更新履歴を Console 用JSに埋め込む。

`dist/` は生成物です。ゲーム画像は Console で元の画像を辿れるように含めますが、トップページでは取得しません。サーバー、環境変数、アクセスログ、旧サイトの実行スクリプトは配信物に含みません。

## ローカル確認

以下は `workers/inazu-site-failover/` で実行します。既存のロックファイルと Wrangler を使い、追加の依存は不要です。

```sh
npm ci
node minimal/build.mjs
./node_modules/.bin/wrangler dev --config wrangler.minimal.jsonc --local --ip 127.0.0.1 --port 8788
```

`http://127.0.0.1:8788/` を開きます。`/games`、`/news`、`/analytics` は `/` へ302転送し、データは Console にまとめます。存在しないURLと旧APIは同じロゴ画面で404を返し、バックエンドへは接続しません。JSを無効にしてもロゴとCSSアニメーションは表示できます。OSの「動きを減らす」がオンでも3つのアイコンは周回し、回転数の「+1」はその場に表示されます。

回転数を確認するときは、ブラウザのウィンドウを2つ並べます。「みんなで ○ 回転」が全員の累計です。一周するたびに両方の画面に「+1」が現れ、自分の画面で回った分は赤、ほかの人の分はグレーで表示されます。非表示のタブは接続を閉じ、表示に戻ると最新の累計を受け取ります。

`node --test minimal/test/rotations.test.mjs` で、同時加算、短すぎる間隔の送信、Durable Object の休止と復帰をローカルで検証できます。

## 本番デプロイ

本番の `inazu.me` は `wrangler.minimal.jsonc` でデプロイします。既存の `inazu-site-failover` Worker と `inazu.me/*` ルートから静的アセットを直接配信します。互換日付は既存Workerの `2026-05-09` です。更新履歴を変更した場合も、再デプロイすると Console に反映されます。

初回デプロイで SQLite を使う `RotationCounter` が作成されます。累計は `ROTATIONS.getByName("logo")` が指すオブジェクトに保存します。運用中の接続数とメッセージ数は Cloudflare ダッシュボードの Durable Objects で確認できます。[利用量と課金](https://developers.cloudflare.com/durable-objects/platform/pricing/)

梱包確認と、実際に本番を切り替えるコマンドは別です。

```sh
# 検証のみ。アップロードしない。
./node_modules/.bin/wrangler deploy --config wrangler.minimal.jsonc --dry-run

# 本番デプロイ。
./node_modules/.bin/wrangler deploy --config wrangler.minimal.jsonc --env-file ../../.env
```

ロールバックする場合は、Cloudflareのデプロイ履歴で戻すバージョンを確認し、`wrangler rollback <version-id>` に同じ設定ファイルと環境ファイルを指定します。`RotationCounter` の初回作成をまたいで以前の画面に戻す場合は、クラスとバインディングを維持し、戻した静的アセットを新しいバージョンとしてデプロイします。[Cloudflare のロールバック制約](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/#bindings)

旧サイトのソースは `public/` と `server.js` にあります。将来、DNSとホスティング設定も整理する場合は Custom Domain への移行を別途確認してください。現在の `inazu.me/*` のルートとプロキシ済みDNSレコードは維持する必要があります。

参考: [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)、[設定](https://developers.cloudflare.com/workers/wrangler/configuration/)、[リダイレクト](https://developers.cloudflare.com/workers/static-assets/redirects/)、[ロールバック](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)。
