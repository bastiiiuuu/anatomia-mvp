/* Real pointer clicks on a deep structure, through a translucent anatomical context. */
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-unsafe-swiftshader']});
  try {
    const page=await browser.newPage({viewport:{width:1024,height:768},hasTouch:true,isMobile:true,deviceScaleFactor:2});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/api/estructuras/*/wikipedia',r=>r.fulfill({json:{status:'unavailable',extract:'',license:'',message:'QA',url:'https://es.wikipedia.org'}}));
    await page.goto('http://127.0.0.1:8000/?debug=1');await page.waitForFunction(()=>window.atlasDebug?.state.ready,null,{timeout:90000});
    const settled=()=>page.waitForFunction(()=>!window.atlasDebug.state.loading&&!window.atlasDebug.state.flight,null,{timeout:60000});
    await page.locator('[data-preset=all]').click();await settled();
    const id=await page.evaluate(async()=>{
      const e=[...window.atlasDebug.entries.values()].find(e=>e.record.nombre_original==='Anterior cruciate ligament'&&e.record.side==='L');
      await window.atlasDebug.select(e.record.Mesh_ID,true);return e.record.Mesh_ID;
    });await settled();
    await page.locator('#toggle-study').click();await page.locator('#isolate-mode').selectOption('xray');await page.locator('#isolate').click();
    await page.locator('#study-panel [data-close-panel]').click();await settled();
    const target=await page.evaluate(id=>{
      const a=window.atlasDebug,e=a.entries.get(id),p=e.center.clone().project(a.camera),r=a.renderer.domElement.getBoundingClientRect();
      return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2,pieces:e.meshes.length};
    },id);
    const samples=[];
    for(let n=0;n<5;n++){
      await page.mouse.click(target.x,target.y);
      const result=await page.evaluate(()=>({selected:window.atlasDebug.state.selected,...window.atlasDebug.performance.snapshot()}));
      assert.equal(result.selected,id,'X-ray picking preserves the deep selected ligament');
      samples.push({ms:result.pickMs,meshes:result.testedMeshes});
    }
    if(!process.argv.includes('--baseline'))assert.ok(samples.every(s=>s.meshes<=target.pieces),'A hit on the isolated piece does not raycast the ghost body');
    const fallback=await page.evaluate(async()=>{
      const {Raycaster,Vector2}=await import('three');
      const a=window.atlasDebug,ray=new Raycaster(),rect=a.renderer.domElement.getBoundingClientRect();
      for(const [x,y] of [[.2,0],[-.2,0],[.4,.2],[-.4,.2],[0,.5],[.6,-.3]]) {
        ray.setFromCamera(new Vector2(x,y),a.camera);
        const selectedHits=[];
        for(const m of a.entries.get(a.state.selected).meshes)if(m.visible)m.raycast(ray,selectedHits);
        if(selectedHits.length)continue;
        const hits=[];
        for(const e of a.entries.values())for(const m of e.meshes)if(m.visible)m.raycast(ray,hits);
        hits.sort((a,b)=>a.distance-b.distance);
        if(hits.length)return {x:rect.left+(x+1)*rect.width/2,y:rect.top+(1-y)*rect.height/2,id:hits[0].object.userData.anatomyId};
      }
      return null;
    });
    assert.ok(fallback,'There is a visible context surface outside the selected ligament');
    await page.mouse.click(fallback.x,fallback.y);await settled();
    assert.equal(await page.evaluate(()=>window.atlasDebug.state.selected),fallback.id,'Missing the isolated piece still selects the closest context surface');
    assert.deepEqual(errors,[]);console.log(JSON.stringify({test:'deep X-ray pointer selection',id,selectedMeshCount:target.pieces,samples}));
  }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
