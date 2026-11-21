# Improve Tracker 実装報告・Cloudflare設定手順

## 実装範囲とPhase

本番DBの作成・変更、実データの登録・削除、本番デプロイ、コミット・push・PR作成は実施していません。WranglerのDB IDは明示的なプレースホルダーです。依存パッケージの追加・更新、faviconの変更もありません。

| Phase           | 変更内容                                                                                         | 検証                                                         |
| --------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| 1 基盤          | 空DB用migration、外部キー・インデックス・親version更新trigger、生成Cloudflare型、DBアクセス層    | SQLiteとメモリ内workerd D1で整合性・rollback・並行採番       |
| 2 認証          | 所有者アクセスキー、Cookieセッション、30日sliding・180日絶対期限、日次rotation、CSRF・レート制限 | ハッシュ保存、期限境界、更新、失効、キー変更、実hook/API認可 |
| 3 Flashcards    | フォルダCRUD・件数、単語CRUD・検索・移動、デモ非表示、既存カード・フォーム再利用                 | DB/APIテスト、実コンポーネントSSR、空状態・XSS表示           |
| 4 Conversations | ルームCRUD・件数、メッセージCRUD・移動、Me/Partner、安定順序                                     | 同話者連続・保存順・CASCADE・競合、SSRモード差分             |
| 5 検証          | format・型チェック・build・テスト、ローカルWorker検証・配備準備                                  | 最終実行結果とブラウザ確認範囲は作業完了時の報告を参照       |

## 変更ファイルと責務

| ファイル                                                             | 内容                                                                                                 |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `migrations/0001_initial.sql`                                        | folders / vocabulary / conversations / messages、外部キー、順序index、親更新trigger                  |
| `migrations/0002_auth.sql`                                           | sessions / login_attempts、期限index                                                                 |
| `src/lib/types/notebook.ts`                                          | DBレコードとNotebookSnapshot型                                                                       |
| `src/lib/server/db.ts`                                               | 4コレクションの一貫したsnapshot取得                                                                  |
| `src/lib/server/data-api.ts`                                         | 入力検証・CRUD・version競合判定                                                                      |
| `src/lib/server/auth.ts`                                             | キーハッシュ検証・セッション・rotation・失効・レート制限                                             |
| `src/lib/server/http.ts`                                             | Origin検証・所有者検証・JSON制限・安全なエラー                                                       |
| `src/hooks.server.ts`                                                | 各リクエストのセッション検証、CSRF、キャッシュ・セキュリティヘッダー                                 |
| `src/app.d.ts` / `src/worker-configuration.d.ts`                     | SvelteKitとWrangler生成のプラットフォーム型                                                          |
| `src/routes/api/data/[...path]/+server.ts`                           | 公開GET、所有者POST/PATCH/DELETE                                                                     |
| `src/routes/api/auth/{login,logout,session}/+server.ts`              | ログイン・ログアウト・利用時のセッション確認                                                         |
| `src/routes/+page.server.ts` / `+page.svelte`                        | D1初期取得、モード、ナビ、再取得、利用時のセッション延長                                             |
| `src/routes/login/+page.server.ts` / `+page.svelte`                  | 所有者ログイン画面                                                                                   |
| `src/lib/components/Flashcards.svelte`                               | フォルダ・カード操作と検索                                                                           |
| `src/lib/components/VocabularyForm.svelte` / `VocabularyCard.svelte` | 既存UIのD1対応・閲覧専用・busy・エラー・移動先                                                       |
| `src/lib/components/Conversations.svelte`                            | ルーム・左右メッセージ・編集フォーム                                                                 |
| `src/lib/client/api.ts`                                              | JSON mutation、競合・認証・保存エラー                                                                |
| `src/lib/styles/global.scss`                                         | 既存toneの共通UI・hidden・フォーカス等                                                               |
| `scripts/create-owner-key.mjs`                                       | 秘密を表示せずローカルの無視対象ファイルに生成                                                       |
| `scripts/check-deployment.mjs`                                       | プレースホルダーDBへの配備を拒否                                                                     |
| `tests/*.test.mjs` / `tests/helpers/d1.mjs`                          | 認証・ルート・DB・D1・SSRテスト、既存9テスト維持                                                     |
| `package.json`                                                       | テスト・型生成・ローカルmigration・キー生成コマンド                                                  |
| `wrangler.jsonc`                                                     | DBバインディング、ローカル時remote無効                                                               |
| `tsconfig.json`                                                      | strict維持。全アプリコードがTSのため、生成Worker JSが型検査に引き込まれるのを避けてcheckJsのみ無効化 |
| `.gitignore` / `.prettierignore` / `.dev.vars.example`               | 秘密の除外、生成型の整形除外、設定例                                                                 |
| `.github/workflows/validate.yml` / `deploy-production.yml`           | main/PR検証と既存release配備、全テスト実行                                                           |
| `README.md` / `docs/IMPLEMENTATION.md`                               | 構成・運用・未検証範囲                                                                               |

追加の検証用ファイル `scripts/isolated-preview.mjs` は、built SSRとメモリ内D1の隔離プレビューを提供します。

ローカル接続の修正では `src/lib/server/environment.ts`、`tests/dev-environment.test.mjs`、`scripts/check-worker-environment.mjs` を追加し、hooks・トップ/ログインのserver load・データAPI・ログイン/ログアウトAPIの環境取得を共有化しました。

## アーキテクチャ

```text
Browser (Svelte 5 / SCSS)
  ├─ Flashcards / Conversations
  └─ JSON API requests (same origin)
       → SvelteKit hook: Origin + Cookie session
       → API: owner authorization + input validation
       → DB access layer: parameterized SQL + batch
       → Cloudflare D1
```

初期表示はSvelteKit server load、操作後はGET `/api/data` による再取得です。データ取得は認証不要、変更はAPIでも所有者セッションを必須とします。フロントの状態やURLパラメーターでは編集権限を付与しません。

localStorageの読み書きとサンプル表示をアプリ経路から除去しました。旧パーサーは既存テストを維持するためのユーティリティとして残りますが、画面/APIの保存・復元には使用しません。migrationにseedはありません。

## テーブルとリレーション

| テーブル       | 主要列・関連                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| folders        | id, name, sort_order, created_at, updated_at, version                                                             |
| vocabulary     | id, folder_id→folders.id, word, meaning, example, translation, notes, sort_order, created_at, updated_at, version |
| conversations  | id, title, description, sort_order, created_at, updated_at, version                                               |
| messages       | id, conversation_id→conversations.id, speaker(me/partner), content, sort_order, created_at, updated_at, version   |
| sessions       | id, token_hash, credential_fingerprint, previous_token_hash/期限, 作成・最終利用・idle/absolute期限・rotation時刻 |
| login_attempts | HMAC化した送信元bucketまたはglobal、試行数、reset_at                                                              |

日時はepochミリ秒です。フォルダ・ルームの件数は読取時に算出します。子を削除・更新・移動するとtriggerが親versionも更新し、古い画面からフォルダ/ルームごと消すことを防ぎます。

フォルダ削除は単語を、ルーム削除はメッセージをCASCADEで削除します。UIで対象と関連件数を示して確認します。更新・削除は必須versionと一致する場合だけ処理し、競合は409、不存在は404を返します。

sort_orderはサーバーSQLで採番し、順序とIDで安定取得します。メッセージを編集しても順序は保持し、別ルームへの移動は移動先末尾へ追加します。D1 batchで読取・書込・関連更新をトランザクション化しています。

## 認証・セッション

- 所有者は1名、256bit乱数のアクセスキーを利用。一般的な短いパスワードへ変更しないでください。
- Secret `OWNER_KEY_HASH` はキーのSHA-256ハッシュ。平文キーはサーバー設定やDBに保存しません。
- セッショントークンも256bit乱数。Cookieだけが平文トークンを持ち、DBはハッシュだけを保存します。
- `__Host-improve-session`: HttpOnly / Secure / SameSite=Strict / Path=/ / Domainなし。
- サーバーで最終利用から30日、初回から180日の絶対期限を検証。Cookie自体は絶対期限まで永続化し、電源断で失効しません。
- 通常リクエストはDB期限だけ延長し、古い応答が新Cookieを戻さないよう再発行しません。24時間ごとのrotation時にCookieを更新します。
- 同時リクエスト向けに旧トークンは2分だけ受け付け、旧トークンからCookieを戻しません。
- 表示中の操作も5分以上間隔を空けてセッションを確認します。背景タブの放置だけでは延長しません。
- ログアウトはサーバー側セッションを削除。別端末のセッションは独立しています。IP一致は認証条件にしません。
- 所有者キーハッシュを変更するとfingerprint不一致で既存全セッションが無効になります。
- 書込はOrigin完全一致を要求。CookieのSameSiteだけに依存しません。
- ログイン試行は送信元ごと5回/15分、全体30回/15分。全体枠の悪用による一時的なログイン妨害は残るため、必要ならCloudflare側の防御を追加してください。
- 期限切れレート行は試行時に清掃し、期限切れセッションはログイン成功時に清掃します。

## デモ・ユーザーモードと保存失敗

未認証画面は実際のD1内容を閲覧するデモです。編集ボタンやフォームはDOMにも出しません。未認証のデータGETはDBを書き換えません。**単語・Notes・会話の全内容が公開対象**であり、所有者認証は編集権限を管理します。

有効なセッションがあれば所有者モードです。保存成功後にだけ再取得・完了通知を行います。保存失敗は入力を保持します。保存成功後の再取得だけ失敗した場合は編集をロックし、GETだけ再試行してPOST/DELETEの重複送信を防ぎます。

競合時は入力を自動で新versionに載せ替えず、必要な内容をコピー→Refresh確認→Edit再開と案内します。タブ切替は両コンポーネントを保持するため下書きを維持します。再読込・フォーム切替・削除は確認対象です。

## Cloudflare側で必要な操作

以下は所有者が本番反映を決めた時に実行する手順です。今回の作業では実行しません。

1. Cloudflareアカウントと対象Workerを確認し、D1作成・migration用権限とWorker配備用権限を準備する。トークンはチャットやソースに貼り付けない。
2. `pnpm exec wrangler d1 create improve-tracker-db` を実行する。
3. 返却されたdatabase_idを `wrangler.jsonc` に設定する。バインディング名は `DB`、migrations_dirは `migrations` を維持する。
4. `pnpm types` で型を再生成する。
5. `pnpm exec wrangler d1 migrations list improve-tracker-db --remote` で対象と未適用migrationを確認する。
6. バックアップを確認し、`pnpm exec wrangler d1 migrations apply improve-tracker-db --remote` を実行する。空DBに初期サンプルは入りません。
7. 本番用の `pnpm owner:key` を実行し、平文キーはパスワードマネージャーへ保管する。生成済みファイルを上書きしない設計です。
8. `pnpm format:check`、`pnpm check`、`pnpm test`、`pnpm build`、`pnpm deploy:dry-run` を実行する。
9. 配備時に `pnpm deploy:production --secrets-file .owner-setup/production-secrets.json` を使用すると、ハッシュSecretとコードを同時に反映できます。平文キーのファイルはアップロードしません。
10. 公開URLでデモ閲覧、所有者ログイン、別ブラウザで同じデータ取得、ログアウト、更新競合を確認する。

`wrangler secret put OWNER_KEY_HASH` はハッシュを対話入力できますが、その操作自体が即時デプロイです。配備を伴わずステージングする場合は `wrangler versions secret put` とVersion配備を使ってください。

ローカル開発は `pnpm db:migrate:local` → `.dev.vars` 設定 → `pnpm dev`。`--remote` やremote bindingを使わなければ本番DBを使用しません。Cookieを安全に利用するため本番はHTTPS、開発はlocalhostを使用してください。

既存GitHub Actionsはrelease push配備を維持し、main/PRには検証だけ追加しました。SecretsはWorkerにあらかじめ設定し、migrationは手動で先行適用します。CIに本番migrationや自動seedは追加していません。

参照した公式資料: [D1 APIとbatch](https://developers.cloudflare.com/d1/worker-api/d1-database/)、[D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)、[Wrangler D1コマンド](https://developers.cloudflare.com/workers/wrangler/commands/d1/)、[Secretsとコード同時反映](https://developers.cloudflare.com/workers/configuration/secrets/)。

## 残る検証・運用事項

最終検証: `pnpm test` は38件成功、`pnpm check` はエラー0・警告0。`pnpm format:check`、本番ビルドも成功しています。通常のVite/Cloudflare adapterを起動する回帰テストで、環境取得・ログイン・全CRUD・競合・サーバー再起動後のデータ/セッション維持・ログアウト・未認証拒否を検証しました。既存の37テストも維持しています。

SvelteKit 3 / adapter-cloudflare 8では、Cloudflareの環境は `event.platform.env` から `cloudflare:workers` の `env` へ移っています。旧参照によりDBも所有者Secretも未取得となり、データAPI503・ログインリンク非表示になっていました。`getEnvironment()` が通常dev/本番では公式のenvを取得し、Nodeテスト/隔離SSRでは明示されたテスト用platformを利用します。認証・CSRF・Cookie設定は変更していません。

実環境では `.dev.vars`、所有者キー/ハッシュの一致、migration 0001/0002適用済みを秘密値非表示で確認しました。Wrangler CLIとadapterの既定保存先は共通の `.wrangler/state/v3` です。DB/キーを再作成せず、通常の `pnpm dev` でデータAPI200・空状態・ログイン画面・所有者認証・ログアウトを確認しました。学習レコードを変更せず、CRUDは隔離DBで実施しました。ChromeでもOwner modeと再読み込み後のログイン状態を確認しています。

前回のWindows workerd起動時のinternal errorは、隔離用bundleがカレントディレクトリ外にあるのにMiniflareの `modulesRoot` を省略し、`../` を含むモジュール名になった検証方法の問題でした。`modulesRoot` を一時bundleのディレクトリに合わせると解消しました。`pnpm build` 後の `node scripts/check-worker-environment.mjs` で、実際のビルド済みWorkerのSSR・D1取得・ログイン・書込・CSRF拒否・ログアウトを成功確認しています。OS一般の不具合や依存更新が必要な問題とは判断していません。静的アセットと本番実配備はこのテストの対象外です。

再現可能な表示確認は `pnpm build` 後に `node scripts/isolated-preview.mjs` を実行します。localhostのみのNode SSRに完全メモリのworkerd D1を接続し、fixtureを表示します。実際の保存先にはfixtureを入れません。`node scripts/isolated-preview.mjs --check` はHTTP検証後に終了します。これはWorker全体の本番実行試験の代替ではありません。

公式根拠: [SvelteKit 3のCloudflare移行](https://svelte.dev/docs/kit/migrating-to-sveltekit-3#Adapters-adapter-cloudflare)、[Cloudflare Runtime APIs](https://svelte.dev/docs/kit/adapter-cloudflare#Runtime-APIs)、[Wrangler getPlatformProxyの保存先](https://developers.cloudflare.com/workers/wrangler/api/#getplatformproxy)。

- Cloudflareアカウント、実DB作成、remote migration、Secret登録、本番配備は未実施です。
- 異なる実端末・実ブラウザから本番D1へ接続する試験は、設定後に必要です。
- 実時間で30日/180日経過する試験は行わず、テストで時刻を進めて境界を確認しています。
- 実スマートフォン、スクリーンリーダー、実ネットワーク断・保存成功後の応答喪失は別途確認が必要です。
- 同じ書込リクエストの応答が通信途中で失われた場合、サーバーが受領したか判断できない余地があります。成功応答後の再取得失敗には再送防止がありますが、完全なidempotency-key方式は未導入です。
- 検索は取得済みsnapshot内で行い、ページング・大量データ向け全文検索は未導入です。
- 旧形式インポート、AIチャット、自動サンプル登録は要求どおり実装していません。
