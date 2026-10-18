# [dnachavez.dev](https://dnachavez.dev)

<p>
  <a href="https://github.com/dnachavez/dnachavez.dev"><picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/github/dnachavez/dnachavez.dev/license.svg?variant=outline&amp;font=geist" /><img alt="license" src="https://shieldcn.dev/github/dnachavez/dnachavez.dev/license.svg?variant=outline&amp;mode=light&amp;font=geist" /></picture></a>
  <a href="https://github.com/dnachavez/dnachavez.dev"><picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/views/repo/dnachavez/dnachavez.dev.svg?base=8541&amp;variant=outline&amp;font=geist" /><img alt="repo views" src="https://shieldcn.dev/views/repo/dnachavez/dnachavez.dev.svg?base=43218&amp;variant=outline&amp;mode=light&amp;font=geist" /></picture></a>
</p>

A pixel-perfect dev portfolio showcasing my work as a Full Stack & AI Engineer.

→ Check out the live site: [dnachavez.dev](https://dnachavez.dev)

[![screenshot-dark](https://dnachavez.dev/images/screenshot-desktop-dark.webp#gh-dark-mode-only)](https://dnachavez.dev#gh-dark-mode-only)
[![screenshot-light](https://dnachavez.dev/images/screenshot-desktop-light.webp#gh-light-mode-only)](https://dnachavez.dev#gh-light-mode-only)

## Overview

### Stack

- Next.js 16 (App Router), React 19, TypeScript
- Tailwind CSS v4
- shadcn/ui
- MDX
- [AI SDK](https://ai-sdk.dev) with [OpenRouter](https://openrouter.ai)
- [Langfuse](https://langfuse.com) for prompt versioning
- Vitest, [promptfoo](https://www.promptfoo.dev)
- Deployed on Vercel

### Featured

- Clean & modern design
- Light, dark, and system themes
- AI chat grounded in the site's own content
- Projects, experience, testimonials, and gear
- vCard integration
- SEO optimized ([JSON-LD schema](https://json-ld.org), sitemap, robots)
- AI-ready with [/llms.txt](https://llmstxt.org)
- Spam-protected email
- Installable as PWA
- Analytics with [PostHog](https://posthog.com) and [OpenPanel](https://openpanel.dev)

### Content

Centralized document system powered by MDX:

- Unified content layer for blog posts
- Category-based content organization
- Raw `.mdx` endpoints for AI readability
- Syntax highlighting with code blocks
- Dynamic OG images for rich link previews
- RSS feed for content distribution

### Chat

A chat widget, also at [/chat](https://dnachavez.dev/chat), that answers questions about my work in the first person:

- Answers only from what the site publishes, searched from a corpus built at `pnpm build`
- Inline citations that link back to the page they came from
- Runs on a free OpenRouter model with a single paid fallback, under a daily cap
- System prompt versioned in Langfuse, with the repo copy as the fallback when it is unset or unreachable
- Red teamed with promptfoo: a regression suite gates every pull request and every new prompt version before it is promoted to `production`

See the [red team guide](./redteam/README.md) for the suites and the prompt lifecycle.

## Development

Please refer to the [Development Guide](./DEVELOPMENT.md) for more details.

## License

Licensed under the [MIT license](./LICENSE).

You're free to use my code! Just make sure to <ins>remove all my personal information</ins> before publishing your website. It's awesome to see my code being useful to someone!

## Contributors

<p>
  <a href="https://github.com/dnachavez/dnachavez.dev/graphs/contributors"><picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/contributors/dnachavez/dnachavez.dev.svg?title=false&amp;size=48&amp;align=left&amp;mode=dark&amp;font=geist&amp;watermark=true" /><img alt="contributors" src="https://shieldcn.dev/contributors/dnachavez/dnachavez.dev.svg?title=false&amp;size=48&amp;align=left&amp;mode=light&amp;font=geist&amp;watermark=true" /></picture></a>
</p>

## Star history

<p>
  <picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/chart/github/stars/dnachavez/dnachavez.dev.svg?font=geist&amp;theme=zinc" /><img alt="chart" src="https://shieldcn.dev/chart/github/stars/dnachavez/dnachavez.dev.svg?mode=light&amp;font=geist&amp;theme=zinc" /></picture>
</p>
