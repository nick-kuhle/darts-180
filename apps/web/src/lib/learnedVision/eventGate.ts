/**
 * Low-resolution temporal event association for capture timing only.
 *
 * It deliberately has no board coordinates, dart shapes, endpoints, score zones, or eligibility
 * logic. The learned model owns localization and the deterministic rules engine owns scoring.
 */
export interface LumaFrame {
  width: number;
  height: number;
  values: Uint8Array;
  capturedAtMs: number;
}

export type CaptureEvent = 'none' | 'motion-started' | 'settled-after-motion' | 'camera-disturbed';

export interface EventGateOptions {
  /** Fraction of sampled pixels that must visibly change to start a capture event. */
  motionFraction: number;
  /** Mean luma delta at a sampled pixel that counts as changed. */
  lumaDelta: number;
  /** A broad scene change is likely a hand/mount disturbance, not a normal impact cue. */
  disturbanceFraction: number;
  /** Wait this long after the last motion before requesting a high-resolution model burst. */
  settleMs: number;
}

const DEFAULT_OPTIONS: EventGateOptions = {
  motionFraction: 0.012,
  lumaDelta: 22,
  disturbanceFraction: 0.42,
  settleMs: 260,
};

export class CaptureEventGate {
  private readonly options: EventGateOptions;
  private baseline: LumaFrame | null = null;
  private previous: LumaFrame | null = null;
  private sawMotionAtMs: number | null = null;
  private disturbed = false;

  public constructor(options: Partial<EventGateOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  public observe(frame: LumaFrame): CaptureEvent {
    if (!isFrameValid(frame)) return 'camera-disturbed';
    if (
      this.baseline === null ||
      this.previous === null ||
      !sameDimensions(this.baseline, frame) ||
      !sameDimensions(this.previous, frame)
    ) {
      this.baseline = cloneFrame(frame);
      this.previous = cloneFrame(frame);
      this.sawMotionAtMs = null;
      this.disturbed = false;
      return 'none';
    }
    if (this.disturbed) {
      this.previous = cloneFrame(frame);
      return 'camera-disturbed';
    }

    const baselineFraction = changedFraction(this.baseline, frame, this.options.lumaDelta);
    const frameFraction = changedFraction(this.previous, frame, this.options.lumaDelta);
    this.previous = cloneFrame(frame);
    if (baselineFraction >= this.options.disturbanceFraction) {
      this.sawMotionAtMs = frame.capturedAtMs;
      this.disturbed = true;
      return 'camera-disturbed';
    }

    if (this.sawMotionAtMs === null && baselineFraction >= this.options.motionFraction) {
      this.sawMotionAtMs = frame.capturedAtMs;
      return 'motion-started';
    }
    if (this.sawMotionAtMs !== null) {
      // Once the camera has stopped changing, count a settle interval from the most recent motion
      // frame. Compare neighbouring frames here: comparing every frame to the empty-board baseline
      // would keep a stationary, newly embedded dart permanently "in motion".
      if (frameFraction >= this.options.motionFraction) {
        this.sawMotionAtMs = frame.capturedAtMs;
        return 'motion-started';
      }
      if (frame.capturedAtMs - this.sawMotionAtMs >= this.options.settleMs) {
        this.sawMotionAtMs = null;
        this.baseline = cloneFrame(frame);
        return 'settled-after-motion';
      }
      return 'none';
    }

    // Adapt only while the scene is quiet. It accommodates normal exposure drift without turning
    // a dart-sized event into a localization signal or absorbing active motion into the baseline.
    this.baseline = blendBaseline(this.baseline, frame, 0.12);
    return 'none';
  }

  public reset(): void {
    this.baseline = null;
    this.previous = null;
    this.sawMotionAtMs = null;
    this.disturbed = false;
  }
}

export function createLumaFrame(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  capturedAtMs: number,
): LumaFrame {
  const values = new Uint8Array(width * height);
  for (let index = 0; index < values.length; index += 1) {
    const offset = index * 4;
    const red = rgba[offset] ?? 0;
    const green = rgba[offset + 1] ?? 0;
    const blue = rgba[offset + 2] ?? 0;
    values[index] = Math.round(red * 0.2126 + green * 0.7152 + blue * 0.0722);
  }
  return { width, height, values, capturedAtMs };
}

function changedFraction(previous: LumaFrame, next: LumaFrame, lumaDelta: number): number {
  let changed = 0;
  for (let index = 0; index < previous.values.length; index += 1) {
    if (Math.abs((previous.values[index] ?? 0) - (next.values[index] ?? 0)) >= lumaDelta)
      changed += 1;
  }
  return changed / previous.values.length;
}

function blendBaseline(previous: LumaFrame, next: LumaFrame, fraction: number): LumaFrame {
  const values = new Uint8Array(previous.values.length);
  for (let index = 0; index < values.length; index += 1) {
    const prior = previous.values[index] ?? 0;
    const current = next.values[index] ?? 0;
    values[index] = Math.round(prior + (current - prior) * fraction);
  }
  return {
    width: previous.width,
    height: previous.height,
    values,
    capturedAtMs: next.capturedAtMs,
  };
}

function cloneFrame(frame: LumaFrame): LumaFrame {
  return { ...frame, values: new Uint8Array(frame.values) };
}

function sameDimensions(left: LumaFrame, right: LumaFrame): boolean {
  return (
    left.width === right.width &&
    left.height === right.height &&
    left.values.length === right.values.length
  );
}

function isFrameValid(frame: LumaFrame): boolean {
  return (
    Number.isInteger(frame.width) &&
    Number.isInteger(frame.height) &&
    frame.width > 0 &&
    frame.height > 0 &&
    frame.values.length === frame.width * frame.height &&
    Number.isFinite(frame.capturedAtMs)
  );
}
