# Keel deck

The presentation for the jury, animated with anime.js v4. It runs offline: open the file in Chrome.

* `keel-deck-en.html`: English, for the jury.
* `keel-deck-es.html`: Spanish, for rehearsal.

| Key | Action |
| --- | --- |
| → / Space / click | Next slide |
| ← | Previous slide |
| N | Speaker notes (the script of each slide) |
| T | Rehearsal timer, red after 8 minutes |
| R | Replay the slide animation |
| F | Full screen |

Text and script live in `assets/content-en.js` and `assets/content-es.js`; layout and animations in `assets/deck.js`; colors and fonts follow `app/src/ui/theme.ts`. Text in yellow with a dashed underline is a placeholder to replace with real numbers and hashes.

Phone screens in `assets/screens/` are captures of the app run with `EXPO_PUBLIC_DEMO_SEED=1`. Fonts: Figtree and IBM Plex Mono (SIL Open Font License, in `assets/fonts/`). anime.js: MIT (`assets/js/anime-LICENSE.md`).

The story, timing and what was checked are in [docs/entrega/esquema-del-deck.md](../docs/entrega/esquema-del-deck.md).
