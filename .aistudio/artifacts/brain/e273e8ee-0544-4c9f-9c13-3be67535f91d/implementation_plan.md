# Interactive Workflow Editor, Model/LoRA Selectors & Default Workflow Management

Enable full interactive editing of saved and imported ComfyUI workflows directly in the Workflow Library right-hand panel, complete with structured node parameter controls, model/LoRA inventory dropdowns, multi-LoRA support for Power Lora Loader, default workflow selection across the app, and Save/Cancel/Export actions.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following decisions were confirmed during clarification:
> - **Editor Layout**: Structured editor exposing all editable node settings on the right-hand side, paired with a toggleable Raw JSON editor tab.
> - **Export Confirmation**: Clicking Export prompts the user to save first ("Yes / No") only when there are unsaved changes, then downloads the workflow JSON file.
> - **Default Workflow Scope**: Marking a workflow as "Default" sets it as the primary default workflow across both the Floating Quick Gen Bar and Generation Studio (whenever no character-specific workflow override is active).

- **Confirmed Decision 1**: Smart Node Input Detection automatically renders dropdowns populated from discovered checkpoints/diffusion models (`models/`), VAEs, CLIPs, and LoRAs (`loras/`) for model-related fields, aspect ratio presets for `ResolutionSelector`, and numeric/boolean/multiline inputs for all other node parameters.
- **Confirmed Decision 2**: `Power Lora Loader (rgthree)` nodes (such as Node #50 in the default workflow) render a dedicated multi-LoRA list editor where users can add multiple LoRAs from a dropdown of discovered LoRAs, toggle each on/off, adjust individual strengths, or remove entries.
- **Confirmed Decision 3**: Saving updates the workflow record and its JSON graph on the app server in SQLite, while Cancel cleanly reverts any unsaved edits back to the stored server state.

---

## 1. Overview & Core Concept

- **What It Does**: Replaces the static read-only JSON preview on the Workflows page with a full-featured Workflow Settings & Node Editor on the right-hand side. Users can edit the workflow's name, description, and every node's settings, select checkpoints/UNETs, VAEs, CLIPs, and multiple LoRAs from dropdowns of locally discovered models, mark any workflow as the app-wide Default, and Save, Cancel, or Export the workflow as a `.json` file.
- **Target Persona**: ComfyUI creators managing multiple generation pipelines who want to tweak workflow defaults, swap base models or multi-LoRA stacks, set their preferred default workflow, and export updated graphs without leaving the gallery app.
- **Key Value**: Eliminates manual JSON editing and external round-tripping by turning stored workflows into live, configurable templates backed by the app's discovered model and LoRA inventory.

---

## 2. User Experience & Visual Design

- **Workflow List & Default Badge (Left Column)**:
  - Each workflow card displays its name, node/image metadata, and a clear `Default` badge if it is currently the primary default workflow.
  - Clicking a workflow opens its editable settings in the right-hand inspector panel; a `Set as Default` button allows promoting any workflow with an API graph to be the new app-wide default.
- **Right-Hand Workflow Settings Editor**:
  - **Sticky Action Header**: Displays the workflow title, an unsaved-changes indicator when modified, a `Set as Default` toggle button, and the three primary action buttons: `Cancel`, `Save`, and `Export`.
  - **Structured Node Settings View (Default Tab)**:
    - **Workflow Metadata**: Editable inputs for Workflow Name and Description.
    - **Power Lora Loader Multi-LoRA Stack**: For workflows containing `Power Lora Loader (rgthree)` (e.g., Node #50), a dedicated multi-LoRA manager lets users pick LoRAs from the discovered `loras/` dropdown, add multiple `lora_1`, `lora_2`, ... slots, toggle each LoRA on/off, and fine-tune strength values.
    - **All Workflow Nodes**: Grouped by node ID, title, and class type. Inputs that reference models (`unet_name`, `ckpt_name`, `lora_name`, `vae_name`, `clip_name`) provide a dropdown of discovered inventory items from `models/` and `loras/` (with support for custom filenames). `ResolutionSelector` aspect ratio fields offer the 8 exact node ratio strings. Other scalar fields render clean textareas, number inputs, or boolean switches, while node-to-node links (`[nodeId, outputSlot]`) are clearly labeled as graph connections so users don't accidentally break wiring.
  - **Raw JSON View (Toggle Tab)**: Allows power users to inspect or directly edit the raw ComfyUI API/Visual JSON string with syntax validation.
- **Export Flow with Unsaved Changes Prompt**:
  - If the user clicks `Export` with no unsaved edits, the browser immediately downloads `<workflow-name>.json`.
  - If there are unsaved edits, a confirmation modal asks: *"You have unsaved changes. Save changes to the server before exporting?"* with `Yes, Save & Export`, `No, Export Without Saving`, and `Cancel` options.

---

## 3. Key Product Decisions & Trade-Offs

- **Single Primary Default Workflow in SQLite**:
  - *Chosen Approach*: Add an `is_default` column to the `workflows` table (defaulting to the seeded Krea2_turbo workflow) and a dedicated endpoint to mark a selected workflow as default (clearing `is_default` on all others in a single transaction).
  - *Why*: Ensures a single source of truth across reloads and devices so both the Floating Quick Gen Bar and Generation Studio automatically prioritize the user's chosen default workflow.
- **Inventory-Driven Dropdowns with Custom Fallback**:
  - *Chosen Approach*: Populate model/LoRA dropdowns using the app's discovered `models` and `loras` tables (checkpoints, diffusion/UNET models, VAEs, CLIPs, and LoRAs), while preserving any currently configured filename in the dropdown list even if it isn't currently installed on disk.
  - *Why*: Prevents accidental loss of model references when editing workflows imported from external machines while giving instant one-click selection of local models.

---

## 4. Technical Architecture & Data Strategy

```
┌──────────────────────────────────────────────────────────────────────┐
│                       Workflow Library View                          │
│  ┌─────────────────────────┐  ┌───────────────────────────────────┐  │
│  │   Stored Workflows List │  │   Right-Hand Workflow Editor      │  │
│  │  - Default Badge        │  │  - Header: Set Default | Cancel   │  │
│  │  - Set as Default Btn   │  │            | Save | Export        │  │
│  │  - Select Workflow ─────┼─►│  - Structured Node Settings Form  │  │
│  └─────────────────────────┘  │    • Model / UNET / VAE Dropdowns │  │
│                               │    • Power Lora Multi-Select      │  │
│                               │    • Prompt, Seed & Scalar Inputs │  │
│                               │  - Raw JSON Editor Toggle         │  │
│                               └─────────────────┬─────────────────┘  │
└─────────────────────────────────────────────────┼────────────────────┘
                                                  │
                    ┌─────────────────────────────┴────────────────────┐
                    ▼                                                  ▼
┌────────────────────────────────────────┐  ┌──────────────────────────────────────┐
│   POST /api/workflows (Save / Update)  │  │ POST /api/workflows/:id/set-default  │
│  - Updates name, desc, api/visual JSON │  │  - Clears previous default           │
│  - Recomputes hash & node mappings     │  │  - Marks workflow is_default = 1     │
└───────────────────┬────────────────────┘  └──────────────────┬───────────────────┘
                    │                                          │
                    ▼                                          ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                     Floating Quick Gen Bar & Generation Studio                   │
│             - Automatically selects workflow with isDefault === true             │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### Interactive Component & State Mapping

1. **Database & API Layer**:
   - Add `is_default INTEGER NOT NULL DEFAULT 0` migration to the `workflows` table and ensure at least one workflow is marked default.
   - Update `GET /api/workflows` and `GET /api/workflows/:id` to return `isDefault`.
   - Enhance `POST /api/workflows` so updating an existing workflow (`id` provided) persists updated `apiWorkflowJson`, `visualWorkflowJson`, `name`, `description`, and `isDefault` status on the server.
   - Add `POST /api/workflows/:id/set-default` to atomically switch the default workflow.
2. **Workflow Editor & Multi-LoRA Controls**:
   - Pass discovered `models` and `loras` into the Workflow Library view.
   - Parse the selected workflow's JSON graph into editable React state (`draftGraph`, `draftName`, `draftDescription`) and track `isDirty` by comparing against the server snapshot.
   - Render specialized field controls:
     - Model selector dropdowns for `unet_name`, `ckpt_name`, `vae_name`, `clip_name`, and standard `lora_name`.
     - Multi-LoRA list builder for `Power Lora Loader (rgthree)` nodes supporting adding multiple LoRAs (`lora_1`, `lora_2`, ...), toggling active state, changing LoRA files from `loras/`, adjusting strength, and deleting rows.
     - ResolutionSelector aspect ratio dropdown with the 8 exact node ratio strings.
   - Wire `Cancel` (resets draft state to server state), `Save` (persists to server and refreshes workflows), and `Export` (checks `isDirty`, prompts to save first if dirty, and triggers browser `.json` file download).
3. **Default Workflow Resolution**:
   - Update `GenerationStudioView` and `FloatingQuickGenBar` to prioritize `workflows.find((w) => w.isDefault && w.hasApiWorkflow)` as the primary default whenever no character-specific workflow is overriding it.
