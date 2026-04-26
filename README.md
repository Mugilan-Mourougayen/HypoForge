# HypoForge application link - https://fulcrum-eta.vercel.app/ 

**Turn a scientific hypothesis into a runnable experiment plan in under 30 seconds.**

HypoForge takes a plain-English scientific hypothesis, searches real literature and protocol databases via Tavily, and generates a complete, operationally-realistic experiment plan — with protocol steps extracted from actual published protocols, reagent supply-chain grounding, budget estimates, timeline, and statistical validation criteria.

<img width="752" height="851" alt="image" src="https://github.com/user-attachments/assets/d028b311-468e-4d5c-96f8-22e19edf90f1" />


## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Installation & Setup](#installation--setup)
3. [Running Locally](#running-locally)
4. [Deploying to Vercel](#deploying-to-vercel)
5. [User Guide — Step by Step](#user-guide--step-by-step)
   - [Step 1 — Write your hypothesis](#step-1--write-your-hypothesis)
   - [Step 2 — Set parameters](#step-2--set-parameters)
   - [Step 3 — Run the pipeline](#step-3--run-the-pipeline)
   - [Step 4 — Read the protocol](#step-4--read-the-protocol)
   - [Step 5 — Review the plan](#step-5--review-the-plan)
   - [Step 6 — Learning Loop](#step-6--learning-loop)
6. [Features](#features)
7. [Architecture](#architecture)
8. [Technical Details & API Flow](#technical-details--api-flow)
9. [Environment Variables](#environment-variables)
10. [Project Structure](#project-structure)

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 18+ | Uses native `fetch`, ES modules |
| npm | 8+ | Comes with Node |
| Tavily API key | — | Free tier at tavily.com |
| PostgreSQL database | — | Neon free tier works; used only for saved reviews |

---

## Installation & Setup

```bash
# 1. Clone the repo
git clone <your-repo-url>
cd HackNation

# 2. Install all dependencies
npm install

# 3. Create the environment file
cp .env.local.example .env.local   # or create it manually
```

Edit `.env.local` and fill in your keys:

```env
TAVILY_API_KEY=tvly-your-key-here
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
```

The database table (`feedback_reviews`) is created automatically on first run — no migration needed.

---

## Running Locally

```bash
npm run dev
```

This starts two processes in parallel using `concurrently`:

| Process | Command | URL |
|---|---|---|
| React frontend (Vite) | `npm run dev:client` | http://localhost:3000 |
| Express API server | `npm run dev:server` | http://localhost:3001 |

Vite proxies all `/api/*` requests to the Express server, so the frontend always calls `/api/pipeline` without worrying about ports.

Open **http://localhost:3000** in your browser.

---

## Deploying to Vercel

The project is already set up for Vercel. The `api/` folder contains serverless functions that mirror every Express route, and `vercel.json` configures the build and function timeouts.

### Step 1 — Push to GitHub

Vercel deploys from a git repository. If you haven't already:

```bash
git init
git add .
git commit -m "initial commit"
gh repo create hypoforge --public --push   # or create manually on github.com
```

### Step 2 — Import the project on Vercel

1. Go to [vercel.com](https://vercel.com) and sign in
2. Click **Add New → Project**
3. Select your GitHub repository
4. Vercel auto-detects Vite — leave the framework setting as-is
5. Do **not** click Deploy yet — set environment variables first

### Step 3 — Add environment variables

In the Vercel project settings under **Environment Variables**, add:

| Name | Value | Environments |
|---|---|---|
| `TAVILY_API_KEY` | `tvly-your-key-here` | Production, Preview, Development |
| `DATABASE_URL` | `postgresql://...?sslmode=require` | Production, Preview, Development |

Or add them via the Vercel CLI:

```bash
npm install -g vercel
vercel login
vercel env add TAVILY_API_KEY
vercel env add DATABASE_URL
```

### Step 4 — Deploy

Click **Deploy** in the Vercel dashboard, or from the terminal:

```bash
vercel --prod
```

Vercel will:
1. Run `npm run build` → `vite build` → outputs static files to `dist/`
2. Deploy the static files to Vercel's global CDN
3. Deploy each file in `api/` as an AWS Lambda serverless function
4. Route all `/api/*` requests to the matching function automatically

Your app goes live at `https://your-project.vercel.app`.

### How local dev and Vercel production differ

| | Local (`npm run dev`) | Vercel production |
|---|---|---|
| API handler | Express server (`server/index.js`) on port 3001 | Vercel Functions (`api/*.js`) on Lambda |
| Routing | Vite proxy forwards `/api/*` to port 3001 | Vercel routes `/api/*` to functions natively |
| Shared logic | `server/pipeline.js` and `server/db.js` | Same files, imported by `api/` functions |
| Env vars | Read from `.env.local` | Read from Vercel dashboard |

The `src/` frontend and `server/pipeline.js` + `server/db.js` are **identical** in both environments — nothing in the app code changes between local and production.

### Important: function timeout

The pipeline makes 5 Tavily API calls and takes **15–30 seconds**. Vercel's free Hobby plan has a **10-second** function timeout, which will cause the pipeline to fail with a 504 error.

| Vercel plan | Timeout | Pipeline works? | Cost |
|---|---|---|---|
| Hobby | 10s | No — times out | Free |
| Pro | 60s | Yes | $20/month |

`vercel.json` already sets `maxDuration: 60`. This takes effect automatically on the Pro plan. The feedback and search endpoints (fast, < 2s) work fine on the free Hobby plan.

---

## User Guide — Step by Step

### Step 1 — Write your hypothesis

Open the **⚗️ New Plan** tab. You will see a textarea and four sample hypothesis chips.

**What makes a good hypothesis for HypoForge?**

A strong input has four components:

| Component | Example |
|---|---|
| Intervention (what you change) | *"A paper-based electrochemical biosensor functionalized with anti-CRP antibodies"* |
| Measurable outcome with threshold | *"will detect CRP in whole blood at concentrations below 0.5 mg/L"* |
| Mechanism (optional but improves parsing) | *"due to antibody–antigen binding at the electrode surface"* |
| Control condition (optional) | *"compared to standard laboratory ELISA"* |

Click any sample chip to auto-fill a fully-formed example. The four built-in examples cover:

- **CRP biosensor** — diagnostics, electrochemical
- **Probiotic gut permeability in mice** — microbiology, in vivo
- **Trehalose cryoprotectant for HeLa cells** — cell biology
- **Sporomusa CO₂ fixation bioreactor** — bioelectrochemistry

---

### Step 2 — Set parameters

Below the textarea you configure two parameters that scale the generated plan:

**Budget Range**

| Option | Range | What scales |
|---|---|---|
| Constrained | $500 – $2k | Reduced reagent quantities, no core facility |
| Standard | $2k – $10k | Default academic lab baseline |
| Well-funded | $10k – $50k | Full replication, premium reagents |
| Core Facility | $50k+ | Unlimited instrumentation budget |

**Timeline**

| Option | Duration | Scale factor |
|---|---|---|
| Sprint | 2–4 weeks | 0.45× |
| Standard | 2–3 months | 1.0× |
| Comprehensive | 6+ months | 2.2× |

Both parameters are numeric multipliers applied to every budget line item and timeline phase duration — not just labels.

---

### Step 3 — Run the pipeline

Click **⚡ Run Literature QC + Generate Protocol**.

A loading overlay shows five live pipeline stages:

1. **Parsing hypothesis structure** — regex extracts domain, intervention, outcome, threshold, mechanism, control, sample system
2. **Literature QC — novelty check** — Tavily searches PubMed, arXiv, bioRxiv, Semantic Scholar
3. **Protocol grounding — fetching methods** — Tavily searches protocols.io, Bio-Protocol, Nature Protocols, JoVE, OpenWetWare
4. **Synthesizing experiment plan** — extracts full text from protocol pages via Tavily `/extract`, parses steps, reagents, equipment
5. **Grounding reagents & finalising** — Tavily searches Sigma-Aldrich, Thermo Fisher, Abcam, Fisher, VWR for real catalog numbers and prices

Total time: typically **15–30 seconds** depending on Tavily response times.

---

### Step 4 — Read the protocol

After generation you land on the **📋 Protocol** tab. A fixed left sidebar lets you jump to any section.

#### Literature QC

Shows the **novelty signal** for your hypothesis:

| Signal | Meaning |
|---|---|
| ● Novel | No identical studies found |
| ◐ Similar work | Related work exists, exact combination unstudied |
| ✕ Exact match | A published study tests this same hypothesis |

Includes the top 1–3 most relevant literature references with snippets and direct links to the source.

#### Hypothesis Decomposition

Shows the structured fields extracted from your text: intervention, outcome, sample system, threshold, mechanism, and control condition.

#### Literature References

Up to 6 papers retrieved from PubMed / arXiv / bioRxiv with snippet previews and "Open source →" links.

#### Protocol Steps

Step-by-step instructions parsed from real published protocols. Each step shows:
- Step number and title
- Full description sourced from actual protocol text
- Estimated duration in minutes
- Parameters (temperature, concentration, etc.) where parseable
- "Protocol source →" link to the originating page

#### Equipment

Every instrument detected in the protocol text, with a status badge:
- **✓ Standard** — assumed available in any lab (centrifuge, incubator, micropipettes, etc.)
- **⚠ Source required** — specialized equipment you need to book or procure (potentiostat, flow cytometer, qPCR machine, confocal, HPLC, etc.)

The sidebar shows a count of items needing sourcing.

#### Reagents & Supply Chain

A table of all reagents found in the protocol text:
- Name and inferred role (capture antibody, buffer, enzyme, kit, etc.)
- Catalog verification badge: **✓ Verified** (matched on a supplier site) or **Unverified**
- Supplier name and catalog number when found
- Quantity, estimated unit cost, and lead time in days

#### Budget Estimate

Line items grouped by category (reagents, consumables, equipment rental, personnel, shipping, 15% contingency buffer), with a running total.

#### Timeline

Phase-by-phase breakdown with dependency chain. Each phase shows duration in days and a description. The top bar and sidebar both display the critical path total in days.

#### Validation Criteria

2–4 validation criteria tied to your hypothesis threshold. Each criterion includes:
- Metric and target value (pulled from your stated threshold)
- Measurement method
- Statistical test
- Required sample size (n)
- Power justification explaining why that n, with effect size, α, and power

---

### Step 5 — Review the plan

Click **🔬 Review** in the nav or the "Review this Plan" button on the Protocol page.

Rate the generated plan across **five scientific dimensions**:

| Dimension | What to assess |
|---|---|
| 🔬 Scientific Validity | Is the hypothesis logically sound? Are methods appropriate? |
| 🏗️ Operational Feasibility | Can this actually run in a real lab with the described resources? |
| 💰 Resource Realism | Are reagent choices, costs, and equipment availability realistic? |
| 📊 Statistical Adequacy | Are sample sizes justified? Are the statistical tests appropriate? |
| ⚠️ Safety & Compliance | Are relevant safety and regulatory requirements identified? |

For each dimension you can:
- **✓ Approve** or **✕ Reject**
- Rate 1–5 stars
- Write an annotation note
- If rejected: write a specific correction describing what should change

At the bottom, give an overall star rating and comment, then click **Save Review to DB** to persist it.

---

### Step 6 — Learning Loop

Click **🧠 Learning Loop** in the nav.

This page shows all saved reviews from the database, newest first. Each card displays:
- Date and detected domain
- Star rating and rejection count
- The original hypothesis text
- Overall comment
- Per-dimension approval/rejection chips in green or red

You can delete individual reviews or clear all. This gives you a persistent log of which hypothesis types and plan domains generate output that needs improvement — useful for tracking quality over time.

---

## Features

- **No LLM dependency** — zero Anthropic / OpenAI requirement. All intelligence is regex parsing + Tavily search and extract.
- **Live literature novelty check** — real-time keyword-overlap scoring against PubMed, arXiv, bioRxiv, Semantic Scholar, NCBI.
- **Protocol extraction from primary sources** — Tavily `/extract` fetches full text from protocols.io, Bio-Protocol, JoVE, OpenWetWare, Nature Protocols. Steps are parsed from actual numbered lists in those pages.
- **Reagent grounding** — Tavily search against six supplier domains to find real catalog numbers, suppliers, and prices.
- **Equipment gap detection** — 27-item vocabulary scans protocol text and flags specialized instruments needing sourcing.
- **Budget scaling** — four budget modes with precise multipliers (0.35×, 1×, 2.8×, 5.5×) applied to every cost line.
- **Timeline scaling** — three timeline modes (0.45×, 1×, 2.2×) applied to all phase durations, with critical path via topological sort.
- **Power-justified validation** — validation criteria with sample sizes justified by effect size, alpha, and power, not arbitrary values.
- **Persistent review database** — PostgreSQL with auto-created schema, JSONB per-dimension sections column.
- **Four sample hypotheses** — diagnostics, microbiology, cell biology, bioelectrochemistry.
- **Nine domain classifiers** — diagnostics, cell_biology, microbiology, bioelectrochemistry, molecular_biology, biochemistry, chemistry, neuroscience, environmental.

---

## Architecture

**Local development (`npm run dev`)**

```
┌──────────────────────────────────────────────────────────┐
│                   Browser (port 3000)                    │
│  React SPA (Vite dev server)                             │
│                      /api/*  → Vite proxy                │
└──────────────────────────┬───────────────────────────────┘
                           │ proxied to port 3001
┌──────────────────────────▼───────────────────────────────┐
│         Express API Server  (server/index.js)            │
│  POST /api/pipeline  →  server/pipeline.js               │
│  GET/POST/DELETE /api/feedback  →  server/db.js          │
│  POST /api/search   →  Tavily pass-through               │
└──────────┬──────────────────────────┬────────────────────┘
           │                          │
   ┌───────▼───────┐          ┌───────▼──────────┐
   │  Tavily API   │          │  Neon PostgreSQL  │
   │  /search      │          │  feedback_reviews │
   │  /extract     │          └──────────────────┘
   └───────────────┘
```

**Vercel production (`vercel --prod`)**

```
┌──────────────────────────────────────────────────────────┐
│                   Browser (HTTPS)                        │
│  React SPA  (static files on Vercel CDN)                 │
│                      /api/*  → Vercel routing            │
└──────────────────────────┬───────────────────────────────┘
                           │ native Vercel routing
┌──────────────────────────▼───────────────────────────────┐
│         Vercel Serverless Functions  (api/)              │
│  api/pipeline.js      →  server/pipeline.js              │
│  api/feedback.js      →  server/db.js                    │
│  api/feedback/[id].js →  server/db.js                    │
│  api/search.js        →  Tavily pass-through             │
└──────────┬──────────────────────────┬────────────────────┘
           │                          │
   ┌───────▼───────┐          ┌───────▼──────────┐
   │  Tavily API   │          │  Neon PostgreSQL  │
   │  /search      │          │  feedback_reviews │
   │  /extract     │          └──────────────────┘
   └───────────────┘
```

### Frontend (`src/`)

| File | Role |
|---|---|
| `src/main.jsx` | React entry point, mounts `<App />`, imports global styles |
| `src/App.jsx` | Entire SPA — four pages, all state management, API calls, rendering |
| `src/styles.css` | Design system — CSS custom properties, dark green header, sidebar layout, all components |

Page state (`'plan' | 'results' | 'review' | 'feedback'`) is managed with a single `useState` — no router library.

### Backend — local dev (`server/`)

| File | Role |
|---|---|
| `server/index.js` | Express server, all route definitions (local dev only) |
| `server/pipeline.js` | Five-call Tavily pipeline — shared by both Express and Vercel functions |
| `server/db.js` | PostgreSQL connection pool, auto-creates schema — shared by both |

### Backend — Vercel production (`api/`)

| File | Route | Role |
|---|---|---|
| `api/pipeline.js` | `POST /api/pipeline` | Calls `server/pipeline.js` |
| `api/feedback.js` | `GET / POST / DELETE /api/feedback` | Calls `server/db.js` |
| `api/feedback/[id].js` | `DELETE /api/feedback/:id` | Calls `server/db.js` |
| `api/search.js` | `POST /api/search` | Tavily pass-through |

---

## Technical Details & API Flow

### Pipeline Stages

```
Input: raw hypothesis string
         │
         ▼
┌──────────────────────────────────────────────┐
│  Stage 1 — Regex Parse  (no API call)        │
│                                              │
│  scoreDomain()   → 9-domain keyword scorer   │
│  THRESHOLD_RE    → numeric unit extraction   │
│  will-split      → intervention / outcome    │
│  MECHANISM_RE    → "due to / via / through"  │
│  CONTROL_RE      → "compared to / vs."       │
│  SAMPLE_KW table → organism / system lookup  │
│                                              │
│  Output: { domain, intervention, outcome,    │
│            threshold, mechanism, control,    │
│            sample_system }                   │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│  Stage 2 — Parallel Tavily Searches (3×)     │
│             Promise.all()                    │
│                                              │
│  Call A — POST /search                       │
│    domains: arxiv, biorxiv, medrxiv,         │
│             semanticscholar, pubmed, ncbi     │
│    query:  "intervention outcome system"     │
│    max_results: 8, include_answer: true      │
│    → novelty check inputs                   │
│                                              │
│  Call B — POST /search                       │
│    domains: protocols.io, bio-protocol,      │
│             nature.com, jove, openwetware,   │
│             addgene                          │
│    query:  "domain intervention outcome      │
│             protocol step-by-step method"   │
│    max_results: 5, include_answer: true      │
│    → protocol step source URLs              │
│                                              │
│  Call C — POST /search                       │
│    domains: sigmaaldrich, thermofisher,      │
│             abcam, fishersci, vwr,           │
│             biolegend, qiagen               │
│    query:  "domain intervention outcome      │
│             reagents materials equipment"   │
│    max_results: 5, include_answer: true      │
│    → reagent name + price inputs            │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│  Stage 2b — Novelty Classification           │
│             (no API call, synchronous)       │
│                                              │
│  tokenize() strips stop words               │
│  overlapScore() = shared tokens / hypo size  │
│  > 0.40  → exact_match_found                 │
│  > 0.18 or 4+ results → similar_work_exists  │
│  else    → not_found                         │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│  Stage 3 — Tavily Extract  (1 API call)      │
│                                              │
│  POST https://api.tavily.com/extract         │
│  urls: top 3 URLs from Call B above          │
│                                              │
│  Returns raw_content (full page text) from   │
│  protocols.io, bio-protocol.org, jove, etc.  │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│  Stage 3b — Content Parsing  (synchronous)   │
│                                              │
│  parseStepsFromText()                        │
│    priority 1: numbered list  (\d+[.):]+…)   │
│    priority 2: bullet list    ([-•*] …)      │
│    priority 3: action sentences (Add/Wash…)  │
│    fallback A: Tavily answer text sentences  │
│    fallback B: raw snippet lines             │
│                                              │
│  estimateDuration() per step                 │
│    overnight→720 min                         │
│    Xh→X×60 min, Xmin→X min                  │
│    wash/rinse→15, centrifug→20, incubat→60  │
│                                              │
│  parseReagentsFromText()                     │
│    AMOUNT_RE: \d+(mg|mL|µM|%) [of] Name     │
│    REAGENT_TYPE_RE: Name (solution|buffer…)  │
│                                              │
│  extractEquipmentFromText()                  │
│    27-entry vocabulary keyword match         │
│    marks specialized items assumed_available │
│    = false (potentiostat, flow cytometer…)   │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│  Stage 4 — Reagent Grounding  (1 API call)   │
│                                              │
│  POST /search on SUPPLIER_DOMAINS            │
│  query: "reagent1 reagent2 reagent3          │
│          catalog number price supplier"      │
│                                              │
│  Per reagent: fuzzy name match in results    │
│  catalog#:  regex [A-Z]{1,3}-\d{4,8}        │
│  price:     regex \$(\d{1,4}(\.\d{2})?)     │
│  supplier:  extracted from result URL domain │
│                                              │
│  grounded: true  if matched in any result    │
│  grounded: false if no result matched        │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│  Stage 5 — Plan Assembly  (synchronous)      │
│                                              │
│  buildTimeline()   5 phases, scaled by tm    │
│  buildBudget()     from reagent costs + bm   │
│  buildValidation() domain-specific from h    │
│  criticalPathDays() topological sort on DAG  │
│                                              │
│  Returns: ExperimentPlan JSON                │
└──────────────────────────────────────────────┘
```

### Total Tavily API Calls per Pipeline Run

| # | Endpoint | Purpose | Results |
|---|---|---|---|
| 1 | `POST /search` | Literature novelty check | 8 results |
| 2 | `POST /search` | Protocol discovery | 5 results |
| 3 | `POST /search` | Materials & reagents | 5 results |
| 4 | `POST /extract` | Full text from protocol pages | up to 3 URLs |
| 5 | `POST /search` | Reagent grounding on supplier sites | 6 results |

Calls 1, 2, 3 run in parallel via `Promise.all()`. Total: **5 calls per run**.

### REST API Endpoints

| Method | Path | Body / Query | Description |
|---|---|---|---|
| `POST` | `/api/pipeline` | `{ raw, budget, timeline_mode }` | Run full pipeline |
| `GET` | `/api/feedback` | `?domain=&limit=` | List saved reviews |
| `POST` | `/api/feedback` | `{ question, domain, sections, overallRating, overallComment }` | Save a review |
| `DELETE` | `/api/feedback/:id` | — | Delete one review |
| `DELETE` | `/api/feedback` | — | Delete all reviews |
| `POST` | `/api/search` | `{ query, maxResults, depth }` | Raw Tavily pass-through |

### Database Schema

```sql
CREATE TABLE feedback_reviews (
  id               BIGSERIAL PRIMARY KEY,
  timestamp        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  question         TEXT NOT NULL,
  domain           TEXT NOT NULL,
  sections         JSONB NOT NULL DEFAULT '{}'::jsonb,
  overall_rating   INTEGER NOT NULL DEFAULT 0,
  overall_comment  TEXT NOT NULL DEFAULT ''
);

CREATE INDEX feedback_reviews_domain_timestamp_idx
  ON feedback_reviews (domain, timestamp DESC);
```

`sections` is a JSONB object keyed by review dimension, each containing `{ approved, rating, annotation, correction }`. Schema is created automatically on first query — no manual migration required.

### Domain Classification

Hypotheses are scored across 9 domains by counting keyword hits in the lowercased raw text. The domain with the highest count wins.

| Domain | Key trigger words |
|---|---|
| `diagnostics` | biosensor, assay, ELISA, LOD, biomarker, CRP, lateral flow, immunoassay |
| `cell_biology` | cell, viability, apoptosis, cryoprotect, HeLa, differentiation, membrane |
| `microbiology` | bacteria, probiotic, microbiome, fermentation, biofilm, antimicrobial |
| `bioelectrochemistry` | electrode, potentiostat, cyclic voltammetry, impedance, redox, bioreactor |
| `molecular_biology` | PCR, CRISPR, sequencing, western blot, transfection, mRNA |
| `biochemistry` | enzyme, kinetics, chromatography, Km, Kcat, SDS-PAGE |
| `chemistry` | synthesis, catalyst, nanoparticle, polymer, titration |
| `neuroscience` | neuron, synapse, electrophysiology, hippocampus, cortex |
| `environmental` | soil, pollutant, remediation, biodegradation, toxicity |

### Tech Stack

| Layer | Technology |
|---|---|
| Frontend framework | React 19 + Vite 7 |
| Styling | Vanilla CSS with custom properties — no framework |
| Backend (local) | Node.js 20+, Express 4 (`server/index.js`) |
| Backend (production) | Vercel Serverless Functions — Node 20 Lambda (`api/`) |
| Database | PostgreSQL via `pg` (node-postgres) — Neon serverless recommended |
| Search & extract | Tavily API — `/search` and `/extract` endpoints |
| Dev process management | `concurrently` for parallel dev processes |
| Server hot reload | Node `--watch` flag (built-in, no nodemon) |
| Env loading (local) | Node `--env-file=.env.local` (built-in, no dotenv package) |
| Env loading (Vercel) | Vercel dashboard → injected as `process.env` at runtime |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `TAVILY_API_KEY` | Yes | From app.tavily.com — used for all search and extract calls |
| `DATABASE_URL` | Yes | PostgreSQL connection string — Neon, Supabase, or local Postgres |

The server reads these via `--env-file=.env.local` passed to the Node process in `package.json`. No `dotenv` package is needed (requires Node 20.6+).

---

## Project Structure

```
HackNation/
├── .env.local                   # API keys — never commit this file
├── index.html                   # Vite HTML entry — loads Google Fonts (Syne, IBM Plex)
├── package.json                 # Scripts: dev, build, preview + engines: node>=20
├── vite.config.js               # Port 3000, proxy /api → 3001 (local dev only)
├── vercel.json                  # Vercel build config + 60s function timeout
│
├── api/                         # Vercel serverless functions (production)
│   ├── pipeline.js              # POST /api/pipeline
│   ├── search.js                # POST /api/search
│   ├── feedback.js              # GET / POST / DELETE /api/feedback
│   └── feedback/
│       └── [id].js              # DELETE /api/feedback/:id  ([id] = dynamic route)
│
├── src/                         # React frontend — identical in local and production
│   ├── main.jsx                 # React mount point
│   ├── App.jsx                  # Complete SPA — all pages, state, API calls
│   └── styles.css               # Full design system with CSS variables
│
├── server/                      # Shared logic — used by both Express and api/ functions
│   ├── index.js                 # Express server (local dev only, not deployed)
│   ├── pipeline.js              # 5-call Tavily pipeline + all parsers + assemblers
│   └── db.js                    # PostgreSQL connection pool + auto schema creation
│
└── reference/
    └── tavily-hacker-guide.pdf  # Tavily API reference (search, extract, crawl, map, research)
<img width="859" height="907" alt="image" src="https://github.com/user-attachments/assets/e8bf885b-1935-400f-8009-bf3b97da4488" />

```
