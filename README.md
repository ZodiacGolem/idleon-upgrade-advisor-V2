# IdleOn Upgrade Advisor

A static GitHub Pages app that analyzes a public IdleOn profile and recommends the best next upgrades.

## How it works

- The frontend runs on GitHub Pages
- The frontend sends the profile slug to a Cloudflare Worker
- The Worker fetches the public IdleOn profile JSON
- The app scores upgrades and renders a dashboard

## Files

- `index.html` - main page
- `styles.css` - UI styling
- `app.js` - app logic
- `.nojekyll` - disables Jekyll processing on GitHub Pages

## Required Worker

This app expects a Cloudflare Worker at:

```txt
https://idleon-upgrade-advisor.zodiacgolem.workers.dev
