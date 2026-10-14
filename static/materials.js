import * as THREE from 'three';

export const SELECTION_GREEN = 0x35cc83;

/** Immutable variants shared by every mesh with the same source material. */
export class AnatomyMaterials {
  constructor() {
    this.sources = new Set();
    this.variants = new Map();
  }

  register(material) {
    this.sources.add(material);
    // One pass is sufficient for translucent anatomical context, including mirrored meshes.
    material.forceSinglePass = true;
    return material;
  }

  get(source, mode) {
    if (mode === 'natural') return source;
    const key = `${source.uuid}:${mode}`;
    let material = this.variants.get(key);
    if (!material) {
      material = source.clone();
      material.forceSinglePass = true;
      if (mode === 'ghost') {
        material.opacity = source.opacity * .15;
        material.transparent = true;
        material.depthWrite = false;
      } else if (mode === 'selected') {
        material.color.setHex(SELECTION_GREEN);
        // A green base color is unmistakable; adding green emission washes out fibers.
        material.emissive?.setHex(0x000000);
        material.emissiveIntensity = 0;
      }
      this.variants.set(key, material);
    }
    return material;
  }

  dispose() {
    const textures = new Set();
    for (const material of [...this.sources, ...this.variants.values()]) {
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      material.dispose();
    }
    for (const texture of textures) { texture.dispose(); texture.source?.data?.close?.(); }
    this.sources.clear(); this.variants.clear();
  }
}

/** Selection is green only in context. Isolation always uses the exact source material. */
export function visualMode({ selected, isolated, context }) {
  if (selected) return isolated ? 'natural' : 'selected';
  return context ? 'ghost' : 'natural';
}
