/* Verify real Pages path semantics without a Python server; optionally test the live site. */
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
  const root=path.resolve(__dirname,'..');let server;
  let url=process.env.ATLAS_PUBLIC_URL;
  if(!url){
    server=http.createServer((req,res)=>{
      const pathname=new URL(req.url,'http://localhost').pathname;
      if(pathname==='/anatomia-mvp'){res.writeHead(301,{Location:'/anatomia-mvp/'});return res.end();}
      if(!pathname.startsWith('/anatomia-mvp/')){res.writeHead(404);return res.end();}
      let relative=decodeURIComponent(pathname.slice('/anatomia-mvp/'.length))||'index.html';
      const file=path.resolve(root,relative);
      if(!file.startsWith(root+path.sep)||!['static','site-data','index.html','.nojekyll'].includes(relative.split('/')[0])||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
      const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.glb':'model/gltf-binary'};
      res.writeHead(200,{'Content-Type':types[path.extname(file)]||'text/plain','Content-Length':fs.statSync(file).size});fs.createReadStream(file).pipe(res);
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));url=`http://127.0.0.1:${server.address().port}/anatomia-mvp/`;
  }
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-unsafe-swiftshader']});
  const context=await browser.newContext({viewport:{width:768,height:1024},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await context.newPage();const errors=[],requests=[],bad=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  page.on('response',r=>{if(r.status()>=400&&new URL(r.url()).origin===new URL(url).origin)bad.push({url:r.url(),status:r.status()});});
  // CORS is tested by a real successful browser fetch after deployment; keep anatomy QA deterministic.
  await page.route('https://es.wikipedia.org/w/api.php?*',route=>route.fulfill({json:{query:{pages:[{title:'Músculo orbicular del ojo',extract:'Resumen enciclopédico de prueba.',fullurl:'https://es.wikipedia.org/wiki/Músculo_orbicular_del_ojo',revisions:[{revid:123}]}]}}}));
  const settled=()=>page.waitForFunction(()=>!window.atlasDebug.state.flight&&!window.atlasDebug.state.loading,null,{timeout:90000});
  try {
    await page.goto(url+'?debug=1');await page.waitForFunction(()=>window.atlasDebug?.state.ready,null,{timeout:90000});
    assert.equal(await page.locator('html').getAttribute('data-runtime'),'static');
    assert.equal(await page.evaluate(()=>window.atlasDebug.entries.size),1373);
    await page.locator('#region-select').selectOption('muscle:head');await settled();
    assert.equal(await page.evaluate(()=>window.atlasDebug.state.section),'head');
    await page.locator('#search').fill('palpebral');await page.locator('.result').first().click();await settled();
    await page.waitForFunction(()=>!document.getElementById('study-description').textContent.includes('Cargando'));
    assert.ok((await page.locator('#study-name').textContent()).toLowerCase().includes('palpebral'));
    assert.equal(await page.evaluate(()=>[...window.atlasDebug.entries.values()].filter(e=>e.meshes.some(m=>m.visible)).length),1);
    assert.ok(await page.evaluate(()=>[...window.atlasDebug.entries.values()].filter(e=>e.record.Mesh_ID===window.atlasDebug.state.selected).every(e=>e.meshes.every(m=>m.material===m.userData.sourceMaterials[0]))));
    await page.waitForFunction(()=>document.getElementById('wiki-extract').textContent==='Resumen enciclopédico de prueba.');
    await page.locator('#toggle-study').tap();await page.locator('#isolate').tap();
    assert.ok(await page.evaluate(()=>window.atlasDebug.entries.get(window.atlasDebug.state.selected).meshes.every(m=>m.material.color.getHexString()==='35cc83')));
    await page.locator('#isolate-mode').selectOption('xray');await page.locator('#isolate').tap();
    await page.locator('#study-panel [data-close-panel]').tap();
    await page.waitForFunction(()=>!document.getElementById('floating-label').hidden);
    assert.ok(await page.locator('#label-connector').isVisible());
    await page.screenshot({path:'artifacts/viewer-public-tablet.png',fullPage:false});
    await page.locator('[data-preset=bones]').tap();await settled();
    await page.locator('#search').fill('C4');await page.locator('.result').first().click();await settled();
    assert.ok((await page.locator('#study-name').textContent()).includes('C4'));
    await page.locator('[data-preset=joints]').tap();await settled();
    assert.equal(new Set(requests.filter(r=>new URL(r).pathname.endsWith('.glb')).map(r=>new URL(r).pathname)).size,3);
    assert.ok(!requests.some(r=>new URL(r).pathname.includes('/api/')),'Pages never requests the local backend');
    assert.deepEqual(bad,[]);assert.deepEqual(errors,[]);
    console.log('PASS: static publication at '+url+'; 1373 structures, real GLBs/Draco/worker, local fiches, Wikipedia adapter, tablet, selection colors and relative paths.');
  }finally{await browser.close();if(server)await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1});
