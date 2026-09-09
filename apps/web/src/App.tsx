import type { DartZone } from '@darts-180/contracts';
import {
  applyCricketVisit,
  applyX01Visit,
  createCricketState,
  createX01State,
  findCheckoutRoutes,
  formatZone,
  makeZone,
  type CricketState,
  type X01State,
} from '@darts-180/rules';
import { useMemo, useState } from 'react';

import { VisionDiagnostics } from './components/VisionDiagnostics';
import { CameraPlayRouter } from './components/CameraPlayRouter';
import { DataLab } from './components/DataLab';
import type { CameraTurnProposal } from './lib/cameraProposal';
import {
  downloadCorrectedDevelopmentEvidence,
  type CorrectedDevelopmentEvidenceSample,
  type LocalDevelopmentEvidence,
} from './lib/developmentVision/localEvidence';
import { Dartboard, type DartboardMarker } from './components/Dartboard';

type GameMode = 'x01' | 'cricket';
type DraftSource = 'auto' | 'manual' | 'corrected';

interface DartDraft {
  slot: 1 | 2 | 3;
  zone: DartZone;
  source: DraftSource;
  confidence: number;
  wireMarginMm: number;
  requiresReview: boolean;
  /** Development suggestions require an explicit human confirm/correction before visit confirmation. */
  developmentSuggestion: boolean;
  /** Opt-in local JPEG + detector record, held in memory until the tester exports it. */
  developmentEvidence?: LocalDevelopmentEvidence;
  filled: boolean;
}

interface HistoryItem {
  id: number;
  playerId: string;
  mode: GameMode;
  notation: string;
  total: number;
  outcome: string;
}

const QUICK_ZONES: readonly DartZone[] = [
  makeZone('T', 20),
  makeZone('S', 20),
  makeZone('D', 20),
  makeZone('T', 19),
  makeZone('S', 19),
  makeZone('D', 16),
  makeZone('IB'),
  makeZone('OB'),
  makeZone('MISS'),
];

function blankDrafts(): DartDraft[] {
  return [1, 2, 3].map((slot) => ({
    slot: slot as 1 | 2 | 3,
    zone: makeZone('MISS'),
    source: 'manual',
    confidence: 0,
    wireMarginMm: 0,
    requiresReview: false,
    developmentSuggestion: false,
    filled: false,
  }));
}

function reviewedDevelopmentEvidenceFromDrafts(
  drafts: readonly DartDraft[],
): CorrectedDevelopmentEvidenceSample[] {
  return drafts.flatMap((draft) => {
    if (
      !draft.filled ||
      draft.requiresReview ||
      !draft.developmentSuggestion ||
      draft.developmentEvidence === undefined
    ) {
      return [];
    }
    return [
      {
        slot: draft.slot,
        finalZone: draft.zone,
        reviewState: draft.source === 'corrected' ? 'corrected' : 'confirmed-as-predicted',
        evidence: draft.developmentEvidence,
      },
    ];
  });
}

function newX01Game(): X01State {
  return createX01State(['Alex', 'Jordan'], { startingScore: 501, outRule: 'double' });
}

function newCricketGame(): CricketState {
  return createCricketState(['Alex', 'Jordan']);
}

export function App() {
  const [workspace, setWorkspace] = useState<'play' | 'camera' | 'camera-lab' | 'capture'>(
    'camera',
  );
  const [mode, setMode] = useState<GameMode>('x01');
  const [x01, setX01] = useState<X01State>(newX01Game);
  const [cricket, setCricket] = useState<CricketState>(newCricketGame);
  const [drafts, setDrafts] = useState<DartDraft[]>(blankDrafts);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [developmentEvidenceArchive, setDevelopmentEvidenceArchive] = useState<
    CorrectedDevelopmentEvidenceSample[]
  >([]);
  const [notice, setNotice] = useState(
    'Choose a DartCard, then tap the board. Live Scoring uses a separate browser-local learned vision path when an approved model is installed.',
  );

  const gameComplete = mode === 'x01' ? x01.winnerId !== undefined : cricket.winnerId !== undefined;
  const activePlayer =
    mode === 'x01'
      ? x01.players[x01.activePlayerIndex]
      : cricket.players[cricket.activePlayerIndex];
  const remaining = mode === 'x01' ? x01.players[x01.activePlayerIndex]?.remaining : undefined;
  const checkoutHint = useMemo(() => {
    if (remaining === undefined || remaining > 170) return undefined;
    return findCheckoutRoutes(remaining, { limit: 1 })[0]?.notation;
  }, [remaining]);
  const currentDevelopmentEvidence = useMemo(
    () => reviewedDevelopmentEvidenceFromDrafts(drafts),
    [drafts],
  );
  const pendingDevelopmentReviewCount = drafts.filter(
    (draft) => draft.filled && draft.developmentSuggestion && draft.requiresReview,
  ).length;
  const exportableDevelopmentEvidence = [
    ...developmentEvidenceArchive,
    ...currentDevelopmentEvidence,
  ];

  const markers: DartboardMarker[] = drafts
    .filter((draft) => draft.filled)
    .map((draft) => ({
      id: `dart-${draft.slot}`,
      label: String(draft.slot),
      zone: draft.zone,
      tone: draft.source,
    }));

  const selectMode = (nextMode: GameMode) => {
    setMode(nextMode);
    setDrafts(blankDrafts());
    setSelectedSlot(null);
    setNotice(
      nextMode === 'x01'
        ? '501 selected. Alex is at the oche.'
        : 'Cricket selected. Close 20 through 15 and bull.',
    );
  };

  const updateDraft = (slot: number, zone: DartZone) => {
    if (gameComplete) return;
    setDrafts((current) =>
      current.map((draft, index) =>
        index === slot
          ? {
              ...draft,
              zone,
              source: draft.source === 'auto' ? 'corrected' : 'manual',
              confidence: 1,
              wireMarginMm: 99,
              requiresReview: false,
              filled: true,
            }
          : draft,
      ),
    );
    setSelectedSlot(null);
    setNotice(
      `Dart ${slot + 1} set to ${formatZone(zone)}. It is recorded as a human-confirmed score.`,
    );
  };

  const addBoardScore = (zone: DartZone) => {
    const target = selectedSlot ?? drafts.findIndex((draft) => !draft.filled);
    if (target < 0 || target > 2) {
      setNotice('All three darts are filled. Clear or select a DartCard to replace it.');
      return;
    }
    updateDraft(target, zone);
  };

  const clearSlot = (slot: number) => {
    setDrafts((current) =>
      current.map((draft, index) => (index === slot ? blankDrafts()[slot as 0 | 1 | 2]! : draft)),
    );
    setSelectedSlot(slot);
    setNotice(`Dart ${slot + 1} cleared. Tap the board or choose a quick score to replace it.`);
  };

  const confirmReviewDraft = (slot: number) => {
    const draft = drafts[slot];
    if (draft === undefined || !draft.filled || !draft.requiresReview) return;
    setDrafts((current) =>
      current.map((item, index) =>
        index === slot
          ? {
              ...item,
              requiresReview: false,
            }
          : item,
      ),
    );
    setSelectedSlot(null);
    setNotice(`Dart ${slot + 1} confirmed as ${formatZone(draft.zone)} by the player.`);
  };

  const exportDevelopmentEvidence = () => {
    if (exportableDevelopmentEvidence.length === 0) return;
    downloadCorrectedDevelopmentEvidence(exportableDevelopmentEvidence);
    setNotice(
      `${exportableDevelopmentEvidence.length} human-reviewed local development sample${exportableDevelopmentEvidence.length === 1 ? '' : 's'} downloaded. Nothing was uploaded.`,
    );
  };

  const addCameraProposal = (proposal: CameraTurnProposal): number | null => {
    if (gameComplete) {
      setNotice('This game is finished. Start a new game before recording another dart.');
      return null;
    }
    const target = drafts.findIndex((draft) => !draft.filled);
    if (target < 0) {
      setNotice(
        'All three darts are already filled. Open the review panel to confirm or correct them.',
      );
      return null;
    }
    setDrafts((current) =>
      current.map((draft, index) =>
        index === target
          ? {
              ...draft,
              zone: proposal.zone,
              source: proposal.source,
              confidence: proposal.confidence,
              wireMarginMm: proposal.wireMarginMm,
              requiresReview: proposal.disposition === 'review',
              developmentSuggestion: proposal.developmentSuggestion === true,
              ...(proposal.developmentEvidence === undefined
                ? {}
                : { developmentEvidence: proposal.developmentEvidence }),
              filled: true,
            }
          : draft,
      ),
    );
    setSelectedSlot(null);
    setNotice(
      `Dart ${target + 1} proposed as ${formatZone(proposal.zone)} by browser-local learned vision. Review or correct it before confirming the visit.`,
    );
    return target + 1;
  };

  const confirmVisit = (): boolean => {
    if (pendingDevelopmentReviewCount > 0) {
      setNotice(
        `${pendingDevelopmentReviewCount} development suggestion${pendingDevelopmentReviewCount === 1 ? '' : 's'} still needs a player confirm or correction before this visit can be recorded.`,
      );
      return false;
    }
    const filled = drafts.filter((draft) => draft.filled);
    if (activePlayer === undefined || filled.length === 0 || gameComplete) {
      setNotice(
        gameComplete
          ? 'This game is finished. Start a new game to continue.'
          : 'Record at least one dart before confirming.',
      );
      return false;
    }

    const zones = filled.map((draft) => draft.zone);
    const notation = zones.map(formatZone).join(' · ');
    const total = zones.reduce((sum, zone) => sum + zone.score, 0);
    let outcome = '';

    if (mode === 'x01') {
      const result = applyX01Visit(x01, activePlayer.playerId, zones);
      setX01(result.state);
      outcome = result.checkout
        ? `${activePlayer.playerId} checked out.`
        : result.bust
          ? `Bust — ${activePlayer.playerId} returns to ${x01.players[x01.activePlayerIndex]?.remaining ?? 'the turn-start score'}.`
          : `${result.turnScore} confirmed. ${result.state.players[result.state.activePlayerIndex]?.playerId ?? 'Next player'} to throw.`;
    } else {
      const result = applyCricketVisit(cricket, activePlayer.playerId, zones);
      setCricket(result.state);
      outcome =
        result.winnerId !== undefined
          ? `${result.winnerId} wins Cricket.`
          : `${result.pointsAdded} point${result.pointsAdded === 1 ? '' : 's'} scored. ${result.state.players[result.state.activePlayerIndex]?.playerId ?? 'Next player'} to throw.`;
    }

    setHistory((current) =>
      [
        { id: current.length + 1, playerId: activePlayer.playerId, mode, notation, total, outcome },
        ...current,
      ].slice(0, 8),
    );
    if (currentDevelopmentEvidence.length > 0) {
      setDevelopmentEvidenceArchive((current) => [...current, ...currentDevelopmentEvidence]);
    }
    setDrafts(blankDrafts());
    setSelectedSlot(null);
    setNotice(
      currentDevelopmentEvidence.length > 0
        ? `${outcome} ${currentDevelopmentEvidence.length} reviewed development sample${currentDevelopmentEvidence.length === 1 ? '' : 's'} is ready for local export.`
        : outcome,
    );
    return true;
  };

  const resetGame = () => {
    if (mode === 'x01') setX01(newX01Game());
    else setCricket(newCricketGame());
    setDrafts(blankDrafts());
    setSelectedSlot(null);
    setHistory([]);
    setNotice(
      `Fresh ${mode === 'x01' ? '501' : 'Cricket'} game ready. Manual scoring works even without a camera.`,
    );
  };

  return (
    <main>
      <section className="hero shell">
        <div>
          <p className="eyebrow">
            DARTS <span>180</span> / PROTOTYPE
          </p>
          <h1>
            Score the board.
            <br />
            <em>Keep the player in control.</em>
          </h1>
          <p className="lede">
            Two clear paths: <b>Live Scoring</b> is the eventual player experience; <b>Data Lab</b>
            is the private, guided place to teach the first real camera model with your own board
            photos.
          </p>
        </div>
        <div className="hero-side">
          <div className="hero-status" aria-label="Prototype status">
            <span className="status-dot" />
            <div>
              <strong>WEB-FIRST DEVELOPMENT</strong>
              <small>Live scorer + guided data collection</small>
            </div>
          </div>
          <div className="workspace-tabs" role="group" aria-label="Choose a Darts 180 workspace">
            <button
              className={workspace === 'camera' ? 'active' : ''}
              onClick={() => setWorkspace('camera')}
            >
              LIVE SCORING
            </button>
            <button
              className={workspace === 'capture' ? 'active' : ''}
              onClick={() => setWorkspace('capture')}
            >
              DATA LAB
            </button>
            <button
              className={workspace === 'play' ? 'active' : ''}
              onClick={() => setWorkspace('play')}
            >
              SCORE REVIEW
            </button>
          </div>
        </div>
      </section>

      {workspace === 'play' ? (
        <section className="shell app-shell">
          <nav className="mode-tabs" aria-label="Choose game">
            <button className={mode === 'x01' ? 'active' : ''} onClick={() => selectMode('x01')}>
              501
            </button>
            <button
              className={mode === 'cricket' ? 'active' : ''}
              onClick={() => selectMode('cricket')}
            >
              CRICKET
            </button>
            <span>V0.1 · NO ACCOUNT REQUIRED</span>
          </nav>

          <div className="score-strip">
            {(mode === 'x01' ? x01.players : cricket.players).map((player, index) => {
              const active =
                index === (mode === 'x01' ? x01.activePlayerIndex : cricket.activePlayerIndex) &&
                !gameComplete;
              const value =
                mode === 'x01'
                  ? (player as X01State['players'][number]).remaining
                  : (player as CricketState['players'][number]).points;
              return (
                <div className={`player-score ${active ? 'is-active' : ''}`} key={player.playerId}>
                  <small>
                    {player.playerId.toUpperCase()}
                    {active ? ' · AT OCHE' : ''}
                  </small>
                  <strong>{value}</strong>
                  <span>{mode === 'x01' ? 'REMAINING' : 'CRICKET POINTS'}</span>
                </div>
              );
            })}
            <div className="turn-score">
              <small>THIS VISIT</small>
              <strong>
                {drafts
                  .filter((draft) => draft.filled)
                  .reduce((sum, draft) => sum + draft.zone.score, 0)}
              </strong>
              <span>{drafts.filter((draft) => draft.filled).length}/3 DARTS</span>
            </div>
          </div>

          {gameComplete ? (
            <section className="complete-panel">
              <p className="eyebrow">GAME COMPLETE</p>
              <h2>{(mode === 'x01' ? x01.winnerId : cricket.winnerId)?.toUpperCase()} WINS</h2>
              <button className="button primary" onClick={resetGame}>
                START ANOTHER GAME
              </button>
            </section>
          ) : (
            <div className="game-grid">
              <section className="board-panel">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">MANUAL BOARD INPUT</p>
                    <h2>Tap the board to score.</h2>
                  </div>
                  {checkoutHint !== undefined && (
                    <p className="checkout">
                      <small>CHECKOUT</small>
                      {checkoutHint}
                    </p>
                  )}
                </div>
                <Dartboard markers={markers} onScore={addBoardScore} />
                <div className="quick-scores" aria-label="Quick manual scores">
                  {QUICK_ZONES.map((zone) => (
                    <button key={formatZone(zone)} onClick={() => addBoardScore(zone)}>
                      {formatZone(zone)}
                    </button>
                  ))}
                </div>
              </section>

              <aside className="review-panel">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">LIVE TURN · {activePlayer?.playerId.toUpperCase()}</p>
                    <h2>Review each dart.</h2>
                  </div>
                </div>
                <div className="dart-cards">
                  {drafts.map((draft, index) => {
                    const needsReview =
                      draft.requiresReview ||
                      (!draft.developmentSuggestion &&
                        draft.source === 'auto' &&
                        (draft.confidence < 0.97 || draft.wireMarginMm < 1.5));
                    const label = !draft.filled
                      ? 'ADD DART'
                      : draft.source === 'corrected'
                        ? 'CORRECTED'
                        : needsReview
                          ? 'CHECK'
                          : draft.developmentSuggestion
                            ? 'CONFIRMED'
                            : draft.source === 'auto'
                              ? 'LOCKED'
                              : 'MANUAL';
                    return (
                      <article
                        className={`dart-card ${!draft.filled ? 'is-empty' : needsReview ? 'needs-review' : 'is-confirmed'} ${selectedSlot === index ? 'is-selected' : ''}`}
                        key={draft.slot}
                      >
                        <button
                          className="dart-card-select"
                          onClick={() => setSelectedSlot(index)}
                          aria-label={`Select dart ${draft.slot} for editing`}
                        >
                          <span>DART {draft.slot}</span>
                          <b>{label}</b>
                          <strong>{draft.filled ? formatZone(draft.zone) : '—'}</strong>
                          <em>
                            {draft.filled
                              ? `${draft.zone.score} points`
                              : 'Tap then choose a board segment'}
                          </em>
                          {draft.filled && draft.source === 'auto' && (
                            <i>
                              {Math.round(draft.confidence * 100)}% confidence ·{' '}
                              {draft.wireMarginMm.toFixed(1)} mm from wire
                            </i>
                          )}
                        </button>
                        {draft.filled && needsReview && (
                          <button
                            className="confirm-dart"
                            onClick={() => confirmReviewDraft(index)}
                            aria-label={`Confirm dart ${draft.slot} as shown`}
                          >
                            CONFIRM AS SHOWN
                          </button>
                        )}
                        {draft.filled && (
                          <button
                            className="clear-dart"
                            onClick={() => clearSlot(index)}
                            aria-label={`Clear dart ${draft.slot}`}
                          >
                            ×
                          </button>
                        )}
                      </article>
                    );
                  })}
                </div>

                <div className="camera-lab">
                  <div>
                    <p className="eyebrow">CAMERA EVIDENCE</p>
                    <h3>Use the learned camera path.</h3>
                  </div>
                  <p>
                    Camera proposals are generated only in Live Scoring when a verified local model
                    is installed. Manual board input remains available for correction and recovery.
                  </p>
                  <button className="button secondary" onClick={() => setWorkspace('camera')}>
                    OPEN LIVE SCORING
                  </button>
                </div>

                {(pendingDevelopmentReviewCount > 0 ||
                  exportableDevelopmentEvidence.length > 0) && (
                  <section className="development-evidence-review">
                    <small>LOCAL DEVELOPMENT EVIDENCE</small>
                    {pendingDevelopmentReviewCount > 0 ? (
                      <p>
                        Confirm as shown or correct {pendingDevelopmentReviewCount} development
                        DartCard
                        {pendingDevelopmentReviewCount === 1 ? '' : 's'} before it can become a
                        training sample.
                      </p>
                    ) : (
                      <p>
                        {exportableDevelopmentEvidence.length} human-reviewed sample
                        {exportableDevelopmentEvidence.length === 1 ? '' : 's'} is in page memory.
                        Download JPEGs and a paired manifest manually; nothing uploads.
                      </p>
                    )}
                    <button
                      className="button secondary"
                      onClick={exportDevelopmentEvidence}
                      disabled={
                        pendingDevelopmentReviewCount > 0 ||
                        exportableDevelopmentEvidence.length === 0
                      }
                    >
                      DOWNLOAD REVIEWED TEST SAMPLES
                    </button>
                  </section>
                )}

                <div className="notice" role="status">
                  <small>SESSION LOG</small>
                  <p>{notice}</p>
                </div>
                <button className="button primary confirm" onClick={confirmVisit}>
                  CONFIRM VISIT
                </button>
                <button className="button ghost" onClick={() => setDrafts(blankDrafts())}>
                  CLEAR VISIT
                </button>
              </aside>
            </div>
          )}

          {mode === 'cricket' && (
            <section className="cricket-board">
              <p className="eyebrow">CRICKET MARKS</p>
              <div>
                {cricket.players.map((player) => (
                  <article key={player.playerId}>
                    <strong>{player.playerId.toUpperCase()}</strong>
                    {[20, 19, 18, 17, 16, 15, 'BULL'].map((target) => (
                      <span key={target}>
                        {target}:{' '}
                        {'●'.repeat(player.marks[target as 15 | 16 | 17 | 18 | 19 | 20 | 'BULL']) ||
                          '—'}
                      </span>
                    ))}
                  </article>
                ))}
              </div>
            </section>
          )}

          <section className="history-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">EVENT-STYLE VISIT HISTORY</p>
                <h2>Every confirmed turn stays explainable.</h2>
              </div>
              <button className="text-button" onClick={resetGame}>
                RESET GAME
              </button>
            </div>
            {history.length === 0 ? (
              <p className="empty-history">
                No confirmed visits yet. Your first confirmed turn will appear here.
              </p>
            ) : (
              <ol>
                {history.map((item) => (
                  <li key={item.id}>
                    <span>
                      #{item.id} · {item.playerId.toUpperCase()} · {item.mode.toUpperCase()}
                    </span>
                    <strong>{item.notation}</strong>
                    <em>
                      {item.total} pts · {item.outcome}
                    </em>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </section>
      ) : workspace === 'camera' ? (
        <CameraPlayRouter
          activePlayerName={activePlayer?.playerId ?? 'Player'}
          availableSlots={gameComplete ? 0 : drafts.filter((draft) => !draft.filled).length}
          gameComplete={gameComplete}
          onAddProposal={addCameraProposal}
          onConfirmVisit={confirmVisit}
          onOpenAdvanced={() => setWorkspace('camera-lab')}
          onOpenReview={() => setWorkspace('play')}
          turnDarts={drafts}
        />
      ) : workspace === 'camera-lab' ? (
        <>
          <div className="shell advanced-camera-return">
            <button className="text-button" onClick={() => setWorkspace('camera')}>
              ← BACK TO LIVE SCORING
            </button>
          </div>
          <VisionDiagnostics onReturnToCamera={() => setWorkspace('camera')} />
        </>
      ) : (
        <DataLab onExit={() => setWorkspace('camera')} />
      )}

      <footer className="shell footer">
        <p>
          <strong>Darts 180 prototype.</strong> Live Scoring keeps camera inference in the browser
          and requires a real verified model before it can propose a score. Data Lab is a separate,
          consent-gated workflow that automatically saves completed private blank-board and
          dart-test examples needed to build that first model.
        </p>
        <a href="https://github.com/nick-kuhle/darts-180" target="_blank" rel="noreferrer">
          Darts 180 source (private) →
        </a>
      </footer>
    </main>
  );
}
