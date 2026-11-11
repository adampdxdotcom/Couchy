# Mobile Viewport Stability & Character Page Responsive Layout

Resolve the mobile viewport shrinking and horizontal overflow issues when navigating Character galleries and inspecting images, stack the Associated Workflows and LoRAs forms cleanly on mobile screens, and hide the Quick Gen dock when inside the Generation Studio tab.

## User Review & Critical Decisions

> [!IMPORTANT]
> Decisions confirmed via Phase 1 clarifying questions:
> - **Confirmed Decision 1 (Associated Workflows & LoRAs Layout)**: Stack form controls vertically and wrap elements cleanly on mobile viewports so neither box ever forces the page wider than the phone screen.
> - **Confirmed Decision 2 (Quick Gen Dock Visibility)**: Hide the bottom Quick Gen dock on the **Generation Studio** tab (which already provides dedicated generation controls) while keeping it active and properly constrained to the screen width on all other tabs.

---

### 1. Overview & Core Concept

- **What It Does**: Eliminates horizontal page overflow and viewport zoom-out ("shrinking") on mobile devices when viewing a character profile or returning from full-screen image inspection.
- **Root Cause Identified**:
  1. On the Character detail page, the **Associated Workflows** form row (`Select workflow` + `w-36 Role label` + `Link` button), the **Top Action Toolbar** (`Open in Main Gallery Filter` + `Download All Images` + `Delete Profile`), and unbroken long LoRA filenames in **Associated LoRAs** lacked flex wrapping and `min-w-0` truncation constraints, forcing an intrinsic width of ~490px on a 375px mobile screen.
  2. When opening and closing an image in the **Image Inspector**, mobile browsers recalculated the layout viewport to accommodate those 490px-wide overflowing containers, zooming out ("shrinking") the page while leaving `fixed` elements like the Quick Gen bar and overflowing boxes wider than the visible viewport.
- **Key Value**: Consistent 1:1 mobile viewport scaling across all tabs, touch-friendly stacked forms in Character profiles, and a clean separation between the Quick Gen dock and Generation Studio.

---

### 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Character Profile Browsing**: Users tap a character card to open their profile. Action buttons wrap cleanly into compact rows, long LoRA filenames truncate with ellipses, and the Associated LoRAs / Associated Workflows forms stack vertically on mobile (`< 640px`) and sit side-by-side on larger screens.
  2. **Image Inspection & Return**: Users tap any character image to open the full-screen Image Inspector and close it to return to the character gallery. The page maintains its exact 100% mobile viewport scale and scroll position with zero horizontal drift or shrinking.
  3. **Tab-Aware Quick Gen Dock**: The Quick Gen bar docks cleanly at the bottom of Gallery, Characters, LoRAs & Models, Workflows, and System & Backup, and automatically hides when switching to **Generation Studio**.

- **Visual Layout & Responsive Structure**:

```text
MOBILE CHARACTER PROFILE (375px - 430px Viewport)
┌──────────────────────────────────────────────────────────┐
│ ← Back to Character Explorer                             │
│ [Open in Gallery] [Download All (12)] [Delete Profile]   │
├──────────────────────────────────────────────────────────┤
│ ┌──────────────┐  Character Name                         │
│ │   Portrait   │  Aliases · Confirmed · Avg Rating       │
│ └──────────────┘                                         │
│ [ Character Description Textarea                       ] │
│ [ User Notes Textarea                                  ] │
│ [ Update Aliases Input                 ] [Save Aliases]  │
├──────────────────────────────────────────────────────────┤
│ Associated LoRAs & Outfits                               │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ char_lora_v2.safetensors (truncated)        [Unlink] │ │
│ │ Trigger Word: [ xmelx                              ] │ │
│ └──────────────────────────────────────────────────────┘ │
│ [ LoRA filename...                                     ] │
│ [ Trigger Word...                                      ] │
│ [ Appearance / Outfit label...                         ] │
│ [ Category Select                        ] [   Link   ]  │
├──────────────────────────────────────────────────────────┤
│ Associated Workflows                                     │
│ [ Select workflow to associate...                      ] │
│ [ Role label (e.g. Canonical Portrait)   ] [   Link   ]  │
└──────────────────────────────────────────────────────────┘
```

- **Component Styling & Viewport Math**:
  - **Strict Horizontal Containment**: Root application shell and page containers enforce `w-full max-w-full overflow-x-hidden` so no child node can ever widen the mobile layout viewport.
  - **Flex & Grid Minimum Width Discipline**: Every flex child and grid column containing dynamic text, filenames, or form inputs applies `min-w-0` and `max-w-full`.
  - **Touch Ergonomics**: Interactive buttons and form inputs maintain comfortable touch hitboxes ($\ge 40\text{px}$) and responsive horizontal padding (`px-3.5 sm:px-6`).

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Vertical Form Stacking on Mobile vs. Horizontal Scrolling**
  - *Chosen Approach*: Stack the workflow selector, role input, and LoRA inputs vertically (`flex-col sm:flex-row`) on mobile screens.
  - *Why*: Native `<select>` and `<input>` elements have browser-enforced intrinsic minimum widths that break horizontal flex rows on narrow viewports. Stacking makes every field legible and easy to tap with one thumb.
- **Decision 2: Hiding Quick Gen on Generation Studio**
  - *Chosen Approach*: Conditionally suppress the Quick Gen dock when `activeTab === 'generation'`.
  - *Why*: Generation Studio already provides full prompt, LoRA stack, resolution, and batch controls. Hiding the bottom dock reclaims vertical screen space on mobile and prevents duplicate prompt inputs.

---

### 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Viewport Containment Diagram**:

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Root Document & App Shell (w-full max-w-full overflow-x-hidden)     │
├─────────────────────────────────────────────────────────────────────┤
│ TopNavHeader (Sticky z-40, Mobile Hamburger Drawer)                 │
├─────────────────────────────────────────────────────────────────────┤
│ Main Workspace Container (min-w-0 max-w-full overflow-x-hidden)     │
│  ├─ CharacterExplorerView                                           │
│  │   ├─ Responsive Header Actions (flex-wrap gap-2)                 │
│  │   ├─ Profile Banner & Aliases Editor (min-w-0 stacked mobile)    │
│  │   ├─ Associated LoRAs Card (truncate filenames, stacked inputs)  │
│  │   ├─ Associated Workflows Card (flex-col sm:flex-row controls)   │
│  │   └─ Character Image Grids (2-col mobile -> 6-col desktop)       │
│  └─ ImageInspectorDrawer (Modal Lightbox)                           │
│      └─ Responsive Character Assignment & Workflow Save Rows        │
├─────────────────────────────────────────────────────────────────────┤
│ FloatingQuickGenBar (Visible when enabled && tab !== 'generation')  │
└─────────────────────────────────────────────────────────────────────┘
```

- **Interactive Component & State Mapping**:
  - **App Shell & Quick Gen Visibility**: Computes `showQuickGenBar = healthData?.config?.quickGenBoxEnabled !== false && activeTab !== 'generation'`, adjusting `<main>` bottom padding automatically so pages without the dock have no wasted blank space at the bottom.
  - **Character Profile Forms**:
    - Top action bar wraps cleanly on narrow screens (`flex-wrap`).
    - Associated LoRAs list items wrap long `.safetensors` filenames inside a `min-w-0 flex-1` container with `truncate` and `break-all` fallbacks.
    - Associated Workflows linking form stacks the `<select>` dropdown above a full-width row containing the flexible role `<input className="flex-1 min-w-0">` and `Link` button on mobile (`flex-col sm:flex-row`).
  - **Image Inspector Drawer**:
    - Applies `flex-wrap` and `min-w-0` to the Manual Character Assignment row (`Assign Character` select + `Outfit/Variant` input + `Add` button) and the `Save Workflow` input row so opening an image never introduces a hidden horizontal overflow while the drawer is mounted.
