# Mobile Navigation & Top Header Refinement

Add a mobile hamburger navigation menu next to the "Couchy" brand title in the top navigation header, standardizing the "Generation Studio" label and providing a clean slide-down navigation panel on mobile screens while preserving the existing desktop navigation bar.

## User Review & Critical Decisions

> [!IMPORTANT]
> Decisions confirmed via Phase 1 clarifying questions:
> - **Navigation Presentation**: Slide-down panel anchored immediately under the top header (`top-full left-0 right-0`), animated smoothly with subtle backdrop blur.
> - **Scope & Focus**: Paused the `README.md` updates per user request to focus entirely on the mobile navigation experience.
> - **Official Name**: Standardized **"Generation Studio"** as the official title for the generation area in the navigation menu and views.

---

### 1. Overview & Core Concept

- **The Problem**: On mobile screens, horizontal navigation links (`Gallery`, `Characters`, `Generation`, `LoRAs & Models`, `Workflows`, `System & Backup`) either wrap awkwardly or disappear off-screen due to limited viewport width and the live ComfyUI status pill.
- **The Solution**: 
  - On mobile (`< 768px`), hide the horizontal link strip and place a clean hamburger toggle button (`Menu` / `X` icon) directly to the left of the "Couchy" brand wordmark.
  - Tapping the hamburger button slides down an organized navigation panel containing each primary section with domain icons, active indicators, and full touch targets ($\ge 44\text{px}$).
  - Tapping any destination or clicking outside automatically selects the tab and closes the panel.
  - On desktop (`md:`), the horizontal navigation strip remains active and uncluttered.

---

### 2. User Experience & Visual Design

#### Header Layout on Mobile (`< 768px`)

```text
COLLAPSED MOBILE HEADER:
┌─────────────────────────────────────────────────────────────┐
│  [☰] Couchy                               [ ComfyUI Ready ▾]│
└─────────────────────────────────────────────────────────────┘

EXPANDED SLIDE-DOWN NAVIGATION PANEL:
┌─────────────────────────────────────────────────────────────┐
│  [✕] Couchy                               [ ComfyUI Ready ▾]│
├─────────────────────────────────────────────────────────────┤
│  [⊞]  Gallery                                            ●  │
│  [👤] Characters                                             │
│  [✨] Generation Studio                                      │
│  [⚙]  LoRAs & Models                                         │
│  [🔀] Workflows                                              │
│  [💾] System & Backup                                        │
└─────────────────────────────────────────────────────────────┘
```

#### Visual Styling Details:
- **Hamburger Button**: `p-1.5 -ml-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 rounded-lg transition-colors cursor-pointer`.
- **Slide-Down Menu**: `absolute top-full left-0 right-0 bg-zinc-950/98 backdrop-blur-2xl border-b border-zinc-800 shadow-2xl py-2 px-3 space-y-1 z-50 animate-in slide-in-from-top-2 duration-200`.
- **Nav Buttons**: Clean unboxed rounded items (`rounded-xl px-3.5 py-2.5`) with domain icons, high contrast text, and subtle indigo accent badge on active tab.
- **Status Pill Responsiveness**: Constrain status pill on mobile (`max-w-[170px] xs:max-w-[210px] sm:max-w-[340px]`) so it never crowds out the logo or hamburger toggle.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Slide-Down Anchored Panel vs Side Drawer**
  - *Chosen Approach*: Slide-down panel anchored flush beneath the top navigation bar.
  - *Why*: User-confirmed choice. Keeps the brand header visible, feels natural on modern mobile devices, and avoids heavy layout re-draws associated with full-page drawer overlays.
- **Decision 2: Name Standardization**
  - *Chosen Approach*: Update `'Generation'` to `'Generation Studio'` in navigation lists.
  - *Why*: Clarifies that this is the full generation workspace, distinct from the bottom Quick Gen dock.

---

### 4. Technical Implementation Steps

1. **`src/components/TopNavHeader.tsx`**:
   - Import `Menu, X, Images, Users, Sparkles, Layers, Network, Settings` from `lucide-react`.
   - Add `mobileMenuOpen` state (`useState(false)`).
   - Add outside click listener and Escape key handler for the mobile menu.
   - Restructure Zone 1 to include the hamburger button for mobile (`md:hidden`) beside `Couchy`.
   - Update `navItems` array:
     - Gallery (`Images`)
     - Characters (`Users`)
     - Generation Studio (`Sparkles`)
     - LoRAs & Models (`Layers`)
     - Workflows (`Network`)
     - System & Backup (`Settings`)
   - Keep desktop `<nav>` hidden on mobile: `className="hidden md:flex items-center gap-6 overflow-x-auto"`.
   - Render the slide-down menu container when `mobileMenuOpen` is true.
   - Adjust Zone 3 status button width so it scales down gracefully on narrow mobile displays.

2. **Verification**:
   - Test mobile viewport widths (360px, 390px, 414px) and desktop breakpoint (`md: 768px`).
   - Verify tab navigation and closing behavior.
   - Run `compile_applet` and `lint_applet` together to confirm zero errors.
