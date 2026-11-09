# Странники

**Всё дело в людях.**

A visual guild chronicle («Летопись гильдии») for the World of Warcraft guild
**[Странники](https://worldofwarcraft.blizzard.com/ru-ru/worldsoul/eu/armory/guild/lich-king/странники)**:
[www.perfectguild.com](https://www.perfectguild.com/).

The project is about the people behind the nicknames: remembering shared times,
finding one another again, and perhaps playing together on WoW Forever.

## Current site

The static GitHub Pages site now animates the original nickname collage with
WebGL2 shaders and a WebAssembly motion engine. It includes:

- Pulsing nicknames, deliberate hover selection, and compact character cards
  connected to the selected lettering by an animated thread.
- Dated Armory details, guild ranks, verified alternate-character groups,
  and selected historical forum avatars with source links.
- An alphabetic catalogue of 67 entries, including historical profiles and
  applications without a readable place on the collage. Such cards open without
  a fabricated nickname highlight or connecting thread.
  Confirmed identities, historical declarations and candidate images remain distinct.
- Three character-card control layouts in settings: compact edge buttons,
  circular buttons (default), or bottom navigation, with full-size touch targets.
- Grayscale screenshot memories in the fog, a fullscreen carousel, and
  selectable image/color reveal effects.
- A movable, hideable settings panel, keyboard and touch controls,
  reduced-motion handling, and the original artwork as the fallback.

This is not a live roster or a restored forum. A matching nickname does not
prove that a current character belongs to the same historical person.
The guild link above also provides Blizzard's current full roster for future research.

## Local development

Use Node.js **22.22.0 or newer in the 22.x line**, or **24.8.0 or newer**, and npm.
The browser does not need Node.js or any installed package.

```sh
npm ci --ignore-scripts
npm run build
npm run dev
```

Open `http://127.0.0.1:4173/`. See [CONTRIBUTING](CONTRIBUTING.md) for checks and
the development workflow.

## Documentation

- [Development and verification](CONTRIBUTING.md)
- [Runtime architecture, data model, and effects](docs/architecture.md)
- [Publication architecture and technical details](docs/deployment.md)
- [Change log](CHANGELOG.md)
- [Third-party notices](tools/THIRD-PARTY-NOTICES.md)

Public development works from this repository alone. Private working notes,
unprocessed historical material, and credentials are not public build or
verification dependencies.
