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

`POST /api/chat` は質問を1件（2,048文字まで）受け付け、ポートフォリオの公開情報とともに OpenAI Responses API に送ります。一般の質問や公開URLの読み取りにも対応します。モデルが使う Web 検索、ページの閲覧、ページ内検索は OpenAI のホスト型ツールで実行します。質問と回答はアプリのデータベースに保存しません。[Web検索ツールの仕様](https://developers.openai.com/api/docs/guides/tools-web-search)

ブラウザが `Accept: application/x-ndjson` を指定すると、Worker はツールの操作を `tool`、最後の回答を `result`、生成時のエラーを `error` の各行で返します。JSONを使うクライアントには回答と操作をまとめて返します。画面には実行された操作、回答中のクリックできる引用、関連する Console の項目、その回答の推定料金を表示します。

OpenAI でこのサイト専用のキーを発行し、Cloudflare の Worker 設定「ランタイム変数とシークレット」で種類「シークレット」、名前 `OPENAI_API_KEY` として登録します。以前使っていた `OPEN_API_KEY` も使用できます。両方登録した場合は `OPENAI_API_KEY` を優先します。ローカル実行用のキーは必要に応じて `workers/inazu-site-failover/.dev.vars` に設定できます。

利用枠は SQLite の Durable Object `ChatLedger` で全地域にわたり共有します。日本時間で1日1,000回答、同じIPからの質問は直近60秒に5件までです。回答を生成している間は1件分の枠を確保し、生成に失敗したときはその日次枠を戻します。

`GET /api/usage` が返す月額は、OpenAI が返すトークンの内訳、Web検索の利用数と標準単価から計算した、このチャットの推定利用額です。新しい回答の金額は10億分の1ドル単位の整数で集計します。過去の推定額も引き継ぎます。クレジットの残高や割引後の請求額は OpenAI の請求画面で確認できます。[モデルの標準単価](https://developers.openai.com/api/docs/models/gpt-6-luna)・[Web検索の単価](https://developers.openai.com/api/docs/pricing)

月の切り替わりは日本時間です。月100ドルの予算には処理中のリクエストも含めるため、送信前に枠を確保し、使用量が判明したら精算します。タイムアウトなどで使用量が不明のときは、未確定分の枠を維持します。料金やツール回数の上限を変更するときは `cost.mjs` にある単価と仮押さえ額を確認してください。

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
