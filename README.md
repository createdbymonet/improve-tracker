# Improve Tracker

A personal English-learning notebook for vocabulary, examples, Japanese meanings, translations, and notes.

**[Demo](https://improve-tracker.sumihana.workers.dev/)**

## Features

- Add, edit, and delete vocabulary cards in a mobile-friendly notebook.
- Word and Meaning are required; Example sentence, Translation, and Notes are optional.
- Save changes automatically in `localStorage`. Data stays in the current browser, does not sync across devices, and is removed when site data is cleared.

Built with SvelteKit, Svelte 5, TypeScript, and SCSS. Hosted on Cloudflare Workers.

## Development

Requires Node.js 24 and pnpm 11.21.0.

```sh
pnpm install
pnpm dev
```

Open the URL printed by Vite (usually `http://localhost:5173`).

### Checks

```sh
pnpm check
pnpm format:check
node --test tests/vocabulary.test.mjs
```

### Production preview

```sh
pnpm build
pnpm preview
```

## Deployment

Pushes to `release` deploy the `improve-tracker` Cloudflare Worker through GitHub Actions. Pushes to `main` do not trigger this workflow.

Configure these repository Actions secrets:

- `CLOUDFLARE_API_TOKEN`: a token with **Workers Scripts: Edit** for the production account.
- `CLOUDFLARE_ACCOUNT_ID`: the production account ID.

Disconnect any Cloudflare dashboard Git integration that deploys from `main`; it operates separately from GitHub Actions.

To validate the production bundle locally:

```sh
pnpm build
pnpm deploy:dry-run
```

## License

[MIT](LICENSE)
