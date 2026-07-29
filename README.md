# Paideia — Seeds of the Logos: study tracker

A single-page study tracker for the *Paideia — Seeds of the Logos* reading plan (v7.3).
Static site, no build step, no dependencies.

## Files

- `index.html` — page shell
- `app.js` — all logic (rendering, progress tracking, Gist sync)
- `app.css` — app layout + responsive rules
- `styles.css` — "Classical" design-system tokens
- `plan-data.json` — the plan content (canonical)
- `plan-data.js` — same data as a script global, used as a fallback when the page is opened directly from disk (`file://`), where `fetch` is blocked

If you ever edit `plan-data.json`, regenerate the fallback:

```sh
printf 'window.PLAN_DATA = ' > plan-data.js && cat plan-data.json >> plan-data.js && printf ';\n' >> plan-data.js
```

## Running

Open `index.html` directly, or serve the folder:

```sh
python -m http.server 8000
```

## Progress storage & sync

Progress (unit modes, checklists, memorization checkboxes, notes) is saved to
`localStorage` on every change. Optionally it syncs across machines through a
**secret GitHub Gist** — no backend, and only you can write to it:

1. Create a [classic personal access token with only the `gist` scope](https://github.com/settings/tokens/new?scopes=gist&description=Paideia+tracker).
   (Fine-grained tokens don't cover the Gist API yet — it must be a classic token.)
2. In the sidebar, click **Set up** under the sync status, paste the token, and
   leave the Gist ID blank — the app creates a secret gist and stores its ID.
3. On another device: same panel, same token, plus the Gist ID shown in the
   panel on the first device.

The token is kept only in each browser's `localStorage`. Sync is
last-write-wins by timestamp: on load the newer of local/remote wins; changes
are pushed ~1.5 s after you make them, and on tab close/hide. If you're
offline, everything keeps working locally and syncs next time a push succeeds.

Anyone who finds a hosted copy of the site can view the plan, but without the
token they cannot read or alter your progress.

## Hosting (GitHub Pages)

```sh
git init && git add -A && git commit -m "Paideia study tracker"
gh repo create paideia --private --source=. --push
gh api repos/{owner}/paideia/pages -X POST -f build_type=workflow # or enable Pages from branch in repo settings
```

Note: Pages sites are public even on private repos (the URL is just unlisted).
That's fine here — progress lives in the gist, not the site.

## License

[CC BY-SA 4.0](LICENSE) — share and adapt freely, with attribution, under the same terms.
