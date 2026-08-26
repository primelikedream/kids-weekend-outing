# 週末おでかけナビ (kids-weekend-outing)

3歳児と行く週末のお出かけ先を、天気予報とWeb検索から探して提案するアプリです。毎週土曜・日曜の朝に自動実行され、その日の天気に合わせた候補(自動車 / バス+電車でのアクセス情報付き)をメールで届けます。

## 仕組み

- `src/weather.ts` — Open-Meteo API(APIキー不要)でその日の天気予報を取得
- `src/search.ts` — Claude API(`claude-opus-5` + Web検索ツール)で実在するお出かけスポットを検索・提案
- `src/store.ts` — `docs/data/history.json` に提案履歴を保存(直近6週間は重複提案を避ける)
- `src/digest.ts` / `src/mailer.ts` — 提案内容(名前・おすすめ理由・アクセス方法)をメール本文にそのまま記載して送信
- `docs/` — 簡易ダッシュボード。このリポジトリは非公開のため GitHub Pages では公開していない(無料プランは非公開リポジトリでPages非対応)。見たい場合はローカルで起動する(下記)
- `.github/workflows/weekend-suggest.yml` — 毎週土・日 06:00 JST に自動実行し、メール送信後に履歴データをコミット

## セットアップ

```bash
npm install
cp .env.example .env
# .env を編集してAPIキー・SMTP情報を設定
npm run suggest
```

`ANTHROPIC_API_KEY` が未設定の場合は検索をスキップし、SMTP設定が未完了の場合はメール送信をスキップします(ローカル動作確認用)。実行は土日のみ(それ以外の曜日はスキップ)です。

## ダッシュボードをローカルで見る

```bash
npx http-server docs -p 4173 -c-1
# http://localhost:4173 を開く
```

## GitHub Actionsでの自動実行

リポジトリの Settings > Secrets and variables > Actions で以下を設定してください。

**Secrets:**
- `ANTHROPIC_API_KEY`
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS`
- `MAIL_FROM` / `MAIL_TO`

**Variables(任意、未設定時は横浜市都筑区川向町の座標を使用):**
- `HOME_LAT` / `HOME_LON` / `HOME_LABEL`
