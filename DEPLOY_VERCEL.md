# Deploying HypoForge to Vercel

This document describes what needs to change and why, then walks through every deployment step. No code is written here — it is a planning and reference guide.

---

## The Core Problem

The current dev setup runs an Express server on port 3001. **Vercel cannot host a persistent Express server.** Vercel is a serverless platform — your backend code runs in short-lived functions that spin up on demand and shut down after the request completes.

The solution is to replace the Express routes with **Vercel Serverless Functions**: individual `.js` files placed in an `/api` folder at the project root. Each file becomes one endpoint automatically.

The React frontend (Vite build) stays exactly the same — Vercel serves it as static files from the `dist/` folder. No changes to `src/` are needed.

---

## What Needs to Change

### 1. Add an `/api` folder at the project root

Vercel looks for serverless functions in `/api` (root level, not inside `server/`). You create one file per route group:

```
api/
├── pipeline.js        →  POST  /api/pipeline
├── search.js          →  POST  /api/search
├── feedback.js        →  GET   /api/feedback
│                         POST  /api/feedback
│                         DELETE /api/feedback  (clear all)
└── feedback/
    └── [id].js        →  DELETE /api/feedback/:id
```

Each file exports a default `async function handler(req, res)` — the same signature as Express middleware. The `server/pipeline.js` and `server/db.js` files are **not moved** — they stay in `server/` and get imported by the new `api/` functions.

A serverless function looks like this in structure (not writing the code here — just the shape):

```
export default async function handler(req, res) {
  // check req.method (GET/POST/DELETE)
  // read process.env.TAVILY_API_KEY etc.
  // call the shared logic from server/pipeline.js or server/db.js
  // return res.json(...)
}
```

### 2. Remove the proxy from `vite.config.js`

The current config has:
```js
proxy: {
  '/api': 'http://localhost:3001',
}
```

In production on Vercel there is no localhost Express server. Vercel routes `/api/*` requests to the serverless functions automatically. **Remove the entire `server` block from vite.config.js** (or keep it only for local dev using a conditional).

### 3. Add `vercel.json` at the project root

This file tells Vercel how to build and configure the deployment:

```json
{
  "buildCommand": "vite build",
  "outputDirectory": "dist",
  "functions": {
    "api/**/*.js": {
      "maxDuration": 60
    }
  }
}
```

`maxDuration: 60` is critical — the pipeline makes 5 Tavily API calls and typically takes 15–30 seconds. The default Vercel timeout is **10 seconds** (Hobby plan), which will cause the pipeline to fail. Setting 60 seconds requires the **Vercel Pro plan** ($20/month). See the timeout section below.

### 4. Update `package.json` scripts (optional)

For local development you still want the Express server. For Vercel's build it only needs `vite build`. The current `"build": "vite build"` script is already correct — no change needed there.

If you want local dev to keep working alongside Vercel functions, you can use the **Vercel CLI** locally instead of `npm run dev`:

```bash
npm install -g vercel
vercel dev   # runs both Vite and the /api functions locally on port 3000
```

---

## Folder Structure After Changes

```
HackNation/
├── api/                         ← NEW: Vercel serverless functions
│   ├── pipeline.js              ← POST /api/pipeline
│   ├── search.js                ← POST /api/search
│   ├── feedback.js              ← GET/POST/DELETE /api/feedback
│   └── feedback/
│       └── [id].js              ← DELETE /api/feedback/:id
│
├── src/                         ← unchanged (React frontend)
│   ├── App.jsx
│   ├── main.jsx
│   └── styles.css
│
├── server/                      ← unchanged (shared logic, imported by api/)
│   ├── pipeline.js
│   └── db.js
│
├── vercel.json                  ← NEW: build config + function timeout
├── vite.config.js               ← EDIT: remove the proxy block
├── index.html
└── package.json
```

---

## Step-by-Step Deployment

### Step 1 — Install Vercel CLI

```bash
npm install -g vercel
```

### Step 2 — Create the `/api` files

Create the four files described above. Each one imports from `../server/pipeline.js` or `../server/db.js` and wraps the logic in a handler function with method checking.

### Step 3 — Edit `vite.config.js`

Remove the `server.proxy` block so the production build does not reference localhost.

### Step 4 — Add `vercel.json`

Create the file at the project root with the build command, output directory, and the 60-second function timeout.

### Step 5 — Test locally with Vercel CLI

```bash
vercel dev
```

This starts a local server that mimics Vercel's routing — it serves the Vite frontend and runs the `/api` functions. Test the full pipeline at http://localhost:3000 before deploying.

### Step 6 — Set environment variables in Vercel

**Do not commit `.env.local` to git.** Instead, add the variables in the Vercel dashboard:

1. Go to your project on vercel.com
2. Settings → Environment Variables
3. Add:
   - `TAVILY_API_KEY` — your Tavily key
   - `DATABASE_URL` — your Neon / PostgreSQL connection string

Or use the CLI:
```bash
vercel env add TAVILY_API_KEY
vercel env add DATABASE_URL
```

### Step 7 — Deploy

```bash
vercel --prod
```

Vercel will:
1. Run `vite build` → outputs static files to `dist/`
2. Deploy the static files to its CDN
3. Deploy each file in `api/` as a serverless function on AWS Lambda
4. Route `/api/*` requests to the matching function

Your app will be live at a `*.vercel.app` URL.

---

## The Timeout Problem

This is the most important constraint to understand.

| Plan | Function timeout | Monthly cost | Suitable? |
|---|---|---|---|
| Hobby (free) | 10 seconds | $0 | No — pipeline takes 15–30s |
| Pro | 60 seconds | $20/month | Yes |
| Enterprise | 900 seconds | custom | Yes |

The HypoForge pipeline makes 5 Tavily API calls (3 in parallel, then extract, then grounding). Total wall-clock time is typically 15–30 seconds depending on Tavily response times. On the free Hobby plan, Vercel will kill the function after 10 seconds with a 504 Gateway Timeout.

**Options if you want to stay on the free plan:**

1. **Reduce Tavily calls** — skip the `/extract` call (lose the full-text protocol step parsing, fall back to snippets only). This brings total time down to ~8–12 seconds — borderline.

2. **Stream the response** — use Vercel's streaming response API to return partial results as they arrive. The function stays alive while streaming even on the free plan, but this requires significant refactoring of the frontend to handle streamed JSON.

3. **Split the pipeline** — expose Stage 1+2 (parse + search) as one fast endpoint (~5s) and Stage 3 (extract + assemble) as a second endpoint (~10s). The frontend calls them sequentially. Each individual call fits within 10 seconds.

4. **Use a different host for the API** — keep the Express server running on Railway, Render, or Fly.io (all have free tiers with no function timeout). Deploy only the React frontend to Vercel. Set a `VITE_API_URL` environment variable in Vercel pointing to the Railway/Render URL and update the frontend `fetch` calls accordingly.

Option 4 is the most practical path to a free deployment. The frontend on Vercel's CDN is free and fast; the Express backend on Railway's free tier handles the long-running pipeline calls without a timeout limit.

---

## Environment Variable Differences

| Variable | Local (`.env.local`) | Vercel (dashboard) |
|---|---|---|
| `TAVILY_API_KEY` | in `.env.local` | Settings → Environment Variables |
| `DATABASE_URL` | in `.env.local` | Settings → Environment Variables |

Vercel injects environment variables into serverless functions at runtime. They are available as `process.env.TAVILY_API_KEY` exactly as in the Express server — no code changes needed for the pipeline or db modules.

Make sure to add the variables to **all three environments** in the Vercel dashboard: Production, Preview, and Development (for `vercel dev` to work locally).

---

## Neon Database Compatibility

Neon PostgreSQL works on Vercel with no changes. The connection string format is the same. The only thing to confirm is that the Neon connection string includes `?sslmode=require` — Neon requires TLS and rejects plain connections. The current `server/db.js` already handles this correctly (it checks whether the host is localhost and sets SSL accordingly).

Neon's free tier also supports Vercel's serverless connection pattern well because it uses connection pooling by default (the `-pooler` hostname in the connection string). Each serverless function invocation opens and closes a connection in milliseconds without exhausting the database's connection limit.

---

## Summary Checklist

- [ ] Create `api/pipeline.js` — wraps `runPipeline` from `server/pipeline.js`
- [ ] Create `api/search.js` — wraps the Tavily pass-through
- [ ] Create `api/feedback.js` — wraps GET, POST, DELETE (all) from `server/db.js`
- [ ] Create `api/feedback/[id].js` — wraps DELETE by ID
- [ ] Edit `vite.config.js` — remove `server.proxy` block
- [ ] Add `vercel.json` — set `buildCommand`, `outputDirectory`, `maxDuration: 60`
- [ ] Upgrade to Vercel Pro (required for 60s timeout) **or** restructure to stay under 10s
- [ ] Add `TAVILY_API_KEY` and `DATABASE_URL` in Vercel dashboard
- [ ] Run `vercel dev` locally to test before deploying
- [ ] Run `vercel --prod` to deploy
