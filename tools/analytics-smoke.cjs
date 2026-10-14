const assert=require('node:assert/strict'),fs=require('node:fs');
const {execFileSync}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const config=JSON.parse(fs.readFileSync('static/analytics-config.json','utf8'));
  const ids=new Set(),errors=[];
  try{
    const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:8011/admin');await page.locator('#dashboard').waitFor({state:'visible'});
    await page.waitForFunction(()=>document.getElementById('views').textContent!=='—');
    assert.equal(await page.locator('#login').isVisible(),false);
    await page.screenshot({path:'artifacts/traffic-admin.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const root='https://bastiiiuuu.github.io/anatomia-mvp/';
    const client=await browser.newContext();const visitor=await client.newPage();
    visitor.on('pageerror',e=>errors.push(e.message));
    const minimal='<!doctype html><label><input id="traffic-opt-out" type="checkbox">Excluir</label><a id="traffic-admin" hidden></a><script type="module" src="./static/analytics.js"></script>';
    await visitor.route(root,r=>r.fulfill({contentType:'text/html',body:minimal}));
    await visitor.route(root+'static/analytics.js',r=>r.fulfill({contentType:'text/javascript',body:fs.readFileSync('static/analytics.js','utf8')}));
    await visitor.route(root+'static/analytics-config.json*',r=>r.fulfill({json:config}));
    visitor.on('request',r=>{if(r.url()===config.endpoint&&r.method()==='POST')ids.add(JSON.parse(r.postData()).id)});
    const collected=visitor.waitForResponse(r=>r.url()===config.endpoint&&r.request().method()==='POST');
    await visitor.goto(root);assert.equal((await collected).status(),204,'Real cross-origin browser traffic reaches the collector');
    const first=ids.size;await visitor.locator('#traffic-opt-out').check();await visitor.reload();await visitor.waitForTimeout(500);
    assert.equal(ids.size,first,'Opt-out is preserved across reload');
    assert.equal(await visitor.locator('#traffic-opt-out').isChecked(),true);
    await visitor.locator('#traffic-opt-out').uncheck();
    await visitor.waitForResponse(r=>r.url()===config.endpoint&&r.request().method()==='POST');
    assert.equal(ids.size,first+1,'Re-enabling statistics records the new page instance');
    await client.close();
    assert.deepEqual(errors,[]);
    console.log('PASS: private admin, phone layout, real HTTPS/CORS visit delivery, persistent opt-out.');
  }finally{
    await browser.close();
    // Delete only the explicitly tracked QA page instances, never real visitor data.
    if(ids.size)execFileSync('.venv/Scripts/python.exe',['-c','import sqlite3,json,sys\nwith sqlite3.connect("data/private/traffic.sqlite3") as db:\n for key in json.loads(sys.stdin.read()): db.execute("DELETE FROM visits WHERE id=?",(key,))'],{input:JSON.stringify([...ids])});
  }
})().catch(e=>{console.error(e);process.exitCode=1});
