# Changelog

## 1.0.1 — 2026-11-07

- Opening or docking the settings panel no longer shifts or shrinks the postcard.
  Docked and floating settings both overlay the composition without reserving
  sidebar space; hiding, dragging and keyboard movement preserve its geometry.

## 1.0.0 — 2026-11-06

### Added

- Interactive nickname collage with WebAssembly timing, WebGL2 materials,
  configurable simultaneous pulses, and pointer-contact threads to character cards.
- Compact dated Armory details, guild ranks, historical forum media, source links,
  and owner-confirmed main/alt navigation for Эрсул, Квилл, and Дийкстра.
- A 51-image memory collection, three configurable fog previews, fullscreen
  keyboard/touch carousel, four preview treatments, and five opening effects.
- Separate fullscreen effect targets: color only, immediately colored image
  reveal, or grayscale image reveal followed by color.
- Movable left-side settings, icon controls, keyboard focus handling,
  reduced-motion support, and original-artwork fallback.
- Reproducible public HTML/WASM build, integrity hashes, runtime/data validation,
  native motion regressions, and publication/privacy boundary checks.

### Changed

- The accepted private prototype is now a self-contained public application;
  raw material and historical experiment copies remain outside public Git history.
- Defaults use left-to-right background flow, silver relief, running glint,
  three memories, and fog opening applied to both image and color.
- The opaque background texture uses pixel-verified lossless WebP, saving
  502,040 bytes without changing decoded browser pixels. The alpha foreground
  remains PNG because an otherwise lossless WebP decoded differently in Chromium.
- Corrected Э in Шэф with local JPEG-coefficient edits, preserving the remaining
  artwork without lossy recompression. Retained selected nickname mask repairs
  and per-occurrence enlargement adjustments.

### Fixed

- Back/forward-cache resource retention, visibility handling after WebGL loss,
  animated-avatar reduced-motion behavior, and manual thread-contact retention
  during fullscreen viewing.
- Removed duplicate gallery images for Квилл and Храндор; added Риннка's original
  animated avatar with a static reduced-motion counterpart.
- Restored focus after fullscreen viewing without a lingering thumbnail frame.
- Updated the animation-disabled message and collage/source terminology.

GitHub Pages still publishes `main` at the repository root behind Cloudflare.
DNS, TLS, the custom domain, and branch-based deployment are unchanged.
A changelog entry is not evidence of successful deployment; verify the release
commit, hosted workflows, and live site separately.
