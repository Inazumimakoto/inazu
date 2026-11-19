# AGENTS.md — inazu.me

ルートの `README.md` は GitHub でサイトを紹介するための文書です。運用・保守の手順はこのガイドと各手順書にまとめます。

## 公開中の inazu.me

Cloudflare Workers が静的ファイルを配信しています。主な編集先は次のとおりです。

| 変更する内容 | 編集先 |
| --- | --- |
| トップページと回転アイコンのリンク先 | `workers/inazu-site-failover/minimal/public/index.html` |
| レイアウトとアニメーション | `workers/inazu-site-failover/minimal/public/style.css` |
| 回転アイコンの画像 | `public/assets/loader/`（旧版と共有） |
| プロフィール、制作物、同期のサイト一覧など | `workers/inazu-site-failover/minimal/content.json` |
| 開発者ツールの Console での表示方法 | `workers/inazu-site-failover/minimal/public/console.js` |
| 更新履歴 | `public/assets/news.json`（旧版と共有） |

ビルドは画像や更新履歴を取り込んで `workers/inazu-site-failover/minimal/dist/` を生成します。変更は表の元ファイルに加えます。

## ローカル確認と本番反映

`workers/inazu-site-failover/` で以下を実行します。初回や依存関係を更新したときは、先に同じディレクトリで `npm ci` を実行します。

```sh
node minimal/build.mjs
./node_modules/.bin/wrangler dev --config wrangler.minimal.jsonc --local --ip 127.0.0.1 --port 8788
```

`http://127.0.0.1:8788/` で変更を確認できます。本番へ反映するときは、同じディレクトリで公開用の設定を指定してデプロイします。

```sh
./node_modules/.bin/wrangler deploy --config wrangler.minimal.jsonc --env-file ../../.env
```

GitHub への push と本番デプロイは別の操作です。ビルドだけの確認とロールバックの方法は [Workers 版の手順書](workers/inazu-site-failover/minimal/README.md) にあります。

## サイトの更新履歴

**サイトに新機能・仕様変更・お知らせなどを加えたときは、更新履歴に載せるか必ずユーザーに確認してください。** 掲載を依頼された場合にだけ、`public/assets/news.json` の `entries` の先頭に `{ "date": "YYYY-MM-DD", "text": "..." }` を1件追加します。

公開中のサイトでは `/news` がトップに転送され、再デプロイ後に Console で `inazu.show("news")` を実行すると新しい履歴を確認できます。旧版は同じ JSON からホームの News カードに最新2件、`/news` に全件を表示します。

## 旧ポートフォリオとチャットの保守

旧版の `public/` と `server.js` を自宅サーバーで配信する構成では、この PC 上の静的ファイルの変更が反映されます。`server.js`、環境変数、依存関係、起動時に読み込む設定を変更した場合は、`pm2 restart inazu-chat` が必要になることがあります。

セットアップ、認証、背景写真、アクセス解析、pm2 の手順は [旧サイトの運用記録](docs/legacy-site.md) にあります。Mac mini と Raspberry Pi の切り替えについては [旧フェイルオーバー構成の運用手順](docs/failover-runbook.md) を参照してください。
