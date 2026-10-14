const $=id=>document.getElementById(id);
let page=0,timer,controller,local=false,authenticated=false;
const number=new Intl.NumberFormat('es-CL');
const date=new Intl.DateTimeFormat('es-CL',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
function status(text,error=false){$('connection').textContent=text;$('connection').classList.toggle('error',error);}
async function api(path,options={}){const r=await fetch('/admin/api/'+path,{credentials:'same-origin',...options});if(!r.ok){const e=new Error((await r.json().catch(()=>({}))).detail||'No se pudo conectar');e.status=r.status;throw e;}return r.json();}
function showLogin(){authenticated=false;clearTimeout(timer);$('dashboard').hidden=true;$('login').hidden=false;$('logout').hidden=true;status('Acceso protegido');}
function text(tag,value){const e=document.createElement(tag);e.textContent=value;return e;}
function chart(data){
  const days=new Map(data.daily.map(d=>[d.day,d.views]));const max=Math.max(1,...days.values());
  const columns=[],firstDay=Math.floor((data.updated_at-data.days*86400)/86400),lastDay=Math.floor(data.updated_at/86400);
  for(let i=firstDay;i<=lastDay;i++){const day=new Date(i*86400000).toISOString().slice(0,10),count=days.get(day)||0;
    const wrap=document.createElement('div');wrap.className='bar-wrap';const bar=document.createElement('div');bar.className='bar';bar.style.height=Math.max(2,count/max*110)+'px';bar.title=day+': '+count+' visitas';wrap.append(text('strong',number.format(count)),bar,text('span',day.slice(8)+'/'+day.slice(5,7)));columns.push(wrap);}
  $('chart').replaceChildren(...columns);
  $('devices').replaceChildren(...data.devices.map(d=>{const row=document.createElement('div');row.className='device';const line=document.createElement('div');line.append(text('span',d.device),text('span',number.format(d.views)));const bar=document.createElement('progress');bar.max=Math.max(1,data.totals.views);bar.value=d.views;bar.setAttribute('aria-label',d.device);row.append(line,bar);return row;}));
  if(!data.devices.length)$('devices').replaceChildren(text('p','Todavía no hay datos.'));
}
async function refresh(){
  clearTimeout(timer);controller?.abort();controller=new AbortController();const current=controller;
  $('refresh').disabled=true;
  try{const data=await api('stats?days='+$('period').value+'&page='+page,{signal:current.signal});if(current!==controller)return;
    for(const key of ['views','addresses','active','today'])$(key).textContent=number.format(data.totals[key]);chart(data);
    $('rows').replaceChildren(...data.rows.map(row=>{const tr=document.createElement('tr');tr.append(...[row.ip,date.format(row.first_seen*1000),date.format(row.last_seen*1000),row.device,row.referrer].map(value=>text('td',value)));return tr;}));
    $('empty').hidden=data.rows.length>0;$('record-count').textContent=number.format(data.totals.views)+' VISITAS';$('previous').disabled=page===0;$('next').disabled=!data.has_more;$('page-number').textContent='Página '+(page+1);
    $('updated').textContent='Actualizado '+date.format(data.updated_at*1000);status('● Panel conectado');
  }catch(error){if(error.name==='AbortError')return;if(error.status===401)showLogin();else status('Sin conexión · reintentar',true);}
  finally{if(current===controller){$('refresh').disabled=false;if(authenticated&&!document.hidden)timer=setTimeout(refresh,15000);}}
}
async function init(){try{const s=await api('session');local=s.local;if(!s.authenticated){showLogin();return;}authenticated=true;$('login').hidden=true;$('dashboard').hidden=false;$('logout').hidden=local;refresh();}catch{status('Servicio sin conexión',true);}}
$('login-form').addEventListener('submit',async event=>{event.preventDefault();const token=$('token').value;$('token').value='';$('login-error').textContent='';try{await api('login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});await init();}catch(error){$('login-error').textContent=error.message;}});
$('logout').addEventListener('click',async()=>{await api('logout',{method:'POST'});showLogin();});
$('refresh').addEventListener('click',refresh);$('period').addEventListener('change',()=>{page=0;refresh();});$('previous').addEventListener('click',()=>{page=Math.max(0,page-1);refresh();});$('next').addEventListener('click',()=>{page++;refresh();});
document.addEventListener('visibilitychange',()=>{clearTimeout(timer);if(!document.hidden&&authenticated)refresh();else controller?.abort();});
window.addEventListener('pagehide',()=>{clearTimeout(timer);controller?.abort();});window.addEventListener('pageshow',event=>{if(event.persisted)init();});init();
