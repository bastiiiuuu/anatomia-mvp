/* QA for the REAL local atlas. Requires existing Playwright + Chrome, no installation. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = process.env.PLAYWRIGHT_MODULE ? require(process.env.PLAYWRIGHT_MODULE) : require('playwright');
(async () => {
  const installedChrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const executablePath = process.env.BROWSER_EXECUTABLE || (fs.existsSync(installedChrome) ? installedChrome : undefined);
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.route('**/api/dev',route=>route.fulfill({json:{enabled:false,version:null}}));
  const errors = []; const modelRequests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (r.url().endsWith('.glb')) modelRequests.push(r.url()); });
  const settled = () => page.waitForFunction(() => !window.atlasDebug.state.flight&&!window.atlasDebug.state.loading,null,{timeout:60000});
  let metadata;
  const expected = (original, side='R') => metadata.structures.find(s => s.nombre_original === original && s.side === side).Mesh_ID;
  const search = async (q, id) => {
    await page.locator('#search').fill(q); await page.locator('.result').first().click(); await settled();
    assert.equal(await page.locator('#study-id').textContent(), id);
  };
  const visibleIds = () => page.evaluate(() => [...window.atlasDebug.entries.values()].filter(e => e.meshes.some(m=>m.visible)).map(e=>e.record.Mesh_ID));
  try {
    await page.goto('http://127.0.0.1:8000/?debug=1');
    await page.waitForFunction(() => window.atlasDebug?.state.ready, { timeout: 60000 });
    metadata = await (await page.request.get('http://127.0.0.1:8000/api/metadata')).json();
    assert.equal(metadata.model.source, 'z-anatomy-real');
    assert.ok(await page.locator('.structure-item').count()<=40);
    assert.equal(metadata.structures.length, 1373);
    assert.deepEqual(await page.evaluate(()=>window.atlasDebug.performance.snapshot().loadedAssets),['muscular']);
    await page.locator('[data-preset=all]').click();await settled();
    const geometry = await page.evaluate(() => [...window.atlasDebug.entries.values()].every(e => {
      const p = e.meshes[0].geometry.attributes.position.array;
      return !e.box.isEmpty() && p.every(Number.isFinite);
    }));
    assert.ok(geometry, 'All real IDs are bound to finite decoded geometry');
    const draws = await page.evaluate(() => {window.atlasDebug.renderNow();return window.atlasDebug.renderer.info.render.triangles;});
    assert.ok(draws > 600000, 'The GPU receives the actual skeleton triangles');
    await page.locator('[data-preset=muscles]').click();await settled();
    assert.ok(await page.evaluate(() => window.atlasDebug.state.muscleStudy), 'Muscle study is available without losing lazy-loaded layers');
    for (const [section, data] of Object.entries(metadata.model.muscle_sections)) {
      await page.locator('#muscle-section').selectOption(section); await settled();
      const visible = await visibleIds();
      assert.equal(visible.length, data.count, section + ' contains its complete source group');
      assert.ok(visible.every(id => metadata.structures.find(s=>s.Mesh_ID===id).study_section===section));
      assert.equal(await page.locator('.structure-item:visible').count(),Math.min(data.count,40));
      assert.ok((await page.locator('#filter-count').textContent()).startsWith(data.count+' coincidencias'));
    }
    await page.locator('#muscle-section').selectOption('shoulder'); await settled();
    await page.locator('#muscle-group').selectOption('rotator_cuff'); await settled();
    await page.locator('[data-side=L]').click(); await settled();
    assert.equal((await visibleIds()).length,4,'Left rotator cuff has four muscle structures');
    await page.locator('#section-context').selectOption('ghost');
    assert.ok(await page.evaluate(()=>[...window.atlasDebug.entries.values()].filter(e=>e.record.capa==='muscular'&&e.record.study_section!=='shoulder').every(e=>e.meshes.every(m=>m.visible&&Math.abs(m.material.opacity-.15)<.001))));
    await page.locator('#section-context').selectOption('hide');
    await page.locator(`.structure-item[data-mesh-id="${expected('Subscapularis muscle','L')}"]`).click(); await settled();
    assert.deepEqual(await visibleIds(),[expected('Subscapularis muscle','L')]);
    await page.locator('#return-section').click(); await settled();
    assert.equal((await visibleIds()).length,4,'Return restores the selected section, compartment and side');
    await page.locator('[data-side=both]').click(); await settled();
    await page.locator('#muscle-section').selectOption('all'); await settled();
    await page.locator('[data-preset=bones]').click(); await settled();
    await search('C4', expected('Vertebra C4','midline'));
    await search('CLAVÍCULA', expected('Clavicle'));
    await page.waitForFunction(() => !document.getElementById('wiki-status').textContent.includes('Consultando'));
    console.log('Wikipedia:', await page.locator('#wiki-status').textContent());
    await search('BÍCEPS BRAQUIAL', expected('Short head of biceps brachii'));
    assert.ok(await page.locator('[data-layer=muscular][type=checkbox]').isChecked());
    assert.deepEqual(await visibleIds(), [expected('Short head of biceps brachii')], 'Search automatically isolates one muscle');
    assert.ok((await page.locator('#study-innervation').textContent()).includes('musculocutáneo'));
    await page.locator('#auto-isolate-muscle').uncheck();
    assert.ok((await visibleIds()).length > 1, 'Auto isolate can be disabled');
    await page.locator('#auto-isolate-muscle').check();
    assert.deepEqual(await visibleIds(), [expected('Short head of biceps brachii')]);
    // List selection must use the same muscle auto-isolation path.
    await page.locator('#structure-filter').fill('recto femoral');
    await page.locator(`.structure-item[data-mesh-id="${expected('Rectus femoris muscle','L')}"]`).click(); await settled();
    assert.deepEqual(await visibleIds(), [expected('Rectus femoris muscle','L')]);
    await page.locator('#structure-filter').fill('');
    await search('CALCÁNEO', expected('Calcaneus'));
    assert.ok((await visibleIds()).length > 1, 'Selecting a bone exits automatic muscle isolation');
    await search('LCA', expected('Anterior cruciate ligament'));
    await page.locator('#isolate-mode').selectOption('xray'); await page.locator('#isolate').click();
    const ghost = await page.evaluate(() => [...window.atlasDebug.entries.values()].filter(e => e.record.Mesh_ID !== window.atlasDebug.state.selected&&e.meshes.some(m=>m.visible))
      .every(e => e.meshes.every(m => [].concat(m.material).every(mat => Math.abs(mat.opacity - .15) < .001))));
    assert.ok(ghost);
    await page.locator('#isolate-mode').selectOption('hide');
    assert.deepEqual(await visibleIds(), [expected('Anterior cruciate ligament')]);
    await page.locator('#hide-piece').click(); await page.waitForFunction(() => document.getElementById('floating-label').hidden);
    await page.locator('#hide-piece').click(); await page.locator('#reset-view').click(); await settled();
    for (const region of ['head_spine','thorax','upper','lower','all']) {
      await page.locator('#region-select').selectOption(region); await settled();
      assert.equal(await page.evaluate(() => window.atlasDebug.state.region),region);
      assert.ok(await page.locator('.structure-item:visible').count()>0);
    }
    await page.locator('#structure-filter').fill('C4'); await page.locator('#structure-filter').press('Enter'); await settled();
    assert.equal(await page.locator('#study-id').textContent(),expected('Vertebra C4','midline'));
    await page.locator('#structure-filter').fill('');
    await page.locator('[data-preset=bones]').click(); await settled();
    await page.locator('#region-select').selectOption('lower'); await settled();
    await page.locator('#front-view').click(); await settled();
    const point = await page.evaluate(id => {
      const {entries,camera} = window.atlasDebug; const box=entries.get(id).box;
      const p=box.min.clone().add(box.max).multiplyScalar(.5).project(camera); const r=document.querySelector('canvas').getBoundingClientRect();
      return {x:r.left+(p.x+1)/2*r.width,y:r.top+(1-p.y)/2*r.height};
    },expected('Femur'));
    await page.mouse.click(point.x,point.y);
    assert.equal(await page.locator('#study-id').textContent(),expected('Femur'),'Raycasting hits the real femoral shaft');
    // Verify automatic isolation also happens after an actual canvas click on a muscle.
    await page.locator('#region-select').selectOption('upper'); await settled();
    await page.locator('[data-preset=muscles]').click(); await settled();
    await page.locator('#front-view').click(); await settled();
    const musclePoint = await page.evaluate(() => {
      const {entries,camera}=window.atlasDebug;
      const e=[...entries.values()].find(e=>e.record.nombre_original==='Brachioradialis muscle'&&e.record.side==='R');
      const p=e.box.min.clone().add(e.box.max).multiplyScalar(.5).project(camera);const r=document.querySelector('canvas').getBoundingClientRect();
      return {x:r.left+(p.x+1)/2*r.width,y:r.top+(1-p.y)/2*r.height};
    });
    await page.mouse.click(musclePoint.x,musclePoint.y); await settled();
    const selected=await page.evaluate(()=>window.atlasDebug.state.selected);
    assert.ok(selected,'Click selects a muscle');
    assert.equal(metadata.structures.find(s=>s.Mesh_ID===selected).capa,'muscular');
    assert.deepEqual(await visibleIds(),[selected],'Canvas selection automatically isolates one muscle');
    await page.locator('#region-select').selectOption('all'); await settled();
    await page.locator('[data-preset=bones]').click(); await settled();
    await page.locator('#global-xray').click(); assert.equal(await page.evaluate(()=>window.atlasDebug.state.xray),true);
    await page.locator('#global-xray').click();
    await page.locator('[data-layer=oseo][type=checkbox]').uncheck({force:true});
    assert.ok(await page.evaluate(()=>[...window.atlasDebug.entries.values()].filter(e=>e.record.capa==='oseo').every(e=>e.meshes.every(m=>!m.visible))));
    await search('C4',expected('Vertebra C4','midline')); assert.ok(await page.locator('[data-layer=oseo][type=checkbox]').isChecked());
    await page.setViewportSize({width:390,height:844}); await page.waitForFunction(()=>document.querySelector('canvas').clientWidth<390);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const fitted=await page.evaluate(()=>{
      const {entries,camera,state}=window.atlasDebug;const box=entries.get(state.selected).box;
      for(const x of[box.min.x,box.max.x])for(const y of[box.min.y,box.max.y])for(const z of[box.min.z,box.max.z]){
        const p=box.min.clone().set(x,y,z).project(camera);if(Math.abs(p.x)>1||Math.abs(p.y)>1)return false;
      }return true;
    });assert.ok(fitted,'Selected real structure fits after portrait resize');
    await page.locator('#search').fill('xyzxyz');await page.locator('#results').getByText('No se encontraron estructuras.',{exact:false}).waitFor();
    await page.route('**/api/estructuras/*/wikipedia',async route=>{
      const first=route.request().url().includes(expected('Clavicle','L'));await new Promise(r=>setTimeout(r,first?300:20));
      await route.fulfill({json:{status:'ok',title:first?'Clavícula':'Calcáneo',extract:first?'Texto anterior':'Texto actual',url:'https://es.wikipedia.org/wiki/Calcáneo',license:'CC BY-SA 4.0',cached:false}}).catch(()=>{});
    });
    await page.evaluate(ids=>{window.atlasDebug.select(ids[0]);window.atlasDebug.select(ids[1]);},[expected('Clavicle','L'),expected('Calcaneus','L')]);
    await page.waitForFunction(()=>document.getElementById('wiki-extract').textContent==='Texto actual');await page.waitForTimeout(350);
    assert.equal(await page.locator('#wiki-extract').textContent(),'Texto actual');
    assert.equal(new Set(modelRequests).size,3,'Three local anatomy GLBs loaded');
    assert.ok(modelRequests.every(url=>url.startsWith('http://127.0.0.1:8000/static/models/')));
    assert.deepEqual(errors,[]);
    const batching=await page.evaluate(()=>{
      for(const batch of window.atlasDebug.batches.batches)for(const member of batch.members){
        const source=member.mesh.geometry;const i=source.index.getX(0);
        const expected=member.mesh.position.clone().fromBufferAttribute(source.attributes.position,i).applyMatrix4(member.mesh.matrixWorld);
        const j=batch.originalIndex[member.start],actual=expected.clone().fromBufferAttribute(batch.geometry.attributes.position,j);
        if(actual.distanceTo(expected)>1e-4)return false;
      }return true;
    });assert.ok(batching,'Baked world-space geometry preserves original node transforms, including mirrored anatomy');
    const masks=await page.evaluate(()=>{
      const a=window.atlasDebug;
      for(const batch of a.batches.batches)for(const [object,ghost] of [[batch.opaque,false],[batch.ghost,true]]){
        const members=batch.members.filter(m=>m.mesh.visible&&m.mesh.userData.anatomyId!==a.state.selected&&(m.mesh.userData.visualMode==='ghost')===ghost);
        const expected=members.reduce((n,m)=>n+m.count,0);
        if(!object){if(expected)return false;continue;}
        if(!!expected!==object.visible)return false;
        if(object.visible&&object.geometry.groups.reduce((n,g)=>n+g.count,0)!==expected)return false;
      }return true;
    });assert.ok(masks,'Sparse index ranges render precisely the visible opaque and ghost triangle sets');
    if(process.env.ATLAS_SCREENSHOT)await page.screenshot({path:process.env.ATLAS_SCREENSHOT,fullPage:false});
    console.log('PASS: real GLB/Draco, 1373 bindings, search, Wikipedia, camera, regions, raycasts, automatic muscle isolation on search/list/click, x-ray, hiding, filters and mobile.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
