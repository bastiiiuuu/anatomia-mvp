import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const COLORS = { oseo: 0xd9c9ab, articular: 0x64bcc4, muscular: 0xb96577, cartilago: 0x8ab4d0 };
const Y = new THREE.Vector3(0, 1, 0);
const vector = coordinates => new THREE.Vector3(...coordinates);
const sphere = new THREE.SphereGeometry(1, 18, 12);

function ellipsoid(center, scale) {
  return sphere.clone().scale(...scale).translate(...center);
}

function tube(points, radius, segments = 20) {
  const curve = new THREE.CatmullRomCurve3(points.map(vector));
  return new THREE.TubeGeometry(curve, Math.max(segments, points.length * 3), radius, 8, false);
}

function capsule(a, b, radius) {
  const first = vector(a); const last = vector(b);
  const direction = last.clone().sub(first); const distance = direction.length();
  if (distance < 1e-6) return ellipsoid(a, [radius, radius, radius]);
  const shape = new THREE.CapsuleGeometry(radius, Math.max(.001, distance - radius * 2), 4, 10);
  shape.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, direction.normalize()));
  shape.translate(...first.add(last).multiplyScalar(.5).toArray());
  return shape;
}

function extrude(recipe) {
  const shape = new THREE.Shape();
  recipe.outline.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y));
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: recipe.depth, bevelEnabled: true,
    bevelSegments: 1, steps: 1, bevelSize: .018, bevelThickness: .015, curveSegments: 6 });
  return geometry.translate(0, 0, recipe.z);
}

function skullPatch(recipe) {
  const positions = []; const uvs = []; const indices = [];
  const rows = 14; const cols = 18;
  for (let row = 0; row <= rows; row++) {
    const theta = THREE.MathUtils.lerp(...recipe.theta, row / rows);
    for (let col = 0; col <= cols; col++) {
      const phi = THREE.MathUtils.lerp(...recipe.phi, col / cols);
      positions.push(recipe.center[0] + recipe.scale[0] * Math.sin(theta) * Math.cos(phi),
        recipe.center[1] + recipe.scale[1] * Math.cos(theta),
        recipe.center[2] + recipe.scale[2] * Math.sin(theta) * Math.sin(phi));
      uvs.push(col / cols, row / rows);
      if (row < rows && col < cols) {
        const a = row * (cols + 1) + col; const b = a + cols + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

function vertebra(recipe) {
  const { y, z, radius: r, height: h, variant } = recipe;
  if (variant === 'atlas') {
    const ring = Array.from({ length: 25 }, (_, i) => {
      const angle = i / 24 * Math.PI * 2;
      return [Math.cos(angle) * .27, y, z - .14 + Math.sin(angle) * .23];
    });
    return [tube(ring, .045), ellipsoid([-.22, y, z - .09], [.08, .065, .11]),
      ellipsoid([.22, y, z - .09], [.08, .065, .11])];
  }
  const parts = [ellipsoid([0, y, z], [r, h / 2, r * .75]),
    tube([[-r * .72, y, z - .08], [-r * 1.15, y, z - .35], [0, y, z - .49],
      [r * 1.15, y, z - .35], [r * .72, y, z - .08]], .038),
    capsule([0, y, z - .43], [0, y - .035, z - .72], .04),
    capsule([-r * .7, y, z - .23], [-r * 1.75, y, z - .15], .033),
    capsule([r * .7, y, z - .23], [r * 1.75, y, z - .15], .033)];
  if (variant === 'axis') parts.push(capsule([0, y + h / 2, z], [0, y + .26, z], .065));
  return parts;
}

function muscle(recipe) {
  const a = vector(recipe.a); const b = vector(recipe.b);
  const direction = b.clone().sub(a); const length = direction.length();
  const orientation = new THREE.Quaternion().setFromUnitVectors(Y, direction.normalize());
  const middle = a.clone().add(b).multiplyScalar(.5);
  const body = sphere.clone().scale(recipe.width, length * .38, recipe.depth);
  body.applyQuaternion(orientation); body.translate(...middle.toArray());
  const parts = [body,
    capsule(a.toArray(), a.clone().lerp(b, .18).toArray(), recipe.width * .16),
    capsule(b.toArray(), b.clone().lerp(a, .18).toArray(), recipe.width * .16)];
  // Subtle geometric fiber ridges; no texture assets or texture downloads.
  for (const offset of [-.3, 0, .3]) {
    const local = new THREE.Vector3(recipe.width * offset, 0, recipe.depth * .87).applyQuaternion(orientation);
    const p = a.clone().lerp(b, .23).addScaledVector(local, .7);
    const q = middle.clone().add(local);
    const end = a.clone().lerp(b, .77).addScaledVector(local, .7);
    parts.push(tube([p.toArray(), q.toArray(), end.toArray()], .009, 10));
  }
  return parts;
}

function geometries(recipe) {
  switch (recipe.type) {
    case 'ellipsoid': return [ellipsoid(recipe.center, recipe.scale)];
    case 'tube': return [tube(recipe.points, recipe.radius)];
    case 'capsule': return [capsule(recipe.a, recipe.b, recipe.radius)];
    case 'extrude': return [extrude(recipe)];
    case 'shell': return [skullPatch(recipe)];
    case 'vertebra': return vertebra(recipe);
    case 'muscle': return muscle(recipe);
    default: throw new Error(`Generador paramétrico desconocido: ${recipe.type}`);
  }
}

export async function generateProceduralBody(metadata, progress = () => {}) {
  const root = new THREE.Group(); root.name = 'Cuerpo humano procedural';
  const groups = new Map();
  for (let i = 0; i < metadata.structures.length; i++) {
    const record = metadata.structures[i];
    const key = record.sistema + ':' + record.view_region;
    if (!groups.has(key)) {
      const group = new THREE.Group(); group.name = key; groups.set(key, group); root.add(group);
    }
    const parts = record.geometry.parts.flatMap(geometries);
    // Merge only parts belonging to THIS anatomical ID, reducing draw calls to ~one per structure.
    const normalized = parts.map(part => part.index ? part.toNonIndexed() : part);
    const geometry = mergeGeometries(normalized, false);
    if (!geometry) throw new Error(`No se pudo construir ${record.Mesh_ID}`);
    for (const part of new Set([...parts, ...normalized])) part.dispose();
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const material = new THREE.MeshStandardMaterial({ color: COLORS[record.capa] || 0x94abba,
      roughness: record.capa === 'oseo' ? .72 : .6, metalness: .02, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = record.nombre;
    mesh.userData.Mesh_ID = record.Mesh_ID;
    mesh.scale.x = record.geometry.mirror;
    groups.get(key).add(mesh);
    if (i % 24 === 0) {
      progress(Math.round((i + 1) / metadata.structures.length * 100));
      await new Promise(requestAnimationFrame);
    }
  }
  root.updateMatrixWorld(true);
  progress(100);
  return root;
}
