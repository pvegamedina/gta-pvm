# Active Ragdoll — Implementation Plan

> **For agentic workers:** each phase is executed by ONE writer subagent (no parallel writers on
> the same files). Phases ship independently: every phase ends with `npm test` + `npm run typecheck`
> + `next build` green, visual verification in a real browser (playwright-core + system Chrome,
> SwiftShader, dev server on :3100, captures only in the session scratchpad), and a commit done by
> the orchestrator. Strict TDD for pure logic; behavioural physics tests run the real Rapier in Node.

**Goal:** Make the characters of "Ciudad Abierta" feel physical in the way ARC Raiders / Euphoria
characters do: bodies that die with fading muscles instead of dropping like sacks, locomotion with
weight, living characters that react locally to hits, knockdowns with a protective fall and a
procedural get-up, and finally balance and stumbling.

**Architecture:** The existing 11-body Rapier ragdoll (`src/game/physics/ragdoll.ts`, anatomical
joint frames and limits) becomes a *powered* ragdoll: every joint axis carries a Rapier position
motor whose target comes from a pose (the death pose now, the animated pose later) and whose gains
come from a per-joint strength 0..1 (`src/game/physics/muscles.ts`, pure and unit-tested).
Behaviours are pose-target modifiers plus strength profiles; balance (phase 5) adds the only
external forces. No machine learning (Embark's RL locomotion is for their robots, not players).
Research: session scratchpad `research/arc-raiders-animation.md` and `research/character-code-map.md`.

**Tech Stack:** Next.js 16, React 19, three.js r186, `@dimforge/rapier3d-compat` 0.21.0 (exact pin),
TypeScript 7, vitest 5.

---

## Phases

### Phase 1 — Debug overlay + motorized death ragdoll with strength fade  *(in progress)*

Deliverables:
- Muscle layer on the 11-body ragdoll: per-axis position motors on the spherical joints and the
  hinge motors on elbows/knees (raw `jointConfigureMotorPosition` / `jointSetMotorMaxForce`, same
  2·asin angle metric as `ragdollMath.frameAngles`), targets clamped inside the limits.
- Pure strength profile (`muscleGains`): ForceBased gains `k = w²·I`, `d = 2·zeta·w·I` from each
  joint's chain inertia, torque caps from the chain's gravity torque, bounded by 300 N·m; the
  passive friction motor restored exactly at zero strength. `numSolverIterations` stays at 8.
- Death as fading strength (`deathStrengthCurve`, seeded randomness): partial strength holding the
  death pose, fading to zero over 1–1.8 s (knees first, arms last), protective reflex targets
  (knees soften, arms brace towards the fall direction, head tucks, spine curls), struck limb limp
  at once plus a knee "buckle" kick, car rams dropping almost instantly with a protective curl.
  After the fade the ragdoll is exactly the old passive one (sleep, settle, fade, cap 20).
- F4 debug overlay (production too): collider wireframes coloured by strength, joints, pelvis
  velocity, centre of mass with its ground projection, ground contacts, DOM panel with mode,
  strength, worst motor error, pelvis speed and sleep state. Zero cost while hidden.
- Dev hooks `__gtaDebug.ragdoll` (spawn a dummy, set strength, pin, kill with a direction / part /
  cause, shoot the nearest ped, toggle the overlay).
- Stale-pose fix: `BoneTransformSnapshot` restores the bind position/rotation/scale of every bone
  the ragdoll writes (plus Root/Hips) before each mixer update.

Acceptance:
- Node/Rapier tests: full strength holds the pinned pose (< 0.15 rad) and stays bounded when free;
  a loaded crouch holds at death-start strength; the fade collapses the body and it sleeps; a head
  shot leaves the neck limp while the rest holds; a leg shot buckles that knee first; motor targets
  never leave the limits; no NaN.
- Browser: front / back / head / leg shot and car-ram deaths read as "dying", not as a limp sack;
  F4 overlay toggles cleanly; 0 console errors.
- Procedural fallback rig and the no-Rapier path (Death clip) unchanged.

### Phase 2 — Locomotion feel

Deliverables: velocity spring with start/stop inertia, acceleration lean and turn-in-place;
strafe / backwards run clips (`Run_Left/Right/Back`) blended by local velocity while aiming;
foot IK on slopes (pelvis offset + two-bone IK, foot aligned to the ground normal) and foot locking
from offline contact curves; secondary sway (second-order springs on head, weapon, torso); camera
springs (positional lag, sprint FOV, trauma shake).

Acceptance: no foot sliding at walk/run on flat ground and slopes, visible weight on starts/stops
and turns, aiming strafes look correct in all 8 directions; frame time unchanged within noise.

### Phase 3 — Active ragdoll on nearby living characters

Deliverables: a powered ragdoll tracking the animated pose (targets + finite-differenced target
velocities) for at most 6 nearby characters (LOD by distance / visibility), rendered physics pose
blended by strength; localized hit reactions (impulse at the hit body, temporary weakening of the
hit chain, recovery over 0.5–1 s, additive `HitRecieve` clips); per-bone hit colliders; network hit
events (optional `PlayerMotion` fields) so remote clients see the same flinch.

Acceptance: hits on head / arms / legs / torso produce distinct reactions on peds and remote
players; living characters never jitter while idle or running; cost bounded with 6 ragdolls active.

### Phase 4 — Knockdown, protective fall and get-up

Deliverables: knockdown on car hits and large impulses (balance off, Falling profile), protective
fall reflex (arms brace towards the predicted impact point, head tuck, absorb on contact), settle
detection, face-up / face-down test and procedural get-up via pose matching (snapshot → clip blend,
roll-to-back fallback for prone), root/heading reconstruction for the player and peds.

Acceptance: a knocked-down character always gets up (both orientations) without popping, can be
pushed again during the get-up, and its gameplay position ends where the body is.

### Phase 5 — Balance

Deliverables: root assist (upright torque + horizontal pelvis pin scaled by `balance`), centre of
mass versus support polygon / capture point, procedural stepping (up to 2–3 steps), stumbles,
falls off ledges and steep slopes, optional "drunk" and body-balance (arms out) modes.

Acceptance: pushes below the threshold produce steps and recover; above it the character falls
into phase 4; walking off a ledge or down a steep slope triggers a fall, not a float.

---

## Risks

- **Rapier internals:** spherical limits and motors go through the raw joint set
  (`jointSetLimits`, `jointConfigureMotor*`, `jointConfigureMotorModel`), which may change on a
  Rapier upgrade. The 0.21.0 pin stays exact; the Node tests catch breakage.
- **Per-axis 2·asin metric:** motors and limits measure each axis as `sin(θ/2)`, which couples axes
  in large combined rotations (> ~90°) and halves the effective stiffness. Reflex targets keep
  combined rotations moderate (the car-ram curl untwists the upper arm).
- **AccelerationBased vs ForceBased:** Rapier's default motor model normalizes by the two jointed
  bodies only, so support joints barely resist the body's weight; muscles use ForceBased gains
  scaled by chain inertia, the passive friction motor stays AccelerationBased.
- **Locked straight knees:** a limp joint has no torque, so loaded straight knees lock at their
  limit and bodies can fold into a stable "tripod"; mitigated by the knee buckle kick at death.
- **Cost:** about 26 motor axes per powered ragdoll and world-wide solver iterations; phase 3 must
  limit active ragdolls by distance and keep far characters kinematic.
- **Rig quirks:** feet hang off Root (IK bones), Body is yawed ~27° in bind, Root/Hips have no
  tracks; anything that writes bones must restore them (BoneTransformSnapshot).
- **Collision slots:** only 14 corpse collision slots; living ragdolls (phase 3) need their own
  scheme.
- **Networking:** ragdolls are local and visual-only; hit events must stay cosmetic and cheap.
