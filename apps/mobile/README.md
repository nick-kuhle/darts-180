# Darts 180 mobile app

This is the cross-platform product shell: Expo/React Native UI now, native camera/CV adapters
behind `src/vision/VisionEngine.ts` as the detection engine matures.

## Run

```bash
# From repository root
npm install
npm run dev:mobile
```

The current demo deliberately uses simulated vision candidates while providing a real
`expo-camera` setup preview. It exercises per-dart confirmation, manual corrections, X01
bust/double-out behavior, and checkout hints.

## Important camera distinction

- **Expo Go:** suitable for UI/manual scorer and camera preview.
- **Expo development build / native build:** required for `react-native-vision-camera`, JSI/TurboModule
  frame processing, Core ML/TFLite, and the production detection engine.

```bash
cd apps/mobile
npx expo prebuild --clean
npx expo run:ios        # macOS/Xcode
# or npx expo run:android
```

Before first external build, replace placeholder application IDs in `app.json`, initialize EAS, and
follow `docs/10-infra-devops.md`. Read `docs/03-detection-engine.md` before connecting a model.
