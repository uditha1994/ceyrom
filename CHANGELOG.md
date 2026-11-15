# Changelog

All notable changes to Ceyrom are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- **Smoother striker:** the striker, aim and power ease toward your input instead of jumping, including the opponent's aim when you play online. Dragging keeps your grab point, and the striker slides around coins on the baseline.
- **Better power control:** a cancel zone around the striker, pull distance that scales with the screen, steadier aiming near the striker, and a click and light buzz at every 10%. The power ring is clearer, with quarter ticks, colour zones and a percentage label.
- **Keyboard:** held keys glide with a speed ramp, and a tap still nudges by a fine step.

### Performance

- The board is drawn once on its own layer and rotated by the browser's compositor, instead of being redrawn every frame. HUD updates happen at most once per frame, and the canvas density is capped at 2×. In a throttled mid-range phone profile, median frame time dropped from about 50 ms to about 17 ms while dragging, and from about 33 ms to about 17 ms during a shot.

## [0.1.0] - 2026-11-04

First public release.

### Added

- **Physics:** a deterministic carrom engine on a 74 cm ICF board, with fixed 240 Hz steps, sub-stepped collision detection, friction, spin, cushions and pockets ([#1](https://github.com/uditha1994/ceyrom/pull/1)).
- **Rules:** queen and cover, striker fouls, dues, last-coin rules and board scoring, with Competitive, Casual, Gedara, Freestyle and custom presets ([#2](https://github.com/uditha1994/ceyrom/pull/2)).
- **AI:** an opponent with five levels, from Beginner to Expert ([#3](https://github.com/uditha1994/ceyrom/pull/3)).
- **Graphics and sound:** a wood-grain board drawn in code, four board themes and four striker skins, and sounds and music generated in the browser ([#4](https://github.com/uditha1994/ceyrom/pull/4)).
- **Languages:** English, Sinhala and Tamil throughout ([#5](https://github.com/uditha1994/ceyrom/pull/5)).
- **Online play:** the server decides every shot. Rooms, invite links, quick match (1v1 and 2v2), spectators, reconnection, Elo ratings and leaderboards ([#6](https://github.com/uditha1994/ceyrom/pull/6)).
- **Modes:** play the computer, pass-and-play for 2 or 4, practice drills with a coach, a tutorial and a daily challenge, plus XP, levels and achievements ([#7](https://github.com/uditha1994/ceyrom/pull/7), [#8](https://github.com/uditha1994/ceyrom/pull/8)).
- **Screens:** layouts for phone, tablet and desktop, light and dark themes, and keyboard, mouse and touch controls ([#8](https://github.com/uditha1994/ceyrom/pull/8)).
- **Project:** a CI workflow, PR and issue templates, the README and a contributing guide ([#9](https://github.com/uditha1994/ceyrom/pull/9), [#10](https://github.com/uditha1994/ceyrom/pull/10)).

### Known limitations

- The server stores data in a JSON file. Move to PostgreSQL before running more than one server instance.
- Players are guests with signed tokens. There is no OAuth login yet.
- The Sinhala and Tamil text needs a review by a native speaker.

[Unreleased]: https://github.com/uditha1994/ceyrom/compare/v0.1.0...develop
[0.1.0]: https://github.com/uditha1994/ceyrom/releases/tag/v0.1.0
