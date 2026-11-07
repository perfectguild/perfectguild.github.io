# Changelog

## 1.1.0 — 2026-11-07

- Incorporate separate evidence from ten owner-supplied in-game guild screenshots:
  corrected rank titles, achievement points where Armory values are absent,
  and twenty-nine initially screenshot-only character records, subsequently
  enriched from observed official roster/profile sources.
- Add nine roster-note character groups without inferring a main; preserve
  explicitly confirmed mains, extend Дийкстра's group, and record the owner's
  confirmation of Милагрос and Риогалл as mains.
- Apply owner-confirmed alias resolutions for Дий / Дийкстратор, Мила and Рио
  to link Консервочка, Йеннефер, Розмэри and Эллеона to their character groups.
- Distinguish screenshot evidence, unknown capture dates and Armory observations;
  keep ambiguous notes and contact information out of public identity mappings.
- Make Максиус, Йор, Пивли and Часотка interactive using source-traced masks,
  background repair and explicit in-game-note links. The collage now contains
  37 selectable names in 51 places; alias cards retain the original collage label.
- Correct screenshot transcriptions to Розмэри and Эллеона without adding
  compatibility aliases or changing their confirmed character groups.
- Add Джонрембо with the owner's confirmed `av-140.jpg`, preserving its bytes
  without assuming a forum ID or current Armory character.
- Complete retained forum-source coverage with historical Чорнобог and Эйнар
  cards, source links and only directly evidenced media. Forum-only cards do not
  display an unrelated Armory snapshot date or invented character details.
- Refresh the dated Armory projection for all 66 implemented characters,
  including 29 formerly screenshot-only alts, with actual roster links,
  localized race/class and levels. Preserve screenshot ranks and character groups.
- Apply seven available individual profiles over the guild cache, including
  Риннка's level 76 and Максис's specialization/equipment. Do not fabricate
  unavailable details from 59 HTTP 500 responses or bind historical forum names
  absent from the current roster.

## 1.0.1 — 2026-11-07

- Opening or docking the settings panel no longer shifts or shrinks the postcard.
  Docked and floating settings both overlay the composition without reserving
  sidebar space; hiding, dragging and keyboard movement preserve its geometry.
- Integrity-checked stylesheets and the entry module now use content-versioned
  URLs, giving updated files fresh browser/CDN cache keys without weakening
  integrity validation.
- Character-card close buttons stay at the outer top-right corner, including
  cards with main/alt navigation. The nickname picker uses locale-aware
  alphabetical order without changing the automatic presentation queue.

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
