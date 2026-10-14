const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
  const source=fs.readFileSync('static/label-layout.js','utf8');
  const {placeLabel}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const bounds={left:10,right:990,top:20,bottom:780},pin={x:500,y:400},output={};
  const anatomy={left:300,right:600,top:250,bottom:600};
  assert.equal(placeLabel(bounds,anatomy,pin,200,60,output),output,'Output object is reused');
  assert.ok(output.x>anatomy.right,'Fits beside anatomy');
  placeLabel(bounds,{...anatomy,right:950},pin,200,60,output);
  assert.ok(output.x+200<anatomy.left,'Moves left when the right edge is blocked');
  placeLabel(bounds,{left:80,right:960,top:200,bottom:600},pin,200,60,output);
  assert.ok(output.y+60<200,'Moves above a wide structure');
  placeLabel(bounds,{left:80,right:960,top:40,bottom:600},pin,200,60,output);
  assert.ok(output.y>600,'Uses space below when the top is blocked');
  // Narrow phone: covering the tapered end is better than covering the center.
  placeLabel({left:10,right:370,top:165,bottom:700},{left:160,right:220,top:200,bottom:670},{x:190,y:435},222,59,output);
  assert.equal(output.y,165);
  // A zoomed or off-screen structure must not push the label outside the canvas.
  for(let i=0;i<100;i++){
    const p={x:i*10,y:i*8};
    placeLabel(bounds,{left:-100,right:1200,top:-200,bottom:1000},p,200,60,output);
    assert.ok(Number.isFinite(output.x)&&Number.isFinite(output.y));
    assert.ok(output.x>=10&&output.x+200<=990&&output.y>=20&&output.y+60<=780);
  }
  placeLabel(bounds,{left:NaN,right:Infinity,top:-Infinity,bottom:NaN},pin,200,60,output);
  assert.ok(Number.isFinite(output.x)&&Number.isFinite(output.y),'A corner on the camera plane does not break label placement');
  console.log('PASS: labels avoid anatomy where possible and stay within the canvas when zoomed.');
})().catch(error=>{console.error(error);process.exit(1)});
