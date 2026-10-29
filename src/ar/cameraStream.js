/**
 * Rear-camera acquisition with errors classified into user-facing causes.
 * MindAR's own wrapper swallows the getUserMedia error, which makes
 * "permission denied" indistinguishable from "no camera" — so we own this.
 */

export class ARError extends Error {
  /**
   * @param {'insecure-context'|'unsupported'|'permission-denied'|'no-camera'|
   *   'camera-busy'|'webgl-unavailable'|'asset-load'|'tracking-init'} code
   */
  constructor(code, message, cause) {
    super(message);
    this.name = 'ARError';
    this.code = code;
    this.cause = cause;
  }
}

export function checkEnvironment() {
  if (!window.isSecureContext) {
    throw new ARError(
      'insecure-context',
      'The camera only works over HTTPS. Open this page using its https:// address.',
    );
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new ARError(
      'unsupported',
      'This browser cannot access the camera. Use Chrome on Android or Safari on iOS.',
    );
  }
  const probe = document.createElement('canvas');
  const gl = probe.getContext('webgl2') || probe.getContext('webgl');
  if (!gl) {
    throw new ARError('webgl-unavailable', 'WebGL is unavailable, so 3D content cannot be shown.');
  }
  gl.getExtension('WEBGL_lose_context')?.loseContext();
}

/**
 * Opens the rear camera and resolves once the <video> has real dimensions.
 * @returns {Promise<{video: HTMLVideoElement, stream: MediaStream}>}
 */
export async function openCamera({ width, height }) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: width },
        height: { ideal: height },
      },
    });
  } catch (err) {
    throw classifyCameraError(err);
  }

  const video = document.createElement('video');
  video.setAttribute('playsinline', ''); // iOS: keep inline, no fullscreen player
  video.setAttribute('muted', '');
  video.muted = true;
  video.autoplay = true;
  video.className = 'ar-video';
  video.srcObject = stream;

  try {
    await new Promise((resolve, reject) => {
      if (video.readyState >= 1 && video.videoWidth) return resolve();
      video.addEventListener('loadedmetadata', resolve, { once: true });
      video.addEventListener('error', () => reject(video.error), { once: true });
    });
    await video.play();
  } catch (err) {
    stopStream(stream);
    throw new ARError('camera-busy', 'The camera started but no video was received.', err);
  }

  // MindAR's InputLoader reads the width/height *attributes* to detect a
  // rotated input, so they must match the real stream dimensions.
  video.width = video.videoWidth;
  video.height = video.videoHeight;
  return { video, stream };
}

export function stopStream(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

function classifyCameraError(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return new ARError(
        'permission-denied',
        'Camera access was blocked. Allow camera access for this site in your browser settings, then try again.',
        err,
      );
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return new ARError('no-camera', 'No usable camera was found on this device.', err);
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return new ARError(
        'camera-busy',
        'The camera is in use by another app. Close other camera apps and try again.',
        err,
      );
    default:
      return new ARError('unsupported', `The camera could not be started (${err?.name ?? 'unknown error'}).`, err);
  }
}
