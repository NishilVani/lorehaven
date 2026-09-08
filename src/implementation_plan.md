# Plan: Library UI/UX Refine

Enhance Library Controls (Filter/Sort/Group) & Grouping UI. Aesthetic: Ethereal Cinematic / Premium Dark Glass.

---

## User Review

> [!IMPORTANT]
> Propose unified glassmorphic Control Panel in sidebar. Stack search/filter/sort vertical. Drop tiny icons. Full legible labels. Premium feel. Approve stack layout?

---

## Changes

### 1. Sidebar Control Panel

Replace icon row in `Sidebar.jsx` with vertical glass stack.

#### [MODIFY] [Sidebar.jsx](file:///e:/Moctale%20Games/moctale-games/src/common/Sidebar.jsx)

- **Container**: Sleek glassmorphic card. `bg-white/[0.02] border border-white/[0.05] backdrop-blur-md`.
- **Labels & Values**:
  - High-contrast micro-typography headers (`FILTER`, `SORT`).
  - Full-width interactive buttons.
  - Lead icon + active value (purple highlight).
  - Hover-responsive `expand_more` chevron.
- **Match Width**: Set `matchAnchorWidth={true}` on `DropdownMenu`. Menu perfectly aligns with trigger. Clean dashboard geometry.

---

### 2. Collapsible Color Groups

Update `Library.jsx`. Interactive accordion rows. Themed visual hierarchy.

#### [MODIFY] [Library.jsx](file:///e:/Moctale%20Games/moctale-games/src/pages/Library.jsx)

- **Collapse State**: Track collapsed groups by key (`groupBy:label`).
- **Aesthetic Theming**: Bold category styling. Avoid generic colors.
  - **Must Play / Perfection**: Deep crimson & amber glow. High contrast.
  - **High / Go for it**: Vibrant emerald & burnt orange.
  - **Give it a try / Timepass**: Ethereal indigo & teal.
  - **Whenever / Skip**: Muted slate & coral.
  - **Unrated**: Ghostly grey transparencies.
- **Accordion Header**:
  - Rotating chevron (`transition-transform duration-300`).
  - Wide-spaced uppercase typography.
  - Themed count badge right-aligned.
  - Interactive scale-down & glow on hover.
- **Motion**: Grid elements stagger fade-in on expand.

---

## Verify

### Manual Test
1. **Controls**:
   - Check sidebar glass panel.
   - Verify dropdown menus match trigger width.
2. **Groups**:
   - Group by Priority / Rating.
   - Check color theme accuracy.
   - Click headers. Verify collapse/expand + chevron rotation.
   - Switch tabs. Confirm collapse state persists.
