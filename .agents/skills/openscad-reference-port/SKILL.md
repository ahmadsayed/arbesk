---
name: openscad-reference-port
description: Use when a CAD part must match a real design or a published standard - phone or tablet stands, Raspberry Pi or Arduino cases, Gridfinity bins, gears - or when repeated generation attempts keep producing parts that are valid but wrong. Finds a permissively licensed OpenSCAD reference that ships a downloadable STL, ports its profile to Manifold JS, and verifies the port against the reference's own output.
---

# Porting an OpenSCAD Reference

A model asked to draw a real part will produce something that is a valid solid, passes every
gate, and is not that part. Five consecutive attempts at a phone stand produced a V-wedge, a
flat panel with a fin, and three disconnected bodies. The same part, **ported**, matched the
reference to 0.07 mm on the first try.

**Generate the boilerplate. Port the standards and the shapes that already exist.**

## When to port rather than generate

| part | approach | why |
|---|---|---|
| Standard dimensions (board holes, a bin grid) | **quote the numbers** in the system prompt | facts, not geometry - there is nothing to port |
| Standard maths (involute gears) | **write the helper** from the equations | short, and the equations are unambiguous |
| Hand-tuned profiles (stands, holders) | **port a reference** | 91 points of human iteration; nothing to infer |
| Free-form / novel geometry | **generate** | no reference exists |

## Step 0 - The licence gate, BEFORE anything else

Verify from the source itself, never from memory or a blog table.

| class | example | obligation |
|---|---|---|
| Facts and standards | Gridfinity's 42 mm grid, Pi hole spacing | **none** - dimensions are not creative works |
| Permissive code (MIT, BSD-2/3, Apache-2) | BOSL2's gear maths | notice in our source |
| Attribution designs (CC-BY) | DrLex0's `SmartPhoneHolder` | **attribution must reach the user** |
| Copyleft (LGPL, GPL, AGPL) | MCAD's `involute_gears.scad` | **NEVER PORT.** Translating is creating a derivative work, so the copyleft attaches to our code |

Read the actual `LICENSE` / header. MCAD is the library everyone reaches for and it is
LGPL-2.1, so it is out. Getting this wrong is not a bug you fix later.

## Step 1 - Find a reference that ships its expected output

A source file alone is not enough. Look for a repo with **both** the `.scad` and committed
`.stl` output - that STL is your ground truth.

```bash
curl -s "https://api.github.com/repos/<owner>/<repo>/git/trees/master?recursive=1" |
  grep -oE '"path": "[^"]+\.(scad|stl)"'
```

Good source: `DrLex0/print3d-customizable-smartphone-holder` - `SmartPhoneHolder.scad` plus
`exampleModels/*.stl`.

## Step 2 - Render the reference through OUR renderer

Never compare your output against a photo, a product page, or your own description of the
part. Compare it against the reference STL drawn by the same code:

```bash
bun scripts/cad-eval.mjs --stl test-results/reference/phone-defaults.stl \
  test-results/reference/phone-defaults.png
```

It prints the **size, centre and triangle count**. Write the size down; it is the acceptance
test for Step 4.

## Step 3 - Port the profile, not the assembly

Open `scripts/cad-scad-port.mjs` - it already does the mechanical part for a
`polygon(points, paths)` profile, which is what most parametric OpenSCAD parts reduce to.

What matters when reading the source:

- `linear_extrude(h) profile()` → **one extruded 2D outline**. This is the shape of nearly
  every correct holder, stand and bracket, with everything else `difference()`d out of it.
- `polygon(points, paths)` → our `polygon([contour, ...])`. `paths` gives index lists; split
  them into separate contours and let the even-odd fill rule make the inner one a hole.
- Keep the SCAD expressions **verbatim** where they are arithmetic over the parameters
  (`23.3089 + lift`, `0.725908 - ox`). They are valid JS, so the port stays fully
  parameterised with no evaluator at runtime - which also keeps it clear of CSP rules that
  forbid `new Function` in the browser.
- `difference()` cutters (`stretchCylinder`, `cornerCutter`) port to `.subtract(cylinder(...))`.

**If the design is an assembly, port the assembly's profile anyway.** Our model reaches for
"a base plate plus a leaning plate, unioned" and that is exactly the structure that comes
apart. A single profile has no join to get wrong.

## Step 4 - Verify the port against the reference size

Build it and compare against the numbers from Step 2. They must agree to within a few
hundredths of a millimetre; anything else means the port is wrong, not that the reference is.

Ported `phoneStand`: **66.79 x 49.89 x 60.00 mm** against the reference's
**66.79 x 49.82 x 60.00**. That agreement is the whole verification.

Also check it is **one solid** - `decompose()` must return 1.

## Step 5 - Register the attribution, with the link

If the licence is CC-BY, the part a user builds is a derivative work, so the credit has to
reach that user. It does **not** go in the prompt, where a model could forget it:

1. Add an entry to `ATTRIBUTED_HELPERS` in `packages/cad-gen/src/core/attribution.ts` -
   `work`, `author`, `licence`, `url` (the link is **required**), and `helper`.
2. Name the author, the licence and `ATTRIBUTED_HELPERS` in the helper's own docstring, so
   nobody reading the port has to go hunting for whose work it is.
3. `attributionsFor(code)` computes the set from `referencedIdentifiers(code)`, so it cannot
   be forgotten and cannot be over-claimed. Tests already enforce steps 1-2.

**The licence position on 3D-printed derivatives is a legal question, not an engineering one.**
Attribution-in-the-response is the conservative reading; confirm it before shipping a ported
helper publicly.

## Step 6 - Ship it with an ABSOLUTE rule

This is where ports fail. Adding the helper, documenting it and testing it is **not enough** -
the model ignored `phoneStand` for three consecutive runs while a rule said *"use it rather
than drawing one"*.

The reason is the lesson worth remembering:

> **A model calls a helper when it believes it cannot do the job itself.** It reaches for
> `spurGear` because involute maths is obviously hard, and for `gridfinityBase` because a
> standard profile is obviously not derivable. It ignores a stand helper because drawing a
> profile *feels easy*.

So:

- Write the rule **absolutely**: *"A phone stand is ALWAYS `phoneStand(...)`. This is not a
  suggestion and not a fallback ... Call the helper."*
- **Demote or delete any competing recipe.** A more specific instruction telling the model how
  to draw it by hand will win, every time. My draft said "use the helper" and then, in the
  next sentence, explained how to draw the profile - and the model drew the profile.
- Add the helper to the table in `SYSTEM_PROMPT`; the prompt/prelude lockstep test fails the
  build otherwise, which is the one thing that does catch this.

## Step 7 - Prove the model actually calls it

A helper sitting unused looks identical to a helper that works. Check the generated code:

```bash
bun scripts/cad-eval.mjs "<the request>" --out test-results/cad-eval
python3 -c "import json;print('CALLS:', 'phoneStand' in json.load(open('<attempt>/q1.json'))['code'])"
```

Then look at the render **and** at the solid count. A render shows surfaces, not connectivity:
two bodies a tenth of a millimetre apart are pixel-identical to two welded together, and a
blind bore is invisible from every angle. `decompose()` is exact where the eye is not.
Checked in this order: **`solids == 1`, then dimensions, then the picture.**

## Anti-patterns

- **Judging output against your own description of the part.** This is how five wrong stands
  and two wrong cases passed review.
- **Fitting each component to its own camera when compositing.** A bad visualisation looks
  exactly like success.
- **Hand-editing generated code.** It is not source; the next run overwrites it. Fix the
  prelude or the prompt.
- **A soft rule.** See Step 6.
- **Assuming a documented helper gets used.** See Step 7.
- **Porting anything copyleft.** See Step 0.
