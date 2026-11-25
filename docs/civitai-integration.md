# Civitai Integration

Couchy connects to both **`civitai.com`** and **`civitai.red`** using a hybrid of Civitai's public/authenticated REST APIs and **Civitai MCP** (`whoami`, `upload_image`, `create_post`, and `list_comments`). All API requests run server-side using your optional `CIVITAI_API_KEY` in `.env`—your key is never sent to the browser.

## The On / Off Switch (`Civitai Activity Notifications`)

You can toggle live Civitai engagement tracking globally at any time under **System &rarr; Civitai Activity Notifications** *(**On** by default)*:

- **When Turned On**:
  - Runs Couchy's **15-minute background sync** (plus on-demand refreshes when opening the Image Inspector or clicking **Refresh Stats** on a LoRA).
  - Shows the amber **Civitai Activity** indicator in the top Status Pill whenever shared posts receive new reactions or comments.
  - Displays the **Civitai Feedback** section inside the desktop Image Inspector (`Published` / `Draft` state, separated Heart vs. Emoji reactions, and collapsible image/post comments).
  - Displays creator attribution (`Uploaded by you` / `@creator`), download/Buzz stats, and collapsible model comments inside each Civitai-linked LoRA's **CivitAI Description** card.
- **When Turned Off**:
  - Pauses background model stats syncing and **hides all Civitai activity alerts, Inspector feedback breakdowns, LoRA engagement metrics, creator badges, and comment threads** across the UI.
  - Preserves your local library, static Civitai/Hugging Face descriptions, external Civitai page links, and manual linking tools without visual clutter.

## Metrics & Data Pulled from Civitai

| Surface | Sync Source | Metrics & Details Pulled |
|---|---|---|
| **Shared Posts & Images** *(Inspector & Gallery)* | Civitai REST (`/api/v1/images?postId=...`) & MCP `list_comments` (`image` / `post`) | - **Publish Status**: `Draft` vs. `Published` + direct image/post links<br>- **Reaction Breakdown**: **Heart** count shown separately from **Emoji** reactions (**Like**, **Laugh**, **Cry**)<br>- **Comments**: Comment count + plain-text comment threads (author `@username`, timestamp, pinned status, reaction/heart count, reply depth, and matched local stack image)<br>- **Unseen Delta**: Compares live totals against your last-seen counts to flag genuinely new activity |
| **LoRA Models & Creator Uploads** *(LoRA Detail Page)* | Civitai REST (`/api/v1/models`, `/api/v1/model-versions/...`) & MCP `whoami` + `list_comments` (`model`) | - **Creator Attribution**: Author `@username` and automatic **`Uploaded by you`** highlight when matching your Civitai account<br>- **Model Totals**: **Downloads**, **Thumbs Up**, **Thumbs Down** *(shown when > 0)*, **Comments**, and **Total Buzz Tipped**<br>- **Matched Version Stats**: Version name, version downloads, version thumbs up, and version index (`1 of N`)<br>- **Model Comments**: Collapsible plain-text comment thread with author, timestamp, pinned badge, and reaction counts |

## Draft Sharing from the Image Inspector

- Click the **Share to Civitai** button next to **Reject** in the Inspector top header bar to open the Draft Confirmation Modal (pre-filled with editable title, primary Civitai `modelVersionId` auto-picked from linked LoRAs/Base Model, target domain **`civitai.com`** vs **`civitai.red`**, tags, and prompt description, plus a preview of embedded resource filenames).
- **Draft-Only & Deterministic (`publish: false`)**: Requires `CIVITAI_API_KEY` in `.env` and posts deterministically from Couchy's backend to Civitai (`initialize` &rarr; `whoami` &rarr; `upload_image` &rarr; `create_post` with `publish: false`) with **zero Local LLM involvement**. Automatically routes mature/`.red`-linked drafts to **`civitai.red/posts/:id/edit`** (with an alternate-domain link) so you land straight in Civitai's draft editor to review mature ratings and publish manually.
- **Share Button State Colors**: Shifts automatically between **Neutral** (unshared), **Sky Blue** (`Draft`), **Emerald Green** (`Published`), and **Amber/Gold** (new unseen likes/reactions or comments), clearing the unseen highlight after you inspect the image.
- **Strict Eligibility Gates**: All linked characters (**both confirmed and suggested**, including multi-character images) must have **Share on CivitAI** turned **On** (`Off` by default); 0-character images require **Share 0-Character Images (Civitai)** enabled in **System** (`Off` by default); and the file on disk must natively contain generation metadata (inline Krea 2 + `4x` ESRGAN PNGs qualify, while standalone upscaled PNGs without generation nodes are blocked).
- **PNG-First with Multi-Resource Metadata & JPEG + EXIF Fallback**: On upload, Couchy keeps your file on disk untouched and injects an in-memory `parameters` block (`Civitai resources` + `Hashes` + `Lora hashes`) alongside original ComfyUI chunks so Civitai attaches **all** LoRAs (with weights) and the Base Model without appending model/sampler stats to your prompt text. If Civitai rejects PNG payload size (`HTTP 413`), the modal offers a one-click **Retry as High-Quality JPEG + EXIF Metadata** fallback with the same embedded parameters.

## Automatic Matching & Manual LoRA Linking

- **15-Minute Creator Auto-Match**: When `CIVITAI_API_KEY` is configured and **Civitai Activity Notifications** is **On**, Couchy resolves your Civitai handle via `whoami`, scans your published models, and matches unlinked local LoRAs by **SHA-256 / AutoV2** file hashes—automatically linking Civitai URLs, model/version IDs, descriptions, non-destructive trigger words, and connected **Character** profiles.
- **Manual Linking Fallback (`Link Civitai` / `Change Link`)**: If a local LoRA was re-saved or quantized and its file hash differs from Civitai, open the LoRA's **CivitAI Description** card and click **Link Civitai** to either:
  1. **Paste URL / Version ID**: Enter any `civitai.com` or `civitai.red` model URL, download link, or numeric Version ID.
  2. **My Civitai Uploads**: Browse your authenticated Civitai uploads list and bind the matching version in one click.

## Privacy & Read-Only Safety Guardrails

- **Draft-Only Posting**: **Share to Civitai** always creates private drafts (`publish: false`)—Couchy never publishes posts, replies to comments, or modifies remote Civitai models.
- **Strict Opt-In Sharing**: Per-character **`Share on CivitAI`** toggles and **Share 0-Character Images (Civitai)** in **System** default to **Off**.
- **Public vs. Keyed Features**: Public REST lookups (linking by public URL/Version ID and refreshing public model stats) work without an API key; private draft uploads, MCP comment threads, `whoami`, and **My Civitai Uploads** require `CIVITAI_API_KEY`.
