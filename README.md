# Improve Tracker

A study habit tracker focused on English learning, consistent routines, and daily improvement.

**Status: Coming Soon / Early Development**

The current project provides a responsive Coming Soon page and the frontend foundation. Tracking features, authentication, backend services, and data persistence are not implemented yet.

## Tech stack

- SvelteKit and Svelte
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

## Project structure

```text
src/
├── app.html
├── lib/
│   ├── assets/
│   │   └── favicon.svg
│   └── styles/
│       └── global.scss
└── routes/
    ├── +layout.svelte
    └── +page.svelte
```

`+layout.svelte` loads the shared SCSS baseline. Page-specific styles live in scoped `<style lang="scss">` blocks. Add reusable components under `src/lib` when the application needs them.

## Planned features

These features are planned for future development:

- Daily study tasks and checkbox-based completion tracking
- Study habits and streaks
- Weekly and monthly progress and statistics
- Study history
- English learning categories: Listening, Speaking, Reading, Writing, and Vocabulary

## License

[MIT](LICENSE)
