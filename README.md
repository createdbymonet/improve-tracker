
# Improve Tracker

A personal English notebook with **Flashcards** and **Conversations**, built with SvelteKit 3, Svelte 5, TypeScript, SCSS, Cloudflare Workers, and D1.

**[Live Demo](https://improve-tracker.sumihana.workers.dev/)**

Public visitors explore the owner's real cloud notebook in a read-only demo. Only the owner can sign in and edit. Conversation messages are written by the owner for both Me and Partner; there is no AI chat service.

## Features

- Folders: create, rename, delete with confirmation, and view word counts.
- Flashcards: add, edit, delete, search all fields, and move between folders.
- Conversations: create, edit and delete rooms; add, edit, delete and move messages.
- Me / Partner bubbles, consecutive messages from the same speaker, stable saved order.
- Server authorization, same-origin CSRF checks, bounded input validation and version-based conflict detection.
- Confirmation for destructive changes, draft protection, accessible labels/focus, and responsive layouts.
- No localStorage persistence, automatic sample insertion, or legacy data import. A new database starts empty.

## Development

Requires Node.js 24 and pnpm 11.21.0. No additional application dependencies were introduced.

```sh
pnpm install --frozen-lockfile
pnpm db:migrate:local
pnpm dev
```

Local D1 uses `.wrangler/state`; `remote: false` prevents the development binding from accessing a remote database. Open the localhost URL printed by Vite. Without an owner secret, the app remains read only.

SvelteKit 3 / adapter-cloudflare 8 provides bindings through `cloudflare:workers`, not `event.platform.env`. The shared server environment resolver uses that module in normal dev and production. The adapter's default persistence location shares `.wrangler/state/v3` with local Wrangler migrations; existing migrations and keys do not need to be recreated after updating the application.

To enable owner sign-in locally:

1. Run `pnpm owner:key`. It creates credentials in the ignored `.owner-setup/` directory and never prints them.
2. Store `owner-key.txt` in a password manager. It is a generated 256-bit random key, not a human-chosen password.
3. Copy `.dev.vars.example` to `.dev.vars`, and set `OWNER_KEY_HASH` to the contents of `owner-key-hash.txt`. Do not put the plaintext key in `.dev.vars`.
4. Restart Vite and sign in at `/login` using the plaintext key from your password manager.

Use separate generated keys for local and production environments. The key generator refuses to overwrite existing files. Move an old setup directory to a protected location before deliberately generating another key. On Windows, protect these files with your user account's file permissions; POSIX `mode` does not establish a Windows ACL.

## Checks

```sh
pnpm types
pnpm format:check
pnpm check
pnpm test
pnpm build
pnpm preview
pnpm deploy:dry-run
```

`pnpm test` includes the original nine vocabulary tests, DB/API tests, an in-memory workerd D1 suite, session/security tests, actual hook/route tests, and component SSR tests. All test data is disposable and is not written to the application's persistent database.

After building, `node scripts/isolated-preview.mjs` starts a localhost-only Node SSR preview with disposable in-memory D1 fixtures. Add `--check` to run its HTTP smoke checks and exit.

`node scripts/check-worker-environment.mjs` checks the actual built Worker in workerd with a separate in-memory D1 and generated test credentials. It verifies bindings, sign-in, writes, CSRF, and logout without loading `.dev.vars` or persistent databases. Its explicit module root avoids the invalid relative module names that caused the earlier isolated Windows startup error. Static asset delivery and remote deployment are outside this smoke check.

## Cloudflare setup and deployment

Production uses the existing D1 database selected by `d1_databases[0].database_id` in `wrangler.jsonc`. Preserve that ID and any completed production migrations. No remote database or deployment is created automatically. See [the Japanese setup and implementation report](docs/IMPLEMENTATION.md) for the original setup procedure and verification limits.

Only for a new account/database, the initial manual setup is as follows. Skip database creation and already completed migrations for an existing production environment:

```sh
pnpm exec wrangler d1 create improve-tracker-db
```

Replace `d1_databases[0].database_id` in `wrangler.jsonc` with the returned ID, then regenerate types. Verify the account and database before applying migrations:

```sh
pnpm types
pnpm exec wrangler d1 migrations list improve-tracker-db --remote
pnpm exec wrangler d1 migrations apply improve-tracker-db --remote
```

For an initial manual deployment, code and the generated production hash can be uploaded together after checks and migration review. The existing GitHub Actions release path described below inherits the staged Cloudflare secret instead:

```sh
pnpm build
pnpm deploy:dry-run
pnpm deploy:production --secrets-file .owner-setup/production-secrets.json
```

The secrets file contains only the owner key hash. Never upload `owner-key.txt`. The deploy script refuses the placeholder database ID. Migration application is deliberately manual and does not seed example records.

For an existing Worker, `pnpm exec wrangler secret put OWNER_KEY_HASH` prompts for the hash, but **creates and deploys a new version immediately**. `wrangler versions secret put` stages a new version instead. Use the workflow appropriate to your release process.

The production workflow deploys on pushes to `release`; `main` and PRs only validate. GitHub Actions needs repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, scoped to the intended Cloudflare account and Worker. The workflow does not need an `OWNER_KEY_HASH` GitHub secret. Remote migrations are not run by CI. Do not enable a second dashboard integration deploying from `main`.

Wrangler 4.152 inherits secrets from the **most recently uploaded Worker version**, which can be undeployed. If `wrangler versions secret put OWNER_KEY_HASH` created that version, the next `release` deployment combines the repository's new code and configured `DB` binding with the inherited hash. There is no need to deploy the staged version first. See Cloudflare's [inheritance rules](https://developers.cloudflare.com/workers/observability/errors/#inherit-binding-errors-10057).

`wrangler.jsonc` declares `secrets.required: ["OWNER_KEY_HASH"]`. Wrangler's strict inheritance validation stops the upload before changing production traffic if that binding cannot be inherited. The local deployment guard also rejects a missing/placeholder `DB`, a missing required-secret declaration, or a plaintext owner hash in `vars`. A dry run checks packaging, not the presence of remote secrets or applied migrations.

Before a later production push, confirm the latest uploaded version still has the secret name (values are never shown):

```sh
pnpm exec wrangler versions secret list --latest-version --config wrangler.jsonc
```

An intervening upload can change the inheritance source. If the secret exists only on an older version, stage it again on the latest version with `wrangler versions secret put OWNER_KEY_HASH` using the protected interactive prompt. Keep the completed production migrations and include the intended `wrangler.jsonc` in the eventual `release` commit. See [required secrets](https://developers.cloudflare.com/workers/configuration/secrets/#validate-secrets-before-deploy).

## Security and data visibility

All notebook content is public by design, including notes and conversations. Owner access controls editing, not reading.

Sessions use a Secure, HttpOnly, SameSite=Strict `__Host-` cookie. The server enforces 30 days of inactivity, 180 days absolute lifetime, daily token rotation, and server-side logout. Changing `OWNER_KEY_HASH` invalidates existing sessions. Login attempts have per-source and global limits; the global limit can temporarily block the owner if abused. Consider edge-level protection if this becomes an operational issue.

Use D1 backups/Time Travel and review migrations before production use. Never commit `.dev.vars`, `.owner-setup`, account credentials, or session cookies.

## License

[MIT](LICENSE)
