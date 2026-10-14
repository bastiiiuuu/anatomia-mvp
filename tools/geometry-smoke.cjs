const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-unsafe-swiftshader']});
  try {
    const page=await browser.newPage({viewport:{width:768,height:1024},hasTouch:true,isMobile:true});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:8000/?debug=1');await page.waitForFunction(()=>window.atlasDebug?.state.ready,null,{timeout:90000});
    await page.locator('[data-preset=all]').click();await page.waitForFunction(()=>!window.atlasDebug.state.loading&&!window.atlasDebug.state.flight);
    const precision=await page.evaluate(async()=>{
      const THREE=await import('three');let samples=0,maxNormalError=0,maxPositionError=0,normalBytes=0;
      const expected=new THREE.Vector3(),actual=new THREE.Vector3(),normalMatrix=new THREE.Matrix3();
      for(const batch of window.atlasDebug.batches.batches) {
        const normals=batch.geometry.attributes.normal;
        if(!(normals.array instanceof Int16Array)||!normals.normalized)throw new Error('Normals must use normalized signed shorts');
        normalBytes+=normals.array.byteLength;
        for(const member of batch.members) {
          const source=member.mesh.geometry,offset=batch.originalIndex[member.start]-source.index.getX(0);
          normalMatrix.getNormalMatrix(member.mesh.matrixWorld);
          for(let i=0;i<source.attributes.position.count;i+=Math.max(1,Math.floor(source.attributes.position.count/64))) {
            expected.fromBufferAttribute(source.attributes.normal,i).applyMatrix3(normalMatrix).normalize();
            actual.fromBufferAttribute(normals,offset+i);maxNormalError=Math.max(maxNormalError,actual.distanceTo(expected));
            expected.fromBufferAttribute(source.attributes.position,i).applyMatrix4(member.mesh.matrixWorld);
            actual.fromBufferAttribute(batch.geometry.attributes.position,offset+i);maxPositionError=Math.max(maxPositionError,actual.distanceTo(expected));samples++;
          }
        }
      }
      return {samples,maxNormalError,maxPositionError,normalBytes};
    });
    assert.ok(precision.samples>10000);assert.ok(precision.maxNormalError<.00003,'Normal quantization stays below the signed-short precision bound');
    assert.ok(precision.maxPositionError<.00001,'Original anatomical surfaces and mirrored transforms remain exact within Float32 precision');
    const cancellation=await page.evaluate(async()=>{
      const THREE=await import('three'),{AnatomyBatches}=await import('/static/batch-renderer.js');
      const {AnatomyMaterials}=await import('/static/materials.js');
      const scene=new THREE.Scene(),pool=new AnatomyMaterials(),material=pool.register(new THREE.MeshStandardMaterial());
      const entries=new Map();
      for(const id of ['a','b']) {
        const mesh=new THREE.Mesh(new THREE.BoxGeometry(),material);mesh.updateMatrixWorld();
        mesh.userData.sourceMaterials=[material];mesh.userData.worldBox=new THREE.Box3().setFromObject(mesh);
        entries.set(id,{record:{capa:'muscular',study_section:id},meshes:[mesh]});
      }
      const batches=new AnatomyBatches(scene,pool),add=scene.add.bind(scene);
      scene.add=(object)=>{add(object);queueMicrotask(()=>batches.dispose());return scene};
      let timer;
      const outcome=await Promise.race([
        batches.build(entries).then(()=>'unexpected completion',error=>error.name),
        new Promise(resolve=>{timer=setTimeout(()=>resolve('hung'),2500)})
      ]);clearTimeout(timer);
      const result={outcome,children:scene.children.length,pending:batches.pending.size,batches:batches.batches.length};
      batches.dispose();pool.dispose();for(const e of entries.values())e.meshes[0].geometry.dispose();return result;
    });
    assert.deepEqual(cancellation,{outcome:'AbortError',children:0,pending:0,batches:0},'Disposing between worker batches rejects promptly and leaves no geometry behind');
    assert.deepEqual(errors,[]);console.log(JSON.stringify({precision,cancellation}));
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
