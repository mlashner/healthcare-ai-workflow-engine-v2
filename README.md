# CarePilot

Demonstration healthcare care-coordination platform. **Fictional data only.** Not a medical product and not for clinical use.

This repository implements Architecture B from [`docs/architecture.md`](docs/architecture.md): a constrained agent with a deterministic control plane. The initial application is the control-plane shell only — no AI features yet.

## Stack

TypeScript, Next.js, PostgreSQL with pgvector, Drizzle ORM, Zod, Vitest, Playwright. Local PostgreSQL runs in Docker.

## Prerequisites

- Node.js 20+ (see `.nvmrc`)
- Docker and Docker Compose, or a local PostgreSQL instance

## Local development

```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:generate   # first time, or after schema changes
npm run db:migrate
npm run db:seed       # fictional demonstration patients and documents
npm run dev
```

`docker-compose.yml` runs PostgreSQL with the `pgvector` extension. The Next.js app stays on the host. If Docker is not available, create a `carepilot` role and database locally, enable `CREATE EXTENSION vector`, and keep `DATABASE_URL` pointed at it.

`npm run db:seed` ingests 24 fictional clinical knowledge documents, chunks them, and stores lexical embeddings for semantic search. The corpus is demonstration text only and is not medical advice.

- App: [http://localhost:3000](http://localhost:3000)
- Health: [http://localhost:3000/api/health](http://localhost:3000/api/health)

## Checks

```bash
npm run typecheck
npm run lint
npm test                 # unit tests
npm run test:integration # requires migrated local Postgres
npm run test:e2e         # Playwright; starts the Next.js app
npm run eval             # CarePilot evaluation suite (in-memory, no Postgres)
```

`npm run eval` runs 32 fictional patient scenarios against the care-coordinator agent with a scripted model, scores control-plane behavior, and writes a comparable report to `eval/results/`. It establishes a baseline; it does not tune the agent.
