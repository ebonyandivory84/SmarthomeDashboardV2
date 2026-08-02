# SmartHome Dashboard V2 for ioBroker

Performance-first SmartHome dashboard for wall-mounted Android tablets. V2 is a separate ioBroker adapter and does not modify or replace `smarthome-dashboard`.

## RK3399 profile

- One mounted dashboard page at a time
- Camera previews are JPEG snapshots only
- Snapshots are resized within 640×360 at JPEG quality 65 while preserving the full aspect ratio
- Binary WebSocket snapshots without Base64/JSON image payloads
- Snapshot requests are staggered across the two-second refresh window
- Exactly one live camera session at a time
- fMP4 and go2rtc WebRTC are preferred for fullscreen video; FLV remains a compatibility fallback
- Grafana previews use static render images every 30–60 seconds
- Grafana iframes mount only in fullscreen
- ioBroker state deltas are batched for 100 ms
- Widgets subscribe only to their own state IDs
- Camera, talkback, Grafana and editor code are loaded on demand
- Blur and expensive compositing effects are disabled on coarse-pointer web tablets
- Heating details rotate with short fade transitions instead of a permanently moving ticker
- Wallbox glow runs continuously on desktop and only on charging/power events on coarse-pointer web tablets
- Solar flow animation remains transform-based and pauses with inactive pages
- Selected UI sound files are prefetched while idle but decoded only when first played
- Compressible HTTP responses use Brotli/gzip while camera and media transports stay uncompressed
- Fingerprinted web assets are served with one-year immutable caching

## Adapter identity

- ioBroker adapter: `smarthome-dashboard-v2`
- Default port: `8110`
- Dashboard URL: `http://<ioBroker-host>:8110/smarthome-dashboard-v2`
- API base: `/smarthome-dashboard-v2/api`

V1 can continue running on its existing adapter instance and port.

## Install and build

```bash
npm install
npm run typecheck
npm run export:web
```

Install the repository through ioBroker's GitHub/custom URL installer or pack the adapter after the web export. The root `main.js` delegates to `adapter/main.js` outside the Expo runtime.

## Deploy to the ioBroker Pi

The current production host is `sebastian@192.168.44.31`. Use the dedicated SSH key
`~/.ssh/id_ed25519_iobroker`. The adapter installation and instance are:

- Installation: `/opt/iobroker/node_modules/iobroker.smarthome-dashboard-v2`
- Instance: `smarthome-dashboard-v2.0`
- Port: `8111`

To deploy one isolated commit without including unrelated local working-tree changes, push the
commit first, clone it into a temporary directory on the Pi, verify its full hash, and build there.

```bash
ssh -i ~/.ssh/id_ed25519_iobroker -o IdentitiesOnly=yes sebastian@192.168.44.31
DEPLOY_DIR=$(mktemp -d /tmp/smarthome-dashboard-v2-deploy.XXXXXX)
git clone --depth 1 --branch main https://github.com/ebonyandivory84/SmarthomeDashboardV2.git "$DEPLOY_DIR/repo"
cd "$DEPLOY_DIR/repo"
git rev-parse HEAD
```

Normally, install and export with:

```bash
npm ci
npm run export:web
```

Older commits may have an unsynchronized lockfile for the optional `sharp` packages. For those
historical revisions only, use this temporary build workaround:

```bash
npm install --omit=optional --no-package-lock --no-audit --no-fund
```

Older commits before `expo-asset` became a direct dependency can fail in Metro even though Expo lists
it transitively. For those historical revisions only, install it temporarily and rerun the export:

```bash
npm install expo-asset --no-save --no-package-lock --omit=optional --no-audit --no-fund
npm run export:web
```

Back up and copy the generated frontend. Do not use `cp -a` for the deployment copy: the `sebastian`
user can update the group-writable adapter files but cannot preserve their ioBroker-owned timestamps,
which causes `cp -a` to fail before the adapter restart.

```bash
COMMIT_SHORT=$(git rev-parse --short HEAD)
BACKUP_DIR="/opt/iobroker/backups/smarthome-dashboard-v2-www-before-${COMMIT_SHORT}"
TARGET_DIR=/opt/iobroker/node_modules/iobroker.smarthome-dashboard-v2/adapter/www
mkdir -p "$BACKUP_DIR"
cp -a "$TARGET_DIR/." "$BACKUP_DIR/"
cp -R adapter/www/. "$TARGET_DIR/"
iobroker restart smarthome-dashboard-v2.0
sleep 5
iobroker status smarthome-dashboard-v2.0
curl -fsS -o /dev/null -w 'HTTP=%{http_code}\n' http://127.0.0.1:8111/smarthome-dashboard-v2/
```

The final checks must report that the instance is running and return HTTP `200`. A status check
immediately after `iobroker restart` can briefly say `not running`; wait a few seconds and check again.

## Cameras

Configure a snapshot URL for every camera. V2 always uses this URL for the dashboard preview, regardless of imported V1 preview settings.

Recommended fullscreen order:

1. `webrtc`: go2rtc `stream.html` URL, for example `http://go2rtc-host:1984/stream.html?src=frontdoor&mode=webrtc`
2. `fmp4`: browser-compatible H.264 fragmented MP4
3. `flv`: compatibility fallback through lazy-loaded `flv.js`
4. `snapshot` or `mjpeg`: fallback only

Opening another camera automatically releases the previous live session. Closing a camera removes its iframe/video/player from the DOM.

The adapter uses optional `sharp` support to fit snapshots within 640×360 without cropping. Reolink Duo panoramas therefore remain fully visible at their wide aspect ratio. If the native package is unavailable, snapshots continue to work without server-side resizing.

## Grafana

V2 derives a render URL from normal `/d/` or `/d-solo/` URLs by inserting `/render/`. A custom render URL can be entered in the widget editor.

Grafana image rendering requires a working Grafana image renderer and suitable authentication. The interactive iframe is created only after the preview is opened.

## Android tablet

For the RK3399 tablet:

- Keep Android System WebView or the kiosk browser current.
- Prefer a browser based on a recent Chromium/WebView release.
- Use H.264 camera substreams around 640×360 or 720p for previews/source conversion.
- Avoid 4K fullscreen streams unless explicitly needed.
- Keep hardware acceleration enabled in the kiosk browser.

## Optional go2rtc host

`iobroker.go2rtc-host/` contains the optional helper adapter copied from the template. It can host go2rtc and expose WebRTC/fMP4 endpoints used by the V2 camera fullscreen configuration.

## Development

```bash
npm run web
npm run typecheck
npm run export:web
```

The production export is written to `adapter/www`.
