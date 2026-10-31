---
name: anim-maker
description: Make Smriti's animations - lesson animated explainers, pet and plant Rive state machines, Lottie UI flourishes and short explainer clips - from Agnes-generated layered art, following the motion tokens in DESIGN.md. Use when a media request of kind animation_rive or animation_lottie is open, or a new UI motion is needed.
---

# anim-maker

Read `DESIGN.md` §7 (motion tokens and the Rive state-machine contract) first.

## Three kinds of animation

| Kind | Format | Who builds it |
|---|---|---|
| **Pet and plant** | Rive (`pet-cat.riv`, `pet-dog.riv`, `plant.riv`) with the fixed inputs and triggers in `DESIGN.md` §7.2 | The skill prepares the art pack, the spec and the tests. A person rigs it in the Rive editor. |
| **Lesson explainers** (a heart pumping, a reaction happening, light refracting) | Lottie with image layers, or Rive for interactive ones | The skill builds them end to end |
| **UI flourishes** (confetti, check pop, streak flame flip) | Lottie, or motion code: Reanimated in `packages/ui-native` and Motion in `packages/ui-web` | The skill builds them |

## Art comes from Agnes

Animations move art. They never replace it with hand-drawn shapes. For each animation:
1. Write a **layer plan**: which parts move separately (for example the valve flaps, the blood cells and the heart body).
2. Request each layer from `visual-director` as a separate transparent image in the same style, scale and camera (preset `sunny-diagram` or `sunny-object`).
3. Simple geometric motion paths, arrows and particles may be drawn as vector shapes inside the animation file. Those are motion graphics, not illustrations.

## Lesson explainers

1. Storyboard 3–6 beats from the lesson card's text, 3–10 s in total.
2. Build the Lottie file from the layers with a script in `tools/anim/` (keyframes for position, rotation, scale and opacity, using the easing and durations from the motion tokens).
3. Leave label anchors free, as the app overlays labels in the student's language.
4. Provide a `transcript` and a reduced-motion poster frame (the most informative frame as a still).
5. Optionally render an MP4 version for the YouTube channel and for PDF export stills.

## Stroke-order guides (little learner tracing)

A `play@1` trace round names a `guide`: an `animation_rive` request showing how to write one letter or digit. The app draws the glyph itself from its own font, so the guide never contains a drawn letter shape.

1. Build it as Rive over the glyph outline from the app's own font (DESIGN.md typography), animating a dot or a hand along each stroke in the order taught in NCERT class 1 books for that script (cite the book in the request's brief).
2. One stroke at a time, `slow` duration per stroke, a short pause between strokes; loop with a rest at the end.
3. Provide a `transcript` in both languages naming the strokes, and a reduced-motion poster with the stroke numbers placed as label anchors (labels are overlaid by the app, not baked in).

## Pet and plant Rive files

- Prepare the art pack: every mood pose for each pet and all 25 plant images, consistent with the reference sheets.
- Write the state-machine spec: inputs `mood`, `energy`, `under10` (pets), `stage`, `health`, `season` (plant); triggers `hop`, `celebrate`, `wave`, `think`, `sleep`, `wake`, `pet`, `water`, `grow`, `revive`; blend times of 400 ms.
- Write the acceptance test: a screen in the app's design gallery that drives every input and trigger, so a reviewer can check every state.
- The under-10 mode never shows sad or unwell states.

## Budgets

- Lottie under 150 KB (excluding images), 60 fps on a mid-range phone.
- Rive files under 500 KB each, excluding images.
- Every animation respects reduced motion (static pose or poster frame).

## Checklist

- [ ] All art layers came from Agnes through `visual-director`.
- [ ] Timing uses the motion tokens.
- [ ] Transcript and poster frame present for lesson animations.
- [ ] Inputs and triggers match `DESIGN.md` §7.2 exactly (Rive).
- [ ] Inside the size budgets. Reduced motion handled.
