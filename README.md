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

### Adding real tutorials

Edit `src/data/tutorials.ts`. Each tutorial has a title, category, summary, `durationSeconds` (from the real file), `video`, `captions`, written `steps`, an optional `transcript`, `productCategories` (which product pages show the "Watch the tutorial" link), optional `links`, `featured` and `published`.

* Self hosted video: `video: { kind: 'file', src: './tutorials/my-video.mp4', type: 'video/mp4', poster: './tutorials/my-poster.jpg' }` with the files in `public/tutorials/`.
* Video hosted on YouTube or Vimeo: `video: { kind: 'embed', url: 'https://www.youtube-nocookie.com/embed/VIDEO_ID' }`.
* Captions: `captions: [{ label: 'English', srclang: 'en', src: './tutorials/my-video.en.vtt' }]` (WebVTT).
* Set `isExample` and `placeholderVideo` to `false` once the real content is in.

Category filters appear automatically once there are at least 4 published tutorials (`MIN_TUTORIALS_FOR_FILTERS`). The current five tutorials are examples that share one 18 second placeholder video in `src/assets/tutorials/`.

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
* Public Tutorials page with a featured tutorial, category filters and cards showing thumbnail, title, description and length
* Tutorial watch pages with an accessible video player (native controls, captions toggle, fullscreen, no autoplay), written instructions, transcript, helpful resource links and related tutorials
* "Need help getting started? Watch the tutorial" links on digital product pages, in Peek inside, in the demo bag and on Help
* Back to top, toasts, reduced motion support, keyboard focus, dialogs with Escape and focus return

Demonstration only:

* All products are example listings with illustrated placeholder images
* No prices, file formats, app compatibility or sizes are shown because none are confirmed
* Checkout is disabled. No payment details are collected and nothing is purchased
* The freebie PDF is a generic prototype page, not a finished Nurse Love Company resource
* Our Story and contact details are placeholders
* Tutorials are examples: one short placeholder video, sample steps and illustrated thumbnails
* There is no customer account or dashboard yet. When one is added, drop `<TutorialHelpLink category=... />` from `src/components/TutorialCard.tsx` into it

## Repository

This project lives in its own repository: https://github.com/avelez94/nurse-love-company
