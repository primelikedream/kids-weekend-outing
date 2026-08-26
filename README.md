# 週末おでかけナビ (kids-weekend-outing)

3歳児と行く週末のお出かけ先を、天気予報とOpenStreetMap(Overpass API)から探して提案するアプリです。毎週土曜・日曜の朝に自動実行され、その日の天気に合わせた候補(自動車 / バス+電車でのアクセス情報付き)をメールで届けます。APIキーが必要な有料サービスは使わず、すべて無料・無登録で使えるAPIのみで構成しています。

## 仕組み

- `src/weather.ts` — Open-Meteo API(APIキー不要)でその日の天気予報を取得
- `src/search.ts` — OpenStreetMapのOverpass API(APIキー不要)で公園・動物園・水族館・室内遊び場などを検索し、天気予報に応じて屋内/屋外の候補をバランスよく選ぶ
- `src/geo.ts` — 距離計算(直線距離)と、同じ週は同じ結果になる決定的な抽選ロジック
- `src/store.ts` — `docs/data/history.json` に提案履歴を保存(直近6週間は重複提案を避ける)
- `src/digest.ts` / `src/mailer.ts` — 提案内容(名前・おすすめ理由・アクセス方法)をメール本文にそのまま記載して送信
- `docs/` — 簡易ダッシュボード。このリポジトリは非公開のため GitHub Pages では公開していない(無料プランは非公開リポジトリでPages非対応)。見たい場合はローカルで起動する(下記)
- `.github/workflows/weekend-suggest.yml` — 毎週土・日 06:00 JST に自動実行し、メール送信後に履歴データをコミット

## 注意点

- アクセス情報(所要時間・最寄り駅)はすべて直線距離からの概算です。実際の道路状況やバス路線とは異なる場合があります。
- 施設の営業時間・休園日・料金などはOpenStreetMapのデータに基づくため最新でない場合があります。必ず各施設の公式サイトでご確認ください。
- OpenStreetMapのデータ網羅性により、地域や施設によっては候補が見つからない・件数が少ないことがあります。

## セットアップ

```bash
npm install
cp .env.example .env
# .env を編集してSMTP情報を設定
npm run suggest
```

SMTP設定が未完了の場合はメール送信をスキップします(ローカル動作確認用)。実行は土日のみ(それ以外の曜日はスキップ)です。

## ダッシュボードをローカルで見る

```bash
npx http-server docs -p 4173 -c-1
# http://localhost:4173 を開く
```

## GitHub Actionsでの自動実行

リポジトリの Settings > Secrets and variables > Actions で以下を設定してください。

**Secrets:**
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS`
- `MAIL_FROM` / `MAIL_TO`

**Variables(任意、未設定時は横浜市都筑区川向町の座標を使用):**
- `HOME_LAT` / `HOME_LON` / `HOME_LABEL`

手動実行(Actions タブ > Run workflow)では `force` を有効にすると、平日でも直近の土曜日を対象として動作確認できます。
