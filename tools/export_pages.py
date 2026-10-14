"""Generate the entry page and study JSON for main/root GitHub Pages. No downloads."""
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from backend.real_catalog import build_real_metadata

SCENE_FIELDS={"Mesh_ID","nombre","nombre_original","nombre_oficial_ta2","sistema","sistema_label","region","view_region",
              "capa","subtype","aliases","side","study_section","study_group","wikipedia_title"}


def write_json(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(data,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def export(root=ROOT):
    metadata=build_real_metadata(root)
    compact=[];chapters={};chapter_for={}
    for record in metadata["structures"]:
        group=record.get("study_section") or record["view_region"]
        chapter=f"{record['capa']}-{group}"
        chapters.setdefault(chapter,{})[record["Mesh_ID"]]=record
        chapter_for[record["Mesh_ID"]]=chapter
    hashes={chapter:write_json(root/"site-data/study"/(chapter+".json"),records) for chapter,records in chapters.items()}
    for record in metadata["structures"]:
        chapter=chapter_for[record["Mesh_ID"]]
        item={key:value for key,value in record.items() if key in SCENE_FIELDS}
        item["study_file"]=f"site-data/study/{chapter}.json?v={hashes[chapter]}";compact.append(item)
    model=metadata["model"]
    for asset in model["assets"]:
        path=asset["url"].lstrip("/")
        version=hashlib.sha256((root/path).read_bytes()).hexdigest()[:16]
        asset["url"]=path+"?v="+version
    write_json(root/"site-data/scene.json",{"model":model,"structures":compact})
    html=(root/"static/index.html").read_text(encoding="utf-8")
    modules=["label-layout.js","camera-motion.js","studio-ui.js","viewer.js","data-source.js","materials.js","performance.js","batch-renderer.js","batch-worker.js","dev.js"]
    source=b"".join((root/"static"/name).read_bytes().replace(b"\r\n",b"\n") for name in [*modules,"styles.css","studio.css"])
    fingerprint=hashlib.sha256((root/"site-data/scene.json").read_bytes()+html.replace("\r\n","\n").encode()+source).hexdigest()[:16]
    html=html.replace('<html lang="es">',f'<html lang="es" data-runtime="static" data-build="{fingerprint}">')
    match=re.search(r'<script type="importmap">\s*(.*?)\s*</script>',html,re.S)
    imports=json.loads(match[1])
    imports["imports"].update({"./static/"+name:"./static/"+name+"?v="+fingerprint for name in modules})
    html=html[:match.start(1)]+json.dumps(imports,separators=(",",":"))+html[match.end(1):]
    for path in ("static/viewer.js","static/dev.js","static/styles.css","static/studio.css"):
        html=html.replace('"./'+path+'"','"./'+path+'?v='+fingerprint+'"')
    (root/"index.html").write_text(html,encoding="utf-8")
    (root/".nojekyll").write_text("",encoding="utf-8")
    write_json(root/"site-data/build.json",{"version":"0.4.0","fingerprint":fingerprint,"structures":len(compact),"chapters":len(chapters)})
    return {"structures":len(compact),"chapters":len(chapters),"fingerprint":fingerprint}


if __name__=="__main__":
    print(json.dumps(export()))
