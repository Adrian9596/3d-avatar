# Checklist — Draft GLB Prototype Requirements

**Purpose:** assess whether prototype-viewer requirements are complete, unambiguous, consistent and objectively assessable.  
**Created:** 2026-08-14  
**Primary source:** `PROTOTYPE_GLTF_VIEWER_REQUIREMENTS.md`  
**Actor/timing:** author and web reviewer before implementation or whenever prototype scope changes.  
**Rule:** checked means the requirement is well-defined, not that implementation passes.

## Requirement completeness

- [x] **PRQ001** Are the prototype objective and production-release exclusions explicitly separated? [Completeness, Req §1]
- [x] **PRQ002** Are local asset, dependency, version, hash and object-role requirements specified? [Completeness, Req §2]
- [x] **PRQ003** Are orbit, zoom, camera presets, reset and resize interactions all covered? [Completeness, Req §3]
- [x] **PRQ004** Are loading, ready, error and static-fallback states defined? [Coverage, Req §4–5]
- [x] **PRQ005** Are display, measurement and unavailable-morph states specified separately? [Completeness, Req §4]
- [x] **PRQ006** Are runtime, visual, interaction, validator and hash evidence requirements enumerated? [Completeness, Req §7]

## Requirement clarity and consistency

- [x] **PRQ007** Is `DRAFT — NOT TD VALIDATED` required as persistent visible language rather than implied status? [Clarity, Req §1, §4]
- [x] **PRQ008** Is “local/offline dependency” clarified as no runtime CDN and no build step? [Clarity, Req §2, §6]
- [x] **PRQ009** Is the supported launch method explicitly localhost rather than `file://`? [Clarity, Req §5]
- [x] **PRQ010** Are current MPFB generator targets distinguished from the six semantic contract morphs? [Consistency, Req §2, §4]
- [x] **PRQ011** Is the missing rig represented consistently in both UI claims and evidence? [Consistency, Req §2, §7]
- [x] **PRQ012** Are measurement placeholders prohibited consistently across status and measurement UI? [Consistency, Req §1, §4]
- [x] **PRQ013** Is the prototype success decision constrained so it cannot be confused with Stage 1 approval? [Consistency, Req §7]

## Acceptance criteria quality

- [x] **PRQ014** Is GLB readiness quantified with a local 10-second threshold? [Measurability, Req §6]
- [x] **PRQ015** Can asset success be assessed from runtime state, mesh count, version and SHA? [Measurability, Req §4, §7]
- [x] **PRQ016** Can each camera preset be assessed from a named screenshot and selected UI state? [Acceptance Criteria, Req §3, §7]
- [x] **PRQ017** Can visibility and wireframe requirements be assessed independently per control? [Acceptance Criteria, Req §4, §7]
- [x] **PRQ018** Are complete-body framing requirements defined for desktop and mobile sizes? [Measurability, Req §6]
- [x] **PRQ019** Are accessible control-state requirements tied to named ARIA attributes? [Acceptance Criteria, Req §6]

## Scenario and edge-case coverage

- [x] **PRQ020** Are initial load, successful load, load failure and WebGL absence covered? [Coverage, Req §4–5]
- [x] **PRQ021** Is recovery behavior defined when localhost is not used? [Recovery, Req §5]
- [x] **PRQ022** Is behavior defined when one or more expected object roles are absent? [Edge Case, Req §5]
- [x] **PRQ023** Are pointer, touch, wheel and pinch input requirements represented without requiring a specific device? [Coverage, Req §3]
- [x] **PRQ024** Is the behavior of shape controls defined while semantic morph targets are missing? [Edge Case, Req §2, §4]
- [x] **PRQ025** Is base-pose-only bikini evidence prevented from implying rig/morph coverage? [Edge Case, Req §4]

## Non-functional requirements and traceability

- [x] **PRQ026** Are performance protection and maximum device pixel ratio quantified? [Non-functional, Req §6]
- [x] **PRQ027** Is the supported error threshold zero uncaught runtime errors? [Non-functional, Req §6]
- [x] **PRQ028** Is responsive behavior included rather than assuming a desktop-only viewer? [Non-functional, Req §3, §6]
- [x] **PRQ029** Does the evidence contract tie browser results to exact viewer and GLB files? [Traceability, Req §7]
- [x] **PRQ030** Are responsibilities separated so web prototype approval cannot substitute for TD/3D approval? [Dependency, Req §1, §7]

**Author assessment:** `30/30 REQUIREMENTS DEFINED`
