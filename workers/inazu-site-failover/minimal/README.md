# Minimal inazu.me

旧ロード画面の猫入りバッジと周回アニメーションを常時表示します。その下のチャットで、公開プロフィールや制作物について質問できます。

プロフィール、制作物、仕事、記事、資格、ゲームの記録、欲しいもの、友人、連絡先、更新履歴はブラウザの Console に出力します。`inazu` で全データ、`inazu.show()` で再表示、`inazu.show("projects")` や `inazu.show("games")` で各項目を表示できます。DevToolsを開いているかの検出処理はありません。

## 編集とビルド

- `public/index.html` と `public/style.css`: 表に出るロゴとアニメーション。
- `public/console.js`: Console の表示と `inazu` オブジェクト。
- `content.json`: 以前のサイトの公開テキストを引き継いだデータ。旧サイトにだけ当てはまる説明は `archiveDescription` または明示した旧サイトの説明として保存。
- `../../../public/assets/news.json`: 更新履歴の単一ソース。追記する前にリポジトリの `AGENTS.md` に従ってユーザーに確認する。
- `build.mjs`: `dist/` を生成。ローダー画像、アイコン、ゲーム画像だけを既存の `public/` からコピーし、テキストと既存の更新履歴を Console 用JSに埋め込む。

`dist/` は生成物です。ゲーム画像は Console で元の画像を辿れるように含めますが、トップページでは取得しません。サーバー、環境変数、アクセスログ、旧サイトの実行スクリプトは配信物に含みません。

## ローカル確認

以下は `workers/inazu-site-failover/` で実行します。既存のロックファイルと Wrangler を使い、追加の依存は不要です。

```sh
npm ci
node --test minimal/tests/*.test.mjs
node minimal/build.mjs
./node_modules/.bin/wrangler dev --config wrangler.minimal.jsonc --local --ip 127.0.0.1 --port 8788
```

`http://127.0.0.1:8788/` を開きます。`/games`、`/news`、`/analytics` は `/` へ302転送し、データは Console にまとめます。存在しないURLと旧APIは同じロゴ画面で404を返し、バックエンドへは接続しません。JSを無効にしてもロゴとCSSアニメーションは表示できます。OSの「動きを減らす」設定では周回を停止します。

## チャットと利用料

`POST /api/chat` は質問を1件（300文字まで）受け付け、公開情報を添えて Worker から OpenAI Responses API に送ります。質問と回答はアプリのデータベースに保存しません。ブラウザには回答、対応する Console の項目、利用額を返します。

OpenAI でこのサイト専用のキーを発行し、Cloudflare の Worker 設定「ランタイム変数とシークレット」で種類「シークレット」、名前 `OPENAI_API_KEY` として登録します。本番で登録済みの名前 `OPEN_API_KEY` も使用できます。両方登録した場合は `OPENAI_API_KEY` を優先します。ローカル実行用のキーは必要に応じて `workers/inazu-site-failover/.dev.vars` に設定できます。

利用枠は SQLite の Durable Object `ChatLedger` で全地域にわたり共有します。日本時間で1日1,000回答、同じIPからの質問は直近60秒に5件までです。回答を生成している間は1件分の枠を確保し、生成に失敗したときはその日次枠を戻します。

`GET /api/usage` が返す月額は、このチャットの呼び出しで確認できたトークン数と単価に基づく米ドルの推定額です。月初は日本時間で切り替わります。同時実行分を含めて月100ドルの範囲に収めるため、送信前に1件0.01ドルを仮押さえし、使用量が判明したら精算します。タイムアウトなどで課金の有無が分からない場合、仮押さえ分は当月の残り枠から差し引きます。単価・最大入力・出力を変えるときは `answer.mjs` と `ledger.mjs` の仮押さえ額を一緒に確認してください。[GPT-6 Luna の標準料金](https://developers.openai.com/api/docs/models/gpt-6-luna)

## 本番デプロイ

本番の `inazu.me` は `wrangler.minimal.jsonc` でデプロイします。既存の `inazu-site-failover` Worker が `inazu.me/*` を受け持ち、ページと画像は静的アセットから、チャットと利用額は Worker のAPIから返します。更新履歴を変更した場合も、再デプロイすると Console に反映されます。

梱包確認と、実際に本番を切り替えるコマンドは別です。

```sh
# 検証のみ。アップロードしない。
./node_modules/.bin/wrangler deploy --config wrangler.minimal.jsonc --dry-run

# 本番デプロイ。
./node_modules/.bin/wrangler deploy --config wrangler.minimal.jsonc --env-file ../../.env
```

ロールバックする場合は、Cloudflareのデプロイ履歴で戻すバージョンを確認し、`wrangler rollback <version-id>` に同じ設定ファイルと環境ファイルを指定します。旧サイトのソースは `public/` と `server.js` にあります。

将来、DNSとホスティング設定も整理する場合は Custom Domain への移行を別途確認してください。現在の `inazu.me/*` のルートとプロキシ済みDNSレコードは維持する必要があります。

参考: [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)、[設定](https://developers.cloudflare.com/workers/wrangler/configuration/)、[リダイレクト](https://developers.cloudflare.com/workers/static-assets/redirects/)、[ロールバック](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)。
