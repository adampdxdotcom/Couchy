# Implementation Plan: Power Lora Loader Multi-LoRA Enhancement

## Overview
Added direct, unclipped multi-LoRA controls for rgthree's Power Lora Loader in the Workflow Library editor. Users can now easily add and remove multiple LoRAs, adjust strengths with 0.05 precision, and persist the workflow in the exact ComfyUI JSON schema.

## Status: Completed

1. **Power Lora Loader Layout & Add LoRA Buttons**
   - Added a prominent `+ Add LoRA` button directly in the node card header.
   - Added an empty state with a clear `+ Add First LoRA` button so it can never be missed.
   - Added a dashed `+ Add Another LoRA Slot` button at the bottom of the slot list.
   - Fixed the flexbox clipping issue (`min-w-0` on container and child elements, `truncate` on `<select>`).

2. **Editable Slots with Trash Can Delete**
   - Each LoRA row displays:
     - Active checkbox (`on: true/false`)
     - Label badge (`lora_1`, `lora_2`, etc.)
     - LoRA selection dropdown populated from `loras/`
     - Compact strength numeric input (`step="0.05"`, `min="-4"`, `max="4"`)
     - Trash can icon button (`<Trash2 />`) to delete that specific slot.
   - Deleting a slot re-indexes remaining slots sequentially (`lora_1`, `lora_2`, ...).

3. **ComfyUI JSON Structure Preservation**
   - Maintained `"PowerLoraLoaderHeaderWidget": { "type": "PowerLoraLoaderHeaderWidget" }` at the top of node inputs.
   - Maintained sequential `lora_1`, `lora_2`, ... with `{ on, lora, strength }`.
   - Preserved `"➕ Add Lora": ""` widget placeholder.
   - Preserved all graph links (`model`, `clip`).
   - Synced immediately with the draft graph, JSON preview, and Save button.
