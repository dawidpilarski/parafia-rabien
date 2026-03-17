# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Website for a Polish Catholic parish (Parafia Zwiastowania Pańskiego w Rąbieniu). Node.js/Express backend serving static files from `public/` with API endpoints for dynamic data.

## Running Locally

```bash
npm install
npm start        # starts Express on port 3000
```

No tests, no build step, no linter configured.

## Architecture

**Backend:** `server.js` — Express server serving `public/` as static files. All API routes are defined in this single file alongside their data-fetching functions.

**Frontend:** Component-based loading without a framework. `public/index.html` is a shell with `<div id="component-{name}">` placeholders. `public/js/main.js` fetches all components in parallel from `components/`, injects them, then initializes AOS. Alpine.js handles interactivity within components after injection.

Component load order (matches page section order):
header → hero → announcements → facebook-news → readings → mass-schedule → about → history → groups → contact → footer → cookie-banner

**Key CDN frameworks:**
- **Tailwind CSS 3** — custom theme (colors, fonts) defined in the `<script>` block in `index.html`
- **Alpine.js 3** — interactivity; `x-data` scopes are per-component
- **AOS** — `data-aos="fade-up"` with staggered `data-aos-delay` on cards
- **Font Awesome 6** — icons

## API Endpoints

| Endpoint | Source | Cache |
|----------|--------|-------|
| `GET /api/czytania` | Scrapes opoka.org.pl (cheerio) | Daily (resets at midnight) |
| `GET /api/ogloszenia` | `data/ogloszenia.json` | None |
| `GET /api/okresy-liturgiczne` | `data/okresy-liturgiczne.json` | None |
| `GET /api/facebook-feed` | Facebook Graph API v21.0 | 1-hour TTL |

Errors are reported via `notifyError()` which POSTs to an external webhook.

## Environment Variables

| Variable | Default | Required for |
|----------|---------|--------------|
| `PORT` | `3000` | — |
| `FACEBOOK_PAGE_TOKEN` | none | `/api/facebook-feed` (returns 503 if unset) |
| `FACEBOOK_PAGE_ID` | `100086143224757` | `/api/facebook-feed` |

### Getting a permanent Facebook page token

```bash
node scripts/exchange-facebook-token.js \
  --app-id <app_id> \
  --app-secret <app_secret> \
  --short-lived-token <EAA...from Graph Explorer> \
  [--page-id 100086143224757]
```

This outputs a page access token that never expires (short-lived → 60-day user token → permanent page token). Set the result as `FACEBOOK_PAGE_TOKEN`.

## Theme & Styling

Custom Tailwind colors in `index.html`:
- `navy` (#152540), `navy2` (#1e3255) — backgrounds, headings
- `gold` (#c4a04b), `gold2` (#e0c47a) — accent
- `cream` (#faf8f4) — page background; `sand` (#f0ece3) — alternating sections

Fonts: Playfair Display (serif headings) + Inter (sans body).

`css/styles.css` holds custom utility classes. Key reusable classes:
- `grad-card` — navy gradient dark card
- `lift` — hover translateY + shadow on interactive elements
- `section-label` — small pill label above section headings
- `divider` — gold accent line under headings

Light cards: `bg-white rounded-2xl shadow-xl border border-gray-100`.

## Announcements

`data/ogloszenia.json` is the source of truth. Served by `/api/ogloszenia` and consumed by `announcements.html` via Alpine.js `fetch`. Each top-level key (`koleda`, `koncert`, `intencje`) has an `enabled` boolean — the section auto-hides when all are false. `intencje` should always render last.

## Conventions

- All content is in Polish
- Section IDs are Polish: `#msze`, `#ogloszenia`, `#czytania`, `#o-parafii`, `#historia`, `#grupy`, `#kontakt`
- Nav links in `header.html` must be updated in both desktop and mobile blocks
- Alpine.js data-fetching pattern: `x-data="{ loading:true, error:false, data:null, init(){ fetch(...).then(...).catch(...) } }"`
