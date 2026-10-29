# CEAT WebAR — image-tracked 3D tyre

A mobile web page that opens the phone camera, recognises a printed CEAT poster and anchors the 3D tyre (`ceat-model.glb`) to it. No app install, no hosted AR service.

```bash
npm install
npm run dev          # http://localhost:5173 (desktop, webcam)
npm run dev:https    # https://<your-LAN-IP>:5173 for phones (self-signed cert)
npm run build        # production build in dist/
npm run lint
npm run test:e2e     # needs build + Chrome + ffmpeg; see TESTING.md
npm run compile-target -- <image> <out.mind>   # rebuild the tracking target
```

See **[TESTING.md](TESTING.md)** to print the target and test on a phone.

## Architecture decision

| Concern | Choice | Why |
|---|---|---|
| Image tracking | **MindAR 1.2.5** (`mind-ar`, MIT) — its `Controller` only | Free, fully client-side (no account, no server, no per-scan fees), works on Android Chrome and iOS Safari through `getUserMedia` + WebGL. **WebXR is not used**: WebXR image tracking (`image-tracking` feature) is only behind a flag in Chrome Android and absent on iOS. |
| Rendering | **Three.js r170** | Loads the GLB with its original PBR materials. |
| UI | React 19 + Vite 6, plain CSS | Matches the requested stack; no CSS framework needed. |
| A-Frame | Not used | No benefit over driving Three.js directly; it would add a second scene graph. |

MindAR's bundled `MindARThree` helper is **not** used. It imports `sRGBEncoding`, which was removed in three r162 (so it breaks the build). It also discards camera errors, which makes "permission denied" impossible to tell apart from "no camera". It also never removes its listeners and doesn't cap the pixel ratio. We use MindAR's `Controller` (the real tracking engine) and own the camera, renderer and lifecycle ourselves.

```
src/
  ar/trackingConfig.js     ← every tunable value (model, target, smoothing, renderer)
  ar/cameraStream.js       camera + environment checks, classified errors
  ar/initializeTracking.js MindAR Controller → anchor matrix; leak-safe dispose
  ar/modelLoader.js        GLB load, recentre, lift onto surface, material tuning
  ar/sceneRenderer.js      renderer, lights, env map, camera matched to the video
  ar/ARSession.js          orchestrates the above; no React, no per-frame state
  ar/arStates.js           explicit UI state machine (rejects invalid transitions)
  components/              ARExperience (lifecycle), IntroScreen, AROverlay, ScanGuide
  styles/ar.css
public/models/ceat-model.glb     copy of ./ceat-model.glb (originals left untouched)
public/targets/ceat-target.jpg   copy of ./cover-5e85748f62.jpg — the printable target
public/targets/ceat-target.mind  compiled MindAR target (npm run compile-target)
public/brand/logo.png            cropped copy of ./logo-c60be54b98.png
scripts/compile-target.mjs       offline .mind compiler (MindAR OfflineCompiler)
scripts/e2e-fake-camera.mjs      end-to-end test with a synthetic camera
```

### Coordinate convention

Anchor space (used throughout `trackingConfig.js`): origin at the **centre of the target image**, +X right, +Y up, +Z out of the image towards the viewer, **1 unit = target width**. The image spans `y ∈ ±aspect/2` (aspect = height / width = 1.778). MindAR's pose is in target pixels with the origin at the bottom-left; `initializeTracking.js` converts it with `T(w/2, h/2, 0) · S(w)`. Nothing else is applied to the pose: no extra smoothing, prediction or easing.

The GLB was already authored in this space (decals in XY at z≈0, axle on +Z), but laid out for a different poster: the tyre sat at (0.25, −0.022) with its centre in the image plane. `modelLoader.js` recentres it on the `TyreLift` node and pushes the tyre forward until its back rests on the print. Placement is then `scale` / `position` / `rotationDeg` in the config.

### Tracking behaviour

- One model instance per session. Found/lost only toggles visibility; Rescan rebuilds the tracker, not the model. The e2e test asserts this.
- On loss, the model fades out (250 ms) on its last *measured* pose. Set `visibility.onLost: 'hide'` to remove it instantly.
- Smoothing: MindAR's One-Euro filter at its defaults (`filterMinCF 0.001`, `filterBeta 1000`). This is modest and keeps lag low. If the tyre jitters while the phone is still, reduce `filterMinCF`. If it lags during fast moves, raise `filterBeta`.
- Drag (yaw) and Spin rotate parts of the model *inside* the anchor; they never alter the tracking pose.

## Changing the target artwork

1. Put the new image in `public/targets/` (JPG/PNG, ~1000–2000 px on the long side).
2. `npm run compile-target -- public/targets/new.jpg public/targets/new.mind`. It prints feature counts and warns if the target is weak.
3. Update `target.mindFile`, `target.image` and `target.aspect` (height / width) in `trackingConfig.js`.
4. Re-tune `model.position` / `model.scale` for the new layout.

**The current target is weak.** The supplied cover image is a dark render with large flat gradients. It compiles to 243 matching / 22 tracking features, against ~500 / ~70 for a busy test image. In the synthetic-camera test, the overlay's corners land within about 4–7% (p95) of the target width with this artwork, versus 1.5% with a feature-rich image. Final poster artwork should carry high-contrast detail (text, product shots, texture) spread across the whole sheet, not just in the centre.

## Known limitations

- **No real-device testing has been done yet.** Everything here was verified in desktop Chrome with a synthetic camera (see TESTING.md).
- MindAR assumes a 45° vertical camera FOV for its pose estimate. Content *on* the print plane lines up correctly. Content that sticks out of the plane (the tyre is ~0.56 widths deep) can show slight parallax error at steep viewing angles, because real phone cameras have a different FOV.
- MindAR runs TensorFlow.js on WebGL. Low-end phones may track at <15 fps. The 1.76 MB engine chunk (~300 kB gzip) loads after the intro paints.
- Shadows are the GLB's baked contact-shadow decal; no realtime shadow maps (they're expensive and can't fall on the real poster anyway).
- MindAR 1.2.5 is the latest release, but the project is lightly maintained.
- `npm audit` reports advisories only in build/test tooling: `canvas`'s installer (`tar`, used only by the offline target compiler) and `puppeteer-core` (e2e only). Neither ships to the browser.
