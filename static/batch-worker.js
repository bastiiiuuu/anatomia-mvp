/* Geometry preparation stays off the UI thread. No dependencies or disk cache. */
self.onmessage=({data})=>{
  const {id,meshes}=data;
  try {
    const names=Object.keys(meshes[0].attributes);
    const vertexCount=meshes.reduce((n,m)=>n+m.attributes.position.count,0);
    const indexCount=meshes.reduce((n,m)=>n+m.index.length,0);
    const attributes={};
    for(const key of names) {
      const itemSize=meshes[0].attributes[key].itemSize;
      // Signed normalized normals retain angular precision while halving their
      // upload/storage cost. Positions and selected source geometry stay exact.
      const normalized=key==='normal'&&itemSize===3;
      const ArrayType=normalized?Int16Array:Float32Array;
      attributes[key]={itemSize,normalized,array:new ArrayType(vertexCount*itemSize)};
    }
    const IndexArray=vertexCount>65535?Uint32Array:Uint16Array;
    const index=new IndexArray(indexCount),ranges=[],min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    let vertexOffset=0,indexOffset=0;
    for(const mesh of meshes) {
      const e=mesh.matrix,n=mesh.normal;
      for(const key of names) {
        const a=mesh.attributes[key],out=attributes[key].array,offset=vertexOffset*a.itemSize;
        if((key==='position'||key==='normal')&&a.itemSize===3) {
          for(let i=0;i<a.array.length;i+=3) {
            const x=a.array[i],y=a.array[i+1],z=a.array[i+2];let px,py,pz;
            if(key==='position') {
              px=e[0]*x+e[4]*y+e[8]*z+e[12];py=e[1]*x+e[5]*y+e[9]*z+e[13];pz=e[2]*x+e[6]*y+e[10]*z+e[14];
              min[0]=Math.min(min[0],px);min[1]=Math.min(min[1],py);min[2]=Math.min(min[2],pz);
              max[0]=Math.max(max[0],px);max[1]=Math.max(max[1],py);max[2]=Math.max(max[2],pz);
            }else {
              px=n[0]*x+n[3]*y+n[6]*z;py=n[1]*x+n[4]*y+n[7]*z;pz=n[2]*x+n[5]*y+n[8]*z;
              const length=Math.hypot(px,py,pz)||1;px/=length;py/=length;pz/=length;
            }
            if(attributes[key].normalized) {
              out[offset+i]=Math.round(Math.max(-1,Math.min(1,px))*32767);
              out[offset+i+1]=Math.round(Math.max(-1,Math.min(1,py))*32767);
              out[offset+i+2]=Math.round(Math.max(-1,Math.min(1,pz))*32767);
            }else {out[offset+i]=px;out[offset+i+1]=py;out[offset+i+2]=pz;}
          }
        }else out.set(a.array,offset);
      }
      for(let i=0;i<mesh.index.length;i+=3){
        index[indexOffset+i]=mesh.index[i]+vertexOffset;
        index[indexOffset+i+1]=mesh.index[i+(mesh.reflected?2:1)]+vertexOffset;
        index[indexOffset+i+2]=mesh.index[i+(mesh.reflected?1:2)]+vertexOffset;
      }
      ranges.push({start:indexOffset,count:mesh.index.length});
      vertexOffset+=mesh.attributes.position.count;indexOffset+=mesh.index.length;
    }
    const transfer=[index.buffer,...Object.values(attributes).map(a=>a.array.buffer)];
    self.postMessage({id,attributes,index,ranges,min,max},transfer);
  }catch(error){self.postMessage({id,error:error.message});}
};
