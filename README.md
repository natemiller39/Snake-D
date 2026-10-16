# SNAKE'D

A trick-taking card game with frogs, dragonflies and snakes. Predict how many tricks you'll win with the last card you hold face up, and use the snakes to steal the lead.

This repository holds the digital playtest version: you against 1–5 computer players, played on a table on top of an Aztec step pyramid.

## Play it

Open `index.html` in a browser. There is nothing to install or build.

To host it, turn on **GitHub Pages** for this repository (Settings → Pages → deploy from the `main` branch, root folder). The game will be live at `https://natemiller39.github.io/Snake-D/`.

## Rules

See [docs/RULES.md](docs/RULES.md). The in-game **Rules** button has the same summary.

## What's in here

| Path | What it is |
|---|---|
| `index.html` | The game: table, animations, your hand, setup and score screens |
| `engine.js` | Rules engine and computer players (no browser code, runs in Node too) |
| `img/` | Card art: 55 cards (red volcano, blue lily pad, green jungle, pink hibiscus, black snakes) and the card back |
| `tools/simulate.js` | Plays thousands of computer-only games and prints stats (`node tools/simulate.js`) |
| `docs/RULES.md` | The full rules |

## Notes

- Card art © the SNAKE'D designer. All rights reserved.
