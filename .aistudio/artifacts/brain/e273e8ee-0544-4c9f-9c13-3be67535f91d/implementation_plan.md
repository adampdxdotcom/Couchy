# Couchy — Bulk Selection for Suggested Character Matches

This update adds multi-select, **Select All**, and one-click batch confirmation/rejection controls to the **Suggested Character Matches** view on the Character Profile page so users can add multiple or all LoRA-matched photos to a character at once instead of confirming them one at a time.

## User Review & Critical Decisions

> [!IMPORTANT]
> Confirmed scope based on your clarification:

- **Keep Existing LoRA Selection Flow**: Uses the existing Character LoRA linking mechanism on the Character Profile page without adding redundant creation dialogs.
- **Multi-Select & Select All on Suggested Photos**: When the system scans image metadata for a linked LoRA (or alias/workflow) and displays the matching photos in **Suggested Character Matches**, each photo card includes a selection checkbox alongside a top toolbar with **Select All / Deselect All**, **Confirm Selected (`N`)**, **Confirm All (`Total`)**, and **Reject Selected (`N`)**.

---

## 1. Overview & Core Concept

- **What It Does**: Enhances the **Suggested Character Matches** queue on the Character Profile page with interactive multi-selection and batch actions backed by a single transactional SQLite update endpoint.
- **Target Audience / Persona**: Users linking a LoRA to a character profile who have dozens or hundreds of matching historical generations and want to confirm all or a subset of those photos in seconds.
- **Key Value**: Eliminates tedious one-by-one clicking when reviewing images discovered by the character LoRA metadata scan.

---

## 2. User Experience & Visual Design

### Key User Flow

1. **Link LoRA & Scan**: The user selects a LoRA for a character on the Character Profile page, and the system scans indexed image metadata for matching generations, populating the **Suggested Character Matches** grid.
2. **Multi-Select or Select All**:
   - Users can click the checkbox overlay on individual suggested photo cards to toggle selection.
   - Clicking **Select All (`N`)** in the Suggested Matches header bar selects every suggested photo (or **Deselect All** if all are currently selected).
3. **One-Click Batch Confirmation or Rejection**:
   - Clicking **Confirm Selected (`N`)** (or **Confirm All** when nothing is individually subsetted) promotes all target images to `confirmed` for that character in a single transaction and moves them immediately into the character's **All Confirmed Images** gallery.
   - Clicking **Reject Selected (`N`)** marks the selected suggestions as `rejected` so they are dismissed and never re-suggested on future scans.

### Visual Identity & Controls

- **Selection Affordance**: Each suggested photo card displays a crisp top-left checkbox button (`CheckSquare` / `Square`) with an `indigo-500` border highlight when selected, matching the main gallery's multi-select visual language.
- **Suggested Queue Action Bar**: A clean, single-row toolbar in the **Suggested Character Matches** header containing:
  - `Select All` / `Deselect All` toggle button
  - `Confirm Selected (N)` primary emerald button (and `Confirm All` quick action)
  - `Reject Selected (N)` secondary rose button

---

## 3. Technical Architecture & Data Strategy *(Technical Reference)*

### Component & Endpoint Flow

```
┌────────────────────────────────────────────────────────────────────────────┐
│                Character Profile — Suggested Character Matches             │
│  ┌────────────────────┐  ┌───────────────────────┐  ┌───────────────────┐  │
│  │ Card Checkboxes +  │─▶│ Select All / Deselect │─▶│ Confirm Selected  │  │
│  │ Selected IDs State │  │ All Header Control    │  │ / Reject Selected │  │
│  └────────────────────┘  └───────────────────────┘  └─────────┬─────────┘  │
└───────────────────────────────────────────────────────────────┼────────────┘
                                                                │
                                 POST /api/characters/associations/bulk-status
                                 { imageIds, characterId, status }
                                                                │
┌───────────────────────────────────────────────────────────────▼────────────┐
│                     SQLite Transactional Batch Update                      │
│  Upserts image_characters rows for all imageIds in a single transaction    │
└────────────────────────────────────────────────────────────────────────────┘
```

### Interactive State & Backend Handling

- **Backend Batch Endpoint (`POST /api/characters/associations/bulk-status`)**:
  - Accepts `{ imageIds: number[], characterId: number, status: 'confirmed' | 'rejected' | 'remove', appearanceLabel?: string }`.
  - Executes inside a single `db.transaction(...)` over `imageIds`, updating `image_characters` keyed by `(image_content_hash, character_id)` so confirming or rejecting 100+ LoRA-matched images completes in a single round-trip.
- **Frontend State (`selectedSuggestedIds: Set<number>`)**:
  - Scoped to the active Character Profile's suggested images list; automatically clears or prunes IDs after batch confirmation/rejection or when switching character profiles.
  - Preserves individual card `Confirm` and `Reject` buttons for single-item convenience alongside the new multi-select toolbar.
