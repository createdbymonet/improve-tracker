# Improve Tracker

A personal English-learning notebook for collecting vocabulary, examples, Japanese meanings, and notes.

**Status: Early Functional MVP**

Build your English, one word at a time. Vocabulary cards form a single, vertically scrolling notebook, with a narrow reading column on desktop and a mobile-friendly layout.

## Current functionality

- Add words through an inline form; new cards appear at the bottom of the notebook.
- Keep five fields on each card: Word, Example sentence, Meaning, Translation, and Notes.
- Require Word and Meaning; the other fields are optional. Whitespace is trimmed before saving.
- Edit all five fields using the same form. Cancel discards unsaved input and preserves the original card.
- Delete cards immediately. Card numbers follow the current list order.
- Show an empty state after all words have been removed.
- Start with three sample words: Versatile, Colleague, and Improve.

## Persistence and architecture

This MVP is frontend-only. Svelte 5 page state holds the notebook, and client-side `localStorage` keeps additions, edits, and deletions across refreshes. Stored data is loaded after the component mounts, so browser APIs are not accessed during SvelteKit server rendering.

The stored vocabulary is validated before use. A missing or malformed saved notebook falls back to the sample words; a saved empty list stays empty.

Data belongs to the current browser and site origin. Clearing site data removes the notebook, and it is not shared between browsers or devices. There is no backend, authentication, database, cloud synchronization, or external API integration.

## Tech stack

- SvelteKit 3 and Svelte 5
- TypeScript with strict type checking
- SCSS for shared and component styles
- Vite for development and production builds
- Prettier for formatting

The project uses SvelteKit's `adapter-auto`. Choose a deployment-specific adapter when the hosting target is decided.

## Local development

Use Node.js 24 LTS and pnpm 11.21.0.

```sh
pnpm install
pnpm dev
```

Open the local URL printed by Vite, normally `http://localhost:5173`.

| Command             | Purpose                              |
| ------------------- | ------------------------------------ |
| `pnpm dev`          | Start the development server         |
| `pnpm check`        | Check Svelte and TypeScript          |
| `pnpm format:check` | Check formatting                     |
| `pnpm format`       | Format the project                   |
| `pnpm build`        | Create a production build            |
| `pnpm preview`      | Preview the production build locally |

Run `pnpm build` before `pnpm preview`.

Run the vocabulary data and stored-JSON regression tests with Node's built-in test runner:

```sh
node --test tests/vocabulary.test.mjs
```

## Project structure

```text
src/
├── app.html
├── lib/
│   ├── assets/
│   │   └── favicon.svg
│   ├── components/
│   │   ├── VocabularyCard.svelte
│   │   └── VocabularyForm.svelte
│   ├── data/
│   │   └── vocabulary.ts
│   ├── types/
│   │   └── vocabulary.ts
│   └── styles/
│       └── global.scss
└── routes/
    ├── +layout.svelte
    └── +page.svelte

tests/
└── vocabulary.test.mjs
```

`+layout.svelte` loads the shared SCSS baseline. Page and component styles use scoped `<style lang="scss">` blocks. `+page.svelte` owns notebook state and browser storage access; the form and card components handle their respective interfaces. The data module contains sample vocabulary, whitespace normalization, and stored-JSON validation, while the type module defines the vocabulary model.

## Future ideas

These ideas are not part of the current MVP:

- Search and filtering
- Study streaks
- Quizzes
- Categories
- Spaced repetition
- Progress tracking

## License

[MIT](LICENSE)
