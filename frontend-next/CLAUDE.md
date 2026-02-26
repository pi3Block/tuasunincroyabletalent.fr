# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Kiaraoke** (kiaraoke.fr) — Next.js 15 frontend for an AI vocal jury app. Users search a song (Spotify), sing along with karaoke lyrics over a YouTube reference, and receive scored feedback from 3 AI jury personas. This is the `frontend-next/` directory — the Next.js migration of the original Vite/React 18 frontend. The backend (FastAPI + Celery GPU worker) lives in a sibling directory.

**Language**: All UI text and most code comments are in French.

## Commands

```bash
# Dev server (Turbopack)
npm run dev

# Production build
npm run build

# Start production server
npm start

# Lint (ESLint with next/core-web-vitals + next/typescript)
npm run lint
```

No test framework is configured yet (no vitest/jest).

## Stack

- **Next.js 15.2** (App Router, `output: "standalone"` for containerized deployment)
- **React 19** + TypeScript 5.7 (strict mode)
- **Tailwind CSS v4** (via `@tailwindcss/postcss`, `@import "tailwindcss"` syntax) + **tw-animate-css** (Radix animations)
- **shadcn/ui** (style "new-york", `components.json` configured, `npx shadcn@latest add <component>`)
- **next-themes** (dark/light mode via `.dark` class, default dark, system detection)
- **sonner** (toast notifications, theme-aware via `<Toaster />` in root layout)
- **Zustand 5** (state management with granular selector hooks)
- **Framer Motion 12** (animations, landing page)
- **Radix UI** (shadcn primitives: Slider, ScrollArea, Slot, Progress)
- **lucide-react** (icons)
- **Web Audio API** (custom multi-track player, no external audio lib)

## Architecture

### Rendering Strategy

| Route | Rendering | Purpose |
|-------|-----------|---------|
| `/` | SSG (Server Component) | Landing page, SEO, JSON-LD |
| `/app` | CSR (`"use client"`) | Main interactive app — full session state machine |
| `/results/[sessionId]` | SSR | Per-performance results with dynamic OG metadata |

### API Proxy

All `/api/*` requests are rewritten by Next.js to the backend (`NEXT_PUBLIC_API_URL`, default `https://api.kiaraoke.fr`). No CORS needed in the browser.

### Session State Machine (`/app` page)

```
idle → selecting → preparing → downloading → ready → recording → uploading → analyzing → results
                            ↘ needs_fallback ↗
```

Backend operations (session status, analysis progress, word timestamps) are polled via `setInterval` — no WebSockets.

### Key Directories

```
src/
├── app/                    # Next.js App Router (layouts, pages, globals.css)
├── api/client.ts           # Singleton ApiClient class (fetch-based, all backend endpoints)
├── stores/
│   ├── sessionStore.ts     # Session lifecycle, lyrics state, playback time, analysis results
│   └── audioStore.ts       # Multi-track audio player state (tracks, transport, volumes)
├── hooks/
│   ├── useAudioRecorder    # MediaRecorder with pause/resume, MIME fallback chain
│   ├── usePitchDetection   # Real-time autocorrelation pitch (browser-side, not CREPE)
│   ├── useYouTubePlayer    # YouTube IFrame API wrapper with 250ms time polling
│   ├── useLyricsSync       # Binary search line lookup, word hysteresis, EMA smoothing
│   ├── useLyricsScroll     # Auto-scroll with user-scroll detection, 3s re-enable
│   ├── useWordTimestamps   # Fetch/generate word timestamps lifecycle (Celery polling)
│   └── useOrientation      # Landscape mobile detection for split-view layout
├── audio/
│   ├── core/               # AudioContext singleton, TrackProcessor (gain→pan→analyser chain)
│   ├── hooks/useMultiTrack # Parallel track loading, rAF playback sync
│   └── components/         # StudioMode, TrackMixer, TransportBar, AudioTrack, VolumeSlider
├── components/
│   ├── sections/           # Landing page sections (hero, how-it-works, tech-stack, recent-performances)
│   ├── layout/footer.tsx   # Site footer
│   ├── theme-provider.tsx   # next-themes ThemeProvider wrapper ("use client")
│   ├── ui/                 # shadcn components (button, card, slider, progress, scroll-area, badge, sonner)
│   ├── app/                # Interactive: TrackSearch, YouTubePlayer, PitchIndicator, LandscapeRecordingLayout
│   └── lyrics/             # LyricsDisplayPro, LyricLine, KaraokeWord, LyricsControls, TimelineDebug
├── types/
│   ├── lyrics.ts           # All lyrics domain types + animation/performance config constants
│   └── youtube.d.ts        # YouTube IFrame API type declarations
└── lib/utils.ts            # cn() helper (clsx + tailwind-merge)
```

### Audio Signal Chain (per track)

```
HTMLAudioElement → MediaElementSource → GainNode → StereoPannerNode → AnalyserNode → MasterGain → destination
```

Track IDs follow `"source:type"` format (e.g., `"ref:vocals"`, `"user:instrumentals"`).

### Lyrics Display System

Three data quality tiers merged in `LyricsDisplayPro`:
1. **Best**: synced lines + word timestamps → proportional word-time assignment
2. **Good**: word timestamps only (Whisper segmentation)
3. **Fallback**: line-level synced lyrics only

Display modes: `line` (highlight active line), `word` (word-by-word), `karaoke` (progressive color fill).

Virtualization: only ±100 lines around the active line are fully rendered; distant lines are height placeholders.

## Code Conventions

- **`cn()` for classNames** — always use `cn()` from `@/lib/utils`, never string concatenation.
- **`memo()` on components** — all components are wrapped in `React.memo()`.
- **Granular Zustand selectors** — each store exports individual selector hooks (`usePlaybackTime()`, `useStatus()`, etc.) to minimize re-renders. Use `useShallow` for object selectors.
- **`useRef` for mutable state** — intervals, streams, previous values, audio elements stored in refs, not React state.
- **`"use client"` boundaries** — interactive components declare `"use client"`, server components are pure layout/metadata.
- **Path aliases** — `@/*` → `./src/*`, also `@components/*`, `@stores/*`, `@hooks/*`, `@api/*`.
- **Mobile-first** — `touch-manipulation` + `active:scale-95` on buttons; landscape detection triggers split-view overlay; `env(safe-area-inset-*)` for notches.
- **Dark/light theme** — oklch CSS variables in `:root` (light) and `.dark` (dark). Default is dark. Managed by `next-themes` (`ThemeProvider` in root layout). Use `useTheme()` hook to access/toggle.
- **Toasts** — use `import { toast } from "sonner"` then `toast.success()`, `toast.error()`, etc. The `<Toaster />` is mounted in root layout.

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_API_URL` | Backend API base URL (default: `https://api.kiaraoke.fr`) |

## Remote Image Domains

Only `i.scdn.co` (Spotify CDN) is allowed in `next/image`. Add new domains in `next.config.ts` → `images.remotePatterns`.
