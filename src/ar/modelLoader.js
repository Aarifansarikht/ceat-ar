/**
 * Loads the tyre GLB and prepares it for anchoring.
 *
 * The supplied ceat-model.glb (exported by three.js GLTFExporter) is already
 * authored in anchor space — the decal planes lie in the XY plane at z≈0 and
 * the wheel axle is local +Z — so no axis conversion is needed. We only:
 *   1. recentre it on `recenterNode` (it was laid out for another poster),
 *   2. lift the tyre so its back rests on the target plane,
 *   3. tune reflection strength (textures/colours are untouched).
 */
import { Box3, Euler, Group, MathUtils, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ARError } from './cameraStream.js';

const isDev = import.meta.env.DEV;

/**
 * @returns {Promise<{content: Group, parts: Record<string, import('three').Object3D|null>,
 *   materials: import('three').Material[], dispose: () => void}>}
 */
export async function loadTyreModel(modelConfig, { maxAnisotropy = 1 } = {}) {
  let gltf;
  try {
    gltf = await new GLTFLoader().loadAsync(modelConfig.url);
  } catch (err) {
    throw new ARError('asset-load', `The 3D tyre could not be loaded (${modelConfig.url}).`, err);
  }

  const root = gltf.scene;
  const find = (name) => (name ? root.getObjectByName(name) ?? null : null);

  for (const name of modelConfig.hiddenNodes) {
    const node = find(name);
    if (node) node.visible = false;
    else if (isDev) console.warn(`[AR] hiddenNodes: "${name}" not found in model`);
  }

  // 1. Recentre: shift the whole authored scene so the chosen node is at the origin.
  const centre = find(modelConfig.recenterNode);
  if (centre) {
    root.position.x -= centre.position.x;
    root.position.y -= centre.position.y;
  }

  // 2. Lift: with the tyre's centre at z=0 half of it would sit behind the
  // print. Measure the tyre's exact (per-vertex) bounds in root space and
  // push it forward so its rearmost point lies on the target plane.
  const lift = find(modelConfig.liftNode);
  if (lift && modelConfig.liftToSurface) {
    root.updateMatrixWorld(true);
    const box = new Box3().setFromObject(lift, true);
    const rootZ = root.position.z;
    const minZ = box.min.z - rootZ;
    if (minZ < 0) lift.position.z -= minZ;
  }

  // 3. Materials: keep the authored PBR values and textures; only balance the
  // environment reflection so dark rubber keeps its tone and metal still reads.
  const materials = new Set();
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    for (const m of [obj.material].flat()) materials.add(m);
  });
  for (const m of materials) {
    if (m.isMeshStandardMaterial) {
      m.envMapIntensity = m.metalness > 0.5 ? modelConfig.metalEnvIntensity : modelConfig.rubberEnvIntensity;
    }
    for (const tex of [m.map, m.emissiveMap, m.roughnessMap, m.metalnessMap, m.normalMap]) {
      if (tex) tex.anisotropy = Math.min(4, maxAnisotropy);
    }
    // Decals (patch, glow, shadow, streaks) are blended planes on/near the
    // target plane; they must not occlude the tyre through the depth buffer.
    if (m.transparent) m.depthWrite = false;
  }

  // Draw the flat decals before the tyre, in their authored stacking order.
  ['CleanPatch', 'Glow', 'ContactShadow'].forEach((name, i) => {
    const node = find(name);
    if (node) node.renderOrder = -3 + i;
  });

  // `content` carries the configurable placement in anchor space; the anchor
  // (tracking pose) is its parent and is never modified by the model code.
  const content = new Group();
  content.name = 'TyreContent';
  content.position.fromArray(modelConfig.position);
  content.rotation.copy(
    new Euler(...modelConfig.rotationDeg.map((d) => MathUtils.degToRad(d)), 'XYZ'),
  );
  content.scale.setScalar(modelConfig.scale);
  content.add(root);

  if (isDev) {
    content.updateMatrixWorld(true);
    const size = new Box3().setFromObject(lift ?? root, true).getSize(new Vector3());
    console.info(
      `[AR] model loaded: ${materials.size} materials; tyre bounds in anchor units ` +
        `${size.x.toFixed(3)} × ${size.y.toFixed(3)} × ${size.z.toFixed(3)} (1 = target width)`,
    );
  }

  return {
    content,
    parts: {
      drag: find(modelConfig.dragNode),
      spin: find(modelConfig.spinNode),
    },
    materials: [...materials],
    dispose() {
      content.removeFromParent();
      root.traverse((obj) => {
        if (obj.isMesh) obj.geometry.dispose();
      });
      for (const m of materials) {
        for (const value of Object.values(m)) if (value?.isTexture) value.dispose();
        m.dispose();
      }
    },
  };
}
