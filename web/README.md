# MirrorPilot Web

A web version of [MirrorPilot](https://github.com/warjiang/MirrorPilot) for
managing container image mirror entries and running **source detection** from
the browser.

It is built to run entirely on **Cloudflare's free tier**:

- **Cloudflare Pages** serves the static React app (free).
- **Cloudflare Pages Functions** (`functions/`) provide the detection API,
  running on the Workers runtime (free tier: 100k requests/day).

No database or paid add‑on is required — config is stored in the browser's
`localStorage`, and registry credentials stay in memory for the active session
only.

## Tech stack

- [Vite](https://vite.dev/) + React 19 + TypeScript
- [Tailwind CSS v4](https://tailwindcss.com/)
- [shadcn/ui](https://ui.shadcn.com/) components (new-york style)
- Cloudflare Pages Functions + [Wrangler](https://developers.cloudflare.com/workers/wrangler/)

## Features

### Mirror entry management
- Add `source → target` mappings with profile selection.
- The target path is auto-derived from the source (same rules as the Go CLI),
  and image references are validated client-side.
- Configure the registry profile (destination registry + detection
  credentials).

### Source detection
For each entry the detection API probes four things via the Docker Registry v2
protocol (token-auth aware):

| Check        | Meaning                                                        |
| ------------ | -------------------------------------------------------------- |
| **Source**   | Whether the source image manifest exists.                      |
| **Reachable**| Whether the mirror/target registry endpoint is reachable.      |
| **Mirror**   | Whether the mirror (target) image is already synced/present.   |
| **Auth**     | Whether the supplied credentials are accepted by the registry. |

## Local development

```bash
cd web
npm install

# Front-end only (the /api/detect endpoint is NOT available here)
npm run dev

# Full stack with Pages Functions (build first, then serve dist + functions)
npm run build
npm run preview:cf   # wrangler pages dev
```

> The `/api/detect` endpoint is implemented as a Pages Function, so use
> `npm run preview:cf` (Wrangler) to exercise detection locally. Plain
> `npm run dev` only serves the React app.

## Checks

```bash
npm run lint        # eslint
npm run typecheck   # tsc for app + functions
npm run build       # type-check + production build to dist/
```

## Deploy to Cloudflare Pages (free tier)

### Option A — Git integration (recommended)
1. Push this repository to GitHub.
2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**.
3. Select the repo and set:
   - **Root directory**: `web`
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
4. Deploy. Functions under `web/functions/` are picked up automatically.

### Option B — Wrangler CLI
```bash
cd web
npm run deploy   # runs build, then `wrangler pages deploy`
```

Configuration lives in [`wrangler.toml`](./wrangler.toml)
(`pages_build_output_dir = "dist"`).

## Project layout

```
web/
├── functions/
│   └── api/
│       ├── detect.ts       # POST /api/detect — runs the four checks
│       └── _registry.ts    # Docker Registry v2 client (token auth)
├── src/
│   ├── components/         # UI: forms, table, status badges
│   │   └── ui/             # shadcn/ui primitives
│   ├── hooks/
│   ├── lib/                # types, image-ref helpers, api client
│   └── App.tsx
├── wrangler.toml
└── components.json         # shadcn config
```
