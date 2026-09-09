import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { verifyWebModelArtifact } from '../scripts/verify-model-artifact.js';

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function createProductionPackage() {
  const directory = await mkdtemp(join(tmpdir(), 'darts180-model-artifact-'));
  const publicDirectory = join(directory, 'public');
  const modelsDirectory = join(publicDirectory, 'models');
  await mkdir(modelsDirectory, { recursive: true });

  const modelBytes = 'tiny test model bytes';
  const modelHash = sha256(modelBytes);
  const decisionPolicy = {
    autoRecordEnabled: true,
    minAutoScoreProbability: 0.97,
    minAutoScoreWireMarginMm: 1.5,
    minReviewProbability: 0.45,
    minZonePosteriorMargin: 0.08,
    minLandmarkConfidence: 0.45,
    maxPoseValidationResidualMm: 18,
    maxQualityOffAxisDegrees: 65,
    minBoardDiameterPixels: 480,
    minOverallQuality: 0.7,
    minBoardCoverage: 0.8,
    minSharpness: 0.7,
    maxGlareRisk: 0.45,
    maxOcclusionRisk: 0.5,
    tipTrackMatchDistanceMm: 12,
    tipTrackSettleMs: 320,
    tipTrackStaleAfterMs: 1200,
    maxTipTrackSpreadMm: 4,
    confidenceTemperature: 1,
    confidenceBias: 0,
    heldOutEvaluationId: 'held-out-eval-test-v2',
  };
  const attestation = {
    schemaVersion: 1,
    modelId: 'darts180-board-tip',
    modelVersion: 'test-production-v2',
    modelSha256: modelHash,
    outputContract: 'darts180-board-tip-v1',
    trainingDataId: 'consented-data-test-v2',
    licenseReviewId: 'license-review-test-v2',
    heldOutEvaluationId: 'held-out-eval-test-v2',
    evaluatedAt: '2026-09-08T00:00:00.000Z',
    approvalId: 'approval-test-v2',
    decisionPolicy,
    evaluation: {
      evaluatedDartCount: 1000,
      exactScoreRate: 0.99,
      unsafeAutoRecordRate: 0.001,
      reviewOrAbstainRate: 0.02,
    },
  };
  const attestationText = `${JSON.stringify(attestation, null, 2)}\n`;
  const manifest = {
    schemaVersion: 2,
    modelId: 'darts180-board-tip',
    modelVersion: 'test-production-v2',
    releaseStage: 'production',
    assetPath: '/models/test-production-v2.onnx',
    sha256: modelHash,
    runtime: 'onnxruntime-web',
    input: { width: 1024, height: 1024, colorOrder: 'rgb', normalization: 'zero-to-one' },
    outputContract: 'darts180-board-tip-v1',
    outputs: { landmarks: 'board_landmarks', dartTips: 'dart_tips', quality: 'quality' },
    decisionPolicy,
    provenance: {
      trainingDataId: 'consented-data-test-v2',
      licenseReviewId: 'license-review-test-v2',
      evaluatedAt: '2026-09-08T00:00:00.000Z',
    },
    releaseEvidence: {
      attestationPath: '/models/test-production-v2.attestation.json',
      attestationSha256: sha256(attestationText),
      approvalId: 'approval-test-v2',
    },
  };
  const manifestPath = join(modelsDirectory, 'darts180-board-tip-v1.json');
  await Promise.all([
    writeFile(join(modelsDirectory, 'test-production-v2.onnx'), modelBytes),
    writeFile(join(modelsDirectory, 'test-production-v2.attestation.json'), attestationText),
    writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`),
  ]);
  return { directory, manifestPath, publicDirectory, modelBytes, manifest, decisionPolicy };
}

test('model artifact verifier requires exact model and attestation bytes for a production manifest', async () => {
  const fixture = await createProductionPackage();
  try {
    const messages: string[] = [];
    await verifyWebModelArtifact({
      manifestPath: fixture.manifestPath,
      publicDirectory: fixture.publicDirectory,
      write: (line) => messages.push(line),
    });
    assert.deepEqual(messages, [
      'Model artifact verification passed: darts180-board-tip@test-production-v2 (production).',
    ]);

    await writeFile(join(fixture.publicDirectory, 'models/test-production-v2.onnx'), 'tampered');
    await assert.rejects(
      verifyWebModelArtifact({
        manifestPath: fixture.manifestPath,
        publicDirectory: fixture.publicDirectory,
      }),
      /ONNX artifact SHA-256 does not match/,
    );

    await writeFile(
      join(fixture.publicDirectory, 'models/test-production-v2.onnx'),
      fixture.modelBytes,
    );
    await writeFile(
      fixture.manifestPath,
      `${JSON.stringify(
        {
          ...fixture.manifest,
          decisionPolicy: { ...fixture.decisionPolicy, minAutoScoreProbability: 0.5 },
        },
        null,
        2,
      )}\n`,
    );
    await assert.rejects(
      verifyWebModelArtifact({
        manifestPath: fixture.manifestPath,
        publicDirectory: fixture.publicDirectory,
      }),
      /attestation decision policy does not match/,
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('model artifact verifier refuses symlinked release assets', async () => {
  const fixture = await createProductionPackage();
  const modelsDirectory = join(fixture.publicDirectory, 'models');
  const modelPath = join(modelsDirectory, 'test-production-v2.onnx');
  try {
    const manifestAliasPath = join(modelsDirectory, 'manifest-alias.json');
    await symlink(fixture.manifestPath, manifestAliasPath);
    await assert.rejects(
      verifyWebModelArtifact({
        manifestPath: manifestAliasPath,
        publicDirectory: fixture.publicDirectory,
      }),
      /model release file is missing or not a regular file/i,
    );
    await rm(manifestAliasPath);

    const aliasPath = join(modelsDirectory, 'test-production-v2-alias.onnx');
    await symlink(modelPath, aliasPath);
    await writeFile(
      fixture.manifestPath,
      `${JSON.stringify(
        { ...fixture.manifest, assetPath: '/models/test-production-v2-alias.onnx' },
        null,
        2,
      )}\n`,
    );
    await assert.rejects(
      verifyWebModelArtifact({
        manifestPath: fixture.manifestPath,
        publicDirectory: fixture.publicDirectory,
      }),
      /ONNX artifact is missing or not a regular file/,
    );

    await rm(aliasPath);
    const externalModelPath = join(fixture.directory, 'outside-public.onnx');
    await writeFile(externalModelPath, fixture.modelBytes);
    await rm(modelPath);
    await symlink(externalModelPath, modelPath);
    await writeFile(fixture.manifestPath, `${JSON.stringify(fixture.manifest, null, 2)}\n`);
    await assert.rejects(
      verifyWebModelArtifact({
        manifestPath: fixture.manifestPath,
        publicDirectory: fixture.publicDirectory,
      }),
      /asset resolves outside apps\/web\/public/,
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
