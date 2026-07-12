# block_cloud

The cloud hub for **YawningFace Block** - a cross-device distraction-blocking
system by [Yawningface](https://github.com/Yawningface). It stores each
user's canonical blocklist config, registers devices, ingests client events,
and serves last-7-days summaries. Clients - the desktop apps (Tauri), the
Chrome extension, and the iPhone app - all talk to this API; this repo also
serves the public landing page and the self-host guide.

## Architecture

```
                        ┌──────────────────────────────┐
                        │            Auth0             │
                        │  (Device Auth Flow, JWTs)    │
                        └──────┬──────────────▲────────┘
                 access tokens │              │ JWKS (jose)
                               │              │
┌───────────────┐   Bearer JWT ▼              │
│ Desktop (Tauri)├──────────┐  ┌──────────────┴──────────────┐
├───────────────┤           │  │   block_cloud (Next.js)     │
│ Chrome ext.   ├──────────┼─▶│   Vercel · /api/v1/*        │
├───────────────┤           │  │   + landing & /setup pages  │
│ iPhone app    ├──────────┘  └──────────────┬──────────────┘
└───────────────┘                            │ service-role key
                                             ▼ (server-side only)
                              ┌──────────────────────────────┐
                              │      Supabase Postgres       │
                              │ profiles · devices · configs │
                              │           events             │
                              └──────────────────────────────┘
```

- **Auth**: clients obtain Auth0 access tokens (desktop uses the Device
  Authorization Flow). The API verifies Bearer JWTs with `jose` against the
  tenant JWKS; the token's `sub` claim is the canonical user id.
- **Data**: Postgres is accessed **only** server-side via
  `@supabase/supabase-js` with the service-role key. RLS is enabled on every
  table with no policies, which locks out the anon key entirely.
  **TODO (v2 hardening)**: add per-user RLS policies so a lower-privilege key
  could be used.
- **Contract**: the blocklist config JSON is the cross-device contract - see
  [`docs/schema.md`](docs/schema.md) and the types in
  [`lib/schema.ts`](lib/schema.ts).

## Local development

```bash
npm install
cp .env.example .env.local   # fill in the values (see table below)
npm run dev                  # http://localhost:3000
```

Checks:

```bash
npm run build        # production build (must pass)
npm run typecheck    # tsc --noEmit
```

## Deploy to Vercel

1. Create a Supabase project and run
   [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql)
   in the SQL editor.
2. Create an Auth0 tenant: an **API** (identifier = `AUTH0_AUDIENCE`, with
   *Allow Offline Access*) and a **Native** application with the *Device
   Code* and *Refresh Token* grants.
3. Import this repo at [vercel.com/new](https://vercel.com/new), set the env
   vars, deploy.

The `/setup` page of the deployed site walks through all of this in detail,
written for a technical friend.

## Environment variables

| Variable                    | Description                                                                | Example                             |
| --------------------------- | -------------------------------------------------------------------------- | ----------------------------------- |
| `AUTH0_DOMAIN`              | Auth0 tenant domain, no protocol/trailing slash                            | `yawningface.eu.auth0.com`          |
| `AUTH0_AUDIENCE`            | Identifier of the Auth0 API; must match the audience clients request       | `https://block.yawningface.org/api` |
| `SUPABASE_URL`              | Supabase project URL                                                       | `https://abcd.supabase.co`          |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key - server-side only, bypasses RLS, keep secret    | `eyJ…`                              |
| `NEXT_PUBLIC_SITE_URL`      | Public URL of this deployment                                              | `https://block.yawningface.org`     |

## API reference

All `/api/v1/*` endpoints require `Authorization: Bearer <Auth0 access token>`
(401 JSON otherwise), send CORS headers (`*` origin), and answer `OPTIONS`
preflights. On any authenticated call the caller's `profiles` row is upserted
from token claims.

| Method | Path              | Body                                                | Returns                                        |
| ------ | ----------------- | --------------------------------------------------- | ---------------------------------------------- |
| GET    | `/api/health`     | -  (no auth)                                        | `{ ok: true }`                                 |
| GET    | `/api/v1/config`  | -                                                   | `{ config, updatedAt }` (creates a default config on first call) |
| PUT    | `/api/v1/config`  | `{ config }` (validated: version 1 + blocklists)    | `{ config, updatedAt }`                        |
| POST   | `/api/v1/devices` | `{ deviceId?, name, platform, appVersion? }`        | `{ deviceId }` (upsert; refreshes `last_seen_at`) |
| POST   | `/api/v1/events`  | `{ deviceId, events: [{ type, occurredAt, payload? }] }` (max 500) | `{ inserted }`                  |
| GET    | `/api/v1/summary` | -                                                   | Last-7-days events per day per type + device list |

`platform` is one of `mac`, `windows`, `linux`, `ios`, `android`,
`extension`. `occurredAt` must be ISO 8601.

## Roadmap

- Chrome extension sync (config pull + block events).
- iOS screen-time estimates ingestion.
- AI daily digest built on `/api/v1/summary`.
- Focus leaderboard across friends.
- Security hardening: per-user RLS policies instead of the
  service-role-only model.

## License

[MIT](LICENSE) © Yawningface
