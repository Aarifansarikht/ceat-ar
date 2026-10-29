/**
 * Single source of truth for the AR experience. Everything a designer or
 * integrator is expected to tune lives here.
 *
 * COORDINATE CONVENTION (anchor space)
 * ------------------------------------
 * MindAR reports the target pose in target-image pixels. initializeTracking.js
 * rescales that so the anchor space used by every value below is:
 *
 *   origin  = centre of the target image
 *   +X      = towards the image's right edge
 *   +Y      = towards the image's top edge
 *   +Z      = out of the image, towards the viewer
 *   1 unit  = the full WIDTH of the target image
 *
 * So the image spans x ∈ [-0.5, 0.5] and y ∈ [-aspect/2, aspect/2], where
 * aspect = height / width. Physical size only matters for converting units to
 * centimetres: 1 unit = target.physicalWidthCm. Tracking itself is scale-free —
 * printing the target larger or smaller does not require any code change.
 */
const base = import.meta.env.BASE_URL;

export const trackingConfig = {
  brand: {
    name: 'CEAT',
    productLine: 'Premium Touring',
    tagline: 'Scan the poster to bring the tyre to life.',
    logo: `${base}brand/logo.png`,
    // Short feature cards shown while the tyre is tracked. Placeholder copy
    // taken from the model's sidewall markings — replace with approved
    // marketing copy before launch.
    features: [
      { title: 'Premium Touring', body: 'Grand-touring tyre line.' },
      { title: 'Tubeless Radial', body: 'Radial construction, tubeless fitment.' },
      { title: '205/55 R16', body: 'Size as marked on the sidewall.' },
    ],
  },

  target: {
    // Compiled MindAR target. Regenerate with `npm run compile-target` after
    // changing the artwork (see scripts/compile-target.mjs).
    mindFile: `${base}targets/ceat-target.mind`,
    // The source artwork, used for the printable target link and the intro preview.
    image: `${base}targets/ceat-target.jpg`,
    // height / width of the target image (1920 / 1080). Must match the image
    // that was compiled, otherwise overlay placement on the image is wrong.
    aspect: 1920 / 1080,
    // Intended printed width. Informational (units → cm); tracking is scale-free.
    // At 15 cm wide the print is ~26.7 cm tall (fits A4 portrait).
    physicalWidthCm: 15,
  },

  model: {
    url: `${base}models/ceat-model.glb`,
    // The GLB is authored in anchor units with the tyre at (0.25, -0.022) —
    // i.e. placed for a different poster layout. When `recenterNode` names a
    // node, the whole scene is shifted so that node sits at the anchor origin.
    // Set to null to keep the authored placement.
    recenterNode: 'TyreLift',
    // Pushes the `liftNode` along +Z until the back of the tyre touches the
    // target plane, so the tyre stands *on* the poster instead of half inside
    // it. The decal planes (patch, glow, contact shadow) stay on the surface.
    liftNode: 'TyreLift',
    liftToSurface: true,
    // Transform of the whole model in anchor space (applied after recentering).
    scale: 2.0, // 2.0 → tyre diameter ≈ 63% of the target width
    position: [0, 0.05, 0], // anchor units (fraction of target width)
    rotationDeg: [0, 0, 0], // XYZ Euler, degrees
    // Nodes to hide. `CleanPatch` is a soft blue backdrop decal that masks the
    // printed artwork behind the tyre; remove it from this list to show it.
    hiddenNodes: [],
    // The node the user can spin with a horizontal drag (yaw), and the node
    // that spins about its axle when "Spin" is on. Neither touches the
    // tracking pose: they rotate parts of the model *within* the anchor.
    dragNode: 'Tyre',
    spinNode: 'Wheel',
    spinAxis: 'z', // the wheel axle is local +Z in this GLB
    spinSpeed: 1.6, // rad/s
    // Light-touch material tuning. Original textures/colours are kept; only
    // reflection strength is adjusted so the rubber is not washed out.
    rubberEnvIntensity: 0.55,
    metalEnvIntensity: 1.1,
  },

  tracking: {
    maxTrack: 1,
    // MindAR One-Euro pose filter. Lower minCutOff = less jitter but more lag
    // when still; higher beta = less lag during fast motion. These are
    // MindAR's own defaults, which keep the tyre glued to the print; reduce
    // filterMinCF (e.g. 0.0005) only if jitter is visible when holding still.
    filterMinCF: 0.001,
    filterBeta: 1000,
    // Consecutive tracked frames before the target is reported as found, and
    // missed frames before it is reported lost. Small values = responsive.
    warmupTolerance: 5,
    missTolerance: 5,
    // Scan duration before help tips are shown.
    scanHintAfterMs: 8000,
  },

  visibility: {
    // 'fade' fades the model out on the last known pose; 'hide' removes it at once.
    onLost: 'fade',
    fadeOutMs: 250,
    // Subtle entrance after detection: scale 0.85 → 1 and fade in.
    entranceMs: 450,
  },

  camera: {
    // Larger input = better detection at distance but slower tracking updates.
    width: 1280,
    height: 720,
  },

  renderer: {
    maxPixelRatio: 2,
    antialias: true,
    toneMappingExposure: 1.0,
    environmentIntensity: 0.9,
  },
};
