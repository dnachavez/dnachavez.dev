# Development

This guide provides instructions on how to set up and run the project locally.

## Prerequisites

Ensure you have the following installed:

- [Node.js](https://nodejs.org/) 24 (see `.nvmrc`)
- [pnpm](https://pnpm.io/) 11
- [Git](https://git-scm.com/)

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/dnachavez/dnachavez.dev.git
cd dnachavez.dev
```

### 2. Install portless

Documentation: [port1355.dev](https://port1355.dev)

```bash
npm install -g portless
```

### 3. Install dependencies

```bash
pnpm i
```

### 4. Configure Environment Variables

Create a `.env.local` file based on `.env.example`:

```bash
cp .env.example .env.local
```

Then, update the necessary environment variables inside `.env.local`.

Everything optional degrades rather than breaks: without `OPENROUTER_API_KEY` the chat widget shows a "chat is off" message, and without the `LANGFUSE_*` keys it serves the system prompt from the repo.

### 5. Run the development server

```bash
pnpm dev
```

The application should now be available at https://dnachavez.localhost

## Building for Production

```bash
pnpm build
```

`pnpm build` regenerates the chat corpus (`src/generated/chat-corpus.*`) from the site's content before `next build`.

After building, start the application with:

```bash
NODE_ENV=production pnpm start
```

## Before pushing

CI runs these on every push and PR. Run them locally first:

```bash
pnpm lint
pnpm format:check
pnpm test:run
pnpm build
pnpm check-types
```
