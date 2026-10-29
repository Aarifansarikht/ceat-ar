/**
 * Three.js renderer for the AR overlay. The camera feed is a plain <video>
 * element *behind* a transparent WebGL canvas, so tone mapping and colour
 * management only affect the 3D content, never the camera image.
 */
import {
  NeutralToneMapping,
  DirectionalLight,
  Group,
  HemisphereLight,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export function createSceneRenderer(container, rendererConfig) {
  const renderer = new WebGLRenderer({
    antialias: rendererConfig.antialias,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, rendererConfig.maxPixelRatio));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = rendererConfig.toneMappingExposure;
  renderer.domElement.className = 'ar-canvas';
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  // Studio reflections for the metal rim. Generated procedurally once — no HDRI download.
  const pmrem = new PMREMGenerator(renderer);
  const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.environment = envTexture;
  scene.environmentIntensity = rendererConfig.environmentIntensity;

  // The camera stays at the origin looking down -Z: MindAR's pose is already
  // a model-view matrix, so the anchor carries the full camera→target transform.
  const camera = new PerspectiveCamera(45, 1, 1, 100000);

  // The anchor's matrix is written directly from tracking every frame.
  const anchor = new Group();
  anchor.name = 'TargetAnchor';
  anchor.matrixAutoUpdate = false;
  anchor.visible = false;
  scene.add(anchor);

  // Lights live inside the anchor so the key light always comes from the
  // poster's top-left, regardless of how the phone is held.
  const key = new DirectionalLight(0xffffff, 2.2);
  key.position.set(-0.6, 1.2, 1.4);
  anchor.add(key, key.target);
  anchor.add(new HemisphereLight(0xbfd9ff, 0x0a1020, 0.6));

  return {
    renderer,
    scene,
    camera,
    anchor,

    /**
     * Matches the 3D camera to the on-screen camera preview.
     *
     * MindAR estimates pose with a pinhole model whose vertical FOV is 45°
     * across the *full* camera frame. The preview is scaled to cover the
     * container (object-fit: cover), cropping one axis, so the visible
     * vertical FOV is 45° scaled by containerHeight / displayedVideoHeight.
     * The crop is centred, so no principal-point offset is needed.
     */
    fitToVideo(video, projectionMatrix) {
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const videoRatio = video.videoWidth / video.videoHeight;
      let vw, vh;
      if (videoRatio > cw / ch) {
        vh = ch;
        vw = vh * videoRatio;
      } else {
        vw = cw;
        vh = vw / videoRatio;
      }
      Object.assign(video.style, {
        width: `${vw}px`,
        height: `${vh}px`,
        left: `${(cw - vw) / 2}px`,
        top: `${(ch - vh) / 2}px`,
      });

      const p = projectionMatrix; // column-major
      camera.fov = (2 * Math.atan((1 / p[5]) * (ch / vh)) * 180) / Math.PI;
      camera.near = p[14] / (p[10] - 1);
      camera.far = p[14] / (p[10] + 1);
      camera.aspect = cw / ch;
      camera.updateProjectionMatrix();
      renderer.setSize(cw, ch);
    },

    render() {
      renderer.render(scene, camera);
    },

    dispose() {
      renderer.setAnimationLoop(null);
      envTexture.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
