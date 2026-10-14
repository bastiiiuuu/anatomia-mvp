/** One requestAnimationFrame chain, asleep when the camera is still. */
export class DemandFrames {
  constructor(draw, active=()=>false) {
    this.draw=draw;this.active=active;this.id=0;this.paused=false;this.disposed=false;
    this.stats={callbacks:0,frames:0};
    this.tick=now=>{
      this.id=0;if(this.paused||this.disposed)return;
      this.stats.callbacks++;const continuing=this.draw(now);
      if(continuing||this.active())this.request();
    };
  }
  request() {if(!this.id&&!this.paused&&!this.disposed)this.id=requestAnimationFrame(this.tick);}
  pause() {this.paused=true;if(this.id)cancelAnimationFrame(this.id);this.id=0;}
  resume() {this.paused=false;this.request();}
  dispose() {this.pause();this.disposed=true;}
}

export class AdaptiveResolution {
  constructor(renderer, stage, mobile) {
    this.renderer=renderer;this.stage=stage;this.mobile=mobile;this.mode='auto';
    this.ratio=1;this.samples=[];this.lastChange=0;this.lastTime=0;
    this.stats={resolutionChanges:0,frameMs:0,renderMs:0,frames:0};
    this.apply(this.ceiling());
    this.interactionRatio=this.ratio;this.interacting=false;
  }
  ceiling() {
    if(this.mode==='fast')return 1;
    const density=globalThis.devicePixelRatio||1;
    const cap=this.mobile?(this.mode==='sharp'?2:1.5):2;
    const pixels=Math.max(1,this.stage.clientWidth*this.stage.clientHeight);
    const pixelBudget=this.mobile?1_800_000:3_000_000;
    return Math.max(.75,Math.min(cap,this.mode==='sharp'?Math.max(density,1.5):density,Math.sqrt(pixelBudget/pixels)));
  }
  apply(ratio) {
    ratio=Math.round(ratio*100)/100;
    if(ratio===this.ratio&&this.renderer.getPixelRatio()===ratio)return;
    this.ratio=ratio;this.renderer.setPixelRatio(ratio);this.stats.resolutionChanges++;
  }
  setMode(mode) {
    this.mode=mode;this.samples.length=0;this.lastTime=0;this.interacting=false;
    this.apply(this.ceiling());this.interactionRatio=this.ratio;
  }
  resize() {
    const ceiling=this.ceiling();this.interactionRatio=Math.min(this.interactionRatio,ceiling);
    this.apply(this.mode==='auto'&&this.interacting?Math.min(this.ratio,ceiling):ceiling);
  }
  prepare(active) {
    if(this.mode!=='auto'||active===this.interacting)return false;
    const before=this.ratio;this.interacting=active;this.samples.length=0;this.lastTime=0;
    if(active)this.apply(Math.min(this.interactionRatio,this.ceiling()));
    else {
      // Keep the learned movement resolution, but restore detail in the last
      // still frame. This never starts a separate animation or timer.
      this.interactionRatio=this.ratio;this.apply(this.ceiling());
    }
    return before!==this.ratio;
  }
  sample(now,renderMs,active) {
    this.stats.frames++;this.stats.renderMs=renderMs;
    if(this.mode!=='auto'||!active){this.lastTime=0;return;}
    if(this.lastTime) {
      const interval=now-this.lastTime;
      if(interval>0&&interval<1000){this.samples.push(interval);if(this.samples.length>24)this.samples.shift();}
    }
    this.lastTime=now;
    if(this.samples.length<12||now-this.lastChange<800)return;
    const average=this.samples.reduce((a,b)=>a+b,0)/this.samples.length;
    this.stats.frameMs=average;
    if(average>22&&this.ratio>.8){this.apply(Math.max(.8,this.ratio-.2));this.lastChange=now;this.samples.length=0;}
    else if(average<18&&this.ratio<this.ceiling()){this.apply(Math.min(this.ceiling(),this.ratio+.1));this.lastChange=now;this.samples.length=0;}
  }
}
