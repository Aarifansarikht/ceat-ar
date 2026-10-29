# Testing guide

## 1. Start the server

```bash
npm install
npm run dev:https
```

Vite prints a **Network** URL such as `https://192.168.1.20:5173/`. Phones need HTTPS: browsers only allow camera access on `https://` or `http://localhost`. Plain `npm run dev` therefore works on the desktop only.

For a production-like check: `npm run build && npx vite preview --mode https`. When deploying, any static HTTPS host works (Netlify, Vercel, S3 + CloudFront…); serve `dist/`.

## 2. Open it on a phone

1. Put the phone on the **same Wi-Fi** as the computer. Guest or corporate networks often block device-to-device traffic.
2. Open the Network URL. The certificate is self-signed, so accept the warning: on Chrome, **Advanced → Proceed**; on Safari, **Show Details → visit this website**.
3. If the page doesn't load, allow Node.js through the Windows firewall for private networks.
4. Alternative without a LAN: `npx cloudflared tunnel --url http://localhost:5173` (run with plain `npm run dev`) gives you a public HTTPS URL.

Supported browsers: Chrome on Android, Safari on iOS 15+. In-app browsers (Instagram, Facebook…) often block the camera.

## 3. Prepare the target

- The target is `public/targets/ceat-target.jpg` (1080×1920). It's also linked from the intro screen.
- Print it at 100% scale on **matte** paper. Gloss causes glare that breaks tracking. A width of **15 cm** fits A4 portrait. Any size works because tracking is scale-free, but sizes under ~10 cm make detection harder.
- Keep it flat; a curled print bends the features.
- Without a printer: show the image full-screen on a laptop or tablet at maximum brightness. This works, but screens add glare and moiré.

## 4. Grant camera permission

Tap **Start AR**, then **Allow**. If you denied it earlier, the app shows "Camera access needed". Re-enable it here:

- **Android Chrome:** tap the lock icon in the address bar → Permissions → Camera → Allow.
- **iOS Safari:** tap **aA** → Website Settings → Camera → Allow, or Settings → Safari → Camera.

Then tap **Try again**.

## 5. Test tracking stability

Run these checks on at least one mid-range Android phone and one iPhone:

| Test | Expected |
|---|---|
| Point at the print from ~30–40 cm, filling most of the screen | "Poster detected" within ~1–2 s; the tyre appears on the poster |
| Hold the phone still for 10 s | The tyre does not visibly shake. If it does, lower `tracking.filterMinCF` |
| Move slowly left/right/up/down and tilt to ~45° | The tyre stays glued to the same spot on the print |
| Move quickly | Brief lag is acceptable; the tyre must not drift away. If it lags too much, raise `filterBeta` |
| Walk back to 1 m+, then close to ~15 cm | Tracking holds at mid distances and may drop at the extremes |
| Cover the print with your hand, or move it out of view | "Poster out of view" appears and the tyre fades out |
| Bring it back | The tyre reappears, with no second copy |
| Rescan, Spin, Details, Reset, drag sideways | Each one works; drag turns the tyre in place |
| Dim room / bright window / desk-lamp glare | Note where detection fails |
| Rotate the phone to landscape and back | The tracker rebuilds and works again |
| Exit (✕) | The camera indicator turns off |

Add `?debug` to the URL on a production build to show the tracking fps and render fps counters (the dev server always shows them). For reference, tracking fps is the rate of real pose updates: below ~15 the tyre will feel laggy.

## 6. If the target is not detected

1. **Lighting and glare** cause most failures. Try even, diffuse light.
2. **Distance:** the print should fill 50–80% of the screen.
3. **The wrong artwork:** the `.mind` file must be compiled from *exactly* the printed image. A cropped or edited print won't match. Recompile with `npm run compile-target`.
4. **A weak target:** the current artwork is weak (see README). Detection that works but drops often means the artwork needs more contrast and detail.
5. **Engine errors:** connect the phone to desktop devtools (Android: `chrome://inspect`; iOS: Safari → Develop menu) and look for `[AR]` log lines. The dev build logs the target size, camera input size, model bounds and each found/lost event.

## 7. Automated test (synthetic camera)

```bash
npm run build && npm run test:e2e
```

It needs ffmpeg on `PATH` and Chrome (or set `CHROME_PATH`). It renders a 1280×720 clip of the target with known placement (static, moving and rotating, sliding out, absent, returning) and feeds it to Chrome as the camera. It then checks against the production build:

- detection, loss and re-acquisition;
- exactly one model instance;
- overlay accuracy: where the anchor projects vs. where the target really is;
- frame-to-frame jitter;
- Rescan;
- permission-denied handling;
- cleanup on Exit.

Screenshots go to `%TEMP%/ceat-webar-e2e` (or `E2E_OUT`).

Typical results with the current artwork: detection 0.2 s after scanning starts; centre error 1–2 px (p50); corner error 3.6–7.3% of the target width (p95; WARN, from the weak target); static jitter ≈1 px per step.

**This does not replace phone testing.** A synthetic clip has no motion blur, sensor noise, autofocus hunting, rolling shutter, glare or hand shake, and the desktop GPU is much faster than a phone.
