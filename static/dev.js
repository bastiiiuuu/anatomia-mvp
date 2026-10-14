// Desktop live editing only. Tablets never poll the development server while studying.
const mobile=matchMedia('(pointer: coarse)').matches||navigator.maxTouchPoints>0;
let version,timer,disposed=false;
async function check(){
  if(disposed||document.hidden||mobile)return;
  try{
    const response=await fetch('/api/dev',{cache:'no-store'});
    if(response.ok){
      const state=await response.json();if(!state.enabled)return;
      if(version&&state.version!==version){location.reload();return;}version=state.version;
    }
  }catch{/* Retry only while the desktop window is visible. */}
  if(!disposed)timer=setTimeout(check,1500);
}
document.addEventListener('visibilitychange',()=>{clearTimeout(timer);if(!document.hidden)check();},{passive:true});
window.addEventListener('pagehide',()=>{disposed=true;clearTimeout(timer)},{once:true});
check();
