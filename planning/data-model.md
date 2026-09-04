# Data Model — Stage 1 Asset Evidence

## AssetVersion

- `asset_id`: fixed value `avatar_36C`
- `version`: semantic or date-based version
- `status`: `DRAFT`, `TD_REVIEW`, `VALIDATED`, `REJECTED`
- `blend_sha256`
- `glb_sha256`
- `created_at`
- `source_manifest`

Rule: `VALIDATED` requires all Stage 1 DoD checks to pass and all three approval roles to be present.

## MeasurementDefinition

- `id`
- `name`
- `canonical_unit`
- `target_value`
- `tolerance`
- `measurement_type`: circumference, surface arc or point-to-point
- `start_landmark`
- `end_landmark`
- `path_description`
- `authority_source`

Rule: no target may be inferred only from the `36C` label.

## MeasurementObservation

- `measurement_id`
- `asset_version`
- `observed_value`
- `delta`
- `result`: `PASS` or `FAIL`
- `evidence`
- `reviewer`
- `reviewed_at`

## Landmark

- `stable_name`
- `side`: `L`, `R` or `CENTER`
- `storage_type`: empty, bone or vertex group
- `parent_object`
- `base_position`
- `follows_morph`: boolean
- `follows_pose`: boolean

## MorphTarget

- `name`
- `neutral_weight`: `0`
- `minimum_weight`
- `maximum_weight`
- `physical_meaning`
- `expected_measurement_effect`
- `forbidden_side_effects`
- `validation_evidence`

Required names: `Underbust`, `Projection`, `RootWidth`, `Spacing`, `UpperFullness`, `Ptosis`.

## EvidenceRecord

- `dod_id`
- `asset_version_or_sha`
- `result`: `PASS`, `FAIL`, `BLOCKED` or `TBC`
- `method`
- `artifact_path`
- `reviewer`
- `timestamp`
- `notes`

Rule: a DoD checkbox may be ticked only when its EvidenceRecord is `PASS`.

## Approval

- `role`: TD reviewer, 3D reviewer or web implementer
- `reviewer_name`
- `decision`
- `asset_version_or_sha`
- `date`
- `notes`

