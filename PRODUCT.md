# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React 19, Vite 8, Tailwind CSS v4, React Router v7, Tauri v2 (Desktop wrapper), Firebase Firestore, IGDB API (via Twitch OAuth).

## Users

Video game collectors, curators, and gaming enthusiasts who maintain personal game libraries, track backlogs, explore game award ceremonies, follow industry events, and curate game collections.

## Product Purpose

Lorehaven acts as a curated digital museum and high-end editorial archive for video games. It allows enthusiasts to organize, rate, and discover video games, view comprehensive award histories, track release schedules, and manage custom collections in an immersive editorial layout.

## Positioning

Unlike traditional game backlog apps or social trackers that prioritize noisy community feeds and soft UI cards, Lorehaven treats video games as cultural artifacts. It presents game metadata using a stark editorial brutalist layout where pure cover art serves as the sole source of visual color against pitch-black negative space.

## Operating Context

- Desktop web browsers and native desktop environments (via Tauri v2 wrapper).
- High-density data browsing across large game catalogs, award categories, franchises, and event calendars.
- Synchronization of user backlog status, custom tags, priorities, and game feels with Firebase Firestore.

## Capabilities and Constraints

### Capabilities
- **Game Library & Backlog:** Status tracking (Backlog, Playing, Completed, Abandoned), Priority levels, and Feel stickers.
- **IGDB Integration:** Direct search, rich game metadata, cover art, release dates, platform availability, and developer/publisher details.
- **Curated Collections & Franchises:** Custom collections, game franchise indexing, category filtering, and wallpaper archives.
- **Events & Schedule:** Industry event calendars, award ceremonies indexing (e.g. Wikidata & IGDB awards), and upcoming game release schedules.
- **Data Import Wizard:** CSV / steam / raw data import flows for external library migration.

### Constraints
- **Design System:** Must adhere strictly to Stark Editorial Brutalism (`DESIGN.md`). Pitch black (`#000000`) background, stark white (`#FFFFFF`) typography, sharp rectangular edges only (`rounded-none`), no soft UI drop shadows, and no decorative UI colors (game art is the primary color source).
- **API Keys:** Requires IGDB Client ID and Client Secret stored in Firebase `config/igdb` or local browser storage.

## Brand Commitments

- **Name:** Lorehaven (formerly Moctale Games).
- **Voice:** Raw, understated, editorial, confident, minimalist, handcrafted.
- **Visual Identity:** Absolute monochrome palette (`bg-black`, `text-white`), typography as architecture (`font-black`, `tracking-tighter`, `uppercase`), vertical left-rail navigation (`<VerticalIndexNav>`).

## Evidence on Hand

- `DESIGN.md`: Established design rules for Stark Editorial Brutalism.
- `AGENTS.md`: Repository workflow, branching rules, and design constraints.
- `src/App.jsx`: Complete application routing and state initialization.
- `src/services/firebase.js`: Firebase configuration and Firestore data service layer.

## Product Principles

1. **Art-First Focus:** Game cover posters and media art are the hero visuals; the UI frame recedes into stark monochrome negative space.
2. **Structural Clarity:** Rely on bold typography, strict grid structures, and sharp borders over decorative widgets or rounded cards.
3. **Curatorial Integrity:** Provide deep metadata exploration (franchises, awards, events, collections) designed for long-form reading and archiving.
4. **Native Fast Feel:** Desktop-class responsiveness and keyboard-friendly navigation across web and Tauri app containers.

## Accessibility & Inclusion

- Stark contrast ratio (pure black `#000000` against pure white `#FFFFFF`).
- Responsive layout supporting desktop left-rail navigation and mobile bottom tab/top bar navigation.
