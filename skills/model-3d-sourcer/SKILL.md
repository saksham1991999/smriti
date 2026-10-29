---
name: model-3d-sourcer
description: Find, licence-check, optimise and import 3D models for Smriti (anatomy, molecules, apparatus, monuments, planets, geometric solids), or build data-driven ones such as molecules from structure data, producing light GLB files with labelled parts. Use when a media request of kind model3d is open.
---

# model-3d-sourcer

Produces GLB models for the 3D viewer (TRD §3, budgets in §15) and registers them as `content.media_assets` with `kind: model3d`.

## Inputs

- The request in `content/media/requests/**`: what the model shows, the parts that need labels, the exploded view if any, and the lesson card that uses it.

## Where to look (check every item's own licence)

| Source | Good for | Licence (verify per item) |
|---|---|---|
| Smithsonian 3D | Artefacts, fossils, monuments | Many CC0 |
| NASA 3D Resources | Planets, spacecraft | Public domain |
| NIH 3D | Biomedical, anatomy | Varies |
| Z-Anatomy, BodyParts3D | Full human anatomy | CC BY-SA |
| Poly Haven, Quaternius, Kenney | Props, textures, simple scenes | CC0 |
| Sketchfab (filtered) | Almost anything | CC BY or CC0 only. No NC, no ND. |
| PubChem, RCSB PDB | Molecules and proteins (as data) | Open data |

Accept CC0, public domain, CC BY and CC BY-SA. For CC BY-SA, record that our modified model is shared under the same licence, and flag it in the pull request for a licence check. Reject NC and ND.

## Build instead of sourcing when the shape comes from data

- **Molecules and crystals:** generate from PubChem or PDB structure data with a script in `tools/3d/` (ball-and-stick, space-filling, orbitals). Atom colours follow the CPK convention.
- **Geometric solids, surfaces, field lines, vectors:** generate procedurally from the maths.
- If nothing fits and the shape can't come from data, flag it for a person or for an image-to-3D tool once the owner picks one. Don't hand-sculpt an approximation.

## Steps

1. Search the sources above. Record the URL, author, licence and attribution text for each candidate.
2. Check accuracy against the lesson's source (anatomy, structure, proportions).
3. Download to a scratch folder, never straight into the repo.
4. Convert to glTF 2.0 and clean up: real-world scale in metres, Y-up, centred origin, merged materials, removed hidden geometry.
5. **Name the label nodes** to match the request's parts (for example `label:left_ventricle`), so the app can pin labels in the student's language.
6. **Optimise** with glTF-Transform: meshopt or Draco compression, KTX2 textures, and two levels of detail. Budgets: high LOD under 3 MB, low LOD under 800 KB.
7. Test in the app's viewer on a low-end device profile: it loads, rotates smoothly, labels sit on the right parts, and the exploded view works.
8. Upload to R2 staging and register the asset with `source: open_licence` (or `original` for data-built ones), `licence`, `attribution`, and the label list.

## Checklist

- [ ] Licence allows commercial use and is recorded with the attribution.
- [ ] Accurate against the lesson's source.
- [ ] Label nodes match the request.
- [ ] High LOD under 3 MB, low LOD under 800 KB.
- [ ] Tested in the viewer, including the exploded view.
