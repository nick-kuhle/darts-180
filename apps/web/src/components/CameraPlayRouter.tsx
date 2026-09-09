import { useEffect, useState } from 'react';

import { loadDevelopmentModelManifest } from '../lib/developmentVision/modelManifest';
import type { DeepDartsDevelopmentModelManifest } from '../lib/developmentVision/types';
import { isRunnableModelManifest, loadModelManifest } from '../lib/learnedVision/modelManifest';

import { DeepDartsDevelopmentCameraPlay } from './DeepDartsDevelopmentCameraPlay';
import { LearnedCameraPlay, type LearnedCameraPlayProps } from './LearnedCameraPlay';

/**
 * The strict schema-v2 ABI always wins. Only when it is intentionally unavailable can a separately
 * installed `development` five-point model enable the editable test loop.
 */
export function CameraPlayRouter(props: LearnedCameraPlayProps) {
  const [primaryManifestReady, setPrimaryManifestReady] = useState(false);
  const [primaryModelRunnable, setPrimaryModelRunnable] = useState(false);
  const [developmentModel, setDevelopmentModel] =
    useState<DeepDartsDevelopmentModelManifest | null>(null);

  useEffect(() => {
    let current = true;
    void loadModelManifest().then((loaded) => {
      if (!current) return;
      setPrimaryModelRunnable(isRunnableModelManifest(loaded.manifest));
      setPrimaryManifestReady(true);
    });
    void loadDevelopmentModelManifest().then((loaded) => {
      if (current) setDevelopmentModel(loaded.manifest);
    });
    return () => {
      current = false;
    };
  }, []);

  if (primaryManifestReady && !primaryModelRunnable && developmentModel !== null) {
    return <DeepDartsDevelopmentCameraPlay {...props} model={developmentModel} />;
  }
  return <LearnedCameraPlay {...props} />;
}
