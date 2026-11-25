# Characters & Generation Studio

## Characters, Portrait Framing & Assisted Identification

- **Roster, Civitai Opt-In & Merge**: Browse character cards with counts, linked LoRAs, aliases, and average ratings. Toggle **`Share on CivitAI: On/Off`** in any character's header (`Off` by default) to permit sharing images featuring that character as private Civitai drafts, **Create Character** profiles, or non-destructively **Merge Characters** (combining links, aliases, LoRAs, workflows, tags, collections, and optionally portrait/crop metadata).
- **Display-Only Portrait Framing**: Click the pencil icon on a profile portrait to adjust focal point (`0%–100%`) and zoom (`1.00×–3.00×`) with live `1:1 Profile`, `4:3 Card`, and `Badge` previews—saved purely as display metadata.
- **Adaptive Portrait Analysis (`Analyze Portrait`)**: Scans a character's portrait (via Vision LLM, or local visual tagging + Text LLM fallback) to draft a **Physical Description (Agent Reference Guide)** that informs the **Agent** without overriding requested outfits, hairstyles, or poses.
- **LoRAs, Spotlight & Favorite Addons**: Manage linked LoRAs and trigger words (with inline `+ Link` for new profiles). View **Highest-Rated Images** (`5★` or `4★+`) alongside **Favorite Addons** (**Base Models**, **Addon LoRAs**, and **Friends**, sorted by **Most Used** or **Top Rated**) and click **New Image** to launch the **Quick Gen Box** pre-loaded with up to 5 total LoRAs.
- **Assisted Identification (Metadata Matching) & First-Photo Portrait Lock**: Unlike **Face Scan** in the **Quick Gen Box**, **Assisted Identification** scans *metadata* on rendered gallery images (checking LoRAs, prompt names/aliases, and workflows) to queue **Pending Suggestions** for bulk **Confirm / Reject** review. The **first** confirmed non-reference photo saved under a character automatically locks in as its portrait until changed via **Set Portrait**.

## Generation Studio

- **Batch Workspace**: Pick a character (auto-loading LoRAs & triggers), stack additional LoRAs with custom strengths, override the Krea 2 **Base Model**, choose an aspect ratio, set target **Megapixels (`0.5–10.0 MP`; `> 3.0 MP` triggers `4x` ESRGAN upscaling)**, and configure batch count.
- **Single Prompt (Verbatim) vs. Photo Set Theme (Agent)**: Interpolate `{character}`, `{lora}`, and `{theme}` across unique seeds, or supply an optional **Visual Style Foundation** + **Photo Set Theme Description** for the **Agent** to expand into a **Multi-Shot Set**.
- **Templates & Queue Preview**: Save/load reusable **Prompt Templates**, hand-edit or reset slots in **Outgoing Prompt Queue Preview**, and monitor **Batch Queue History**.
