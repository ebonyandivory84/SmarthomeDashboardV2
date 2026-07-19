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
- Solar, heating ticker and wallbox movement remain animated with CSS transforms and slower tablet timings
- Selected UI sound files are prefetched while idle but decoded only when first played
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
