"""Create an isolated Blender workfile for authoring avatar_36C hair.

The script must be run with avatar_36C_master.blend open. It extracts an
evaluated body snapshot for visual fitting, removes the editable project
objects from the working scene, creates authoring/delivery collections, and
saves avatar_36C_hair_working.blend. It never saves the canonical master.

This is an authoring bootstrap only. It creates no approved hair geometry and
grants no TD, anatomy, rig, visual, web, or production approval.
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
MASTER = ROOT / "avatar_36C_master.blend"
OUTPUT = ROOT / "avatar_36C_hair_working.blend"
GUIDE = ROOT / "AVATAR_HAIR_DESIGN_AND_INTEGRATION.md"

REFERENCE_COLLECTION = "REFERENCE_DO_NOT_EDIT"
AUTHORING_COLLECTION = "HAIR_AUTHORING"
DELIVERY_COLLECTION = "AVATAR_36C_HAIR_DELIVERY"
REFERENCE_OBJECT = "REF_avatar_36C_body"
ORIGIN_OBJECT = "HAIR_ORIGIN_CHECK"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def overwrite_requested() -> bool:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    return "--overwrite-hair-workfile" in args


def require_master() -> bpy.types.Object:
    current = Path(bpy.data.filepath).resolve()
    if current != MASTER.resolve():
        raise RuntimeError(f"Expected open master {MASTER}, got {current}")

    bodies = [
        obj
        for obj in bpy.context.scene.objects
        if obj.type == "MESH"
        and obj.get("asset_id") == "avatar_36C"
        and obj.get("object_role") == "BODY"
    ]
    if len(bodies) != 1:
        raise RuntimeError(f"Expected one BODY object, found {[obj.name for obj in bodies]}")
    return bodies[0]


def evaluated_reference(body: bpy.types.Object, master_hash: str) -> bpy.types.Object:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = body.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(
        evaluated,
        preserve_all_data_layers=True,
        depsgraph=depsgraph,
    )
    mesh.name = f"{REFERENCE_OBJECT}_mesh"

    reference = bpy.data.objects.new(REFERENCE_OBJECT, mesh)
    reference.matrix_world = body.matrix_world.copy()
    reference.display_type = "TEXTURED"
    reference.show_name = True
    reference["asset_id"] = "avatar_36C"
    reference["object_role"] = "REFERENCE_BODY"
    reference["reference_only"] = True
    reference["source_master"] = MASTER.name
    reference["source_master_sha256"] = master_hash
    reference["reference_geometry"] = "EVALUATED_SNAPSHOT_FOR_HAIR_FIT_ONLY"
    return reference


def clear_scene_objects_and_collections(preserve: bpy.types.Object) -> None:
    scene_root = bpy.context.scene.collection
    for obj in list(bpy.data.objects):
        if obj != preserve:
            bpy.data.objects.remove(obj, do_unlink=True)
    for child in list(scene_root.children):
        scene_root.children.unlink(child)
    for collection in list(bpy.data.collections):
        bpy.data.collections.remove(collection)


def new_collection(name: str) -> bpy.types.Collection:
    collection = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(collection)
    return collection


def create_origin_marker(collection: bpy.types.Collection, master_hash: str) -> None:
    marker = bpy.data.objects.new(ORIGIN_OBJECT, None)
    marker.empty_display_type = "PLAIN_AXES"
    marker.empty_display_size = 0.10
    marker.location = (0.0, 0.0, 0.0)
    marker["purpose"] = "Verify hair delivery stays aligned to master origin"
    marker["source_master_sha256"] = master_hash
    collection.objects.link(marker)


def create_embedded_readme(master_hash: str) -> None:
    text = bpy.data.texts.get("README_HAIR_WORKFILE.txt") or bpy.data.texts.new(
        "README_HAIR_WORKFILE.txt"
    )
    text.clear()
    text.write(
        "avatar_36C isolated hair authoring workfile\n"
        f"Source master: {MASTER.name}\n"
        f"Source SHA-256: {master_hash}\n"
        f"Workflow/checklist: {GUIDE.name}\n\n"
        "REFERENCE_DO_NOT_EDIT is a visual/evaluated body snapshot only.\n"
        "Keep editable curves and helpers in HAIR_AUTHORING.\n"
        "Put only the reviewed final mesh/material in AVATAR_36C_HAIR_DELIVERY.\n"
        "Append only AVATAR_36C_HAIR_DELIVERY into an integration copy of the master.\n"
        "Status: DRAFT_NOT_VISUALLY_APPROVED. This file grants no approval.\n"
    )


def configure_scene(master_hash: str) -> None:
    scene = bpy.context.scene
    scene.name = "avatar_36C_hair_authoring"
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene["asset_id"] = "avatar_36C"
    scene["workfile_role"] = "HAIR_AUTHORING"
    scene["asset_status"] = "DRAFT_NOT_VISUALLY_APPROVED"
    scene["source_master"] = MASTER.name
    scene["source_master_sha256"] = master_hash
    scene["workflow_document"] = GUIDE.name
    scene["final_delivery_collection"] = DELIVERY_COLLECTION
    scene["hair_style_target"] = "SLEEK_MID_HIGH_BUN"
    scene["hair_triangle_budget"] = 20000
    scene["warning"] = (
        "Static presentation draft only until the TD-fitted master and final rig are frozen"
    )


def main() -> None:
    if OUTPUT.exists() and not overwrite_requested():
        raise RuntimeError(
            f"Refusing to overwrite {OUTPUT}. Pass -- --overwrite-hair-workfile "
            "only after reviewing or backing up the existing workfile."
        )
    if not GUIDE.exists():
        raise RuntimeError(f"Missing workflow document: {GUIDE}")

    body = require_master()
    master_hash = sha256(MASTER)
    reference = evaluated_reference(body, master_hash)

    clear_scene_objects_and_collections(reference)
    reference_collection = new_collection(REFERENCE_COLLECTION)
    authoring_collection = new_collection(AUTHORING_COLLECTION)
    delivery_collection = new_collection(DELIVERY_COLLECTION)

    reference_collection.objects.link(reference)
    reference_collection["purpose"] = "Evaluated master snapshot; do not deliver or edit"
    reference_collection["source_master_sha256"] = master_hash
    authoring_collection["purpose"] = "Editable hair curves, cap, guides and helpers"
    delivery_collection["purpose"] = "Append only this collection into the master"
    delivery_collection["required_object_role"] = "HAIR"
    delivery_collection["asset_status"] = "DRAFT_NOT_VISUALLY_APPROVED"
    delivery_collection["source_master_sha256"] = master_hash

    create_origin_marker(authoring_collection, master_hash)
    create_embedded_readme(master_hash)
    configure_scene(master_hash)

    bpy.context.view_layer.objects.active = reference
    reference.select_set(True)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT), check_existing=False)

    print("HAIR_WORKFILE_CREATED")
    print(f"output={OUTPUT}")
    print(f"source_master_sha256={master_hash}")
    print(f"collections={REFERENCE_COLLECTION},{AUTHORING_COLLECTION},{DELIVERY_COLLECTION}")
    print("status=DRAFT_NOT_VISUALLY_APPROVED")


if __name__ == "__main__":
    main()
