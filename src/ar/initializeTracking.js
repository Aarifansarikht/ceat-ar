/**
 * Thin, leak-safe wrapper around MindAR's image-tracking Controller.
 *
 * We deliberately do not use MindAR's `MindARThree` helper: it imports
 * `sRGBEncoding` (removed in three r162+), swallows camera errors, never
 * removes its resize listener and does not cap the pixel ratio. The
 * Controller is the actual tracking engine and is renderer-agnostic.
 *
 * Pose pipeline (per processed camera frame, inside MindAR):
 *   detect/match (worker) → homography → pose refine → One-Euro filter
 *   → `worldMatrix` (OpenGL model-view, target-pixel units, origin at the
 *     image's bottom-left corner, +Y up, +Z out of the image)
 * We then right-multiply by `postMatrix` = T(w/2, h/2, 0) · S(w), which moves
 * the origin to the image centre and makes 1 unit = image width. That is the
 * "anchor space" documented in trackingConfig.js. Nothing else is applied to
 * the pose: no extra smoothing, prediction or easing.
 */
import { Controller } from 'mind-ar/dist/mindar-image.prod.js';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { ARError } from './cameraStream.js';

const isDev = import.meta.env.DEV;

/**
 * @param {object} opts
 * @param {HTMLVideoElement} opts.video
 * @param {string} opts.mindFile
 * @param {object} opts.tracking          trackingConfig.tracking
 * @param {(m: Matrix4) => void} opts.onPose  called with the anchor matrix every tracked frame
 * @param {() => void} opts.onFound
 * @param {() => void} opts.onLost
 * @param {() => void} [opts.onFrame]     called after every processed camera frame
 */
export async function initializeTracking({ video, mindFile, tracking, onPose, onFound, onLost, onFrame }) {
  let buffer;
  try {
    const res = await fetch(mindFile);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    buffer = await res.arrayBuffer();
  } catch (err) {
    throw new ARError('asset-load', `The tracking target could not be downloaded (${mindFile}).`, err);
  }

  const inputWidth = video.videoWidth;
  const inputHeight = video.videoHeight;
  const anchorMatrix = new Matrix4();
  const postMatrix = new Matrix4();
  let visible = false;
  let disposed = false;
  let frameWaiter = null;

  let controller;
  try {
    controller = new Controller({
      inputWidth,
      inputHeight,
      maxTrack: tracking.maxTrack,
      filterMinCF: tracking.filterMinCF,
      filterBeta: tracking.filterBeta,
      warmupTolerance: tracking.warmupTolerance,
      missTolerance: tracking.missTolerance,
      onUpdate: (data) => {
        if (disposed) return;
        if (data.type === 'processDone') {
          onFrame?.();
          frameWaiter?.();
          return;
        }
        if (data.type !== 'updateMatrix') return;

        if (data.worldMatrix === null) {
          if (visible) {
            visible = false;
            onLost();
          }
          return;
        }
        anchorMatrix.fromArray(data.worldMatrix).multiply(postMatrix);
        onPose(anchorMatrix);
        if (!visible) {
          visible = true;
          onFound();
        }
      },
    });

    // Throws inside msgpack if the file is not a .mind file (e.g. an HTML 404 page).
    const { dimensions } = controller.addImageTargetsFromBuffer(buffer);
    if (!dimensions.length) throw new Error('The .mind file contains no targets or is outdated.');

    const [w, h] = dimensions[0];
    postMatrix.compose(new Vector3(w / 2, h / 2, 0), new Quaternion(), new Vector3(w, w, w));
    if (isDev) console.info(`[AR] target ${w}x${h}px, camera input ${inputWidth}x${inputHeight}`);

    // Compiles the WebGL kernels up front (can take a few seconds on first run)
    // so the first real frame does not stall.
    controller.dummyRun(video);
  } catch (err) {
    controller?.worker?.terminate();
    if (err instanceof ARError) throw err;
    throw new ARError('tracking-init', 'The tracking engine failed to start on this device.', err);
  }

  return {
    inputWidth,
    inputHeight,
    /** OpenGL projection used by MindAR's pose estimate (column-major array). */
    projectionMatrix: controller.getProjectionMatrix(),

    start() {
      controller.processVideo(video);
    },

    /**
     * Stops the processing loop and releases the worker and GPU tensors.
     * Waits for the in-flight frame to finish first: terminating the worker
     * mid-frame would leave MindAR's loop awaiting a reply forever and leak
     * that frame's tensor.
     */
    async dispose() {
      if (disposed) return;
      const wasRunning = controller.processingVideo;
      controller.stopProcessVideo();
      if (wasRunning) {
        await new Promise((resolve) => {
          frameWaiter = resolve;
          setTimeout(resolve, 1000);
        });
      }
      disposed = true;
      frameWaiter = null;
      controller.worker.postMessage({ type: 'dispose' });
      controller.worker.terminate();
      const t = controller.tracker;
      [t?.featurePointsListT, t?.imagePixelsListT, t?.imagePropertiesListT]
        .flat()
        .forEach((tensor) => tensor?.dispose?.());
    },
  };
}
