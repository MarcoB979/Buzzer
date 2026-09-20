# Sparkmote

The BLE web remote for the OSSM — by **Volt Labs**.

A static Progressive Web App (no build step) that controls your OSSM from any phone or tablet over Bluetooth.

## Modes

- **Standard** — stroke-engine control: speed, max/min depth, sensation, patterns.
- **Advanced Penetration** — the OSSM-Lite advanced-penetration controls (auto-hidden on standard OSSM / OSSM-RS firmware).
- **Funscript** — load a `.funscript` + video, with Chromecast casting and full timestamp sync.

## Use it

1. Open the site in Chrome/Edge (Android) over HTTPS.
2. Tap **Connect** and pair your OSSM via Web Bluetooth.
3. Add to home screen to install it as a PWA.

> The web remote requires a browser with Web Bluetooth (Chrome or Edge). iOS Safari does not support Web Bluetooth.

## Deploy

GitHub Actions deploys the `Sparkmote/` folder to GitHub Pages on every push to `main`.

## License

See [LICENSE](LICENSE).
