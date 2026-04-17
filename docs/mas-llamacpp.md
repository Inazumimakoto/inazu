# MAS llama.cpp Setup

## 目的

`/mas` の発話を mock ではなく `llama.cpp` で生成するための最小手順をまとめる。

## 前提

- `llama.cpp` 本体はまだこの Mac に入っていない
- この repo 側はすでに `llama-server` の OpenAI 互換 API を叩ける
- 優先エンドポイントは `POST /v1/chat/completions`
- 旧式の `POST /completion` にも自動フォールバックする

## 公式ベースの起動形

`llama.cpp` の README どおり、まずは `llama-server` を立てる。

```bash
llama-server -m /absolute/path/to/model.gguf --port 8080
```

Apple Silicon で GPU を積極的に使うなら、例えばこういう形から始めればよい。

```bash
llama-server -m /absolute/path/to/model.gguf --port 8080 -ngl 99 -c 8192
```

補足:

- `-m` は GGUF モデルパス
- `--port 8080` はこの repo の既定値に合わせている
- `-ngl` は GPU に載せるレイヤ数
- `-c` はコンテキスト長

## この repo 側の設定

`.env` かシェル環境に以下を入れる。

```env
MAS_UTTERANCE_BACKEND=llama.cpp
LLAMACPP_URL=http://127.0.0.1:8080
LLAMACPP_MODEL=local-model
LLAMACPP_API_MODE=auto
LLAMACPP_TIMEOUT_MS=15000
LLAMACPP_MAX_TOKENS=96
LLAMACPP_TEMPERATURE=0.75
LLAMACPP_TOP_P=0.92
```

意味:

- `MAS_UTTERANCE_BACKEND`: `mock` か `llama.cpp`
- `LLAMACPP_URL`: `llama-server` の base URL
- `LLAMACPP_MODEL`: OpenAI 互換 API の `model` フィールド
- `LLAMACPP_API_MODE`: `auto`, `chat`, `completion`
- `LLAMACPP_TIMEOUT_MS`: 発話 1 回の待ち時間上限

## 動作確認

1. `llama-server` を起動する
2. この repo のサーバーを起動する
3. `http://localhost:3000/mas/` を開く
4. 右上の mode 表示が `server orchestrator / llama.cpp ...` 系になれば、少なくとも接続は通っている

## フォールバックの挙動

- `llama.cpp` 接続に失敗した場合、`/mas` は止まらず mock 発話に落ちる
- その場合 UI の mode 表示は `server orchestrator / mock fallback` になる
- まずはここで接続失敗に気づけるようにしている

## 次に見るべき点

- 1 発話の待ち時間
- 題材逸脱の度合い
- ロールごとの話し分けが十分か
- 同じ表現を繰り返しすぎないか
