# SNAKE'D

A trick-taking card game with frogs, dragonflies and snakes. Predict how many tricks you'll win with the last card you hold face up, and use the snakes to steal the lead.

Play against computer players, or online with friends: one person creates a table and shares a 4-letter code, friends join from their own devices, and computer players fill any empty seats. The table sits on top of an Aztec step pyramid.

## Play it

Open `index.html` in a browser. There is nothing to install or build.

To host it, turn on **GitHub Pages** for this repository (Settings → Pages → deploy from the `main` branch, root folder). The game will be live at `https://natemiller39.github.io/Snake-D/`.

## Online play

The website talks to a small game server (`server/server.js`) that runs the game, keeps each player's hidden cards private, and fills empty or abandoned seats with computer players.

- Hosted on Render as a Node web service: build `npm install`, start `npm start`.
- The page connects to `wss://snaked-server.onrender.com` by default. For local testing run `npm install && npm start`, then open `index.html?server=ws://localhost:8787`.
- On Render's free plan the server sleeps when unused, so the first connection of the day can take up to a minute.

## Rules

See [docs/RULES.md](docs/RULES.md). The in-game **Rules** button has the same summary.

## What's in here

| Path | What it is |
|---|---|
| `index.html` | The game: table, animations, your hand, setup and score screens |
| `engine.js` | Rules engine and computer players (no browser code, runs in Node too) |
| `img/` | Card art: 55 cards (red volcano, blue lily pad, green jungle, pink hibiscus, black snakes) and the card back |
| `server/server.js` | Online game server: rooms, seats, reconnects, computer stand-ins |
| `tools/simulate.js` | Plays thousands of computer-only games and prints stats (`node tools/simulate.js`) |
| `docs/RULES.md` | The full rules |

## Notes

- Card art © the SNAKE'D designer. All rights reserved.
