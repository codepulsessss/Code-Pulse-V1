# CodePulse Backend

Push-triggered AI code analysis for GitHub repositories.

Connect a repo branch once; every push to that branch re-indexes RAG context and runs a multi-agent LangGraph review.

## Flow

1. **GitHub OAuth** — `GET /api/v1/github/oauth/url` → callback → app JWT
2. **List repos** — `GET /api/v1/github/repositories` (slim fields)
3. **List branches** — `GET /api/v1/github/repositories/:owner/:repo/branches`
4. **Connect** — `POST /api/v1/repo-index/connect` with `{ "workspace": "owner/repo", "branch": "main" }`
   - Builds embeddings for that branch
   - Registers a push webhook (`PUBLIC_WEBHOOK_URL`)
5. **On push** — webhook refreshes the index and starts analysis (async)
6. **Results** — `GET /api/v1/analysis/repositories/:owner/:repo/branches/:branch/runs`

## Auth

GitHub OAuth only. No email/password signup.

- `GET /api/v1/auth/me` — current user (JWT)

## API (client-facing)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/github/oauth/url` | Public | OAuth authorize URL |
| GET | `/api/v1/github/oauth/callback` | Public | OAuth callback → JWT |
| GET | `/api/v1/github/profile` | JWT | Slim GitHub profile |
| GET | `/api/v1/github/repositories` | JWT | Slim repo list |
| GET | `/api/v1/github/repositories/:owner/:repo/branches` | JWT | Slim branch list |
| POST | `/api/v1/repo-index/connect` | JWT | Index + webhook for workspace/branch |
| GET | `/api/v1/repo-index/repositories/:owner/:repo/branches/:branch/status` | JWT | Index status |
| POST | `/api/v1/github/webhook` | GitHub HMAC | Push events |
| GET | `/api/v1/analysis/repositories/:owner/:repo/branches/:branch/runs` | JWT | Analysis runs |
| GET | `/api/v1/analysis/repositories/:owner/:repo/runs/:runId` | JWT | Single run |

### Connect body

```json
{ "workspace": "acme/api", "branch": "main" }
```

Optional: `webhookUrl` overrides `PUBLIC_WEBHOOK_URL`.

### Slim responses

- **Profile:** `id`, `login`, `name`, `avatarUrl`
- **Repo:** `fullName`, `owner`, `name`, `private`, `defaultBranch`, `updatedAt`
- **Branch:** `name`, `protected`, `commitSha`

## Stack

- NestJS + MongoDB (Atlas Vector Search for RAG)
- LangGraph multi-agent pipeline (quality / security / performance → bug detection)
- Google Gemini for review + embeddings
- GitHub OAuth + encrypted token storage

## Setup

```bash
npm install
cp .env.example .env
# fill secrets, set PUBLIC_WEBHOOK_URL to a publicly reachable webhook URL
npm run start:dev
```

## Environment

See [`.env.example`](.env.example). Required: MongoDB, JWT secret, GitHub OAuth app, `PUBLIC_WEBHOOK_URL`, `GITHUB_WEBHOOK_SECRET`, Gemini API key.
