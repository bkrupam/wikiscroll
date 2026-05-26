<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Design System — MANDATORY

Before touching any UI (components, styles, layouts), read `/Users/apple/Downloads/Wikiscroll/DESIGN (1).md`.

Key rules extracted from that file — never violate these:
- **Ghost button** (secondary / inactive): transparent background, `1px solid #cfcfcf` border, `#000000` text, `999px` border-radius
- **Primary action button** (active / CTA): `#ebffb1` background, `1px solid #ade900` border, `#000000` text, `999px` border-radius
- **Never** use a black/dark button that transforms into a light button on activation — that is not in this design language
- **Accent colors**: only `#ade900` (Lime Spritz) and `#d8723c` (Sunset Orange) — no other vivid colors
- **Surfaces**: `#faf9f7` (canvas) and `#ffffff` (cards/inputs) — never dark backgrounds on interactive elements
- **Shadow**: `rgba(34, 40, 42, 0.04) 0px 3px 10px 0px` for modals/overlays — nothing heavier except toasts
- **Border radius**: `999px` for all buttons and pills, `9.89577px` default, `13.8541px` prominent elements
- **Text**: `#000000` primary, `#232529` secondary, `#696f7b` muted/captions
