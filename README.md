# Странники

**Всё дело в людях.**

A small postcard website for the World of Warcraft guild
**[Странники](https://worldofwarcraft.blizzard.com/ru-ru/worldsoul/eu/armory/guild/lich-king/странники)**:
[www.perfectguild.com](https://www.perfectguild.com/).

The project is about the people behind the nicknames: remembering shared times,
finding one another again, and perhaps playing together on WoW Forever.

## Current site

The published page displays the guild's nickname artwork and links to its
Discord invitation. It is a static website, not a forum, character database,
or live guild roster.

## Possible next steps

These are directions for later work, not implemented features or a settled design:

- Give the nicknames a subtle dynamic effect instead of relying on a static image.
- Link to verified character profiles, such as an appropriate WoW armory.
- Recover and curate old forum avatars, posts, screenshots, and community memes
  while preserving their historical context and sources.

The initial repository setup covers development tooling and project documentation
only. It does not redesign the page or publish the historical collection.

## Local development

Use Node.js **22.22.0 or newer in the 22.x line**, or **24.8.0 or newer**, and npm.
The browser does not need Node.js or any installed package.

```sh
npm ci --ignore-scripts
npm run dev
```

Open `http://127.0.0.1:4173/`. See [CONTRIBUTING](CONTRIBUTING.md) for checks and
the development workflow.

## Documentation

- [Development and verification](CONTRIBUTING.md)
- [Publication architecture and technical details](docs/deployment.md)
- [Change log](CHANGELOG.md)
- [Notices for adapted tooling](tools/THIRD-PARTY-NOTICES.md)

Public development works from this repository alone. Private working notes,
unprocessed historical material, and credentials are not public build or
verification dependencies.
