# GoRigo — AI Business Operating System

## Overview

GoRigo is an AI-powered Business OS mobile app (Expo React Native) backed by an Express 5 API server and PostgreSQL. It provides an AI chat assistant, autonomous AI agents, business communications (contacts + campaigns), usage tracking, and full business/team management.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **Mobile**: Expo SDK 53, React Native, Expo Router v3 (file-based routing)
- **Build**: esbuild (ESM bundle for API server)

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express 5 REST API (port from $PORT)
│   └── mobile/             # Expo React Native mobile app (GoRigo)
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts
└── pnpm-workspace.yaml
```

## API Server (`artifacts/api-server`)

Express 5 server with **19 route groups** mounted at `/api`:

| Route | Description |
|---|---|
| `/api/auth` | Device auth + email OTP verification + account recovery |
| `/api/businesses` | Business CRUD (now stores accountType, intent, background) |
| `/api/keys` | API key management (envelope encrypted) |
| `/api/orchestrate` | AI chat orchestration |
| `/api/agents` | AI agent management |
| `/api/tools` | Agent tool definitions |
| `/api/usage` | Usage tracking + plan limits |
| `/api/team` | Team member management + invite system |
| `/api/contacts` | CRM contacts (GDPR/PECR compliant) |
| `/api/campaigns` | Marketing campaign management |
| `/api/notifications` | Push notifications |
| `/api/referrals` | Referral program |
| `/api/reports` | Business analytics |
| `/api/knowledge` | Knowledge base (RAG) |
| `/api/sessions` | Voice/chat sessions |
| `/api/voice` | Voice call management |
| `/api/account` | Account management |
| `/api/admin` | Admin endpoints (ADMIN_TOKEN protected) |
| `/api/profile` | User profile CRUD (displayName, email, country, accountType, intent, background, tocAcceptedAt) |
| `/api/strategies` | AI strategy generation (SSE streaming) + history for 7 frameworks |

### Key Security Features
- **Rate limiting**: AI 20/min, auth 10/min, general 100/min, webhooks 200/min
- **trust proxy**: Set to `1` for Replit reverse proxy (fixes express-rate-limit)
- **Envelope encryption**: Per-record DEK encrypted by KEK (`ENCRYPTION_KEY` env var)
- **Admin auth**: `ADMIN_TOKEN` env var, NOT device ID
- **Device auth**: High-entropy tokens, looked up directly (no bcrypt)

### Dev Command
```bash
pnpm --filter @workspace/api-server run dev
```

## Mobile App (`artifacts/mobile`)

Expo React Native app with 5 screens:

| Screen | Description |
|---|---|
| `app/(tabs)/index.tsx` | Dashboard — AI chat with mode chips (Deep Research, Strategy SWOT, Brainstorm, Business Plan) |
| `app/(tabs)/agents.tsx` | Agents — list AI agents, view status, approve pending actions |
| `app/(tabs)/comms.tsx` | Communications — contacts list + campaign management |
| `app/(tabs)/strategies.tsx` | Strategies — 7 AI framework analyses (SWOT, Porter's 5 Forces, OKRs, Blue Ocean, BMC, GTM, Competitive) |
| `app/(tabs)/settings.tsx` | Settings — business info, API keys, team management, plan/usage |
| `app/onboarding.tsx` | 9-step onboarding: Welcome → Name & Email → ToC/Privacy → Country → Account Type → Intent → Background → Business Setup (incl. API key) → Done |

### Mobile Design System
- **Brand color**: Gold `#F5A623`
- **Background**: Near-black `#0A0A0A`
- **Fonts**: Inter (via `@expo-google-fonts/inter`)
- **Colors**: `Colors.ts` exports `Colors` (`.light`, `.dark`, `.gold`, `.goldMuted`) and `COLORS` named export

### Mobile Context
`context/AppContext.tsx` manages:
- Device authentication (stores token + userId in AsyncStorage)
- Active business selection
- Onboarding completion state

### Dev Command
```bash
pnpm --filter @workspace/mobile run dev
```

## Database (`lib/db`)

**15 schema files:**
- `users` (now includes `email`, `email_verified` columns), `businesses` (now includes `accountType`, `intent`, `background` columns), `apiKeys`, `agents`, `tools`, `usage` (events + subscriptions + wallets), `team`, `contacts`, `campaigns`, `notifications`, `knowledge`, `sessions`, `profiles` (`user_profiles` table), `strategies` (`strategies` table)

Push schema to DB (uses drizzle-kit push — no migration files needed):
```bash
pnpm --filter @workspace/db run push
```

> **DB Migration approach**: This project uses `drizzle-kit push` (direct schema sync) rather than migration files. New tables/columns are applied by running the push command above. The `user_profiles` and `strategies` tables were added in Task #4; `accountType`, `intent`, `background` were added to `businesses`.

## Environment Variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection (auto-provided by Replit) |
| `ENCRYPTION_KEY` | 32-byte hex KEK for envelope encryption |
| `ADMIN_TOKEN` | Secret for admin endpoints |
| `EXPO_PUBLIC_DOMAIN` | API base URL for mobile app |
| `PORT` | Server port (auto-assigned by Replit per artifact) |

## Known Limitations / Future Work
- AI orchestration uses a placeholder response (needs OpenAI/Anthropic integration)
- Voice endpoints are stubs (needs Twilio/Deepgram integration)
- Push notifications need Firebase/APNs configuration
- `agents.tsx` shows `template.systemPrompt` which may be undefined (minor display bug)
