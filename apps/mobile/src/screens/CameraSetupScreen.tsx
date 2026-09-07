import { CameraView, useCameraPermissions } from 'expo-camera';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface CameraSetupScreenProps {
  onDone: () => void;
}

/**
 * This is a real camera permission/preview surface. The frame-processor is intentionally not
 * connected yet: it belongs in the native development-build bridge described in docs/03.
 */
export function CameraSetupScreen({ onDone }: CameraSetupScreenProps) {
  const [permission, requestPermission] = useCameraPermissions();

  if (permission === null) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Preparing camera…</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <Text style={styles.eyebrow}>CAMERA SETUP</Text>
        <Text style={styles.title}>Point Darts 180 at the board.</Text>
        <Text style={styles.copy}>
          Camera access is used only to see the board. In production, scoring is on-device unless
          you explicitly opt in to share an anonymized board crop for model improvement.
        </Text>
        <Pressable style={styles.primaryButton} onPress={requestPermission}>
          <Text style={styles.primaryButtonText}>Allow camera</Text>
        </Pressable>
        <Pressable onPress={onDone} style={styles.textButton}>
          <Text style={styles.textButtonText}>Not now — use manual scoring</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView style={styles.camera} facing="back">
        <View style={styles.topOverlay}>
          <Text style={styles.eyebrow}>ADAPTIVE BOARD SETUP</Text>
          <Text style={styles.overlayTitle}>Fit the full board inside the guide</Text>
          <Text style={styles.overlayCopy}>
            Best: mount on the centerline, 0.7–1.2 m away, slightly above.
          </Text>
        </View>
        <View style={styles.boardGuide}>
          <View style={styles.crossHorizontal} />
          <View style={styles.crossVertical} />
          <View style={styles.bullGuide} />
        </View>
        <View style={styles.bottomOverlay}>
          <Text style={styles.quality}>Setup preview only</Text>
          <Text style={styles.qualityCopy}>
            Native pose and dart detection will replace this label.
          </Text>
          <Pressable style={styles.primaryButton} onPress={onDone}>
            <Text style={styles.primaryButtonText}>Use demo scorer</Text>
          </Pressable>
        </View>
      </CameraView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#101415' },
  camera: { flex: 1, justifyContent: 'space-between', padding: 22 },
  centered: { flex: 1, backgroundColor: '#101415', padding: 28, justifyContent: 'center', gap: 16 },
  eyebrow: { color: '#57d6a8', fontSize: 11, fontWeight: '900', letterSpacing: 1.3 },
  title: { color: '#f8fbfa', fontSize: 29, lineHeight: 35, fontWeight: '900' },
  copy: { color: '#c3d0cd', fontSize: 15, lineHeight: 22 },
  topOverlay: {
    backgroundColor: 'rgba(16,20,21,0.84)',
    borderColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderRadius: 16,
    padding: 15,
    gap: 4,
  },
  overlayTitle: { color: '#fff', fontSize: 20, fontWeight: '800' },
  overlayCopy: { color: '#d4e1de', fontSize: 12, lineHeight: 17 },
  boardGuide: {
    alignSelf: 'center',
    width: 250,
    height: 250,
    borderRadius: 125,
    borderWidth: 3,
    borderColor: '#57d6a8',
    backgroundColor: 'rgba(87,214,168,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  crossHorizontal: { position: 'absolute', width: '100%', height: 1, backgroundColor: '#57d6a8' },
  crossVertical: { position: 'absolute', height: '100%', width: 1, backgroundColor: '#57d6a8' },
  bullGuide: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#ffb64c' },
  bottomOverlay: {
    backgroundColor: 'rgba(16,20,21,0.9)',
    borderRadius: 16,
    padding: 15,
    gap: 5,
  },
  quality: { color: '#ffcf7a', fontSize: 14, fontWeight: '900' },
  qualityCopy: { color: '#d4e1de', fontSize: 12, marginBottom: 6 },
  primaryButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#57d6a8',
    borderRadius: 14,
    paddingHorizontal: 18,
  },
  primaryButtonText: { color: '#0a1713', fontSize: 15, fontWeight: '900' },
  textButton: { alignItems: 'center', padding: 11 },
  textButtonText: { color: '#aab9b6', fontWeight: '700' },
});
