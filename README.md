# Buzzer

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

GitHub Actions deploys the `Buzzer/` folder to GitHub Pages on every push to `main`.

## Cast local videos

Chromecast fetches the video URL itself, so a file that only exists on your phone
cannot be cast with the default receiver. Buzzer solves this by streaming the
file **directly from your phone to the TV over WiFi** with a custom receiver —
free forever, no upload, no storage, no server.

### One-time developer setup (visitors need nothing)

1. Register a **Custom Receiver** at <https://cast.google.com/publish> (free).
2. Set its URL to `https://<your-name>.github.io/Buzzer/receiver.html`.
3. Copy the **Application ID** and paste it into `DEFAULT_CAST_APP_ID` in
   `index.html` (or into the ⚙ field while testing).
4. **Publish** the receiver in the console. Once published, it works on every
   Chromecast with no serial-number registration — visitors just press **Cast**.

> While developing a draft receiver, add your Chromecast's serial number under
> **Cast Receiver Devices**; that step is only needed before publishing.

Only formats the TV can decode (MP4/H.264, WebM) will play; `.mkv`/`.avi` play
locally but cannot be cast.

### Alternative (Cloudflare Worker + R2)

If you'd rather use the Cloudflare Worker path (remote URLs reachable from the TV):

1. In Cloudflare, create a free **R2 bucket** (Storage → R2 → Create bucket).
2. Bind it to your `video-extractor` worker with variable name `BUCKET`
   (Workers & Pages → your worker → Settings → Bindings → Add → R2 bucket →
   Variable name: `BUCKET`).
3. Redeploy the updated `video-extractor.js`.
4. In Funscript mode, paste the worker URL into the ⚙ field.

This uploads the file first (free plan caps a single upload at 100 MB).

## License

See [LICENSE](LICENSE).
