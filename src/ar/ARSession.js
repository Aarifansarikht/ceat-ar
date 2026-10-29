/**
 * Framework-agnostic AR session: camera → MindAR tracking → Three.js overlay.
 *
 * React only receives coarse lifecycle events (phase changes, found/lost,
 * errors). Per-frame work — pose updates, fades, rendering — never touches
 * React state.
 *
 * Scene graph:
 *   scene
 *   └─ anchor        matrix = tracking pose (written directly, never animated)
 *      ├─ lights
 *      └─ content    configurable placement + entrance scale
 *         └─ GLB root (recentred) → TyreLift → Tyre (drag yaw) → Wheel (spin)
 */
import { Quaternion, Vector3 } from 'three';
import { ARError, checkEnvironment, openCamera, stopStream } from './cameraStream.js';
import { initializeTracking } from './initializeTracking.js';
import { loadTyreModel } from './modelLoader.js';
import { createSceneRenderer } from './sceneRenderer.js';

const isDev = import.meta.env.DEV;
const UP = new Vector3(0, 1, 0);
const easeOutCubic = (t) => 1 - (1 - t) ** 3;

export class ARSession {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.container
   * @param {typeof import('./trackingConfig.js').trackingConfig} opts.config
   * @param {(phase: 'requesting-camera'|'initializing'|'scanning') => void} opts.onPhase
   * @param {(status: 'found'|'lost') => void} opts.onTracking
   * @param {(err: ARError) => void} opts.onError
   * @param {(stats: {trackingFps: number, renderFps: number}) => void} [opts.onDiagnostics]
   */
  constructor({ container, config, onPhase, onTracking, onError, onDiagnostics }) {
    this.container = container;
    this.config = config;
    this.cb = { onPhase, onTracking, onError, onDiagnostics };

    this.started = false;
    this.destroyed = false;
    this.restarting = null;

    // Presentation state, advanced in the render loop.
    this.visibility = 0; // 0 = hidden, 1 = fully shown
    this.visibilityTarget = 0;
    this.spinning = false;
    this.userYaw = 0;
    this.dragBaseQuat = new Quaternion();
    this.tmpQuat = new Quaternion();
    this.frames = { tracked: 0, rendered: 0, since: performance.now() };

    this.handleResize = this.handleResize.bind(this);
    this.handleVisibility = this.handleVisibility.bind(this);
    this.handleTrackEnded = () => this.fail(new ARError('camera-busy', 'The camera stopped unexpectedly.'));
    this.handleContextLost = (e) => {
      e.preventDefault();
      this.fail(new ARError('webgl-unavailable', 'The graphics context was lost. Please restart the experience.'));
    };
  }

  async start() {
    if (this.started) return; // never initialise twice
    this.started = true;
    try {
      checkEnvironment();

      this.cb.onPhase('requesting-camera');
      const { video, stream } = await openCamera(this.config.camera);
      this.video = video;
      this.stream = stream;
      if (this.destroyed) return this.releaseCamera();
      this.container.prepend(video);
      stream.getVideoTracks()[0]?.addEventListener('ended', this.handleTrackEnded);

      this.cb.onPhase('initializing');
      this.view = createSceneRenderer(this.container, this.config.renderer);
      this.view.renderer.domElement.addEventListener('webglcontextlost', this.handleContextLost);

      // Model download and tracker setup are independent — run them together.
      // allSettled so that if one side fails, the other is still released.
      const [modelResult, trackingResult] = await Promise.allSettled([
        loadTyreModel(this.config.model, {
          maxAnisotropy: this.view.renderer.capabilities.getMaxAnisotropy(),
        }),
        this.createTracking(),
      ]);
      const failed = [modelResult, trackingResult].find((r) => r.status === 'rejected');
      if (failed || this.destroyed) {
        if (modelResult.status === 'fulfilled') modelResult.value.dispose();
        if (trackingResult.status === 'fulfilled') await trackingResult.value.dispose();
        if (failed) throw failed.reason;
        return;
      }
      const model = modelResult.value;
      const tracking = trackingResult.value;
      this.model = model;
      this.tracking = tracking;

      // Exactly one model instance per session; found/lost only toggles visibility.
      this.view.anchor.add(model.content);
      this.baseScale = model.content.scale.x;
      if (model.parts.drag) this.dragBaseQuat.copy(model.parts.drag.quaternion);
      this.attachInteraction();

      this.view.fitToVideo(this.video, tracking.projectionMatrix);
      this.resizeObserver = new ResizeObserver(this.handleResize);
      this.resizeObserver.observe(this.container);
      this.video.addEventListener('resize', this.handleResize);
      document.addEventListener('visibilitychange', this.handleVisibility);

      this.lastTime = performance.now();
      this.view.renderer.setAnimationLoop((t) => this.tick(t));
      tracking.start();
      this.cb.onPhase('scanning');
      this.exposeDebugHooks();
    } catch (err) {
      this.fail(err);
    }
  }

  createTracking() {
    return initializeTracking({
      video: this.video,
      mindFile: this.config.target.mindFile,
      tracking: this.config.tracking,
      onPose: (matrix) => {
        const { anchor } = this.view;
        anchor.matrix.copy(matrix);
        anchor.matrixWorldNeedsUpdate = true;
      },
      onFound: () => {
        if (isDev) console.info('[AR] target found');
        this.visibilityTarget = 1;
        this.view.anchor.visible = true;
        if (this.config.visibility.entranceMs <= 0) this.visibility = 1;
        this.cb.onTracking('found');
      },
      onLost: () => {
        if (isDev) console.info('[AR] target lost');
        // The model stays on its last *measured* pose while fading; we never
        // extrapolate or animate the pose to fake continued tracking.
        this.visibilityTarget = 0;
        if (this.config.visibility.onLost === 'hide') this.visibility = 0;
        this.cb.onTracking('lost');
      },
      onFrame: () => {
        this.frames.tracked++;
      },
    });
  }

  /** Per-frame: presentation animation + render. No React, no allocation. */
  tick(now) {
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;
    const { visibility: vis } = this.config;
    const { anchor } = this.view;

    if (this.visibility !== this.visibilityTarget) {
      const duration = (this.visibilityTarget > this.visibility ? vis.entranceMs : vis.fadeOutMs) / 1000;
      const step = duration > 0 ? dt / duration : 1;
      this.visibility =
        this.visibilityTarget > this.visibility
          ? Math.min(1, this.visibility + step)
          : Math.max(0, this.visibility - step);
      this.applyVisibility();
    }
    if (this.visibility === 0 && anchor.visible && this.visibilityTarget === 0) anchor.visible = false;

    const { spin } = this.model.parts;
    if (this.spinning && spin && anchor.visible) {
      spin.rotation[this.config.model.spinAxis] -= this.config.model.spinSpeed * dt;
    }

    this.view.render();
    this.frames.rendered++;
    this.reportDiagnostics(now);
  }

  applyVisibility() {
    const k = easeOutCubic(this.visibility);
    this.model.content.scale.setScalar(this.baseScale * (0.85 + 0.15 * k));
    for (const m of this.model.materials) {
      m.userData.baseOpacity ??= m.opacity;
      m.userData.baseTransparent ??= m.transparent;
      const transparent = m.userData.baseTransparent || k < 1;
      if (m.transparent !== transparent) {
        m.transparent = transparent;
        m.needsUpdate = true;
      }
      m.opacity = m.userData.baseOpacity * k;
    }
  }

  /** Horizontal drag spins the tyre about the poster's vertical axis. */
  attachInteraction() {
    const el = this.container;
    let lastX = null;
    this.onPointerDown = (e) => {
      if (!this.view.anchor.visible || e.target.closest('button, a')) return;
      lastX = e.clientX;
      el.setPointerCapture?.(e.pointerId);
    };
    this.onPointerMove = (e) => {
      if (lastX === null) return;
      this.userYaw += (e.clientX - lastX) * 0.012;
      lastX = e.clientX;
      this.applyYaw();
    };
    this.onPointerUp = () => {
      lastX = null;
    };
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
  }

  applyYaw() {
    const drag = this.model?.parts.drag;
    if (!drag) return;
    drag.quaternion.copy(this.tmpQuat.setFromAxisAngle(UP, this.userYaw)).multiply(this.dragBaseQuat);
  }

  setSpin(on) {
    this.spinning = on;
  }

  resetView() {
    this.userYaw = 0;
    this.applyYaw();
    const spin = this.model?.parts.spin;
    if (spin) spin.rotation[this.config.model.spinAxis] = 0;
  }

  /**
   * Rebuilds the tracker on the same camera stream and model. Used for the
   * "Rescan" action and when the camera frame rotates (MindAR's tracker is
   * sized to the input dimensions at construction).
   */
  rescan() {
    if (!this.tracking || this.destroyed) return Promise.resolve();
    this.restarting ??= (async () => {
      try {
        this.visibility = this.visibilityTarget = 0;
        this.applyVisibility();
        this.view.anchor.visible = false;
        this.cb.onPhase('initializing');
        await this.tracking.dispose();
        this.tracking = null;
        if (this.destroyed) return;
        const tracking = await this.createTracking();
        if (this.destroyed) return tracking.dispose();
        this.tracking = tracking;
        this.view.fitToVideo(this.video, tracking.projectionMatrix);
        tracking.start();
        this.cb.onPhase('scanning');
      } catch (err) {
        this.fail(err);
      } finally {
        this.restarting = null;
      }
    })();
    return this.restarting;
  }

  handleResize() {
    if (!this.video || !this.tracking || this.restarting) return;
    const rotated =
      this.video.videoWidth !== this.tracking.inputWidth || this.video.videoHeight !== this.tracking.inputHeight;
    if (rotated) {
      this.video.width = this.video.videoWidth;
      this.video.height = this.video.videoHeight;
      if (isDev) console.info('[AR] camera frame size changed, rebuilding tracker');
      this.rescan();
    } else {
      this.view.fitToVideo(this.video, this.tracking.projectionMatrix);
    }
  }

  handleVisibility() {
    // MindAR's loop pauses on its own in background tabs (it waits on
    // requestAnimationFrame). On return, make sure the OS did not kill the camera.
    if (document.visibilityState !== 'visible') return;
    const track = this.stream?.getVideoTracks()[0];
    if (!track || track.readyState === 'ended') this.handleTrackEnded();
    else this.video.play().catch(() => {});
  }

  reportDiagnostics(now) {
    const elapsed = now - this.frames.since;
    if (elapsed < 1000 || !this.cb.onDiagnostics) return;
    this.cb.onDiagnostics({
      trackingFps: Math.round((this.frames.tracked * 1000) / elapsed),
      renderFps: Math.round((this.frames.rendered * 1000) / elapsed),
    });
    this.frames.tracked = this.frames.rendered = 0;
    this.frames.since = now;
  }

  /** Test/diagnostic hooks, only installed in dev builds or with ?debug. */
  exposeDebugHooks() {
    if (!(isDev || new URLSearchParams(location.search).has('debug'))) return;
    const v = new Vector3();
    window.__AR_DEBUG__ = {
      modelInstances: () => {
        let n = 0;
        this.view.scene.traverse((o) => o.name === 'TyreContent' && n++);
        return n;
      },
      anchorVisible: () => this.view.anchor.visible,
      videoSize: () => ({ width: this.video.videoWidth, height: this.video.videoHeight }),
      /** PNG data URL of the current raw camera frame. */
      grabFrame: () => {
        const c = document.createElement('canvas');
        c.width = this.video.videoWidth;
        c.height = this.video.videoHeight;
        c.getContext('2d').drawImage(this.video, 0, 0);
        return c.toDataURL('image/png');
      },
      /** Screen position (CSS px) of an anchor-space point, e.g. the target centre. */
      project: (x = 0, y = 0, z = 0) => {
        v.set(x, y, z).applyMatrix4(this.view.anchor.matrix).project(this.view.camera);
        const r = this.container.getBoundingClientRect();
        return { x: ((v.x + 1) / 2) * r.width, y: ((1 - v.y) / 2) * r.height };
      },
    };
  }

  fail(err) {
    if (this.destroyed) return;
    const error =
      err instanceof ARError ? err : new ARError('tracking-init', 'Something went wrong starting AR.', err);
    if (isDev) console.error('[AR]', error.code, error.message, error.cause ?? '');
    this.destroy();
    this.cb.onError(error);
  }

  releaseCamera() {
    this.stream?.getVideoTracks()[0]?.removeEventListener('ended', this.handleTrackEnded);
    stopStream(this.stream);
    if (this.video) {
      this.video.srcObject = null;
      this.video.remove();
    }
    this.stream = this.video = null;
  }

  /** Idempotent: safe to call from React cleanup, errors and Exit. */
  async destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    document.removeEventListener('visibilitychange', this.handleVisibility);
    this.resizeObserver?.disconnect();
    this.video?.removeEventListener('resize', this.handleResize);
    const el = this.container;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerUp);
    if (window.__AR_DEBUG__) delete window.__AR_DEBUG__;

    this.view?.renderer.setAnimationLoop(null);
    this.releaseCamera(); // camera light goes off immediately
    const tracking = this.tracking;
    this.tracking = null;
    this.model?.dispose();
    this.view?.renderer.domElement.removeEventListener('webglcontextlost', this.handleContextLost);
    this.view?.dispose();
    await tracking?.dispose();
  }
}
