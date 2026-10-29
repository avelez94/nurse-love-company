# Nurse Love Company website prototype

Made by a nurse, for nurses.

An interactive preview of the new Nurse Love Company website, built from the approved homepage mockup. It runs as a static site with no backend. No real payments, accounts or email sign ups are connected.

## Run it

Requirements: Node.js 20 or newer.

```bash
npm install
```

```bash
npm run dev
```

Open the printed address (usually http://localhost:5173).

Other commands:

| Command | What it does |
| --- | --- |
| `npm run build` | Type checks, then builds the static site into `dist/` |
| `npm run preview` | Serves the built `dist/` folder locally |
| `npm run typecheck` | TypeScript check only |
| `npm run smoke` | Clicks through the site in a headless browser (needs `npm run build` and `npx vite preview --port 4173` running, plus Playwright on the machine) |
| `npm run build:artifact` | Builds the single file hosted preview into `dist-artifact/` |

The `dist/` folder can be uploaded to any static host (Netlify, Vercel, Cloudflare Pages, GitHub Pages). Routes use the URL hash (`#shop`, `#product-glaucoma`), so no server rewrites are needed.

## Stack

React 19, TypeScript and Vite. Icons come from `lucide-react`. Styling is plain CSS with shared tokens. There are no other runtime dependencies.

## Where things live

```
src/
  data/
    types.ts        Product, category and freebie record shapes
    catalog.ts      Sample catalog (all records marked as examples)
    site.ts         Approved headings and copy
  styles/
    tokens.css      Colors, type, spacing, shape and motion settings
    base.css        Global styles, buttons, labels, entrance animations
  lib/              Router, demo bag, search, reveal on scroll, downloads
  components/       Header, footer, dialogs, product cards, galleries,
                    "Peek inside" viewer, search, finder, demo bag
    illustrations/  Temporary illustrated product art
  pages/            Home, Shop, collections, A little extra cute,
                    product pages, Freebie Corner, Our Story, Help
```

### Adding real products

Edit `src/data/catalog.ts`. Each product record has:

* `id`, `slug`, `title`, `category`, `audience`, `type` (`digital` or `physical`)
* `summary` and `description`
* `gallery`: images. Use `{ kind: 'photo', src, alt, width, height, fit: 'contain' }` for real photos. Use `fit: 'contain'` for full marketing graphics so the artwork is never cropped. Every gallery image can be enlarged.
* `samplePages`: the pages shown in "Peek inside". Use `{ kind: 'photo', title, src, alt, width, height }` for real sample page images.
* `priceCents`, `fileFormat`, `appCompatibility`, `variants`: leave as `null` until confirmed. The site shows "Pricing to be added" or "To be confirmed" instead of guessing.
* `availability`, `deliveryRef` (future link to the digital delivery service), `isExample`, `keywords` (for search)

Put image files in `public/images/` and reference them as `./images/your-file.jpg`.

### Replacing the logo

The wordmark is temporary text in `src/components/Wordmark.tsx`. Swap in an `<img>` of the real logo there.

## What works and what is demonstration only

Works in the preview:

* Every page, link and button, with a hash based router
* Mobile menu, search (local sample catalog with empty states), "Find your essentials" chooser
* Shop filters for Nurse and NP Binder Inserts, search within the shop, clear filters, empty states
* Product pages with gallery, enlarge view and "Peek inside" sample viewer (thumbnails, previous and next, counter, keyboard arrows, swipe)
* Quick view for apparel, accessories and pens
* Demo bag: add, remove, change quantity for physical items, saved in this browser only
* Freebie Corner preview and a real one page PDF download of a general planner page (prototype sample)
* Back to top, toasts, reduced motion support, keyboard focus, dialogs with Escape and focus return

Demonstration only:

* All products are example listings with illustrated placeholder images
* No prices, file formats, app compatibility or sizes are shown because none are confirmed
* Checkout is disabled. No payment details are collected and nothing is purchased
* The freebie PDF is a generic prototype page, not a finished Nurse Love Company resource
* Our Story and contact details are placeholders

## Connecting a repository later

This project currently lives in `clients/nurse-love-company/` inside the developer portfolio repository. To move it into its own repository:

1. Create an empty repository (for example `nurse-love-company`) on GitHub.
2. Copy this folder anywhere outside the portfolio repository.
3. In the copied folder:

```bash
git init
```

```bash
git add . && git commit -m "Nurse Love Company prototype"
```

```bash
git remote add origin https://github.com/YOUR-ACCOUNT/nurse-love-company.git
```

```bash
git push -u origin main
```

To keep the history from the portfolio repository instead, run this from the portfolio root and push the resulting branch:

```bash
git subtree split --prefix=clients/nurse-love-company -b nurse-love-company
```
