import assert from 'node:assert/strict';
import test from 'node:test';

import { boardFitsAreSimilar, detectBoardFitFromColors } from '../src/lib/autoBoardFit.js';
import { assessAutomaticBoardFitQuality, type CameraFrame } from '../src/lib/cameraScoring.js';

function makeFrame(width = 960, height = 720, fill = 26): CameraFrame {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba[offset] = fill;
    rgba[offset + 1] = fill;
    rgba[offset + 2] = fill;
    rgba[offset + 3] = 255;
  }
  return { width, height, rgba, capturedAtMs: 1_000 };
}

function drawSyntheticAccentBoard(
  frame: CameraFrame,
  centerX: number,
  centerY: number,
  horizontalRadius: number,
  verticalRadius: number,
  rotationDegrees = 0,
) {
  const radians = (rotationDegrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const imageX = x - centerX;
      const imageY = y - centerY;
      const localX = imageX * cosine + imageY * sine;
      const localY = -imageX * sine + imageY * cosine;
      const radius = Math.hypot(localX / horizontalRadius, localY / verticalRadius);
      const angle = ((Math.atan2(localX, -localY) * 180) / Math.PI + 360) % 360;
      const sector = Math.floor((angle + 9) / 18) % 20;
      const isAccent =
        (radius >= 162 / 170 && radius <= 1) ||
        (radius >= 99 / 170 && radius <= 107 / 170) ||
        radius <= 15.9 / 170;
      if (!isAccent) continue;
      setPixel(frame, x, y, sector % 2 === 0 ? [214, 70, 61] : [27, 149, 104]);
    }
  }
}

function drawRedSurround(
  frame: CameraFrame,
  centerX: number,
  centerY: number,
  innerHorizontalRadius: number,
  innerVerticalRadius: number,
  outerHorizontalRadius: number,
  outerVerticalRadius: number,
) {
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const outerRadius = Math.hypot(
        (x - centerX) / outerHorizontalRadius,
        (y - centerY) / outerVerticalRadius,
      );
      const innerRadius = Math.hypot(
        (x - centerX) / innerHorizontalRadius,
        (y - centerY) / innerVerticalRadius,
      );
      if (outerRadius <= 1 && innerRadius >= 1) setPixel(frame, x, y, [214, 70, 61]);
    }
  }
}

function drawLopsidedRedBranding(frame: CameraFrame) {
  // Approximate saturated marketing lettering/decoration around one side of a board. It is not a
  // radial scoring band and must not drag the color-fit center or guide rotation toward itself.
  const blocks = [
    [150, 310],
    [180, 350],
    [205, 390],
    [250, 610],
    [300, 645],
  ] as const;
  for (const [centerX, centerY] of blocks) {
    for (let y = centerY - 12; y <= centerY + 12; y += 1) {
      for (let x = centerX - 25; x <= centerX + 25; x += 1) {
        if ((x + y) % 7 < 5) setPixel(frame, x, y, [214, 70, 61]);
      }
    }
  }
}

function drawTwoColorOval(
  frame: CameraFrame,
  centerX: number,
  centerY: number,
  horizontalRadius: number,
  verticalRadius: number,
) {
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const radius = Math.hypot((x - centerX) / horizontalRadius, (y - centerY) / verticalRadius);
      if (radius > 1) continue;
      setPixel(frame, x, y, x < centerX ? [214, 70, 61] : [27, 149, 104]);
    }
  }
}

function setPixel(
  frame: CameraFrame,
  x: number,
  y: number,
  color: readonly [number, number, number],
) {
  const offset = (y * frame.width + x) * 4;
  frame.rgba[offset] = color[0];
  frame.rgba[offset + 1] = color[1];
  frame.rgba[offset + 2] = color[2];
}

test('finds a standard red/green board and returns outer-double guide handles', () => {
  const frame = makeFrame();
  drawSyntheticAccentBoard(frame, 480, 360, 290, 250, 10);

  const result = detectBoardFitFromColors(frame);
  assert.equal(result.status, 'found');
  assert.notEqual(result.fit, null);
  assert.ok(result.fit !== null);
  assert.ok(result.confidence > 0.4);
  assert.ok(result.estimatedBoardDiameterPixels >= 480);
  assert.ok(Math.abs((result.center?.x ?? 0) - 480) < 8);
  assert.ok(Math.abs((result.center?.y ?? 0) - 360) < 8);
  assert.ok(
    Math.hypot(result.fit[0].x - result.fit[2].x, result.fit[0].y - result.fit[2].y) >= 480,
  );
  assert.ok(
    Math.hypot(result.fit[1].x - result.fit[3].x, result.fit[1].y - result.fit[3].y) >= 480,
  );
  assert.equal(assessAutomaticBoardFitQuality(result.fit, frame).pass, true);
});

test('finds scoring bands inside a large red surround instead of fitting the surround', () => {
  const frame = makeFrame(960, 960);
  drawRedSurround(frame, 480, 480, 330, 310, 450, 430);
  drawSyntheticAccentBoard(frame, 480, 480, 300, 280);

  const result = detectBoardFitFromColors(frame);
  assert.equal(result.status, 'found');
  assert.ok(result.fit !== null);
  assert.ok(Math.abs((result.center?.x ?? 0) - 480) < 8);
  assert.ok(Math.abs((result.center?.y ?? 0) - 480) < 8);
  assert.ok(result.estimatedBoardDiameterPixels >= 520);
  assert.ok(result.estimatedBoardDiameterPixels <= 620);
});

test('uses repeated-band and bull evidence instead of lopsided red board branding', () => {
  const frame = makeFrame();
  drawSyntheticAccentBoard(frame, 480, 360, 290, 250);
  drawLopsidedRedBranding(frame);

  const result = detectBoardFitFromColors(frame);
  assert.equal(result.status, 'found');
  assert.ok(result.fit !== null);
  assert.ok(Math.abs((result.center?.x ?? 0) - 480) < 8);
  assert.ok(Math.abs((result.center?.y ?? 0) - 360) < 8);
  assert.ok(result.estimatedBoardDiameterPixels >= 480);
  assert.ok(result.estimatedBoardDiameterPixels <= 530);
  assert.ok(result.outerAlternatingColorStrength > 0.2);
  assert.ok(result.bandColorPhaseAgreement > 0.8);
});

test('rejects frames without a sufficient red/green board pattern', () => {
  const result = detectBoardFitFromColors(makeFrame());
  assert.equal(result.status, 'not-found');
  assert.equal(result.fit, null);
  assert.match(result.message, /red and green/i);
});

test('rejects a red-and-green filled oval without distinct scoring-band gaps', () => {
  const frame = makeFrame();
  drawTwoColorOval(frame, 480, 360, 290, 250);

  const result = detectBoardFitFromColors(frame);
  assert.equal(result.status, 'not-found');
  assert.equal(result.fit, null);
  assert.match(result.message, /double-and-treble scoring-band pattern/i);
});

test('requires two comparable color fits before treating a board as stable', () => {
  const frame = makeFrame();
  drawSyntheticAccentBoard(frame, 480, 360, 290, 250, 0);
  const first = detectBoardFitFromColors(frame);
  const second = detectBoardFitFromColors(frame);
  assert.ok(first.fit !== null && second.fit !== null);
  assert.equal(boardFitsAreSimilar(first.fit, second.fit), true);

  const shiftedFrame = makeFrame();
  drawSyntheticAccentBoard(shiftedFrame, 570, 360, 290, 250, 0);
  const shifted = detectBoardFitFromColors(shiftedFrame);
  assert.ok(shifted.fit !== null);
  assert.equal(boardFitsAreSimilar(first.fit, shifted.fit), false);

  const rotatedHandleOrder = [first.fit[1], first.fit[2], first.fit[3], first.fit[0]] as const;
  assert.equal(boardFitsAreSimilar(first.fit, rotatedHandleOrder), false);
});
