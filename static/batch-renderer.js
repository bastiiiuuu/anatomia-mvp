import * as THREE from 'three';

const nextTask = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * Static, indexed anatomy merged into region/material batches. Works in WebGL2
 * without multi-draw extensions. Original meshes remain CPU-only for exact picking.
 * Visibility changes pack triangle ranges; vertices and medical identities stay exact.
 */
export class AnatomyBatches {
  constructor(scene, materials) {
    this.scene = scene; this.materials = materials;
    this.batches = []; this.details = []; this.detailSources = [];
    const workerUrl=new URL('./batch-worker.js',import.meta.url);workerUrl.search=new URL(import.meta.url).search;
    this.worker=new Worker(workerUrl);this.pending=new Map();this.sequence=0;
    this.worker.onmessage=({data})=>{const pending=this.pending.get(data.id);if(!pending)return;this.pending.delete(data.id);if(data.error)pending.reject(new Error(data.error));else pending.resolve(data)};
    this.worker.onerror=error=>{for(const pending of this.pending.values())pending.reject(new Error(error.message));this.pending.clear()};
    this.stats = { sourceMeshes: 0, batches: 0, vertexBytes: 0, indexBytes: 0 };
  }

  async build(entries) {
    const groups = new Map();
    for (const entry of entries.values()) for (const mesh of entry.meshes) {
      if(mesh.userData.batchAssigned)continue;
      const geometry = mesh.geometry;
      // Preserve unusual/skinned/multi-material geometries using individual detail meshes.
      if (mesh.isSkinnedMesh || geometry.morphAttributes.position?.length || Array.isArray(mesh.material) || !geometry.index) {
        mesh.userData.unbatched = true; continue;
      }
      const textured = Object.values(mesh.material).some(value => value?.isTexture);
      const attributes = Object.keys(geometry.attributes).filter(key => textured || !key.startsWith('uv')).sort();
      mesh.userData.batchAttributes = attributes;
      const signature = attributes.map(key => `${key}:${geometry.attributes[key].itemSize}`).join('|');
      const region = entry.record.study_section || entry.record.view_region;
      const key = `${mesh.material.uuid}:${entry.record.capa}:${region}:${signature}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(mesh); this.stats.sourceMeshes++;
    }
    for (const meshes of groups.values()) {
      const result=await this.prepare(meshes);
      const geometry=new THREE.BufferGeometry();
      for(const [key,a] of Object.entries(result.attributes)) {
        geometry.setAttribute(key,new THREE.BufferAttribute(a.array,a.itemSize));this.stats.vertexBytes+=a.array.byteLength;
      }
      const IndexArray=result.index.constructor,originalIndex=result.index;
      const members=meshes.map((mesh,i)=>({...result.ranges[i],mesh}));
      const index=new THREE.BufferAttribute(new IndexArray(originalIndex.length),1).setUsage(THREE.DynamicDrawUsage);
      geometry.setIndex(index);geometry.setDrawRange(0,0);
      geometry.boundingBox=new THREE.Box3(new THREE.Vector3(...result.min),new THREE.Vector3(...result.max));
      geometry.boundingSphere=geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
      const opaque=new THREE.Mesh(geometry,meshes[0].userData.sourceMaterials[0]);
      opaque.name='Lote anatómico';opaque.matrixAutoUpdate=false;opaque.visible=false;
      const batch={geometry,opaque,ghost:null,sourceMaterial:meshes[0].userData.sourceMaterials[0],originalIndex,members,IndexArray,signature:null};
      this.batches.push(batch);this.scene.add(opaque);
      for(const mesh of meshes)mesh.userData.batchAssigned=true;
      this.stats.indexBytes+=originalIndex.byteLength+index.array.byteLength;
      await nextTask();
    }
    this.stats.batches=this.batches.length;
  }

  prepare(meshes) {
    const normal=new THREE.Matrix3(),transfer=[];
    const input=meshes.map(mesh=>{
      const attributes={};
      for(const key of mesh.userData.batchAttributes) {
        const a=mesh.geometry.attributes[key];let array;
        if(!a.isInterleavedBufferAttribute&&!a.normalized&&a.array instanceof Float32Array)array=a.array.slice();
        else {array=new Float32Array(a.count*a.itemSize);for(let i=0;i<a.count;i++)for(let j=0;j<a.itemSize;j++)array[i*a.itemSize+j]=a.getComponent(i,j);}
        attributes[key]={array,itemSize:a.itemSize,count:a.count};transfer.push(array.buffer);
      }
      const index=mesh.geometry.index.array.slice();transfer.push(index.buffer);normal.getNormalMatrix(mesh.matrixWorld);
      return {attributes,index,matrix:mesh.matrixWorld.elements.slice(),normal:normal.elements.slice(),reflected:mesh.matrixWorld.determinant()<0};
    });
    const id=++this.sequence;
    return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.worker.postMessage({id,meshes:input},transfer)});
  }

  ghostFor(batch) {
    if(batch.ghost)return batch.ghost;
    const geometry=new THREE.BufferGeometry();
    for(const [key,a] of Object.entries(batch.geometry.attributes))geometry.setAttribute(key,a);
    geometry.boundingBox=batch.geometry.boundingBox;geometry.boundingSphere=batch.geometry.boundingSphere;
    geometry.setIndex(new THREE.BufferAttribute(new batch.IndexArray(batch.originalIndex.length),1).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0,0);
    const ghost=new THREE.Mesh(geometry,this.materials.get(batch.sourceMaterial,'ghost'));
    ghost.matrixAutoUpdate=false;ghost.visible=false;ghost.renderOrder=-1;
    batch.ghost=ghost;this.scene.add(ghost);return ghost;
  }

  /** Upload only index ranges changed by selection/visibility; never rebuild vertices. */
  update(entries, selectedId) {
    const nextSources=[];
    for(const entry of entries.values())for(const mesh of entry.meshes) {
      if(mesh.visible&&(entry.record.Mesh_ID===selectedId||mesh.userData.unbatched))nextSources.push(mesh);
    }
    const detailChanged=nextSources.length!==this.detailSources.length||nextSources.some((m,i)=>m!==this.detailSources[i]);
    if(detailChanged) {
      const previous=new Set(this.detailSources.map(m=>m.geometry));
      const current=new Set(nextSources.map(m=>m.geometry));
      for(const detail of this.details)this.scene.remove(detail);
      this.details=nextSources.map(source=>{
        const detail=new THREE.Mesh(source.geometry,source.material);
        detail.matrixAutoUpdate=false;detail.matrix.copy(source.matrixWorld);detail.matrixWorld.copy(source.matrixWorld);
        detail.name=source.name;detail.userData.anatomyId=source.userData.anatomyId;
        this.scene.add(detail);return detail;
      });
      // dispose releases only the source geometry's previous GPU buffers; its exact CPU arrays remain for raycasting.
      for(const geometry of previous)if(!current.has(geometry))geometry.dispose();
      this.detailSources=nextSources;
    }else this.details.forEach((detail,i)=>{detail.material=nextSources[i].material});
    for(const batch of this.batches) {
      const visible=batch.members.filter(m=>m.mesh.visible&&m.mesh.userData.anatomyId!==selectedId);
      const signature=visible.map(m=>`${m.start}:${m.mesh.userData.visualMode}`).join(',');
      if(signature===batch.signature)continue;
      batch.signature=signature;
      let opaqueCount=0,ghostCount=0;
      for(const member of visible)if(member.mesh.userData.visualMode==='ghost')ghostCount+=member.count;else opaqueCount+=member.count;
      const opaqueIndex=batch.geometry.index;
      let opaqueOffset=0,ghostOffset=0;let ghostIndex=null;
      if(ghostCount) {
        const ghost=this.ghostFor(batch);
        ghostIndex=ghost.geometry.index;
      }
      for(const member of visible) {
        const range=batch.originalIndex.subarray(member.start,member.start+member.count);
        if(member.mesh.userData.visualMode==='ghost'){ghostIndex.array.set(range,ghostOffset);ghostOffset+=member.count;}
        else{opaqueIndex.array.set(range,opaqueOffset);opaqueOffset+=member.count;}
      }
      opaqueIndex.clearUpdateRanges();if(opaqueCount)opaqueIndex.addUpdateRange(0,opaqueCount);opaqueIndex.needsUpdate=true;
      batch.geometry.setDrawRange(0,opaqueCount);batch.opaque.visible=opaqueCount>0;
      if(batch.ghost){
        if(ghostIndex){ghostIndex.clearUpdateRanges();ghostIndex.addUpdateRange(0,ghostCount);ghostIndex.needsUpdate=true;}
        batch.ghost.geometry.setDrawRange(0,ghostCount);batch.ghost.visible=ghostCount>0;
      }
    }
  }

  dispose() {
    this.worker.terminate();for(const pending of this.pending.values())pending.reject(new DOMException('Viewer disposed','AbortError'));this.pending.clear();
    for(const detail of this.details)this.scene.remove(detail);
    for(const batch of this.batches) {
      this.scene.remove(batch.opaque);batch.geometry.dispose();
      if(batch.ghost){this.scene.remove(batch.ghost);batch.ghost.geometry.dispose();}
    }
    this.batches.length=0;this.details.length=0;this.detailSources.length=0;
  }
}
