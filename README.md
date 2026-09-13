# Zayn Chat

A lightweight ChatGPT-style AI assistant. Streaming answers, saved chat history,
no database and no login.

**Stack:** Next.js (App Router) · TypeScript · Tailwind CSS · OpenRouter

## What it does

- Chat with streaming responses (`/api/chat` streams OpenAI-style SSE from OpenRouter)
- Chat history with rename and delete, kept in `localStorage`
- Stop generation, regenerate the last reply
- Markdown rendering with code blocks and a copy button
- Enter to send, Shift + Enter for a new line
- Mobile-first dark UI

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in the two values
npm run dev                  # http://localhost:3000
```

Get an API key at <https://openrouter.ai/keys> and pick any model id from
<https://openrouter.ai/models>.

## Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | yes | Server-side only. Never prefixed with `NEXT_PUBLIC_`. |
| `OPENROUTER_MODEL` | yes | e.g. `openai/gpt-4o-mini` |
| `OPENROUTER_SITE_URL` | no | Sent as `HTTP-Referer` |
| `OPENROUTER_APP_NAME` | no | Sent as `X-Title`, defaults to `Zayn Chat` |

The key is read only inside the route handler, so it is never included in the
client bundle.

## Scripts

| Script | Command |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run start` | Production server (honours `PORT`) |
| `npm run typecheck` | `tsc --noEmit` |

## Deploy on Render

`render.yaml` is included, so **New → Blueprint** and pointing at the repo is enough.
Manual setup works the same:

- **Build command:** `npm ci && npm run build`
- **Start command:** `npm run start`
- **Environment:** `NODE_VERSION=20`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`

`npm run start` binds to Render's `PORT` automatically. No `.env` file is committed.

## Project layout

```
app/
  api/chat/route.ts   streaming proxy to OpenRouter (key never leaves the server)
  globals.css         Tailwind + markdown styles
  layout.tsx
  page.tsx
components/
  Chat.tsx            state, streaming, persistence
  Sidebar.tsx         history: new / select / rename / delete
  MessageList.tsx     bubbles + empty state
  Composer.tsx        textarea + send / stop
  markdown.tsx        small dependency-free markdown renderer
lib/
  storage.ts          localStorage helpers
  types.ts            Chat / Message types
```
