import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isRunnableDevelopmentModelManifest,
  parseDevelopmentModelManifest,
} from '../src/lib/developmentVision/modelManifest.js';
import {
  isRunnableModelManifest,
  parseModelManifest,
} from '../src/lib/learnedVision/modelManifest.js';
import {
  assertAttestationMatchesManifest,
  parsePublicModelReleaseAttestation,
} from '../src/lib/learnedVision/modelReleaseAttestation.js';

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const publicRoot = resolve(packageRoot, 'public');
const defaultManifestPath = resolve(publicRoot, 'models/darts180-board-tip-v1.json');

export interface VerifyModelArtifactOptions {
  manifestPath?: string;
  /** Optional override for tests or a reviewed development package. */
  developmentManifestPath?: string;
  publicDirectory?: string;
  write?: (line: string) => void;
}

/**
 * CI-facing artifact gate. The browser Worker performs the same ONNX-byte check immediately before
 * inference; this command catches a missing, moved, or mis-hashed package before it can reach a
 * preview or production deployment.
 */
export async function verifyWebModelArtifact({
  manifestPath = defaultManifestPath,
  developmentManifestPath,
  publicDirectory = publicRoot,
  write = console.log,
}: VerifyModelArtifactOptions = {}): Promise<void> {
  const manifest = parseModelManifest(await readJson(manifestPath));
  if (!isRunnableModelManifest(manifest)) {
    if (manifest.releaseStage !== 'unavailable') {
      throw new Error('Only the explicit unavailable manifest may omit a runnable artifact.');
    }
    write(
      'Model artifact verification passed: explicit unavailable production manifest; no production model bytes expected.',
    );
  } else {
    const modelPath = await resolvePublicAsset(publicDirectory, manifest.assetPath);
    await assertFileHash(modelPath, manifest.sha256, 'ONNX artifact');

    if (manifest.releaseStage === 'production') {
      const attestationPath = manifest.releaseEvidence.attestationPath;
      const attestationHash = manifest.releaseEvidence.attestationSha256;
      if (attestationPath === null || attestationHash === null) {
        throw new Error('Production model manifest is missing its hash-bound release attestation.');
      }
      const resolvedAttestationPath = await resolvePublicAsset(publicDirectory, attestationPath);
      await assertFileHash(resolvedAttestationPath, attestationHash, 'release attestation');
      const attestation = parsePublicModelReleaseAttestation(
        await readJson(resolvedAttestationPath),
      );
      assertAttestationMatchesManifest(attestation, manifest);
    }

    write(
      `Model artifact verification passed: ${manifest.modelId}@${manifest.modelVersion} (${manifest.releaseStage}).`,
    );
  }

  const optionalDevelopmentManifest =
    developmentManifestPath ??
    resolve(publicDirectory, 'models/darts180-deepdarts-yolo-dev-v1.json');
  if (!(await fileSystemEntryExists(optionalDevelopmentManifest))) {
    write('No optional five-point development model package is installed.');
    return;
  }

  const developmentManifest = parseDevelopmentModelManifest(
    await readJson(optionalDevelopmentManifest),
  );
  if (!isRunnableDevelopmentModelManifest(developmentManifest)) {
    throw new Error('Development model manifest must name a runnable local ONNX artifact.');
  }
  const developmentModelPath = await resolvePublicAsset(
    publicDirectory,
    developmentManifest.assetPath,
  );
  await assertFileHash(
    developmentModelPath,
    developmentManifest.sha256,
    'development ONNX artifact',
  );
  write(
    `Development model artifact verification passed: ${developmentManifest.modelId}@${developmentManifest.modelVersion} (review-only).`,
  );
}

async function fileSystemEntryExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path: string): Promise<unknown> {
  let text: string;
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('not a regular file');
    text = await readFile(path, 'utf8');
  } catch {
    throw new Error(`Required model release file is missing or not a regular file: ${path}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Model release file is not valid JSON: ${path}`);
  }
}

async function resolvePublicAsset(publicDirectory: string, assetPath: string): Promise<string> {
  const resolvedPublicDirectory = resolve(publicDirectory);
  const resolvedAsset = resolve(resolvedPublicDirectory, assetPath.slice(1));
  const pathWithinPublicDirectory = relative(resolvedPublicDirectory, resolvedAsset);
  if (
    assetPath === '' ||
    pathWithinPublicDirectory === '' ||
    pathWithinPublicDirectory.startsWith('..') ||
    isAbsolute(pathWithinPublicDirectory)
  ) {
    throw new Error('Model release asset must resolve inside apps/web/public.');
  }
  try {
    const [canonicalPublicDirectory, canonicalAsset] = await Promise.all([
      realpath(resolvedPublicDirectory),
      realpath(resolvedAsset),
    ]);
    const canonicalRelativePath = relative(canonicalPublicDirectory, canonicalAsset);
    if (
      canonicalRelativePath === '' ||
      canonicalRelativePath.startsWith('..') ||
      isAbsolute(canonicalRelativePath)
    ) {
      throw new Error('Model release asset resolves outside apps/web/public.');
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('outside apps/web/public')) throw error;
    throw new Error(`Required model release asset is missing: ${resolvedAsset}`);
  }
  return resolvedAsset;
}

async function assertFileHash(path: string, expectedHash: string, label: string): Promise<void> {
  let bytes: Buffer;
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error('not a regular file');
    }
    bytes = await readFile(path);
  } catch {
    throw new Error(`Required ${label} is missing or not a regular file: ${path}`);
  }
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  if (actualHash !== expectedHash) {
    throw new Error(`${label} SHA-256 does not match the model manifest.`);
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  void verifyWebModelArtifact().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : 'Unknown model artifact verification failure.';
    console.error(`Model artifact verification failed: ${message}`);
    process.exitCode = 1;
  });
}
