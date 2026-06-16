# Sandboxed Issue Triage Agent

This demo app shows how to use AI SDK 7 `HarnessAgent` with Vercel Sandbox to investigate third-party reproduction repositories without running unknown code on a maintainer laptop.

The app accepts:

- A public GitHub repository URL
- An issue report
- An optional failing command
- A harness adapter choice

It creates a harness-backed session in Vercel Sandbox, streams the investigation, and returns a maintainer-ready reproduction report.

The default form values point at this public repro repository:

- [https://github.com/vercel-labs/harness-triage-repro-bugs](https://github.com/vercel-labs/harness-triage-repro-bugs)
- Default issue: https://github.com/vercel-labs/harness-triage-repro-bugs/issues/2
- Alternate issue: https://github.com/vercel-labs/harness-triage-repro-bugs/issues/1

## Why this demo exists

The point is not that an agent can read a repository. A developer can already do that locally. The point is that a product can safely investigate unknown code on behalf of a team, while keeping the harness swappable.

## Run locally

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

You will need AI SDK 7 canary harness packages, Vercel Sandbox credentials, and Vercel AI Gateway credentials available to your local environment. The demo intentionally routes harness model access through AI Gateway, not provider-specific API keys.

For local development:

```bash
vercel link
vercel env pull .env.local
```

Required environment:

```bash
VERCEL_OIDC_TOKEN=...
```

Optional overrides:

```bash
AI_GATEWAY_API_KEY=...
AI_GATEWAY_BASE_URL=https://ai-gateway.vercel.sh
```

`lib/harness-agent.ts` passes Gateway auth into every harness adapter. It uses `AI_GATEWAY_API_KEY` when present and falls back to `VERCEL_OIDC_TOKEN` for local Vercel-authenticated development.

The package names follow the current HarnessAgent canary proposal:

- `@ai-sdk/harness`
- `@ai-sdk/harness-claude-code`
- `@ai-sdk/harness-codex`
- `@ai-sdk/sandbox-vercel`

## Main files

- `app/page.tsx`: the triage form and streaming report UI
- `app/api/triage/route.ts`: the streaming server route
- `lib/harness-agent.ts`: the `HarnessAgent` setup and harness adapter swap
- `lib/reproduction-triage-skill.ts`: the reusable triage skill
- `lib/prompt.ts`: the prompt contract for each run

## What is intentionally out of scope

- GitHub app setup
- GitHub issue comments
- Pull request creation
- Vercel Workflow durability
- Patch mode

Those are natural production follow-ups, but they distract from the core HarnessAgent + Sandbox flow.
