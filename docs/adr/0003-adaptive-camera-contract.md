# ADR-0003: Support adaptive camera placement through explicit quality gates

- **Status:** Accepted
- **Date:** 2026-09-06
- **Decision owners:** Product + Vision/Data leads

## Context

The product request is “any angle” with a cheap phone mount placed as close to board center as
possible. A planar board can be rectified at many poses, but single-camera entry-point visibility
and pixel resolution have hard limits. Marketing an unqualified universal-angle promise would create
avoidable wrong scores and support burden.

## Decision

Build for adaptive pose/calibration from the first model design: landmarks + camera pose +
homography, temporal tracking, canonical coordinates, uncertainty, and data coverage across pose
bands. Publish/support only a measured quality envelope. Initial gate: full board visible, ≥480 px
board diameter, overall quality ≥.70, off-axis ≤55°, stable camera. Recommend a low-cost mount on
or near the centerline, 0.7–1.2m from the board, slightly above bull height.

When a view fails, Darts 180 provides a controllable adjustment, manual entry, or future second-device
option. It does not fabricate confidence.

## Consequences

### Positive

- Keeps the desired flexible setup as a real architecture/data goal.
- Protects trust on impossible/unsafe views.
- Produces actionable UX and measurable expansion thresholds.
- Allows later multicam fusion without changing game/rules APIs.

### Costs

- Requires quality model, calibration/drift work, diverse data, and transparent support copy.
- Some users will need to reposition/mount despite “phone-first” messaging.
- The initial supported envelope may be narrower than competitor marketing language.

## Alternatives considered

| Alternative                              | Rejected because                                                   |
| ---------------------------------------- | ------------------------------------------------------------------ |
| Fixed front-on rig only                  | quickest prototype but contradicts desired product differentiation |
| Claim truly any angle                    | physically dishonest and risks silent score errors                 |
| Require proprietary multicamera hardware | loses low-cost phone-first advantage                               |
| Pure manual calibration every game       | avoids ML but creates excessive setup friction                     |

## Follow-up

- Instrument every quality rejection and calibration recovery path.
- Expand pose bands only after sacred-eval and field pilot slice metrics pass.
- Define objective trigger for second-device/multicam product work.
