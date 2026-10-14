/** FastAPI locally, static JSON + public Wikipedia on GitHub Pages. */
export class AtlasData {
  constructor({base,runtime,json,signal}) {
    Object.assign(this,{base,runtime,json,signal});
    this.records=new Map();this.chunks=new Map();this.wikiCache=new Map();
  }
  url(path){return new URL(path.replace(/^\//,''),this.base).href;}
  async scene(signal) {
    const version=document.documentElement.dataset.build;
    const path=this.runtime==='static'?'site-data/scene.json'+(version?'?v='+version:''):'api/scene';
    const data=await this.json(this.url(path),signal);
    this.records=new Map(data.structures.map(s=>[s.Mesh_ID,s]));return data;
  }
  async structure(id,signal) {
    if(this.runtime!=='static')return this.json(this.url(`api/estructuras/${encodeURIComponent(id)}`),signal);
    const record=this.records.get(id);
    if(!record?.study_file)throw new Error('Sin ficha de estudio');
    let pending=this.chunks.get(record.study_file);
    if(!pending){
      pending=this.json(this.url(record.study_file),this.signal);this.chunks.set(record.study_file,pending);
      pending.catch(()=>this.chunks.delete(record.study_file));
      if(this.chunks.size>12)this.chunks.delete(this.chunks.keys().next().value);
    }
    const chunk=await pending;
    if(signal?.aborted)throw new DOMException('Selección cancelada','AbortError');
    if(!chunk[id])throw new Error('Ficha anatómica no encontrada');return chunk[id];
  }
  async wikipedia(id,signal) {
    if(this.runtime!=='static')return this.json(this.url(`api/estructuras/${encodeURIComponent(id)}/wikipedia`),signal);
    const title=this.records.get(id)?.wikipedia_title;
    if(!title)return {status:'not_mapped',message:'Sin correspondencia editorial con un artículo español.',extract:'',url:'https://es.wikipedia.org/',license:'',cached:false};
    const cached=this.wikiCache.get(title);
    if(cached&&cached.expires>Date.now())return {...cached.data,cached:true};
    const article=`https://es.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(' ','_'))}`;
    let result;
    try {
      const query=new URLSearchParams({action:'query',prop:'extracts|info|revisions|pageprops',exintro:'1',explaintext:'1',inprop:'url',rvprop:'ids',ppprop:'disambiguation',redirects:'1',titles:title,origin:'*',format:'json',formatversion:'2'});
      const response=await this.json('https://es.wikipedia.org/w/api.php?'+query,signal,6000);
      const page=response.query?.pages?.[0];
      if(response.error)throw new Error('Wikipedia no disponible');
      if(page?.missing||!page)result={status:'not_found',message:'No hay un artículo español para esta estructura.'};
      else if(page.pageprops?.disambiguation!==undefined)result={status:'disambiguation',message:'El artículo es una desambiguación; consulta las fuentes de la ficha.'};
      else result={status:'ok',title:page.title,extract:(page.extract||'').slice(0,6000),url:page.fullurl||article,revision:page.revisions?.[0]?.revid};
    }catch(error){
      if(error.name==='AbortError')throw error;
      result={status:'unavailable',message:'Wikipedia no respondió. La ficha local sigue disponible; puedes abrir el artículo.'};
    }
    result={title,extract:'',url:article,license:'CC BY-SA 4.0',cached:false,...result};
    this.wikiCache.set(title,{data:result,expires:Date.now()+(result.status==='ok'?21600000:60000)});
    if(this.wikiCache.size>128)this.wikiCache.delete(this.wikiCache.keys().next().value);
    return result;
  }
  dispose(){this.records.clear();this.chunks.clear();this.wikiCache.clear();}
}
