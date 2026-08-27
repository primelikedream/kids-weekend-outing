# 週末おでかけナビ (kids-weekend-outing)

3歳児と行く週末のお出かけ先を、天気予報とOpenStreetMap(Overpass API)から探して提案するアプリです。手動実行すると、直近の週末(土曜・日曜)2日分の候補(自動車で20分以内、またはバス+電車で1時間以内)をまとめてメールとダッシュボードで届けます。`ANTHROPIC_API_KEY`を設定すると、Claude(Web検索付き)による候補の検証・補正と、週末限定イベントのタイムリーな発見が加わります(任意)。

ダッシュボード: https://primelikedream.github.io/kids-weekend-outing/

## 仕組み

- `src/weather.ts` — Open-Meteo API(APIキー不要)でその日の天気予報を取得
- `src/search.ts` — OpenStreetMapのOverpass API(APIキー不要)で公園・動物園・水族館・室内遊び場などを検索。自宅・現地それぞれの最寄り駅からの概算移動時間を計算し、車20分以内またはバス+電車1時間以内の場所だけに絞り込み、天気予報に応じて屋内/屋外の候補をバランスよく選ぶ
- `src/enrich.ts` — `ANTHROPIC_API_KEY`設定時のみ有効。地図データの候補をClaude(Web検索付き)で検証し、誤タグ付けの修正・実際の移動時間確認・タイムリーな子供向けイベント情報の反映を行う。さらに、既存の施設に紐付かない週末限定イベント(祭り・マルシェ・季節イベントなど)を毎回1件追加で探す
- `src/events.ts` — Tavily Search API(無料枠あり・任意)で各候補地の子供向けイベント情報(特別展・季節イベントなど)をWeb検索。`ANTHROPIC_API_KEY`未設定時のみ使われる簡易版
- `src/geo.ts` — 距離計算(直線距離)と、同じ週は同じ結果になる決定的な抽選ロジック
- `src/store.ts` — `docs/data/history.json` に提案履歴を保存(直近6週間は重複提案を避ける)
- `src/digest.ts` / `src/mailer.ts` — 提案内容(名前・おすすめ理由・アクセス方法・イベント情報)をメール本文にそのまま記載して送信
- `docs/` — GitHub Pagesで公開するダッシュボード(今週末分は上部に、過去の履歴は下部に表示)
- `.github/workflows/weekend-suggest.yml` — GitHub Actionsの手動実行(workflow_dispatch)のみ。自動スケジュール実行はしない。メール送信・履歴データのコミット・Pagesへのデプロイまで行う

## 注意点

- アクセス情報(所要時間・最寄り駅)はすべて直線距離からの概算です。実際の道路状況やバス路線とは異なる場合があります。
- 施設の営業時間・休園日・料金などはOpenStreetMapのデータに基づくため最新でない場合があります。必ず各施設の公式サイトでご確認ください。
- OpenStreetMapのデータ網羅性により、地域や施設によっては候補が見つからない・件数が少ないことがあります。
- イベント情報はWeb検索結果からの自動抽出で、要約や事実確認はしていません。必ず公式サイトで最新情報をご確認ください。
- `ANTHROPIC_API_KEY`を設定すると、1日あたり候補4件のうち3件はClaudeによる検証(地図データ+Web検索1回ずつ)、残り1件は週末イベントの新規探索という構成になり(土日で計8件のWeb検索)、地図データに載っていない候補や既存候補の絞り込みで見つかる件数が0件になることがあります。

## セットアップ

```bash
npm install
cp .env.example .env
# .env を編集してSMTP情報(・任意でANTHROPIC_API_KEY/TAVILY_API_KEY)を設定
npm run suggest
```

SMTP設定が未完了の場合はメール送信をスキップします(ローカル動作確認用)。いつ実行しても直近の土日2日分をまとめて提案します。

## ダッシュボードをローカルで見る

```bash
npx http-server docs -p 4173 -c-1
# http://localhost:4173 を開く
```

## GitHub Actionsでの手動実行

自動スケジュール実行はせず、Actions タブから手動(Run workflow)で実行する運用です。リポジトリの Settings > Secrets and variables > Actions で以下を設定してください。

**Secrets:**
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS`
- `MAIL_FROM` / `MAIL_TO`
- `ANTHROPIC_API_KEY`(任意、精度向上用。[console.anthropic.com](https://console.anthropic.com/)で発行。この頻度の利用なら月数十円程度)
- `TAVILY_API_KEY`(任意、`ANTHROPIC_API_KEY`未設定時のみ使うイベント情報検索用。[app.tavily.com](https://app.tavily.com/)で登録・無料枠あり・クレジットカード不要)

**Variables(任意、未設定時は横浜市都筑区川向町の座標・下記ダッシュボードURLを使用):**
- `HOME_LAT` / `HOME_LON` / `HOME_LABEL`
- `DASHBOARD_URL`(未設定時は `https://primelikedream.github.io/kids-weekend-outing/`)

Settings > Pages で Source を「GitHub Actions」に設定してください。

実行するには: リポジトリの Actions タブ > "Suggest weekend outing spots and publish dashboard" > Run workflow。

```bash
gh workflow run weekend-suggest.yml --repo primelikedream/kids-weekend-outing
```
