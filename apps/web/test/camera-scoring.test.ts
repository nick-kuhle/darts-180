import assert from 'node:assert/strict';
import test from 'node:test';

import { makeZone } from '@darts-180/rules';

import {
  analysisRadiusForBoardSkew,
  analyzeDartDifference,
  assessBoardFitCalibration,
  assessGuidedCalibration,
  candidateFromManualPoint,
  isAutomaticTipCandidateEligible,
  selectAutomaticTipCandidate,
  selectReviewTipCandidate,
  type CameraFrame,
  type DartTipCandidate,
} from '../src/lib/cameraScoring.js';
import { solveImageToBoardHomography, type ImagePoint } from '../src/lib/annotationGeometry.js';

const WIDTH = 720;
const HEIGHT = 720;
const anchors: ImagePoint[] = [
  { x: 360, y: 80 },
  { x: 640, y: 360 },
  { x: 360, y: 640 },
  { x: 80, y: 360 },
];
const boardPoints = [
  { xMm: 0, yMm: -166 },
  { xMm: 166, yMm: 0 },
  { xMm: 0, yMm: 166 },
  { xMm: -166, yMm: 0 },
];

function calibration() {
  const value = solveImageToBoardHomography(anchors, boardPoints);
  assert.notEqual(value, null);
  assert.ok(value !== null);
  return value;
}

function makeFrame(width = WIDTH, height = HEIGHT, fill = 185): CameraFrame {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba[offset] = fill;
    rgba[offset + 1] = fill;
    rgba[offset + 2] = fill;
    rgba[offset + 3] = 255;
  }
  return { width, height, rgba, capturedAtMs: 1_000 };
}

function drawDarkLine(frame: CameraFrame, x: number, startY: number, endY: number, thickness = 5) {
  for (let y = startY; y <= endY; y += 1) {
    for (
      let xOffset = -Math.floor(thickness / 2);
      xOffset <= Math.floor(thickness / 2);
      xOffset += 1
    ) {
      setPixel(frame, x + xOffset, y, 20);
    }
  }
}

function drawCompactFlight(
  frame: CameraFrame,
  centerX: number,
  centerY: number,
  radius = 9,
  value = 166,
) {
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      if (Math.hypot(x - centerX, y - centerY) <= radius) setPixel(frame, x, y, value);
    }
  }
}

function adjustExposure(frame: CameraFrame, gain: number, offset: number) {
  for (let index = 0; index < frame.rgba.length; index += 4) {
    frame.rgba[index] = Math.round(Math.min(255, frame.rgba[index]! * gain + offset));
    frame.rgba[index + 1] = Math.round(Math.min(255, frame.rgba[index + 1]! * gain + offset));
    frame.rgba[index + 2] = Math.round(Math.min(255, frame.rgba[index + 2]! * gain + offset));
  }
}

function translateFrame(frame: CameraFrame, offsetX: number, offsetY: number): CameraFrame {
  const translated = makeFrame(frame.width, frame.height);
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const sourceX = x - offsetX;
      const sourceY = y - offsetY;
      if (sourceX < 0 || sourceX >= frame.width || sourceY < 0 || sourceY >= frame.height) {
        continue;
      }
      const sourceOffset = (sourceY * frame.width + sourceX) * 4;
      const targetOffset = (y * frame.width + x) * 4;
      translated.rgba[targetOffset] = frame.rgba[sourceOffset]!;
      translated.rgba[targetOffset + 1] = frame.rgba[sourceOffset + 1]!;
      translated.rgba[targetOffset + 2] = frame.rgba[sourceOffset + 2]!;
      translated.rgba[targetOffset + 3] = frame.rgba[sourceOffset + 3]!;
    }
  }
  return translated;
}

function drawVisibleFlightDart(frame: CameraFrame) {
  // A connected narrow shaft with a much wider flight is the strongest non-trained direction cue
  // available to the browser-only detector: the narrow end is the candidate board entry point.
  drawDarkLine(frame, 360, 260, 407, 5);
  for (let y = 220; y <= 270; y += 1) {
    const halfWidth = Math.round(8 + (270 - y) * 0.45);
    for (let x = 360 - halfWidth; x <= 360 + halfWidth; x += 1) setPixel(frame, x, y, 20);
  }
}

function transformFrameSimilarity(
  frame: CameraFrame,
  offsetX: number,
  offsetY: number,
  scale: number,
  rotationRadians: number,
): CameraFrame {
  const transformed = makeFrame(frame.width, frame.height);
  const center = { x: frame.width / 2, y: frame.height / 2 };
  const cosine = Math.cos(rotationRadians);
  const sine = Math.sin(rotationRadians);
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      // Invert reference → current so each transformed output pixel samples the source frame.
      const dx = x - center.x - offsetX;
      const dy = y - center.y - offsetY;
      const sourceX = center.x + (dx * cosine + dy * sine) / scale;
      const sourceY = center.y + (-dx * sine + dy * cosine) / scale;
      const left = Math.floor(sourceX);
      const top = Math.floor(sourceY);
      if (left < 0 || left >= frame.width - 1 || top < 0 || top >= frame.height - 1) continue;
      const xFraction = sourceX - left;
      const yFraction = sourceY - top;
      const outputOffset = (y * frame.width + x) * 4;
      for (const channel of [0, 1, 2] as const) {
        const topLeft = frame.rgba[(top * frame.width + left) * 4 + channel]!;
        const topRight = frame.rgba[(top * frame.width + left + 1) * 4 + channel]!;
        const bottomLeft = frame.rgba[((top + 1) * frame.width + left) * 4 + channel]!;
        const bottomRight = frame.rgba[((top + 1) * frame.width + left + 1) * 4 + channel]!;
        const topValue = topLeft + (topRight - topLeft) * xFraction;
        const bottomValue = bottomLeft + (bottomRight - bottomLeft) * xFraction;
        transformed.rgba[outputOffset + channel] = Math.round(
          topValue + (bottomValue - topValue) * yFraction,
        );
      }
      transformed.rgba[outputOffset + 3] = 255;
    }
  }
  return transformed;
}

function drawBoardSurroundChange(frame: CameraFrame) {
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      // With this test's circular calibration, 310 px is just outside the double-wire scoring
      // face. The detector may retain this in its flight envelope but must not let it dominate the
      // broad-motion percentage or board-face illumination estimate.
      if (Math.hypot(x - frame.width / 2, y - frame.height / 2) > 310) setPixel(frame, x, y, 34);
    }
  }
}

function drawLowerOuterRimIntrusion(frame: CameraFrame) {
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const radius = Math.hypot(x - frame.width / 2, y - frame.height / 2);
      // A moving foreground beneath a centred mount can skim the bottom edge/number area. This
      // deliberately reaches the outer scoring face enough to exceed the historic broad-motion
      // percentage, but leaves the stable central board core untouched.
      if (radius >= 180 && radius <= 280 && y >= 540) setPixel(frame, x, y, 20);
    }
  }
}

function drawCheckerboard(frame: CameraFrame) {
  for (let y = 80; y < 640; y += 1) {
    for (let x = 80; x < 640; x += 1) {
      setPixel(frame, x, y, (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0 ? 135 : 230);
    }
  }
}

function drawTranslationTexture(frame: CameraFrame) {
  for (let y = 80; y < 640; y += 1) {
    for (let x = 80; x < 640; x += 1) {
      // Vary individual 8 px tiles so a large periodic shift cannot imitate a small safe
      // vibration in the translation tests.
      const tileX = Math.floor(x / 8);
      const tileY = Math.floor(y / 8);
      const hash = (Math.imul(tileX, 73_856_093) ^ Math.imul(tileY, 19_349_663)) >>> 0;
      setPixel(frame, x, y, 110 + (hash % 120));
    }
  }
}

function drawLargeChangedBlock(frame: CameraFrame) {
  for (let y = 100; y < 620; y += 1) {
    for (let x = 100; x < 620; x += 1) setPixel(frame, x, y, 20);
  }
}

function setPixel(frame: CameraFrame, x: number, y: number, value: number) {
  if (x < 0 || x >= frame.width || y < 0 || y >= frame.height) return;
  const offset = (y * frame.width + x) * 4;
  frame.rgba[offset] = value;
  frame.rgba[offset + 1] = value;
  frame.rgba[offset + 2] = value;
}

test('reports no change when the settled frame matches the clear-board reference', () => {
  const reference = makeFrame();
  const current = makeFrame();
  const result = analyzeDartDifference(reference, current, calibration(), {
    boardDiameterPixels: 570,
  });

  assert.equal(result.status, 'no-change');
  assert.equal(result.candidates.length, 0);
  assert.equal(result.changedPixels, 0);
  assert.ok(result.comparedPixels > 0);
  assert.equal(result.changedFraction, 0);
});

test('finds reviewable endpoint candidates for a newly visible elongated change', () => {
  const reference = makeFrame();
  const current = makeFrame();
  drawDarkLine(current, 360, 190, 390);

  const result = analyzeDartDifference(reference, current, calibration(), {
    boardDiameterPixels: 570,
  });

  assert.equal(result.status, 'dart-candidate');
  assert.ok(result.shapes.length >= 1);
  assert.ok(result.candidates.length >= 1);
  assert.ok(result.candidates.every((candidate) => candidate.confidence > 0));
  assert.ok(result.candidates.every((candidate) => candidate.tipLikelihood > 0));
  assert.ok(result.candidates.some((candidate) => candidate.zone.score >= 0));
  // A uniformly thin line provides two plausible on-board endpoints. It remains reviewable, but
  // must never be silently auto-recorded as whichever endpoint wins a tie-breaker.
  assert.equal(selectAutomaticTipCandidate(result.candidates), null);
  assert.ok(
    result.candidates.every((candidate) => candidate.directionEvidence === 'ambiguous-endpoint'),
  );
  // A single held prompt may expose a deterministic suggestion, but it is intentionally separate
  // from the automatic selector and requires a player action in Camera Play.
  assert.notEqual(selectReviewTipCandidate(result.candidates), null);
});

test('uses a clear wider-flight cue to auto-select the narrow board-entry endpoint', () => {
  const reference = makeFrame();
  const current = makeFrame();
  drawTranslationTexture(reference);
  drawTranslationTexture(current);
  drawVisibleFlightDart(current);

  const result = analyzeDartDifference(reference, current, calibration(), {
    boardDiameterPixels: 570,
  });

  assert.equal(result.status, 'dart-candidate');
  const selected = selectAutomaticTipCandidate(result.candidates);
  assert.ok(selected !== null);
  assert.equal(selected?.directionEvidence, 'narrow-endpoint-shape');
  assert.equal(selected?.endpoint, 'B');
  assert.ok(isAutomaticTipCandidateEligible(selected));
  assert.ok((selected?.imagePoint.y ?? 0) > 390);
});

test('never proposes a protruding flight endpoint as an automatic MISS', () => {
  const reference = makeFrame();
  const current = makeFrame();
  // The upper end is 6–8 mm beyond the outer double while the lower end is on the board. This
  // mirrors a flight/shaft extending past the ring from a real dart point and used to create a
  // false automatic MISS when both endpoints were retained for ranking.
  drawDarkLine(current, 360, 62, 300);

  const result = analyzeDartDifference(reference, current, calibration(), {
    boardDiameterPixels: 570,
  });
  assert.equal(result.status, 'dart-candidate');
  assert.ok(result.candidates.length >= 1);
  assert.ok(result.candidates.every((candidate) => candidate.zone.ring !== 'MISS'));
  const selected = selectAutomaticTipCandidate(result.candidates);
  assert.notEqual(selected?.zone.ring, 'MISS');
  assert.equal(selected?.directionEvidence, 'only-endpoint-on-board');
});

test('finds a subtle compact flight change for a near-centreline camera view', () => {
  const reference = makeFrame(720, 720, 110);
  const current = makeFrame(720, 720, 110);
  // Deliberately below the old 22-level floor: a front-on flight/occlusion need not look like a
  // high-contrast elongated shaft to be a useful correctable candidate.
  drawCompactFlight(current, 360, 190, 9, 92);

  const result = analyzeDartDifference(reference, current, calibration(), {
    boardDiameterPixels: 570,
  });
  assert.equal(result.status, 'dart-candidate');
  const compactCandidate = result.candidates[0];
  assert.equal(compactCandidate?.endpoint, 'center');
  assert.equal(compactCandidate?.directionEvidence, 'compact-local-change');
  assert.ok((compactCandidate?.confidence ?? 1) < 0.7);
  // A compact front-on flight can prove that something changed, not where its hidden point entered.
  assert.equal(selectAutomaticTipCandidate(result.candidates), null);
  assert.equal(selectReviewTipCandidate(result.candidates)?.id, compactCandidate?.id);
});

test('keeps a compact dart proposal through modest global exposure drift', () => {
  const reference = makeFrame();
  const current = makeFrame();
  drawCheckerboard(reference);
  drawCheckerboard(current);
  adjustExposure(current, 1.08, 4);
  drawCompactFlight(current, 360, 190, 9, 60);

  const result = analyzeDartDifference(reference, current, calibration(), {
    boardDiameterPixels: 570,
  });
  assert.equal(result.status, 'dart-candidate');
  assert.ok(result.changedFraction < 0.02);
});

test('keeps a board-local dart detectable when the permitted flight surround changes', () => {
  const reference = makeFrame();
  const current = makeFrame();
  drawTranslationTexture(reference);
  drawTranslationTexture(current);
  // A cabinet / room shadow can change outside the board while the board face itself is steady.
  // It must not become a broad-motion event or bias the exposure adjustment away from the dart.
  drawBoardSurroundChange(current);
  drawDarkLine(current, 360, 190, 250);

  const result = analyzeDartDifference(reference, current, calibration(), {
    boardDiameterPixels: 570,
  });

  assert.equal(result.status, 'dart-candidate');
  assert.ok(result.changedFraction < 0.02);
  assert.ok(result.candidates.some((candidate) => candidate.zone.segment === 20));
});

test('keeps a lower outer-rim foreground change out of the broad-motion stop', () => {
  const reference = makeFrame();
  const current = makeFrame();
  drawTranslationTexture(reference);
  drawTranslationTexture(current);
  drawLowerOuterRimIntrusion(current);

  const result = analyzeDartDifference(reference, current, calibration(), {
    boardDiameterPixels: 570,
    acceptedRadiusMm: analysisRadiusForBoardSkew(10),
  });

  assert.ok(result.changedFraction > 0.065);
  assert.ok(result.stableCoreChangedFraction < 0.025);
  assert.equal(result.requiresExplicitReview, true);
  assert.notEqual(result.status, 'camera-moved-or-hand-present');
  // A lower foreground intrusion becomes an abstention/recovery case, never an automatic score.
  assert.equal(selectAutomaticTipCandidate(result.candidates), null);
});

test('uses a tight board-local flight envelope for a near-centreline view', () => {
  assert.equal(analysisRadiusForBoardSkew(0), 194);
  assert.equal(analysisRadiusForBoardSkew(18), 194);
  assert.equal(analysisRadiusForBoardSkew(19), 212);
  assert.equal(analysisRadiusForBoardSkew(36), 240);
  assert.equal(analysisRadiusForBoardSkew(null), 212);
});

test('keeps a direct visible dart eligible with lower-room changes outside a centreline envelope', () => {
  const reference = makeFrame();
  const current = makeFrame();
  drawTranslationTexture(reference);
  drawTranslationTexture(current);
  drawBoardSurroundChange(current);
  drawVisibleFlightDart(current);

  const result = analyzeDartDifference(reference, current, calibration(), {
    boardDiameterPixels: 570,
    acceptedRadiusMm: analysisRadiusForBoardSkew(10),
  });

  assert.equal(result.status, 'dart-candidate');
  assert.equal(result.requiresExplicitReview, false);
  assert.equal(
    selectAutomaticTipCandidate(result.candidates)?.directionEvidence,
    'narrow-endpoint-shape',
  );
});

test('does not turn a board-length foreground edge into a dart shape', () => {
  const reference = makeFrame();
  const current = makeFrame();
  drawTranslationTexture(reference);
  drawTranslationTexture(current);
  drawDarkLine(current, 360, 100, 600, 5);

  const result = analyzeDartDifference(reference, current, calibration(), {
    boardDiameterPixels: 570,
  });

  assert.equal(result.status, 'ambiguous-change');
  assert.equal(result.shapes.length, 0);
  assert.equal(selectAutomaticTipCandidate(result.candidates), null);
});

test('absorbs bounded mount vibration before detecting a newly inserted dart', () => {
  const reference = makeFrame();
  drawTranslationTexture(reference);
  // The board moves four pixels right and three pixels up after an impact. The new dart stays at
  // the same board location, so it is translated with the board before its local change is drawn.
  const current = translateFrame(reference, 4, -3);
  drawDarkLine(current, 364, 187, 387);

  const result = analyzeDartDifference(reference, current, calibration(), {
    boardDiameterPixels: 570,
  });
  assert.equal(result.status, 'dart-candidate');
  assert.deepEqual(result.alignmentOffset, { x: 4, y: -3 });
  assert.ok(result.candidates.some((candidate) => candidate.zone.ring === 'T'));
  assert.ok(result.candidates.some((candidate) => candidate.zone.segment === 20));
  // Translation compensation must not restore the former arbitrary equal-endpoint auto-score.
  assert.equal(selectAutomaticTipCandidate(result.candidates), null);
});

test('absorbs bounded mobile optical-stabilization scale and rotation without inventing a dart', () => {
  const reference = makeFrame();
  drawTranslationTexture(reference);
  // This is comparable to a phone re-centering by about 2% of a 570 px board after impact.
  const current = transformFrameSimilarity(reference, 12, -3, 1.009, 0.007);

  const result = analyzeDartDifference(reference, current, calibration(), {
    boardDiameterPixels: 570,
  });

  assert.equal(result.status, 'no-change');
  assert.deepEqual(result.alignmentOffset, { x: 12, y: -3 });
  assert.ok(Math.abs(result.alignment.scale - 1.009) < 0.002);
  assert.ok(Math.abs(result.alignment.rotationRadians - 0.007) < 0.002);
  assert.ok(result.alignment.improvement > 0.5);
});

test('does not normalize a board translation beyond the bounded vibration allowance', () => {
  const reference = makeFrame();
  drawTranslationTexture(reference);
  const current = translateFrame(reference, 28, 0);

  const result = analyzeDartDifference(reference, current, calibration(), {
    boardDiameterPixels: 570,
  });
  assert.equal(result.status, 'camera-moved-or-hand-present');
  assert.ok(Math.abs(result.alignmentOffset.x) <= 16);
  assert.ok(Math.abs(result.alignmentOffset.y) <= 16);
});

test('manual visible-tip selection maps through the same canonical scorer', () => {
  const candidate = candidateFromManualPoint({ x: 360, y: 190 }, calibration());
  assert.notEqual(candidate, null);
  assert.ok(candidate !== null);
  assert.deepEqual(candidate.zone, makeZone('T', 20));
  assert.equal(candidate.tipLikelihood, 1);
  assert.ok(candidate.boardPoint.yMm < -90);
});

test('automatic candidate choice admits direct direction evidence and rejects arbitrary endpoints', () => {
  const base: Omit<DartTipCandidate, 'id' | 'tipLikelihood' | 'directionEvidence'> = {
    shapeId: 'shape-1',
    endpoint: 'A',
    imagePoint: { x: 350, y: 220 },
    boardPoint: { xMm: -6, yMm: -82 },
    zone: makeZone('S', 20),
    wireMarginMm: 3.2,
    confidence: 0.72,
  };
  const ambiguousWideEnd: DartTipCandidate = {
    ...base,
    id: 'ambiguous-wide-end',
    tipLikelihood: 0.91,
    directionEvidence: 'ambiguous-endpoint',
  };
  const containedEnd: DartTipCandidate = {
    ...base,
    id: 'contained-end',
    tipLikelihood: 0.8,
    directionEvidence: 'only-endpoint-on-board',
  };
  assert.equal(isAutomaticTipCandidateEligible(ambiguousWideEnd), false);
  assert.equal(isAutomaticTipCandidateEligible(containedEnd), true);
  assert.equal(selectAutomaticTipCandidate([ambiguousWideEnd, containedEnd])?.id, 'contained-end');

  const nearWireDirectEnd: DartTipCandidate = {
    ...containedEnd,
    id: 'near-wire-direct-end',
    wireMarginMm: 1.49,
  };
  assert.equal(isAutomaticTipCandidateEligible(nearWireDirectEnd), false);
  assert.equal(selectAutomaticTipCandidate([ambiguousWideEnd, nearWireDirectEnd]), null);

  const separateMappedChange: DartTipCandidate = {
    ...ambiguousWideEnd,
    id: 'separate-shape',
    shapeId: 'shape-2',
  };
  assert.equal(selectAutomaticTipCandidate([containedEnd, separateMappedChange]), null);
  assert.equal(selectReviewTipCandidate([containedEnd, separateMappedChange]), null);
});

test('rejects comparisons when camera resolution changes after reference capture', () => {
  const result = analyzeDartDifference(makeFrame(), makeFrame(640, 640), calibration());
  assert.equal(result.status, 'incompatible-frame');
});

test('rejects a large frame-wide change that reaches the stable board core', () => {
  const reference = makeFrame();
  const current = makeFrame();
  drawTranslationTexture(reference);
  drawTranslationTexture(current);
  drawLargeChangedBlock(current);

  const result = analyzeDartDifference(reference, current, calibration(), {
    boardDiameterPixels: 570,
  });
  assert.ok(result.changedFraction > 0.065);
  assert.equal(result.status, 'camera-moved-or-hand-present');
});

test('guided quality accepts a sharp, adequately sized straight-on board', () => {
  const frame = makeFrame();
  drawCheckerboard(frame);
  const quality = assessGuidedCalibration(anchors, frame);
  assert.equal(quality.pass, true);
  assert.ok(quality.boardDiameterPixels >= 480);
  assert.ok(quality.sharpness >= 7);
});

test('board-fit quality accepts the outer double-wire handles used by Camera Play', () => {
  const frame = makeFrame();
  drawCheckerboard(frame);
  const outerWireHandles: ImagePoint[] = [
    { x: 360, y: 70 },
    { x: 650, y: 360 },
    { x: 360, y: 650 },
    { x: 70, y: 360 },
  ];
  const quality = assessBoardFitCalibration(outerWireHandles, frame);
  assert.equal(quality.pass, true);
  assert.ok(quality.boardDiameterPixels >= 560);
});

test('board-fit quality uses the compressed axis as its resolution floor', () => {
  const frame = makeFrame();
  drawCheckerboard(frame);
  const obliqueHandles: ImagePoint[] = [
    { x: 360, y: 160 },
    { x: 690, y: 360 },
    { x: 360, y: 560 },
    { x: 30, y: 360 },
  ];
  const quality = assessBoardFitCalibration(obliqueHandles, frame);
  assert.equal(quality.pass, false);
  assert.equal(Math.round(quality.boardDiameterPixels), 400);
  assert.ok(quality.blockers.some((blocker) => blocker.includes('at least 480 px')));
});

test('guided quality blocks a board that is too small', () => {
  const smallAnchors: ImagePoint[] = [
    { x: 100, y: 80 },
    { x: 180, y: 160 },
    { x: 100, y: 240 },
    { x: 20, y: 160 },
  ];
  const quality = assessGuidedCalibration(smallAnchors, makeFrame(320, 320));
  assert.equal(quality.pass, false);
  assert.ok(quality.blockers.some((blocker) => blocker.includes('at least 480 px')));
});
