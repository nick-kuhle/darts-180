import { useEffect, useState } from 'react';

import { getBrowserVisionSupport } from '../lib/learnedVision/webInferenceClient';
import {
  isRunnableModelManifest,
  loadModelManifest,
  UNAVAILABLE_MODEL_MANIFEST,
} from '../lib/learnedVision/modelManifest';
import type { VisionModelArtifactManifest } from '@darts-180/contracts';

interface VisionDiagnosticsProps {
  onReturnToCamera: () => void;
}

/**
 * A transparent status page, not an alternate scorer. The retired color/frame-difference detector
 * is deliberately absent from both this UI and the normal Live Scoring route.
 */
export function VisionDiagnostics({ onReturnToCamera }: VisionDiagnosticsProps) {
  const [model, setModel] = useState<VisionModelArtifactManifest>(UNAVAILABLE_MODEL_MANIFEST);
  const [message, setMessage] = useState('Checking the same-origin learned model manifest…');
  const support = getBrowserVisionSupport();

  useEffect(() => {
    let live = true;
    void loadModelManifest().then((loaded) => {
      if (!live) return;
      setModel(loaded.manifest);
      setMessage(loaded.message ?? 'Manifest parsed and eligible for local Worker verification.');
    });
    return () => {
      live = false;
    };
  }, []);

  const runnable = isRunnableModelManifest(model);
  return (
    <section className="shell vision-diagnostics">
      <div className="vision-diagnostics-head">
        <div>
          <p className="eyebrow">LEARNED VISION DIAGNOSTICS</p>
          <h1>Evidence gates, not a backup heuristic.</h1>
          <p>
            This page makes the camera program inspectable without offering an older color or
            frame-difference scoring fallback. Normal play stays in Live Scoring; ordinary score
            correction stays in the score review screen.
          </p>
        </div>
        <button className="button primary" onClick={onReturnToCamera}>
          RETURN TO LIVE SCORING
        </button>
      </div>

      <div className="vision-diagnostics-grid">
        <article className={runnable ? 'is-pass' : 'is-hold'}>
          <small>01 · MODEL RELEASE</small>
          <strong>
            {runnable
              ? `${model.modelVersion} · ${model.releaseStage.toUpperCase()}`
              : 'NO VERIFIED MODEL ARTIFACT'}
          </strong>
          <p>{message}</p>
        </article>
        <article className={support.supported ? 'is-pass' : 'is-hold'}>
          <small>02 · BROWSER RUNTIME</small>
          <strong>
            {support.supported
              ? 'WORKER / BITMAP / INTEGRITY APIs READY'
              : 'BROWSER CAPABILITY HOLD'}
          </strong>
          <p>
            {support.supported
              ? 'WebGPU is attempted first, with single-threaded WASM fallback.'
              : support.reasons.join(' ')}
          </p>
        </article>
        <article className="is-info">
          <small>03 · COMPLETE BOARD POSE</small>
          <strong>NAMED LANDMARKS → ORIENTED HOMOGRAPHY</strong>
          <p>
            Bull plus named D20, D6, D3, and D11 anchors establish board geometry and orientation;
            repeated board colors do not decide the score map.
          </p>
        </article>
        <article className="is-info">
          <small>04 · SCORE SAFETY</small>
          <strong>LEARNED TIP → CANONICAL MM → RULES</strong>
          <p>
            The model never emits a score. Deterministic board geometry ranks zones, preserves
            near-wire ambiguity, and declines automatic MISS predictions.
          </p>
        </article>
        <article className="is-info">
          <small>05 · EVENT ASSOCIATION</small>
          <strong>LOW-RES TIMING ONLY</strong>
          <p>
            A tiny luma cue can request a post-impact burst but has no board coordinate, tip choice,
            score zone, or automatic eligibility role.
          </p>
        </article>
        <article className="is-hold">
          <small>06 · RELEASE REQUIREMENT</small>
          <strong>HELD-OUT REAL-DEVICE EVIDENCE REQUIRED</strong>
          <p>
            A production artifact must pass provenance, license, integrity, calibration, and
            held-out evaluation gates before automatic recording can be enabled.
          </p>
        </article>
      </div>
    </section>
  );
}
