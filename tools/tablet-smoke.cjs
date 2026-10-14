/* Real tablet layouts and touch gestures, using the already installed browser runtime. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-unsafe-swiftshader']});
  const context = await browser.newContext({viewport:{width:1024,height:768},deviceScaleFactor:2,hasTouch:true,isMobile:true});
  const page = await context.newPage(); const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/dev',route=>route.fulfill({json:{enabled:false,version:null}}));
  await page.route('**/api/estructuras/*/wikipedia',route=>route.fulfill({json:{status:'unavailable',message:'QA sin consulta externa',extract:'',url:'https://es.wikipedia.org',license:'CC BY-SA 4.0'}}));
  const settled=()=>page.waitForFunction(()=>!window.atlasDebug.state.flight&&!window.atlasDebug.state.loading,null,{timeout:60000});
  const fits=()=>page.evaluate(()=>{
    const {camera,entries,state}=window.atlasDebug;
    const targets=[...entries.values()].filter(e=>e.meshes.some(m=>m.visible&&[].concat(m.material).some(mat=>mat.opacity>.5)));
    return targets.length>0&&targets.every(e=>{
      for(const x of[e.box.min.x,e.box.max.x])for(const y of[e.box.min.y,e.box.max.y])for(const z of[e.box.min.z,e.box.max.z]){
        const p=e.box.min.clone().set(x,y,z).project(camera);if(Math.abs(p.x)>1||Math.abs(p.y)>1)return false;
      }return true;
    });
  });
  try {
    await page.goto('http://127.0.0.1:8000/?debug=1');
    await page.waitForFunction(()=>window.atlasDebug?.state.ready,{timeout:60000});
    await page.locator('#muscle-section').selectOption('thigh'); await settled();
    await page.locator('#muscle-group').selectOption('thigh_anterior'); await settled();
    await page.locator('[data-side=L]').tap(); await settled();
    await page.locator('#tablet-section').tap(); await settled();
    await page.locator('#toggle-explorer').tap();
    await page.waitForFunction(()=>document.getElementById('render-stage').clientWidth>950);
    assert.equal(await page.locator('#explorer-panel').isVisible(),false,'Landscape explorer can be collapsed');
    await page.locator('#toggle-explorer').tap(); await settled();
    assert.ok(await fits(),'All five left anterior thigh structures fit the landscape tablet');
    assert.equal(await page.evaluate(()=>[...window.atlasDebug.entries.values()].filter(e=>e.meshes.some(m=>m.visible)).length),5);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.locator('#render-quality').selectOption('sharp');
    assert.equal(await page.evaluate(()=>window.atlasDebug.renderer.getPixelRatio()),2);
    assert.ok(await page.evaluate(()=>{const c=document.querySelector('canvas');return c.width===c.clientWidth*2}),'Retina canvas uses real physical pixels');
    await page.screenshot({path:'artifacts/viewer-tablet-landscape.png',fullPage:false});
    await page.setViewportSize({width:768,height:1024}); await settled();
    await page.waitForFunction(()=>document.getElementById('render-stage').clientWidth>700);
    assert.ok(await fits(),'Portrait tablet keeps the entire section in view');
    assert.equal(await page.locator('#explorer-panel').isVisible(),false,'Portrait canvas is not squeezed by the explorer');
    await page.locator('#toggle-explorer').tap();
    assert.equal(await page.locator('#toggle-explorer').getAttribute('aria-expanded'),'true');
    await page.locator('#muscle-section').selectOption('head'); await settled();
    await page.locator('[data-side=both]').tap(); await settled();
    await page.locator('#tablet-section').tap(); await settled();
    assert.equal(await page.locator('#explorer-panel').isVisible(),false);
    assert.ok(await fits(),'Head section fits without overlap with controls');
    await page.screenshot({path:'artifacts/viewer-tablet-portrait.png',fullPage:false});
    // Use real touch input, rather than only assuming OrbitControls responds to it.
    const cdp=await context.newCDPSession(page);const canvas=await page.locator('canvas').boundingBox();
    const cx=canvas.x+canvas.width/2,cy=canvas.y+canvas.height/2;
    const before=await page.evaluate(()=>window.atlasDebug.camera.position.distanceTo(window.atlasDebug.controls.target));
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:cx-40,y:cy,id:1},{x:cx+40,y:cy,id:2}]});
    for(const d of[50,65,80])await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:cx-d,y:cy,id:1},{x:cx+d,y:cy,id:2}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForFunction(before=>window.atlasDebug.camera.position.distanceTo(window.atlasDebug.controls.target)<before*.9,before);
    await page.locator('#tablet-section').tap(); await settled();
    await page.locator('#toggle-explorer').tap();
    await page.locator('#structure-filter').fill('palpebral');
    await page.locator('.structure-item:visible').first().tap(); await settled();
    assert.equal(await page.locator('#explorer-panel').isVisible(),false,'Selection frees the viewport');
    const visible=await page.evaluate(()=>[...window.atlasDebug.entries.values()].filter(e=>e.meshes.some(m=>m.visible)).length);
    assert.equal(visible,1);assert.ok(await fits(),'The tiny selected eye muscle is framed in detail');
    await page.locator('#toggle-study').tap();assert.equal(await page.locator('#study-panel').isVisible(),true);
    await page.locator('#hide-piece').tap();
    assert.ok(await page.evaluate(()=>[...window.atlasDebug.entries.values()].filter(e=>e.meshes.some(m=>m.visible)).length>1),'Hiding an automatically isolated muscle restores the other section pieces');
    await page.locator('#study-panel [data-close-panel]').tap();
    await page.locator('#toggle-explorer').tap();await page.locator('#restore-section').tap();
    assert.ok(await page.locator('#restore-section').isHidden());
    await page.locator('#structure-filter').fill('palpebral');await page.locator('.structure-item:visible').first().tap();await settled();
    await page.locator('#toggle-study').tap();
    await page.locator('#isolate-mode').selectOption('xray');
    assert.ok(await page.evaluate(()=>[...window.atlasDebug.entries.values()].filter(e=>e.meshes.some(m=>m.visible&&m.material.opacity===.15)).length>10));
    await page.locator('#study-panel [data-close-panel]').tap();
    await page.locator('#return-section').tap();await settled();
    assert.ok(await fits());
    await page.locator('#render-quality').selectOption('fast');assert.equal(await page.evaluate(()=>window.atlasDebug.renderer.getPixelRatio()),1);
    await page.setViewportSize({width:390,height:844});await settled();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.ok(await fits(),'Phone also keeps the section inside the canvas');
    assert.deepEqual(errors,[]);
    console.log('PASS: tablet landscape/portrait, real retina resolution, section/group/side, sheet panels, pinch zoom, eye muscle selection, ghost context, return to section and phone layout.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
