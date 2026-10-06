# Verdant Skyline

A hand-inked garden city drawn live on canvas: a one-point-perspective city of crosshatched buildings, hanging and rooftop gardens, street trees and parks, seen from a garden terrace with a fountain, hedges, lamps, walkers and two trees grown leaf by leaf. Everything is drawn as pen strokes in blue ink on cream paper.

## Play

- **Load / Redraw sketch**: the drawing lands like splashes of paint and settles, roughly back to front.
- **Move the cursor**: the ink scatters away from it and springs back; the field swells with speed and pulses when you rest.
- **Click**: lobs a ball from the bottom of the view that arcs into the scene and smashes whatever it hits:
  - a building gets a hole blasted in its wall, with flying debris and a wrecked interior;
  - a tree branch snaps, hangs on its torn fibres, then falls and bounces to rest, shedding leaves; hit the trunk to fell the whole tree;
  - a walker is bowled over, lies there a moment, then gets up and hurries off.

## Run

No build step. Serve the folder and open `index.html`:

```sh
python3 -m http.server 8000
# then open http://localhost:8000/
```

## How it works

Everything is built once as 2D ink: each 3D point is projected with one-point perspective (`proj`), and strokes are grouped into depth-ordered layers. Each layer erases what is behind it with its masks, then draws its strokes (the painter's algorithm). The static scene is baked into a cache canvas; each frame redraws only the regions where ink moved, plus the swaying trees. Motion is per-point offsets on top of the rest positions: the cursor field, sway, and the transforms of falling pieces.

| File | Role |
| --- | --- |
| `core.js` | constants, palette, stroke primitives, hatching, cursor-field maths |
| `proj.js` | cameras and perspective, the layered `Scene`, buildings and park trees |
| `tree.js` | grown trees: space colonisation, pipe-model limbs, scalloped leaf clumps |
| `city.js`, `garden.js` | the city and the foreground terrace |
| `engine.js` | drawing, cursor field, sway, walkers, birds |
| `reveal.js` | the splash reveal |
| `blast.js` | hit testing, building blasts, particles |
| `fell.js` | cutting trees and the rigid-body physics of falling pieces |
| `ball.js` | the thrown ball: aiming, ballistic flight, impacts |
| `main.js` | scene assembly, the frame loop, input |
