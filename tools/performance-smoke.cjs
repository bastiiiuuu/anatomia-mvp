const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-unsafe-swiftshader']});
  const context=await browser.newContext({viewport:{width:768,height:1024},deviceScaleFactor:3,hasTouch:true,isMobile:true});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.qaRafCallbacks=0;const raf=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=fn=>raf(t=>{window.qaRafCallbacks++;fn(t)});});
  await page.route('**/api/dev',r=>r.fulfill({json:{enabled:false,version:null}}));
  await page.route('**/api/estructuras/*/wikipedia',r=>r.fulfill({json:{status:'unavailable',message:'QA',extract:'',url:'https://es.wikipedia.org',license:''}}));
  try{
    const start=Date.now();await page.goto('http://127.0.0.1:8000/?debug=1');await page.waitForFunction(()=>window.atlasDebug?.state.ready,null,{timeout:90000});
    const readyMs=Date.now()-start;
    const metrics=await page.evaluate(()=>{
      const {renderer,entries}=window.atlasDebug;window.atlasDebug.renderNow();
      const materials=new Set(),geometries=new Set();for(const e of entries.values())for(const m of e.meshes){[].concat(m.material).forEach(x=>materials.add(x));geometries.add(m.geometry)}
      return {dpr:renderer.getPixelRatio(),drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,
        gpuGeometries:renderer.info.memory.geometries,materials:materials.size,sourceGeometries:geometries.size,domRows:document.querySelectorAll('.structure-item').length};
    });
    await page.waitForTimeout(300);const rafBefore=await page.evaluate(()=>window.qaRafCallbacks);await page.waitForTimeout(600);
    const idleCallbacks=await page.evaluate(before=>window.qaRafCallbacks-before,rafBefore);
    await page.locator('#toggle-explorer').click();await page.locator('#auto-isolate-muscle').uncheck();
    const colors=await page.evaluate(()=>{
      const a=window.atlasDebug;const id=[...a.entries.values()].find(e=>e.record.nombre_original==='Rectus femoris muscle'&&e.record.side==='L').record.Mesh_ID;
      const t=performance.now();a.select(id,false);const ms=performance.now()-t;
      return {id,selectionMs:ms,context:a.entries.get(id).meshes.map(m=>({color:m.material.color.getHexString(),emissive:m.material.emissive?.getHexString()}))};
    });
    await page.locator('#toggle-study').click();await page.locator('#isolate').click();
    const isolated=await page.evaluate(id=>window.atlasDebug.entries.get(id).meshes.map(m=>({color:m.material.color.getHexString(),emissive:m.material.emissive?.getHexString()})),colors.id);
    const report={readyMs,...metrics,idleCallbacks,...colors,isolated,diagnostics:await page.evaluate(()=>window.atlasDebug.performance?.snapshot?.()||null)};
    const baseline=process.argv.includes('--baseline');fs.writeFileSync(baseline?'artifacts/performance-before.json':'artifacts/performance-after.json',JSON.stringify(report,null,2));
    if(!baseline){
      assert.equal(idleCallbacks,0,'No animation callbacks are scheduled while idle');
      assert.ok(metrics.dpr<=1.5,'Automatic mobile DPR is capped at 1.5');
      assert.ok(metrics.domRows<=50,'The structure list is paged');
      assert.ok(metrics.materials<40,'Materials are pooled instead of cloned per mesh');
      assert.ok(colors.context.every(m=>m.color==='35cc83'),'Context selection is green');
      assert.ok(isolated.every(m=>m.color!=='35cc83'&&m.emissive==='000000'),'Isolation restores natural anatomy with no green emission');
    }
    if(!baseline){
      assert.ok(metrics.drawCalls<=25,'Full muscular view uses region batches');
      assert.ok(report.diagnostics.batches.vertexBytes<25000000,'Compact normals keep the original muscular batches under 25 MB of vertex arrays');
      assert.deepEqual(report.diagnostics.loadedAssets,['muscular'],'Unused layers are not decoded at startup');
      await page.locator('#isolate').click();
      assert.ok(await page.evaluate(id=>window.atlasDebug.entries.get(id).meshes.every(m=>m.material.color.getHexString()==='35cc83'),colors.id),'Leaving isolation immediately restores green');
      await page.locator('#isolate-mode').selectOption('xray');await page.locator('#isolate').click();
      assert.ok(await page.evaluate(id=>window.atlasDebug.entries.get(id).meshes.every(m=>m.material===m.userData.sourceMaterials[0]),colors.id),'X-ray also uses the exact original material');
      await page.evaluate(()=>window.atlasDebug.clear());
      assert.ok(await page.evaluate(()=>[...window.atlasDebug.entries.values()].every(e=>e.meshes.every(m=>m.material===m.userData.sourceMaterials[0]))),'Deselecting returns every mesh to its source material');
      await page.locator('#study-panel [data-close-panel]').click();
      await page.locator('#global-xray').click();
      await page.evaluate(id=>window.atlasDebug.select(id,false),colors.id);
      assert.ok(await page.evaluate(id=>{
        const a=window.atlasDebug;
        return a.state.isolated&&!a.state.xray&&document.getElementById('isolate-mode').value==='xray'&&a.entries.get(id).meshes.every(m=>m.material===m.userData.sourceMaterials[0]);
      },colors.id),'Selecting inside global X-ray restores the exact natural material, even with automatic isolation disabled');
      await page.locator('#global-xray').click();
      assert.ok(await page.evaluate(id=>{
        const a=window.atlasDebug;
        return !a.state.isolated&&!a.state.xray&&a.entries.get(id).meshes.every(m=>m.material.color.getHexString()==='35cc83');
      },colors.id),'One tap exits X-ray isolation and restores context green');
      await page.evaluate(()=>window.atlasDebug.clear());
      const beforePause=await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));return window.atlasDebug.performance.snapshot().frames.callbacks});
      await page.locator('#render-quality').selectOption('fast');await page.waitForTimeout(100);
      assert.equal(await page.evaluate(()=>window.atlasDebug.performance.snapshot().frames.callbacks),beforePause);
      await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
      await page.waitForFunction(before=>window.atlasDebug.performance.snapshot().frames.callbacks>before,beforePause);
      await page.evaluate(()=>window.atlasDebug.dispose());
      const disposed=await page.evaluate(()=>({diagnostics:window.atlasDebug.performance.snapshot(),gpu:window.atlasDebug.renderer.info.memory,entries:window.atlasDebug.entries.size}));
      assert.equal(disposed.entries,0);assert.equal(disposed.gpu.geometries,0);assert.equal(disposed.diagnostics.materials,0);assert.ok(disposed.diagnostics.disposed);
    }
    assert.deepEqual(errors,[]);console.log(JSON.stringify(report));
  }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
