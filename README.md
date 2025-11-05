# Decision Simulator

<p align="center"><img src="https://i.imgur.com/QUnDTAv.png" alt="Decision Simulator screenshot" width="720"/></p>

A small React + Bootstrap app that helps you decide what to do by cycling through a list of user-provided options (like a slot-machine / gacha). Instead of a fixed spin time, the app rolls a dice (1–6) which maps to a pre-defined duration (3s, 5s, 7s, 8s, 9s, 10s) and shows a Bootstrap progress bar while it cycles. Save and reuse sets of decisions as **presets** stored in `localStorage`.

---

## Features

- Add / remove decisions in a simple form
- Start a decision "spin" that cycles through the list and picks a result
- Dice-driven durations: roll 1..6 → durations: 3, 5, 7, 8, 9, 10 seconds
- Progress bar showing spin progress
- Stop button to cancel the spin early (preserves selected index)
- Save named presets (stored in browser `localStorage`), apply/edit/delete
- Export / Import presets JSON (manual backup)
- Responsive layout using React Bootstrap (keeps the same layout you requested)

## Tech stack

- React (Vite recommended)
- React Bootstrap (v5)
- bootstrap-icons
- Local `localStorage` for presets

---

## Installation

Make sure you have Node.js (14+) and npm installed.

```bash
# clone the repo
git clone <your-repo-url>
cd <your-repo-folder>

# install
npm install

# run dev server (Vite)
npm run dev
```

Open `http://localhost:5173` (or whatever Vite prints) and try the app.

### Optional (icons)

Install bootstrap-icons so the GitHub icon shows:

```bash
npm install bootstrap-icons
```

Or include the CDN link in `index.html`:

```html
<link
  rel="stylesheet"
  href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css"
/>
```
## Usage

1. Type a decision into the input and click **Add Decision**.
2. Add as many decisions as you want (they appear in a stacked list).
3. Click **Start Decision** — the app will roll a dice and use the mapped duration. Watch the progress bar while it cycles.
4. When the spin ends the app chooses a final result. You can also press **Stop** to cancel early (the currently selected choice will remain highlighted).
5. Save current set as a preset using **Save Preset** — give it a name. Presets persist across reloads.
6. Use the **Presets** modal to apply, edit, delete, export or import presets.

---

## Configuration / Code pointers

- The dice → duration mapping is in the code as:

```js
const DICE_DURATIONS = { 1: 3, 2: 5, 3: 7, 4: 8, 5: 9, 6: 10 };
```

- The `localStorage` keys used:

  - `decisions_v1` — array of current decisions
  - `presets_v1` — array of saved presets (`{id,name,decisions}`)

- Author info / GitHub link are constants at the top of the component — change them as desired.

---

## Troubleshooting

### Presets disappear on reload (dev only)

If you see that presets disappear in **local development** (Vite `localhost`), this is usually due to React Dev Mode (StrictMode / HMR) causing multiple mounts and a race where an initial empty state is written back to `localStorage` before the loader runs.

**Fixes / checks:**

- Use the **lazy state initializer** pattern when reading `localStorage` so initial `useState` is created from storage synchronously. Example:

```js
const [presets, setPresets] = useState(() => {
  try {
    const p = localStorage.getItem("presets_v1");
    return p ? JSON.parse(p) : [];
  } catch (e) {
    return [];
  }
});
```

- Ensure you open the same origin/port (e.g. `http://localhost:5173`) — `localStorage` is origin-specific.
- Disable any browser extensions or cleaners that clear site storage.
- The production build (Vercel) does not use React dev StrictMode in the same way so this issue often doesn't appear there.

### Presets still not saved

- Check DevTools → Application → Local Storage to inspect `presets_v1` value.
- Make sure there’s no other script overwriting that key.

---

## Possible future improvements

- Make final selection be the currently highlighted item when time runs out (instead of choosing a random final index).
- Show a die animation or sound when rolling.
- Add user accounts and a server-side database to persist presets across devices.

---

## License & credits

This project is free to use and modify. Credit: built by Andy.

---
