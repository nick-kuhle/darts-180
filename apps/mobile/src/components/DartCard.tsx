import type { DartZone } from '@darts-180/contracts';
import { formatZone } from '@darts-180/rules';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface DartCardProps {
  index: number;
  zone: DartZone;
  confidence: number;
  wireMarginMm: number;
  source: 'auto' | 'manual';
  onPress: () => void;
}

export function DartCard({
  index,
  zone,
  confidence,
  wireMarginMm,
  source,
  onPress,
}: DartCardProps) {
  const needsReview = confidence < 0.97 || wireMarginMm < 1.5;
  const stateLabel = source === 'manual' ? 'MANUAL' : needsReview ? 'CHECK' : 'LOCKED';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Dart ${index}: ${formatZone(zone)}. Tap to change score.`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        needsReview ? styles.review : styles.accepted,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.topLine}>
        <Text style={styles.dartNumber}>DART {index}</Text>
        <Text style={[styles.badge, needsReview ? styles.reviewText : styles.acceptedText]}>
          {stateLabel}
        </Text>
      </View>
      <Text style={styles.zone}>{formatZone(zone)}</Text>
      <Text style={styles.points}>{zone.score} pts</Text>
      <Text style={styles.meta}>
        {Math.round(confidence * 100)}% score confidence · {wireMarginMm.toFixed(1)} mm from wire
      </Text>
      <Text style={styles.hint}>Tap to cycle a correction</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    gap: 4,
  },
  accepted: { backgroundColor: '#13221e', borderColor: '#256a54' },
  review: { backgroundColor: '#2b2314', borderColor: '#b87b20' },
  pressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },
  topLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dartNumber: { color: '#a7b5b2', fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  badge: { fontSize: 11, fontWeight: '900', letterSpacing: 0.8 },
  acceptedText: { color: '#57d6a8' },
  reviewText: { color: '#ffb64c' },
  zone: { color: '#f8fbfa', fontSize: 30, fontWeight: '900', letterSpacing: -0.5 },
  points: { color: '#c8d4d1', fontSize: 14, fontWeight: '700' },
  meta: { color: '#8c9b98', fontSize: 11, marginTop: 5 },
  hint: { color: '#d7e3e0', fontSize: 11, marginTop: 7, fontWeight: '600' },
});
