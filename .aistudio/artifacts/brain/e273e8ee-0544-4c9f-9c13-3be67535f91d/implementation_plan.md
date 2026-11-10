# High-Speed Gallery Thumbnail Pipeline & Payload Optimization

This update eliminates full-resolution image fallbacks and gallery load latency by generating 384px long-side WebP thumbnails in `data/thumbnails` at the project root, serving them with immutable browser caching, and combining on-demand thumbnail generation with an automatic background migration for all 2,000+ existing images.

## User Review & Critical Decisions

> [!IMPORTANT]
> Confirmed configuration choices from our clarification step:

- **Confirmed Decision 1 (Thumbnail Dimensions & Location)**: All thumbnails will be resized to a maximum of **384px on the long side** (`width: 384, height: 384, fit: 'inside', withoutEnlargement: true`) in WebP format (`~18–24 KB` each) and stored in `data/thumbnails` inside the project root (`<project_root>/data/thumbnails/<content_hash>.webp`).
- **Confirmed Decision 2 (Dual On-Demand + Background Migration)**:
  1. **On-Demand Generation**: Whenever the browser requests `/api/images/:id/thumbnail` and a valid 384px WebP thumbnail does not yet exist in `data/thumbnails`, the server generates and persists it immediately before responding—never falling back to streaming a 5MB original PNG unless thumbnail encoding itself fails.
  2. **Background Startup Migration**: On server startup (and during incremental scans), a non-blocking background worker iterates through all indexed images, verifies each thumbnail exists in `data/thumbnails` at the new 384px specification, and generates any missing or outdated thumbnails while yielding to the event loop between files.

---

## 1. Overview & Core Concept

- **What It Does**: Replaces the legacy thumbnail path and fallback behavior with a dedicated project-root `data/thumbnails` cache, adds immutable HTTP caching (`Cache-Control: public, max-age=31536000, immutable`), and trims redundant inspector-only metadata from the bulk gallery list response.
- **Target Audience / Persona**: Power users managing 2,000+ high-resolution ComfyUI generations who need instant page transitions, fast initial load, and zero bandwidth spikes when browsing grids, character sheets, and `@character` mention previews.
- **Key Value**: Reduces per-page image transfer from **150–250 MB** (when falling back to 3MP PNGs) down to **~1 MB per 48-card page** on first view and **0 KB** on subsequent views via browser disk cache.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Instant Gallery Grid & Masonry Rendering**: Cards reserve their exact aspect ratio (`width` / `height`) upfront to prevent layout shift, while loading crisp 384px long-side WebP thumbnails with native `decoding="async"` and `loading="lazy"`.
  2. **Automatic Background Backfill**: Existing 2,000+ images are migrated into `data/thumbnails` in the background without blocking UI navigation or API requests, while whichever page the user is actively viewing is prioritized on-demand.
  3. **Full-Resolution Lightbox Preservation**: Clicking any card to open the Inspector Drawer or clicking Download continues to serve the unaltered original PNG/WebP from `/api/images/:id/file`.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Dark-first archival photography & AI studio workspace (`#09090B` canvas, `#18181B` structural cards, `#27272A` hairlines, `#6366F1` indigo interactive accents).
  - *Component Styling & Layout*: Media-first masonry and uniform grid cards with clean unboxed metadata (`·` separators) and aspect-ratio placeholders so cards never jump as thumbnails stream in.
- **Interactive Feedback & Motion**: Smooth opacity fade-in on thumbnail load and status feedback in the System & Backup view showing the resolved `data/thumbnails` path.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: 384px Long-Side `fit: 'inside'` WebP in Project-Root `data/thumbnails`**
  - *Chosen Approach*: Configure Sharp with `.resize({ width: 384, height: 384, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 })` stored in `<project_root>/data/thumbnails/<contentHash>.webp` (unless explicitly overridden via `THUMBNAIL_PATH` in `.env`).
  - *Why*: Previously, `.resize({ width: 520 })` let tall portrait images reach `520×780px`, and the default `/app/data/thumbnails` path pointed outside the project workspace. `384px` on the long side guarantees neither width nor height ever exceeds `384px`, keeping files around `~20 KB` while staying crisp on Retina grids.
- **Decision 2: Immutable Browser Caching & Content-Hash URLs**
  - *Chosen Approach*: Append `?h=<contentHash.slice(0, 10)>` to `thumbnailUrl` and return `Cache-Control: public, max-age=31536000, immutable` on `/api/images/:id/thumbnail`.
  - *Why*: Because thumbnails are keyed by SHA-256 content hash, a thumbnail for a given hash never changes. Immutable caching prevents the browser from making 48 conditional round-trip requests every time the user switches tabs or pages.
- **Decision 3: Self-Healing Incremental Scanner & On-Demand Fallback**
  - *Chosen Approach*: Even when an image's `mtime` and `file_size` match in SQLite, the scanner checks `fs.existsSync(expectedThumbPath)` and regenerates the thumbnail if missing. Simultaneously, `/api/images/:id/thumbnail` generates the WebP on the fly if requested before the background worker reaches it.
  - *Why*: Guarantees full 3MP PNGs are never accidentally served as grid thumbnails.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                       React Frontend (Browser)                           │
│                                                                          │
│  ┌─────────────────────────┐  ┌──────────────────────┐  ┌─────────────┐  │
│  │    GalleryGridView      │  │ CharacterExplorer /  │  │  Inspector  │  │
│  │  (48 cards/page, async  │  │ FloatingQuickGenBar  │  │   Drawer    │  │
│  │   decode, aspect box)   │  │   (@mention thumbs)  │  │ (Full File) │  │
│  └────────────┬────────────┘  └──────────┬───────────┘  └──────┬──────┘  │
└───────────────┼──────────────────────────┼─────────────────────┼─────────┘
                │                          │                     │
                ▼  GET /api/images/:id/thumbnail?h=<hash>        ▼  GET /api/images/:id/file
┌──────────────────────────────────────────────────────────────────────────┐
│                         Express Backend Server                           │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │                   Thumbnail Controller & Service                   │  │
│  │  1. Check <project_root>/data/thumbnails/<content_hash>.webp       │  │
│  │  2. Hit  ──► Serve WebP + Cache-Control: max-age=31536000,immutable│  │
│  │  3. Miss ──► Generate 384px long-side WebP via Sharp on-the-fly,   │  │
│  │              update DB thumbnail_path, and stream WebP             │  │
│  └───────────────────────────────┬────────────────────────────────────┘  │
│                                  │                                       │
│  ┌───────────────────────────────▼────────────────────────────────────┐  │
│  │         Background Thumbnail Migration & Incremental Scanner       │  │
│  │  • One-time v2 migration + continuous scan verification            │  │
│  │  • Resizes existing/missing thumbs to 384px long-side in           │  │
│  │    ./data/thumbnails while yielding to the Node.js event loop      │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

### Data Model & State
- **Project-Root Storage (`./data/thumbnails`)**: Default thumbnail directory resolves to `path.resolve(process.cwd(), 'data/thumbnails')` (configurable via `THUMBNAIL_PATH`), ensuring all generated WebP files live predictably inside `data/thumbnails` in the project root.
- **Thumbnail Versioning (`thumb_migration_384_v1`)**: Tracked in `app_settings` so any older 520px-width thumbnails or missing thumbnails are cleanly rebuilt at `384px` long-side inside `data/thumbnails`.
- **Cache-Keyed `thumbnailUrl`**: Hydrated `ImageRecord.thumbnailUrl` includes `/api/images/${id}/thumbnail?h=${contentHash.slice(0, 12)}` so the browser caches each thumbnail permanently by content hash.

### Interactive Component & State Mapping
- **Gallery Cards & Mention Previews**: Render with `decoding="async"` and `loading="lazy"`, backed by the immutable 384px WebP endpoint.
- **System & Backup View**: Displays the active `data/thumbnails` directory path and allows triggering a directory/thumbnail reconciliation scan at any time.
