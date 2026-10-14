// One anonymous page instance. No search terms, muscle selection or identifiers
// from other websites are sent. This module never touches the WebGL frame loop.
const optOutKey='atlas-traffic-opt-out';
const toggle=document.getElementById('traffic-opt-out');
const admin=document.getElementById('traffic-admin');
const privacySignal=navigator.globalPrivacyControl===true||navigator.doNotTrack==='1';
let optedOut=privacySignal;
try{optedOut ||= localStorage.getItem(optOutKey)==='1';}catch{}
if(toggle){toggle.checked=optedOut;toggle.disabled=privacySignal;}
let endpoint,timer,request,failures=0,stopped=false;
const id=globalThis.crypto?.randomUUID?.();
const device=navigator.maxTouchPoints>0?(Math.max(screen.width,screen.height)>=1024?'Tablet':'Móvil'):'Escritorio';
const eligible=!!id&&location.origin==='https://bastiiiuuu.github.io'&&location.pathname.replace(/\/$/,'')==='/anatomia-mvp'&&!new URLSearchParams(location.search).has('debug');
async function send(){
  clearTimeout(timer);
  if(!endpoint||!eligible||optedOut||document.hidden||stopped||request)return;
  request=new AbortController();const timeout=setTimeout(()=>request?.abort(),5000);
  try{const response=await fetch(endpoint,{method:'POST',mode:'cors',credentials:'omit',keepalive:true,
    headers:{'Content-Type':'text/plain','ngrok-skip-browser-warning':'atlas-traffic'},
    body:JSON.stringify({id,path:'/anatomia-mvp/',device,referrer:document.referrer?new URL(document.referrer).origin:''}),signal:request.signal});
    if(response.status!==204)throw new Error('Traffic unavailable');failures=0;
  }catch{failures++;}finally{clearTimeout(timeout);request=null;if(!optedOut&&!stopped&&!document.hidden&&failures<3)timer=setTimeout(send,30000*Math.max(1,failures));}
}
toggle?.addEventListener('change',()=>{optedOut=toggle.checked;try{localStorage.setItem(optOutKey,optedOut?'1':'0');}catch{}clearTimeout(timer);if(optedOut)request?.abort();else{failures=0;send();}});
document.addEventListener('visibilitychange',()=>{clearTimeout(timer);if(!document.hidden)send();else request?.abort();},{passive:true});
window.addEventListener('pagehide',()=>{stopped=true;clearTimeout(timer);request?.abort();},{passive:true});
window.addEventListener('pageshow',event=>{if(event.persisted){stopped=false;send();}},{passive:true});
async function init(){
  try{const base=new URL('../',import.meta.url),build=document.documentElement.dataset.build||'';
    const response=await fetch(new URL('static/analytics-config.json?v='+encodeURIComponent(build),base),{signal:AbortSignal.timeout(4000)});
    if(!response.ok)return;const config=await response.json();if(!config.enabled)return;
    const url=new URL(config.endpoint);if(url.protocol!=='https:')return;endpoint=url.href;
    if(admin){admin.href=['localhost','127.0.0.1'].includes(location.hostname)?'http://127.0.0.1:8011/admin':new URL('/admin',url).href;admin.hidden=false;}
    send();
  }catch{/* Statistics must never prevent anatomy from loading. */}
}
if(document.readyState==='complete')init();else window.addEventListener('load',init,{once:true});
