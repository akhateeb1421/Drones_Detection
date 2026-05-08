Drop the two GLB files here:

  shahed.glb  -- from https://sketchfab.com/3d-models/shahed-136-launcher-3f4f8742fe044c4cb1bf20ca4caf56ef
  orlan.glb   -- from https://sketchfab.com/3d-models/orlan-f0f9e877c22443abad0126da0aefd080

How to download from Sketchfab:
  1. Sign in to Sketchfab (free account is fine).
  2. Open each model page, click the "Download 3D Model" button.
  3. Pick the "glTF" format (preferred) or "Original" if glTF isn't offered.
  4. Unzip the download. You'll get a .glb (or a .gltf with separate .bin/textures).
     If you only have .gltf+bin+textures, convert to .glb at https://gltf.report/
     or with `gltf-pipeline -i model.gltf -o model.glb`.
  5. Rename the .glb files to shahed.glb / orlan.glb and put them in this folder.

If a file is missing the dashboard will show a placeholder cube + a note in the
viewer; everything else (info cards, switching between drones) keeps working.
