"""Run INSIDE Blender: blender --background --python pipeline/export_blender.py -- ..."""
import argparse
import json
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import hierarchy, normalize, validate_glb, write_json


def arguments():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input", type=Path, required=True, help=".blend, .glb, .gltf, .obj o carpeta de OBJ")
    p.add_argument("--output", type=Path, required=True, help="Destino .glb")
    p.add_argument("--metadata", type=Path, required=True)
    p.add_argument("--mapping", type=Path, help="Manifiesto con clasificación explícita por nombre original")
    p.add_argument("--namespace", required=True, help="Identificador estable del dataset, ej. z-anatomy-v1")
    p.add_argument("--collection", help="Exporta solo esta colección y sus descendientes")
    p.add_argument("--ratio", type=float, default=1.0, help="Decimación optativa (0,1]; 1 preserva anatomía")
    p.add_argument("--model-url", default="/static/models/anatomia.glb")
    p.add_argument("--license", default="Ver licencia del dataset de origen")
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    args = p.parse_args(argv)
    if not 0 < args.ratio <= 1:
        p.error("--ratio debe estar en (0,1]")
    if args.output.suffix.lower() != ".glb":
        p.error("--output debe terminar en .glb")
    if not args.input.exists():
        p.error("--input no existe")
    if args.input.resolve() in (args.output.resolve(), args.metadata.resolve()):
        p.error("No se puede sobrescribir el archivo de origen")
    if not args.model_url.startswith("/static/models/") or ".." in args.model_url:
        p.error("--model-url debe estar en /static/models/")
    return args


def import_source(bpy, path):
    if path.suffix.lower() == ".blend":
        bpy.ops.wm.open_mainfile(filepath=str(path.resolve()), use_scripts=False)
        return
    bpy.ops.wm.read_factory_settings(use_empty=True)
    paths = sorted(path.glob("*.obj")) if path.is_dir() else [path]
    if not paths:
        raise ValueError("La carpeta no contiene OBJ")
    for item in paths:
        if item.suffix.lower() in (".glb", ".gltf"):
            bpy.ops.import_scene.gltf(filepath=str(item.resolve()))
        elif item.suffix.lower() == ".obj":
            before = set(bpy.data.objects)
            bpy.ops.wm.obj_import(filepath=str(item.resolve()))
            meshes = [o for o in set(bpy.data.objects) - before if o.type == "MESH"]
            # BodyParts3D OBJ may use generic object names; preserve the dataset file key.
            for i, obj in enumerate(sorted(meshes, key=lambda o: o.name)):
                obj.name = item.stem if len(meshes) == 1 else f"{item.stem}_{i}"
        else:
            raise ValueError(f"Formato no admitido: {item}")


def collection_paths(bpy, obj):
    paths = []
    def walk(collection, prefix):
        path = prefix + [collection.name]
        if obj.name in collection.objects:
            paths.append(path)
        for child in collection.children:
            walk(child, path)
    walk(bpy.context.scene.collection, [])
    return paths


def infer_layer(paths, name):
    # Collection-level evidence only. Unrecognized classifications remain explicit.
    text = normalize(" ".join(" ".join(p) for p in paths))
    if any(x in text for x in ("skeletal", "osteologia", "ossa", "bones", "sistema oseo")):
        return "Sistema óseo", "oseo"
    if any(x in text for x in ("muscular", "myologia", "musculi", "muscles")):
        return "Sistema muscular", "muscular"
    if any(x in text for x in ("articular", "arthrologia", "ligament", "joints")):
        return "Sistema articular", "articular"
    return "Sin clasificar", "otro"


def main():
    import bpy
    args = arguments()
    mapping = json.loads(args.mapping.read_text(encoding="utf-8")) if args.mapping else {}
    overrides = mapping.get("structures", {})
    import_source(bpy, args.input)
    if args.collection:
        coll = bpy.data.collections.get(args.collection)
        if coll is None:
            raise ValueError(f"Colección inexistente: {args.collection}")
        objects = [o for o in coll.all_objects if o.type == "MESH"]
    else:
        objects = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not objects:
        raise ValueError("No hay mallas para exportar")
    # Work on copies with baked WORLD transforms. Original objects/collections are not changed.
    # One node per source object; never join anatomy or merge meshes across structures.
    prepared = []
    structures = []
    for obj in sorted(objects, key=lambda o: o.name):
        original = obj.name
        if obj.data.shape_keys or any(m.type == "ARMATURE" for m in obj.modifiers):
            raise ValueError(f"{original}: se requiere modelo anatómico estático sin skin/morph")
        custom = overrides.get(original, {})
        stable_key = custom.get("source_id", original)
        mesh_id = custom.get("Mesh_ID") or "mesh_" + uuid.uuid5(
            uuid.NAMESPACE_URL, args.namespace + ":" + stable_key).hex
        paths = collection_paths(bpy, obj)
        system, layer = infer_layer(paths, original)
        structure = {"Mesh_ID": mesh_id, "source_name": original,
                     "nombre": custom.get("nombre", original), "sistema": custom.get("sistema", system),
                     "region": custom.get("region", "Sin clasificar"), "capa": custom.get("capa", layer),
                     "aliases": custom.get("aliases", []), "collection_paths": paths,
                     "catalog_key": custom.get("catalog_key"), "revision": "pendiente"}
        if "nombre" in custom:
            structure["display_name_override"] = custom["nombre"]
        if "side" in custom:
            structure["side"] = custom["side"]
        # Evaluated geometry includes existing static modifiers without changing the source.
        evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        mesh = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=True,
                                              depsgraph=bpy.context.evaluated_depsgraph_get())
        mesh.transform(obj.matrix_world)
        mesh.update()
        copy = bpy.data.objects.new(mesh_id, mesh)
        bpy.context.scene.collection.objects.link(copy)
        copy["Mesh_ID"] = mesh_id
        copy["anatomy_name"] = structure["nombre"]
        copy["system"] = structure["sistema"]
        copy["region"] = structure["region"]
        if args.ratio < 1:
            modifier = copy.modifiers.new("WebDecimate", "DECIMATE")
            modifier.ratio = args.ratio
            bpy.context.view_layer.objects.active = copy
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        prepared.append(copy)
        structures.append(structure)
    if len({s["Mesh_ID"] for s in structures}) != len(structures):
        raise ValueError("Mesh_ID o source_id duplicados en el manifiesto")
    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    for obj in prepared:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = prepared[0]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temp = args.output.with_name(args.output.stem + ".pending.glb")
    result = bpy.ops.export_scene.gltf(filepath=str(temp.resolve()), export_format="GLB",
        use_selection=True, export_extras=True, export_yup=True, export_animations=False,
        export_cameras=False, export_lights=False, export_apply=True,
        export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
        export_draco_position_quantization=16, export_draco_normal_quantization=12)
    if "FINISHED" not in result:
        raise RuntimeError(f"Falló la exportación: {result}")
    report = validate_glb(temp, structures, require_draco=True)
    # Validate before promoting the export; missing Draco/extras fails loudly.
    temp.replace(args.output)
    metadata = {"schema_version": 1, "model": {"url": args.model_url,
                "source": args.namespace, "title": args.input.stem,
                "license": args.license, "attribution": mapping.get("attribution", ""),
                "report": report, "decimation_ratio": args.ratio},
                "structures": structures, "hierarchy": hierarchy(structures)}
    write_json(args.metadata, metadata)
    print(json.dumps(report, indent=2))
    print(f"GLB: {args.output}; metadata: {args.metadata}")
    # Intentionally no save_mainfile(): the input .blend stays untouched.


if __name__ == "__main__":
    main()
