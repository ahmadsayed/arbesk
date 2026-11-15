---
name: openscad-reference-port
description: Use when a CAD part must match a real design or a published standard - phone or tablet stands, Raspberry Pi or Arduino cases, Gridfinity bins, gears - or when repeated generation attempts keep producing parts that are valid but wrong. Finds a permissively licensed OpenSCAD reference that ships a downloadable STL, ports its profile to Manifold JS, and verifies the port against the reference's own output.
---

# Porting an OpenSCAD Reference

A model asked to draw a real part produces a valid solid that passes every gate and is not that part. Five generated phone stands were all wrong; the ported one matched the reference to 0.07 mm on the first try. Generate the boilerplate; port the standards and the shapes that already exist.

| Part | Approach |
|---|---|
| Standard dimensions (board holes, bin grid) | Quote the numbers in the system prompt. Facts need no port. |
| Standard maths (involute gears) | Write the helper from the equations. |
| Hand-tuned profiles (stands, holders) | **Port a reference.** |
| Free-form or novel geometry | Generate. |

## 0. Licence gate, before anything else

Read the repo's actual `LICENSE` or file header, never a blog table or memory.

| Class | Obligation |
|---|---|
| Facts and standards (Gridfinity's 42 mm grid, Pi hole spacing) | None. |
| Permissive code (MIT, BSD, Apache-2) | Notice in our source. |
| Attribution designs (CC-BY) | The credit must reach the user (step 5). |
| Copyleft (LGPL, GPL, AGPL), including MCAD's `involute_gears.scad` | **Never port.** A translation is a derivative work. |

## 1. Find a reference that ships its output

You need the `.scad` **and** a committed `.stl`; the STL is the ground truth.

```bash
curl -s "https://api.github.com/repos/<owner>/<repo>/git/trees/master?recursive=1" |
  grep -oE '"path": "[^"]+\.(scad|stl)"'
```

## 2. Render the reference through our renderer

```bash
bun scripts/cad-eval.mjs --stl test-results/reference/<name>.stl test-results/reference/<name>.png
```

Note the printed size, centre and triangle count. The size is the acceptance test for step 4. Never compare against a photo or your own description of the part.

## 3. Port the profile, not the assembly

`scripts/cad-scad-port.mjs` already converts a `polygon(points, paths)` profile.

- `linear_extrude(h) profile()` becomes one extruded 2D outline with everything else subtracted from it.
- `polygon(points, paths)` becomes our `polygon([contour, ...])`: split `paths` into contours; the even-odd rule turns inner ones into holes.
- Keep arithmetic over parameters verbatim (`23.3089 + lift`). It is valid JS, so the port stays parametric with no runtime evaluator.
- `difference()` cutters become `.subtract(cylinder(...))`.
- If the design is an assembly, still port a single profile. "Base plate plus leaning plate, unioned" is the structure that comes apart.

## 4. Verify against the reference

The built size must match step 2 to a few hundredths of a millimetre, and `decompose()` must return 1 solid. Otherwise the port is wrong, not the reference.

## 5. Register the attribution

For CC-BY sources, add an entry to `ATTRIBUTED_HELPERS` in `packages/cad-gen/src/core/attribution.ts` (`work`, `author`, `licence`, `url`, `helper`) and name the author and licence in the helper's docstring. `attributionsFor(code)` then credits it whenever the helper is used. Whether attribution in the response is enough for printed derivatives is a legal question: confirm before shipping a ported helper publicly.

## 6. Make the model call it

A model calls a helper only when it believes it cannot do the job itself. It uses `spurGear` because involute maths looks hard and ignores a stand helper because drawing a profile feels easy.

- Write the rule absolutely: "A phone stand is ALWAYS `phoneStand(...)`." A soft "use it rather than drawing one" was ignored three runs in a row.
- Delete any competing recipe. An instruction that explains how to draw the part by hand wins every time.
- Add the helper to the table in `SYSTEM_PROMPT` (`packages/cad-gen/src/backend/prompt.ts`); the prompt/prelude lockstep test fails otherwise.

## 7. Prove it

```bash
bun scripts/cad-eval.mjs "<the request>" --out test-results/cad-eval
```

Check the generated code for the helper call, then `solids == 1`, then dimensions, then the picture, in that order. A render cannot show two bodies 0.1 mm apart or a blind bore. Never hand-edit generated code; fix the prelude or the prompt.
