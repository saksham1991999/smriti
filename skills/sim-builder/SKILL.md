---
name: sim-builder
description: Build Smriti's interactive simulations and virtual labs (physics, chemistry, biology, maths) as small self-contained web bundles that talk to the app through the sim-bridge protocol, or adapt open-licence sims such as PhET. Use when a media request of kind sim is open, or a lab is planned for a chapter.
---

# sim-builder

Writes `sims/{sim_id}/` and the matching `content.sims` metadata. Each sim runs in a WebView on mobile and an iframe on web (TRD §7.3). Read TRD §7.3 and `packages/sim-bridge` before starting.

## Inputs

- The sim request in `content/media/requests/**` (`kind: sim`): the concept, the learning goal, the tasks the lesson card will set, and the measurements it needs.
- The shared kit in `sims/_kit/` (created in Phase 1, epic M-4): the bridge client, controls (slider, toggle, stepper, play/pause/reset), a readout chip, a units helper, the token theme, and the i18n helper.

## First, check what exists

1. Search `sims/` for an existing sim that can take new `params`. Extending a sim beats a new one.
2. Search PhET's HTML5 sims (CC BY 4.0). If one fits, adapt it: embed the official HTML5 build, map its state to bridge messages where possible, and show the attribution PhET requires. Record `origin: phet`, `licence: CC BY 4.0`, `attribution`.
3. Avoid anything under a non-commercial licence (for example ChemCollective).

## Building a new sim

- **Stack:** TypeScript and Vite, one folder per sim, built to static files. 2D in Canvas or SVG; 3D with three.js only when depth matters. Use a tested physics or chemistry model in code, not an animation that only looks right.
- **What the sim draws:** only the interactive, data-driven parts: vectors, graphs, particles, wires, rays, fluids, apparatus outlines. Decorative art (backgrounds, realistic apparatus, characters) is an Agnes image requested through `visual-director` and loaded as an asset. The sim never hand-draws illustrations.
- **Bridge protocol:** on `init {locale, theme, params, task}` set up and send `ready`. Send `state` on meaningful changes, `measurement {name, value, unit}` when the student records a reading, `task_result {taskId, correct, data}` when a task is checked, `complete` at the end, and `error` on failure. Handle `reset`.
- **Strings:** every visible string comes from the sim's `strings.{en,hi}.json`. Numbers use the locale's format. Units use SI with the exam's conventions.
- **Theme:** colours from the token theme passed in `init` (light or dark), subject colours for the main elements.
- **Low power:** honour `params.lowPower`: fewer particles, 30 fps, no shadows.

## Budgets

- Under 2 MB total, starts in under 1.5 s on a mid-range Android phone, 60 fps normally (30 in low power).
- Works offline once downloaded. No network calls at runtime.

## Accessibility

- Every control has a label and works by touch, keyboard and screen reader.
- State changes are announced (for example "Current: 2.0 amperes").
- Reduced motion: no auto-play loops. The student steps through instead.
- Colour is never the only signal.

## Tests

- **Model tests:** compare outputs with known results (for example the pendulum period against 2π√(L/g) for small angles, Ohm's law, the titration end point).
- **Bridge tests:** a headless host sends `init` and checks `ready`, the task flow and `complete`.
- **Performance:** a Lighthouse or Playwright trace on a throttled CPU stays inside the budget.

## Checklist

- [ ] Reused or extended an existing sim if possible.
- [ ] The physics or chemistry model is real, with tests against known values.
- [ ] Every task in the lesson card can be completed and is checked with a tolerance.
- [ ] Both languages, both themes, low-power mode, reduced motion.
- [ ] Licence and attribution recorded for any third-party part.
- [ ] Under 2 MB, starts in under 1.5 s.
