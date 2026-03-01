# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Website for a Polish Catholic parish (Parafia Zwiastowania Pańskiego w Rąbieniu). Node.js/Express backend serving static files from `public/` with a scraping API for daily liturgical readings.

## Running Locally

```bash
npm install
npm start        # starts Express on port 3000
```

## Architecture

**Backend:** `server.js` — Express server serving `public/` as static files. Exposes `GET /api/czytania` which scrapes brewiarz.pl for daily readings (ISO-8859-2 encoded, cached 1 hour).

**Frontend:** Component-based loading without a framework. `public/index.html` is a shell with placeholder `<div id="component-{name}">` elements. `public/js/main.js` fetches each HTML file from `components/` and injects it, then initializes AOS (scroll animations).

Component load order matters — it matches page section order:
header → hero → announcements → readings → mass-schedule → about → history → features → groups → contact → footer

**Key frameworks (all via CDN):**
- **Tailwind CSS 3** — utility classes, custom theme defined inline in `index.html`
- **Alpine.js 3** — interactivity (mobile menu toggle, announcements on/off switches)
- **AOS** — scroll-triggered animations via `data-aos` attributes
- **Font Awesome 6** — icons

## Theme & Styling

Custom Tailwind colors defined in `index.html` `<script>` block:
- `navy` (#152540), `navy2` (#1e3255) — dark backgrounds, headings
- `gold` (#c4a04b), `gold2` (#e0c47a) — accent color
- `cream` (#faf8f4) — page background
- `sand` (#f0ece3) — alternating section background

Fonts: Playfair Display (serif headings) + Inter (sans body text).

Custom animations and component styles live in `css/styles.css`. Sections alternate between `bg-white`, `bg-sand`, and `bg-cream` backgrounds. Dark cards use the `grad-card` class (navy gradient).

## Announcements System

`public/components/announcements.html` has an Alpine.js `x-data` config block at the top:

```js
news: {
  koleda:   true,   // toggle each item on/off
  koncert:  false,
  intencje: true,
}
```

Each news item is wrapped in `<template x-if="news.xxx">`. The entire section auto-hides when all items are `false`. Intencje mszalne should always render last.

## Conventions

- All content is in Polish
- Section IDs are Polish: `#msze`, `#ogloszenia`, `#czytania`, `#o-parafii`, `#historia`, `#grupy`, `#kontakt`
- Nav links in `header.html` must be updated in both desktop and mobile menu blocks
- AOS attributes: use `data-aos="fade-up"` (or fade-left/right) with staggered `data-aos-delay`
- Card patterns: dark cards = `grad-card` class, light cards = `bg-white` with `shadow-xl border border-gray-100`
- Interactive elements get the `lift` class (hover translateY + shadow)
