# World Price Ghana

Browser-only Ghana price comparison for searching a user-provided CSV and finding the cheapest option across familiar retailers.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/world-price-ghana/src/App.tsx` — client-side CSV parsing, validation, search, comparison, sharing, and page UI
- `artifacts/world-price-ghana/src/index.css` — local Tailwind theme and visual system
- `artifacts/world-price-ghana/public/world-price-ghana-sample.csv` — downloadable sample dataset
- `artifacts/world-price-ghana/index.html` — document metadata and social previews

## Architecture decisions

- Price lists stay in the browser; there is no account, upload endpoint, database, or server-side storage.
- CSV rows are normalized for lookup while preserving the original product-name casing for display.
- Only absolute `https:` links survive CSV parsing; unsafe, malformed, and non-secure links are shown as unavailable.
- Local Tailwind Vite integration is used instead of the runtime Tailwind CDN.

## Product

- Upload or drag and drop a CSV with product, store, price, and optional URL columns.
- Accept common header aliases, skip blank/malformed rows, report unsafe links, and show progress while reading.
- Search products with forgiving matching, compare stores cheapest-first, format values as Ghana Cedi, and share offers on WhatsApp.
- Load a truthful sample dataset without sending any data to a server.

## User preferences

- Prioritize robust CSV upload behavior, safe URLs, Ghana Cedi formatting, retailer branding, and a polished production-ready UI.

## Gotchas

- Keep the upload control's stop-propagation handlers intact; the drop zone and file input should not reopen the picker through bubbling.
- Use `PORT` and `BASE_PATH` from the managed artifact workflow for local preview/build commands.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
