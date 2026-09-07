import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { applyX01Visit, createX01State, findCheckoutRoutes, formatZone } from '@darts-180/rules';

import { DartCard } from './src/components/DartCard';
import { cycleZone, mockTurn, type DartDraft } from './src/game/demo-data';
import { CameraSetupScreen } from './src/screens/CameraSetupScreen';

function newDemoGame() {
  return createX01State(['Alex', 'Jordan'], { startingScore: 501, outRule: 'double' });
}

export default function App() {
  const [game, setGame] = useState(newDemoGame);
  const [drafts, setDrafts] = useState<DartDraft[]>(() => mockTurn(0));
  const [mockTurnIndex, setMockTurnIndex] = useState(0);
  const [notice, setNotice] = useState(
    'Camera demo loaded. Review each dart before confirming the visit.',
  );
  const [showCameraSetup, setShowCameraSetup] = useState(false);

  const currentPlayer = game.players[game.activePlayerIndex];
  const checkoutHint = useMemo(() => {
    if (currentPlayer === undefined || currentPlayer.remaining > 170) return undefined;
    return findCheckoutRoutes(currentPlayer.remaining, { limit: 1 })[0]?.notation;
  }, [currentPlayer]);

  if (showCameraSetup) {
    return <CameraSetupScreen onDone={() => setShowCameraSetup(false)} />;
  }

  const cycleDraft = (index: number) => {
    setDrafts((current) =>
      current.map((draft, draftIndex) =>
        draftIndex === index
          ? {
              ...draft,
              zone: cycleZone(draft.zone),
              confidence: 1,
              wireMarginMm: 99,
              source: 'manual',
            }
          : draft,
      ),
    );
    setNotice(
      `Dart ${index + 1} marked as a manual correction. The event log will retain that provenance.`,
    );
  };

  const simulateCameraTurn = () => {
    const nextIndex = mockTurnIndex + 1;
    setMockTurnIndex(nextIndex);
    setDrafts(mockTurn(nextIndex));
    setNotice('New simulated camera result. Amber cards are intentionally routed to human review.');
  };

  const confirmVisit = () => {
    if (currentPlayer === undefined || game.winnerId !== undefined) return;
    try {
      const result = applyX01Visit(
        game,
        currentPlayer.playerId,
        drafts.map((draft) => draft.zone),
      );
      setGame(result.state);
      if (result.checkout) {
        setNotice(`${currentPlayer.playerId} checked out. The leg is complete.`);
      } else if (result.bust) {
        setNotice(`Bust — ${currentPlayer.playerId} returns to ${currentPlayer.remaining}.`);
      } else {
        setNotice(
          `${currentPlayer.playerId} confirmed ${result.turnScore}. ${result.state.players[result.state.activePlayerIndex]?.playerId ?? 'Next player'} to throw.`,
        );
      }
      setDrafts(mockTurn(mockTurnIndex + 1));
      setMockTurnIndex((value) => value + 1);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not confirm that visit.');
    }
  };

  const resetGame = () => {
    setGame(newDemoGame());
    setDrafts(mockTurn(0));
    setMockTurnIndex(0);
    setNotice('Fresh 501 leg. This local demo is ready for a camera session.');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.wordmark}>
              DARTS <Text style={styles.wordmarkAccent}>180</Text>
            </Text>
            <Text style={styles.subtitle}>THE CONFIRMABLE DARTS REFEREE</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            style={styles.cameraButton}
            onPress={() => setShowCameraSetup(true)}
          >
            <Text style={styles.cameraButtonText}>⌁ CAMERA</Text>
          </Pressable>
        </View>

        <View style={styles.scoreboard}>
          {game.players.map((player, index) => {
            const active = index === game.activePlayerIndex && game.winnerId === undefined;
            return (
              <View
                key={player.playerId}
                style={[styles.playerScore, active && styles.activePlayerScore]}
              >
                <Text style={styles.playerName}>{player.playerId.toUpperCase()}</Text>
                <Text style={styles.remaining}>{player.remaining}</Text>
                <Text style={styles.playerMeta}>
                  {active ? 'AT THE OCHE' : `${player.busts} bust${player.busts === 1 ? '' : 's'}`}
                </Text>
              </View>
            );
          })}
        </View>

        {game.winnerId !== undefined ? (
          <View style={styles.winnerPanel}>
            <Text style={styles.winnerEyebrow}>LEG COMPLETE</Text>
            <Text style={styles.winnerTitle}>{game.winnerId.toUpperCase()} WINS</Text>
            <Pressable style={styles.primaryButton} onPress={resetGame}>
              <Text style={styles.primaryButtonText}>Start another 501</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.sectionHeading}>
              <View>
                <Text style={styles.eyebrow}>
                  LIVE TURN · {currentPlayer?.playerId.toUpperCase()}
                </Text>
                <Text style={styles.sectionTitle}>Confirm the board, dart by dart.</Text>
              </View>
              <Text style={styles.turnTotal}>
                {drafts.reduce((sum, draft) => sum + draft.zone.score, 0)}
              </Text>
            </View>

            <View style={styles.cards}>
              {drafts.map((draft, index) => (
                <DartCard
                  key={draft.id}
                  index={index + 1}
                  zone={draft.zone}
                  confidence={draft.confidence}
                  wireMarginMm={draft.wireMarginMm}
                  source={draft.source}
                  onPress={() => cycleDraft(index)}
                />
              ))}
            </View>

            {checkoutHint !== undefined && (
              <View style={styles.checkoutHint}>
                <Text style={styles.checkoutLabel}>CHECKOUT ROUTE</Text>
                <Text style={styles.checkoutValue}>{checkoutHint}</Text>
              </View>
            )}

            <View style={styles.noticePanel}>
              <Text style={styles.noticeLabel}>SESSION LOG</Text>
              <Text style={styles.noticeText}>{notice}</Text>
            </View>

            <Pressable
              accessibilityRole="button"
              style={styles.primaryButton}
              onPress={confirmVisit}
            >
              <Text style={styles.primaryButtonText}>
                Confirm {drafts.map((draft) => formatZone(draft.zone)).join(' · ')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={styles.secondaryButton}
              onPress={simulateCameraTurn}
            >
              <Text style={styles.secondaryButtonText}>Simulate next camera result</Text>
            </Pressable>
          </>
        )}

        <View style={styles.footer}>
          <Text style={styles.footerTitle}>Implementation status</Text>
          <Text style={styles.footerText}>
            Rules and confirmation UX are live in this prototype. Camera preview works in Expo;
            production per-frame detection remains behind the native VisionEngine contract and needs
            a development build plus measured real-world validation.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#101415' },
  container: { padding: 20, paddingBottom: 38, gap: 18 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
  },
  wordmark: {
    color: '#f5f9f7',
    fontSize: 28,
    lineHeight: 30,
    letterSpacing: -1.8,
    fontWeight: '900',
  },
  wordmarkAccent: { color: '#57d6a8' },
  subtitle: { color: '#82908e', marginTop: 3, fontSize: 9, fontWeight: '800', letterSpacing: 1.15 },
  cameraButton: {
    borderWidth: 1,
    borderColor: '#31564a',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  cameraButtonText: { color: '#8de7c4', fontWeight: '900', fontSize: 11, letterSpacing: 0.5 },
  scoreboard: { flexDirection: 'row', gap: 10 },
  playerScore: {
    flex: 1,
    backgroundColor: '#19201f',
    borderRadius: 18,
    padding: 15,
    borderWidth: 1,
    borderColor: '#273331',
  },
  activePlayerScore: { borderColor: '#57d6a8', backgroundColor: '#14221e' },
  playerName: { color: '#acb9b6', fontSize: 11, fontWeight: '900', letterSpacing: 0.9 },
  remaining: { color: '#f8fbfa', fontSize: 38, lineHeight: 45, fontWeight: '900', marginTop: 3 },
  playerMeta: { color: '#82908e', fontSize: 10, fontWeight: '700' },
  sectionHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 5,
  },
  eyebrow: { color: '#57d6a8', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  sectionTitle: { color: '#f4f8f6', fontSize: 21, lineHeight: 26, fontWeight: '800', marginTop: 3 },
  turnTotal: { color: '#ffca72', fontSize: 30, fontWeight: '900' },
  cards: { gap: 10 },
  checkoutHint: {
    borderLeftWidth: 3,
    borderLeftColor: '#ffb64c',
    paddingLeft: 13,
    paddingVertical: 5,
  },
  checkoutLabel: { color: '#ffca72', fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  checkoutValue: { color: '#f7f3ea', fontSize: 17, fontWeight: '800', marginTop: 2 },
  noticePanel: { backgroundColor: '#171e1d', borderRadius: 14, padding: 13, gap: 4 },
  noticeLabel: { color: '#83908e', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  noticeText: { color: '#d7e1df', fontSize: 13, lineHeight: 18 },
  primaryButton: {
    backgroundColor: '#57d6a8',
    minHeight: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  primaryButtonText: { color: '#092016', fontSize: 14, fontWeight: '900', textAlign: 'center' },
  secondaryButton: {
    borderColor: '#40514e',
    borderWidth: 1,
    minHeight: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: { color: '#c7d3d0', fontSize: 13, fontWeight: '800' },
  winnerPanel: {
    backgroundColor: '#15251f',
    borderColor: '#57d6a8',
    borderWidth: 1,
    padding: 22,
    borderRadius: 20,
    gap: 10,
  },
  winnerEyebrow: { color: '#57d6a8', fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  winnerTitle: { color: '#f8fbfa', fontSize: 31, fontWeight: '900' },
  footer: { borderTopWidth: 1, borderTopColor: '#273331', marginTop: 8, paddingTop: 16, gap: 4 },
  footerTitle: { color: '#f4f8f6', fontSize: 12, fontWeight: '900' },
  footerText: { color: '#8c9b98', fontSize: 11, lineHeight: 16 },
});
