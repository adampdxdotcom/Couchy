# Mobile UI Refinement & Gallery Search Optimization

Transform the mobile user experience across four core areas: docking the generation bar edge-to-edge with a minimize tab, locking the search bar to the top with an expandable filter accordion, eliminating viewport jumping when typing prompts on mobile, and moving full-screen image details to a non-overlapping single-line bottom footer.

## User Review & Critical Decisions

> [!IMPORTANT]
> Decisions confirmed via Phase 1 clarifying questions:
> - **Filter Sliding Window**: Expandable accordion panel directly below the sticky top search bar, collapsed by default with an active filter badge counter.
> - **Mobile Generation Bar**: Edge-to-edge full-width bottom dock (losing floating margins on mobile) with a minimize/expand toggle tab so users can reclaim gallery viewing space.
> - **Full-Screen Image Details**: Compact single-line footer bar pinned to the very bottom edge with zero image overlap, maximizing image visibility.
> - **Typing Stability**: Fixed bottom anchoring with isolated touch/scroll containment to prevent mobile keyboard viewport shifts and gallery jumping.

---

### 1. Overview & Core Concept

1. **Edge-to-Edge Mobile Generation Dock (`FloatingQuickGenBar.tsx`)**:
   - On screens `< 768px` (mobile), the bar transforms from a floating pill into a full-width docked bottom sheet with `bottom-0 left-0 right-0 rounded-t-2xl border-t border-zinc-800`.
   - Includes a top pull/toggle tab with chevron indicating collapsed vs. expanded states.
   - Re-architected flex layout prevents control truncation, ensuring the submission button (enter arrow) is always 100% visible and accessible.

2. **Sticky Top Search Bar & Hidden Filter Accordion (`GalleryFilterBar.tsx`)**:
   - The search bar becomes `sticky top-0 z-30` with backdrop blur, remaining pinned at the top as users scroll through hundreds of images.
   - All secondary controls (ratings, favorites, sort options, view layout, LoRA/character tags) are tucked into a smooth expandable accordion panel.
   - The filter trigger button displays an active filter count pill (e.g., `Filters (3)`) so users instantly know when filters are active.

3. **Mobile Keyboard Typing Stability**:
   - Prevent mobile browser viewport jumping when tapping into the prompt input by removing intrusive `scrollIntoView` calls during typing.
   - Isolate input focus and ensure proper keyboard handling on mobile devices.

4. **Zero-Overlap Mobile Full-Screen Preview (`ImageInspectorDrawer.tsx`)**:
   - In full-screen mode, replace the floating card overlay that obscures lower image content with a compact single-line bar pinned to the screen bottom edge.
   - Ensure the image container reserves space so the entire image remains 100% unobstructed.

---

### 2. User Experience & Visual Design

#### A. Mobile Quick Generation Docked vs. Minimized States

```text
EXPANDED MOBILE DOCK:
┌─────────────────────────────────────────────────────────────┐
│                       [ ─ Quick Gen ─ ]                    │
├─────────────────────────────────────────────────────────────┤
│  [User Pill: Ana]                                           │
│  What do you want to create?                                │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  [+] [@Agent]              [Krea2 · 2:3 · x1]        [ → ]  │
└─────────────────────────────────────────────────────────────┘

MINIMIZED MOBILE DOCK:
┌─────────────────────────────────────────────────────────────┐
│             [ ▴ Quick Gen · Tap to expand ]                 │
└─────────────────────────────────────────────────────────────┘
```

- **Touch Target**: The minimize handle provides a $\ge 44\text{px}$ touch target with haptic-ready transition.
- **Responsive Controls**: The workflow name shrinks to fit small screens (down to 360px), guaranteeing the `[ → ]` submit button never gets pushed out of view.

#### B. Sticky Search & Filter Accordion

```text
PINNED TOP BAR (Default / Collapsed):
┌─────────────────────────────────────────────────────────────┐
│  🔍 Search prompts, tags, characters...   [ Filters (2) ▾ ] │
└─────────────────────────────────────────────────────────────┘

EXPANDED ACCORDION:
┌─────────────────────────────────────────────────────────────┐
│  🔍 Search prompts, tags, characters...   [ Filters (2) ▴ ] │
├─────────────────────────────────────────────────────────────┤
│  FAVORITES & RATINGS:                                       │
│  [♥ Favorites Only]   [★ 1] [★ 2] [★ 3] [★ 4] [★ 5]         │
│                                                             │
│  SORT & VIEW:                                               │
│  Sort: [Newest ▾]     Layout: [⊞ Grid]    Thumbs: [M]       │
│                                                             │
│  TAGS & CHARACTERS:                                         │
│  LoRAs: [All ▾]   Characters: [All ▾]   [Reset All Filters] │
└─────────────────────────────────────────────────────────────┘
```

#### C. Mobile Full-Screen Image Lightbox

```text
┌─────────────────────────────────────────────────────────────┐
│  [✕]                                                   [⤢]  │
│                                                             │
│                                                             │
│                     [ FULL IMAGE VIEW ]                     │
│               (Completely visible, no overlay)              │
│                                                             │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  Krea2_turbo_01793_.png · 1448×2176 · 3.2 MB        [ ⬇ ]  │
└─────────────────────────────────────────────────────────────┘
```

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Accordion Panel vs. Slide-over Drawer**
  - *Chosen Approach*: Expandable accordion panel directly under the sticky search header.
  - *Why*: User-confirmed choice. Keeps the search input context visible while toggling filters without obstructing the entire gallery screen with a modal curtain.
- **Decision 2: Mobile Bottom Dock with Minimize Tab**
  - *Chosen Approach*: Flush edge-to-edge dock on mobile (`< 768px`) with an interactive toggle tab, preserving the floating card aesthetic only on tablet/desktop (`md:`).
  - *Why*: Eliminates cramped margins on mobile, guarantees all interactive buttons are visible, and gives users full control to collapse the bar when browsing.
- **Decision 3: Sticky Top Header Positioning**
  - *Chosen Approach*: `sticky top-0 z-30` on `GalleryFilterBar`.
  - *Why*: Prevents users from having to scroll back to the very top of a massive gallery to perform a new search or tweak filters.

---

### 4. Technical Implementation Steps

1. **`src/components/FloatingQuickGenBar.tsx`**:
   - Add `isMinimized` state (with mobile auto-persist in session/local state if desired).
   - Update outer container:
     - Mobile: `fixed bottom-0 left-0 right-0 w-full z-40 rounded-t-2xl border-t border-zinc-800 bg-zinc-900/98 backdrop-blur-2xl`
     - Desktop (`md:`): `md:bottom-5 md:left-1/2 md:-translate-x-1/2 md:w-[94vw] md:max-w-2xl md:rounded-3xl md:border`
   - Add minimize toggle header bar with chevron icon (`ChevronDown` / `ChevronUp`).
   - Fix inner controls flexbox: make prompt textarea flexible, add `shrink-0` to the submit button (`[ → ]`) and wrap or truncate settings pill gracefully.
   - Remove intrusive `scrollIntoView` on keystrokes to stop mobile gallery jumping.

2. **`src/components/GalleryFilterBar.tsx`**:
   - Change container to `sticky top-0 z-30 bg-zinc-950/95 backdrop-blur-md border-b border-zinc-800`.
   - Move all secondary filter rows into a collapsible `<div className="...">` controlled by `showFilters` state (default: `false`).
   - Add clean `FilterToggle` button with badge count calculating active non-default filters (e.g. `favoritesOnly`, `minRating > 0`, `characterIds.length > 0`, etc.).

3. **`src/components/ImageInspectorDrawer.tsx`**:
   - In full-screen mode and mobile view, move the floating bottom metadata box (`absolute bottom-4 left-4 right-4`) to a compact single-line footer docked at the bottom (`fixed bottom-0 inset-x-0 h-11 bg-black/90 border-t border-zinc-800/80 px-4 flex items-center justify-between text-xs`).
   - Adjust image viewport padding (`pb-12` in mobile/full-screen) so the image never has text or download buttons rendered over it.

4. **Verification**:
   - Test mobile viewport widths (360px, 390px, 414px) and desktop layouts.
   - Co-execute `compile_applet` and `lint_applet` for clean zero-error compilation.
