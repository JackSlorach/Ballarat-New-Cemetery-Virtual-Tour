# Ballarat New Cemetery Virtual Tour (Marzipano-based)

A 360° virtual tour of the Ballarat New Cemetery that you can drop onto any static host. Copy the folder to a website root folder/(WWW) and it works.

---

## What it is (at a glance)

- **360° viewer** — Look around and jump between scenes.
- **Map with pins** — Click pins or a scene list to teleport.
- **Floating area label** — Shows the area you’re facing (with anti-flicker “hysteresis”).
- **Auto-tour** — Guided walkthrough with an optional time estimate and screen-reader “quiet mode”.
- **Editors (optional)** — Point-and-click tools to update pins, labels, and info popups. No coding.

---

## Quick start (non-tech friendly)

1. Put the whole folder on your web host ("WWW") Folder on (any hosting site: Netlify, GitHub Pages, S3, plain web server or local host NGINX).
2. Open the site URL — you should see the tour.
3. For quick testing on your computer:
   - Open a terminal in the folder and run: `python -m http.server 8080`
   - Visit: `http://localhost:8080`

> **Tip:** Use **HTTPS** (or `localhost`) if you want the built-in editors to save files directly.

---

## nginx setup 

Point nginx to the folder and cache static assets, while keeping JSON files easy to refresh:

```nginx
server {
  listen 80;
  server_name example.com;

  root /var/www/virtual-tour;
  index index.html;

  # Cache static assets
  location ~* \.(js|css|png|jpg|jpeg|gif|svg|webp|ttf|woff2?)$ {
    expires 30d;
    add_header Cache-Control "public, max-age=2592000, immutable";
    try_files $uri =404;
  }

  # Short cache for editable JSON (tours/labels/map)
  location ~* ^/(tour|labels|map)/.*\.json$ {
    expires 1m;
    add_header Cache-Control "no-cache";
    try_files $uri =404;
  }

  location / { try_files $uri $uri/ =404; }
}
```

---

## Using the tour

- **Click and Drag** to look around.
- **Click pins** or use the **menu** to switch scenes.
- **Start an auto-tour** from the tour drawer; it will also show an estimated time it takes to complete.
- The **label at the top** updates to the area you’re facing.

---

## Tech notes (for implementers)

- **Autorotate:** Off by default in `index.js`; only toggled via UI.
- **Scene switching:** Use `safeSwitchToScene(id)`; on success, close the menu and resync pins.
- **Pin overlay sync:** Map UI resyncs pins after layout/fullscreen changes and on camera moves.

---

## Troubleshooting

- **Pins don’t click** — Make sure the entire folder was uploaded (especially `map/` and `assets/`), then refresh.
- **Tour won’t start** — Check that the tour JSON is inside `tour/tours/` and referenced correctly.
