const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:768,height:1024},hasTouch:true,deviceScaleFactor:3});
  try{
    await page.route('**/api/dev',r=>r.fulfill({json:{enabled:false}}));
    await page.addInitScript(()=>{const raf=requestAnimationFrame;window.qaOperations=[];window.qaFrames=[];window.requestAnimationFrame=callback=>raf(now=>{window.qaOperations=[];callback(now);if(window.qaOperations.length)window.qaFrames.push(window.qaOperations.slice());});});
    await page.goto('http://127.0.0.1:8000/?debug=1');await page.waitForFunction(()=>atlasDebug.state.ready,null,{timeout:60000});
    await page.evaluate(()=>{
      const r=atlasDebug.renderer,draw=r.render.bind(r),resize=r.setPixelRatio.bind(r);
      r.render=(...args)=>{qaOperations.push('draw');return draw(...args)};
      r.setPixelRatio=(...args)=>{qaOperations.push('resize');return resize(...args)};
      // Force the adaptive sampler to observe slow frames during the next orbit.
      const q=atlasDebug.resolution,sample=q.sample.bind(q);q.sample=(now,ms,active)=>{
        if(active&&q.ratio>1){q.samples=Array(24).fill(35);q.lastChange=-10000;q.lastTime=now-35;}
        return sample(now,ms,active);
      };
    });
    await page.locator('#back-view').click();await page.waitForFunction(()=>!atlasDebug.state.flight);
    const frames=await page.evaluate(()=>qaFrames);
    const changes=frames.filter(ops=>ops.includes('resize'));
    assert.ok(changes.length>=2,'The test forces actual resolution changes while rotating');
    assert.ok(changes.every(ops=>ops.at(-1)==='draw'),'Every framebuffer resize is followed by drawing before presentation');
    console.log('PASS: '+changes.length+' forced quality changes, no frame cleared after drawing.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
