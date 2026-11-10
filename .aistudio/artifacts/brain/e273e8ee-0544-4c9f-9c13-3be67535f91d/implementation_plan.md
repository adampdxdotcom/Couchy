# Gallery Search Scoping & Precision Matching

Deliver an accurate, intuitive search experience across 2,000+ local ComfyUI images by scoping default queries strictly to positive prompts, tags, LoRAs, characters, and visual keywords—while enforcing whole-word boundary matching on unquoted terms and exact substring matching on quoted terms.

## User Review & Critical Decisions

> [!IMPORTANT]
> The search engine currently returned nearly every image for general keywords like `blonde` because queries performed unconstrained substring scans across negative prompts, filenames, hashes, and raw notes. The requirements below incorporate your confirmed choices:

- **Target Fields**: Default unquoted search searches **positive prompts, user tags, LoRA names, character names, and AI visual tags**. It **excludes filenames**, negative prompts, content hashes, and technical notes by default.
- **Word Matching Behavior**:
  - **Unquoted terms** (e.g., `blonde`): Enforce whole-word boundary matching (`\bblonde\b`), allowing word-level matches on prompts and composite visual tags (e.g., `blonde_hair` matches `blonde`).
  - **Quoted terms** (e.g., `"blonde"` or `"blonde hair"`): Enforce exact substring matching.
- **Explicit Field Overrides**: Retain explicit key-value queries for users who intentionally want to search other attributes (e.g. `filename:ComfyUI_0001`, `neg:blurry`, `hash:...`).
- **AI-Generated Visual Tags**: Treated with equal weight alongside user tags and prompts, matching both standard tags and snake_cased tag tokens.

---

## 1. Overview & Core Concept

- **What It Does**: Upgrades the gallery search engine in `galleryQueryService.ts` and the UI in `GalleryFilterBar.tsx` so searching for visual attributes, concepts, characters, or LoRAs returns only relevant images.
- **Target Audience**: Photographers, concept artists, and AI creators organizing growing local galleries with thousands of generated images.
- **Key Value**: Eliminates false positives caused by boilerplate negative prompts and random filename strings, making keyword search instant and trustworthy.

---

## 2. User Experience & Visual Design

- **Search Input Guidance**:
  - Update search placeholder in `GalleryFilterBar`:
    `Search prompts, tags, characters, LoRAs (e.g. blonde, "exact phrase", rating >= 4)`
- **Search Feedback & Clear Affordance**:
  - Keep the compact, high-density toolbar design adhering to the SaaS design constitution (no loud badges or generic pill sandwiches).
  - When an active search query is present, display a quiet inline match indicator (e.g. `24 matches`) with a clean `X` button to immediately reset the query.
- **Boolean & Advanced Queries Preserved**:
  - Complex boolean logic (`AND`, `OR`, `NOT`, `character:"Elena"`, `rating >= 4`) continues to work without friction.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Whole-Word Regex vs Substring for Unquoted Queries**
  - *Chosen Approach*: Unquoted single-word and multi-word terms use word-boundary matching `\b<term>\b` (with underscore/hyphen awareness for tags like `blonde_hair`).
  - *Why*: Substring matching causes terms like `art` to match `part`, `start`, `smart`, `artwork`, etc. Whole-word matching delivers the search precision users expect.
  - *Alternatives Considered*: Fuzzy matching or stemming (introduces unpredictable false positives).
- **Decision 2: Exclusion of Filenames & Negative Prompts from Universal Search**
  - *Chosen Approach*: Universal unquoted search matches only content attributes (`positivePrompt`, `tags`, `loras`, `characters`, `visualTags`). Dedicated prefixes `file:` / `filename:` and `neg:` / `negative:` allow power users to search those fields when explicitly requested.
  - *Why*: ComfyUI filenames are auto-incrementing or hash-based, and negative prompts contain 20–50 generic negative terms (like `worst quality, normal quality, low quality`) present across 95% of images.
- **Decision 3: Server-Authoritative Matching in SQLite / Query Pipeline**
  - *Chosen Approach*: Implement regex token boundary matching in `evaluateSinglePredicate` inside `galleryQueryService.ts`.
  - *Why*: Ensures consistent results across both paginated/filtered queries, batch zip exports, and bulk tag operations.

---

## 4. Technical Architecture & Data Strategy

```
┌──────────────────────────────────────────────────────────────┐
│                    GalleryFilterBar (UI)                     │
│   Search Input: [ blonde ]  ──>  filters.query = "blonde"    │
└──────────────────────────────┬───────────────────────────────┘
                               │ POST /api/images/query
                               ▼
┌──────────────────────────────────────────────────────────────┐
│              galleryQueryService.ts (Backend)                │
│                                                              │
│  1. Parse Clauses (AND / OR / NOT / KV / Quoted / Words)     │
│  2. evaluateSinglePredicate(img, clause):                   │
│     ├─ If explicit prefix (char:, lora:, file:, neg:, etc.)  │
│     │    Target only specified field                         │
│     ├─ If quoted ("blonde"):                                 │
│     │    Exact substring search across allowed fields        │
│     └─ If unquoted (blonde):                                 │
│          Word-boundary regex: (?:\b|_)blonde(?:\b|_)         │
│          Scoped to:                                          │
│          • positivePrompt                                    │
│          • tags                                              │
│          • loras                                             │
│          • characters                                        │
│          • visualTags (WD14 tokens)                          │
│          [EXCLUDED: filename, negativePrompt, notes, hash]   │
└──────────────────────────────┬───────────────────────────────┘
                               │ Matched ImageRecord[]
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                    GalleryGridView (View)                    │
│   Renders only genuinely matching images (no false matches)  │
└──────────────────────────────────────────────────────────────┘
```

### Targeted Implementation Steps
1. **`src/server/services/galleryQueryService.ts`**:
   - Refactor `evaluateSinglePredicate` to distinguish quoted vs unquoted tokens.
   - For unquoted tokens: compile a boundary-aware RegExp `(?:\b|_)${escapeRegex(token)}(?:\b|_)` with `'i'` flag.
   - Restrict universal matching to `positivePrompt`, `characters`, `loras`, `tags`, and `visualTags`.
   - Add explicit field support for `file:` / `filename:` and `neg:` / `negativePrompt:` so users can still search them deliberately.
2. **`src/components/GalleryFilterBar.tsx`**:
   - Update search placeholder and accessibility labels.
   - Ensure clean query clear button and matching count display.
3. **Verification**:
   - Run compilation and TypeScript validation (`compile_applet` and `lint_applet`).
   - Validate queries with `blonde`, `"blonde"`, `character:Elena`, and multi-word terms.
