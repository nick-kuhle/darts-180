import type { BoardPointMm, DartZone } from '@darts-180/contracts';

import type { DevelopmentVisionFrame } from './engine';
import type { DeepDartsDevelopmentModelManifest, DevelopmentScoreSuggestion } from './types';

const MAX_EVIDENCE_EDGE_PX = 1440;

/**
 * Browser-memory-only evidence for an explicitly opted-in development test sample. This is never
 * sent to an API, stored in localStorage, or retained after the current page session unless the
 * tester manually downloads it.
 */
export interface LocalDevelopmentEvidence {
  schemaVersion: 1;
  kind: 'darts180-deepdarts-yolo-dev-v1';
  capturedAt: string;
  image: {
    contentType: 'image/jpeg';
    widthPx: number;
    heightPx: number;
    /** A local in-memory data URL; omitted from the exported JSON and downloaded as a JPEG instead. */
    dataUrl: string;
    timing: 'post-suggestion-settled-camera-frame';
  };
  model: {
    modelId: string;
    modelVersion: string;
    sha256: string;
  };
  suggestion: {
    zone: DartZone;
    boardPointMm: BoardPointMm;
    detectorConfidence: number;
    wireMarginMm: number;
  };
  detector: {
    /** Detector boxes below use exported-JPEG pixels, not the original camera-frame dimensions. */
    coordinateFrame: 'exported-jpeg-pixels';
    modelSourceFrame: { widthPx: number; heightPx: number };
    minimumAnchorConfidence: number | null;
    detections: readonly LocalDevelopmentDetectionEvidence[];
  };
}

export interface LocalDevelopmentDetectionEvidence {
  classId: 0 | 1 | 2 | 3 | 4;
  confidence: number;
  centerXPx: number;
  centerYPx: number;
  widthPx: number;
  heightPx: number;
}

export interface CorrectedDevelopmentEvidenceSample {
  slot: 1 | 2 | 3;
  finalZone: DartZone;
  reviewState: 'confirmed-as-predicted' | 'corrected';
  evidence: LocalDevelopmentEvidence;
}

/**
 * Capture a bounded JPEG only after the tester has opted in. The dart is already settled; this
 * local frame is close to—not falsely claimed to be byte-identical with—the transferred model
 * frame. The exact model detection values are stored alongside it.
 */
export function captureLocalDevelopmentEvidence(
  video: HTMLVideoElement,
  model: DeepDartsDevelopmentModelManifest,
  suggestion: DevelopmentScoreSuggestion,
  frame: DevelopmentVisionFrame,
): LocalDevelopmentEvidence | null {
  if (video.videoWidth <= 0 || video.videoHeight <= 0) return null;
  const scale = Math.min(1, MAX_EVIDENCE_EDGE_PX / Math.max(video.videoWidth, video.videoHeight));
  const widthPx = Math.max(1, Math.round(video.videoWidth * scale));
  const heightPx = Math.max(1, Math.round(video.videoHeight * scale));
  try {
    const canvas = document.createElement('canvas');
    canvas.width = widthPx;
    canvas.height = heightPx;
    const context = canvas.getContext('2d');
    if (context === null) return null;
    context.drawImage(video, 0, 0, widthPx, heightPx);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    if (!dataUrl.startsWith('data:image/jpeg;base64,')) return null;
    return {
      schemaVersion: 1,
      kind: 'darts180-deepdarts-yolo-dev-v1',
      capturedAt: new Date().toISOString(),
      image: {
        contentType: 'image/jpeg',
        widthPx,
        heightPx,
        dataUrl,
        timing: 'post-suggestion-settled-camera-frame',
      },
      model: {
        modelId: model.modelId,
        modelVersion: model.modelVersion,
        sha256: model.sha256,
      },
      suggestion: {
        zone: suggestion.zone,
        boardPointMm: suggestion.boardPointMm,
        detectorConfidence: suggestion.detectorConfidence,
        wireMarginMm: suggestion.wireMarginMm,
      },
      detector: {
        coordinateFrame: 'exported-jpeg-pixels',
        modelSourceFrame: { widthPx: video.videoWidth, heightPx: video.videoHeight },
        minimumAnchorConfidence: frame.pose?.minimumAnchorConfidence ?? null,
        detections: frame.detections.map((detection) => ({
          classId: detection.classId,
          confidence: detection.confidence,
          centerXPx: detection.center.xPx * scale,
          centerYPx: detection.center.yPx * scale,
          widthPx: detection.widthPx * scale,
          heightPx: detection.heightPx * scale,
        })),
      },
    };
  } catch {
    // Evidence capture is optional. It must not block scoring or turn a camera security error into
    // retained media; the editable score suggestion remains usable without a sample JPEG.
    return null;
  }
}

/**
 * Download one manifest plus one JPEG per **human-reviewed** development sample. No network call,
 * hidden persistence, or automatic upload occurs. The tester chooses the folder/browser permission.
 */
export function downloadCorrectedDevelopmentEvidence(
  samples: readonly CorrectedDevelopmentEvidenceSample[],
): void {
  if (samples.length === 0) return;
  const batchId = timestampId(new Date());
  const exportedSamples = samples.map((sample) => {
    const imageFilename = `darts180-dev-${batchId}-dart-${sample.slot}.jpg`;
    downloadBlob(dataUrlToBlob(sample.evidence.image.dataUrl), imageFilename);
    return {
      schemaVersion: sample.evidence.schemaVersion,
      kind: sample.evidence.kind,
      slot: sample.slot,
      reviewState: sample.reviewState,
      finalZone: sample.finalZone,
      imageFilename,
      capturedAt: sample.evidence.capturedAt,
      image: {
        contentType: sample.evidence.image.contentType,
        widthPx: sample.evidence.image.widthPx,
        heightPx: sample.evidence.image.heightPx,
        timing: sample.evidence.image.timing,
      },
      model: sample.evidence.model,
      suggestion: sample.evidence.suggestion,
      detector: sample.evidence.detector,
    };
  });
  const manifest = {
    schemaVersion: 1,
    kind: 'darts180-local-development-evidence-batch',
    exportedAt: new Date().toISOString(),
    privacy: {
      uploaded: false,
      persistedByApp: false,
      note: 'Images are downloaded only because the tester explicitly clicked export.',
    },
    samples: exportedSamples,
  };
  downloadBlob(
    new Blob([`${JSON.stringify(manifest, null, 2)}\n`], { type: 'application/json' }),
    `darts180-dev-${batchId}-manifest.json`,
  );
}

function dataUrlToBlob(dataUrl: string): Blob {
  const prefix = 'data:image/jpeg;base64,';
  if (!dataUrl.startsWith(prefix))
    throw new Error('Development evidence image is not a JPEG data URL.');
  const decoded = atob(dataUrl.slice(prefix.length));
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return new Blob([bytes], { type: 'image/jpeg' });
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function timestampId(date: Date): string {
  return date.toISOString().replace(/[-:.]/g, '').replace('T', '-').replace('Z', 'Z');
}
