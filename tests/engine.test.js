// 엔진 테스트: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const Chess = require('../rules.js');
const Engine = require('../engine.js');

const sameMove = (a, b) => a.from[0] === b.from[0] && a.from[1] === b.from[1] && a.to[0] === b.to[0] && a.to[1] === b.to[1] && (a.promotion || '') === (b.promotion || '');
const sq = (name) => [8 - Number(name[1]), name.charCodeAt(0) - 97]; // 'e4' -> [4, 4]
const isMove = (m, from, to) => m.from[0] === sq(from)[0] && m.from[1] === sq(from)[1] && m.to[0] === sq(to)[0] && m.to[1] === sq(to)[1];

// 매번 같은 결과가 나오는 가짜 주사위
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const over = (state) => ['checkmate', 'stalemate', 'draw'].includes(Chess.getStatus(state));
const material = (state, color) => {
  const v = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };
  let s = 0;
  for (const row of state.board) for (const p of row) if (p && p[0] === color) s += v[p[1]];
  return s;
};

test("engine's own move generator matches the rules (perft)", () => {
  assert.strictEqual(Engine.perft(Chess.newGame(), 3), 8902);
  assert.strictEqual(Engine.perft(Chess.newGame(), 4), 197281);
  // Kiwipete: castling, en passant, pins, checks
  const kiwi = Chess.fromFEN('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
  assert.strictEqual(Engine.perft(kiwi, 2), 2039);
  assert.strictEqual(Engine.perft(kiwi, 3), 97862);
});

test('engine always returns a legal move (many games)', () => {
  const random = seeded(7);
  for (let game = 0; game < 4; game++) {
    let state = Chess.newGame();
    for (let ply = 0; ply < 60 && !over(state); ply++) {
      const move = Engine.pickMove(state, { rating: 600, random });
      assert.ok(move, 'engine gave no move');
      assert.ok(Chess.allLegalMoves(state).some((m) => sameMove(m, move)), 'engine move is not legal');
      state = Chess.applyMove(state, move);
    }
  }
});

test('engine always plays mate in one (even in its careless moments)', () => {
  // 1.f3 e5 2.g4 — black to play Qh4#
  const state = Chess.fromFEN('rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq g3 0 2');
  for (let i = 0; i < 30; i++) {
    const move = Engine.pickMove(state, { rating: 600, random: seeded(i + 1) });
    assert.ok(isMove(move, 'd8', 'h4'), 'missed Qh4#');
  }
});

test('engine takes a free queen', () => {
  const state = Chess.fromFEN('4k3/8/8/3q4/8/2N5/8/4K3 w - - 0 1');
  const random = seeded(42);
  let took = 0;
  for (let i = 0; i < 100; i++) if (isMove(Engine.pickMove(state, { rating: 600, random }), 'c3', 'd5')) took++;
  assert.ok(took >= 95, 'took the free queen only ' + took + '/100 times');
});

test('engine usually does not leave its queen where a pawn can take it', () => {
  // white queen on d4 is attacked by the e5 pawn: it should move the queen away (or take the pawn)
  const state = Chess.fromFEN('rnbqkbnr/pppp1ppp/8/4p3/3Q4/8/PPP1PPPP/RNB1KBNR w KQkq - 0 3');
  const random = seeded(3);
  let safe = 0;
  for (let i = 0; i < 100; i++) {
    const m = Engine.pickMove(state, { rating: 600, random });
    const next = Chess.applyMove(state, m);
    // after the move, can black win the queen right away with a pawn?
    const queenLost = Chess.allLegalMoves(next).some((r) => r.capture === 'wQ' && r.piece === 'bP');
    if (!queenLost) safe++;
  }
  assert.ok(safe >= 85, 'kept the queen safe ' + safe + '/100 times');
});

test('engine plays sensible openings, not random moves', () => {
  // over many first moves, it prefers central pawns and knights (no rook-pawn / edge junk)
  const random = seeded(11);
  const firsts = {};
  for (let i = 0; i < 60; i++) {
    const m = Engine.pickMove(Chess.newGame(), { rating: 600, random });
    const name = 'abcdefgh'[m.from[1]] + (8 - m.from[0]) + 'abcdefgh'[m.to[1]] + (8 - m.to[0]);
    firsts[name] = (firsts[name] || 0) + 1;
  }
  const good = ['e2e4', 'd2d4', 'e2e3', 'd2d3', 'g1f3', 'b1c3', 'c2c4', 'c2c3', 'f2f4', 'g1h3', 'b1a3'];
  const goodCount = Object.entries(firsts).filter(([k]) => good.includes(k)).reduce((a, [, v]) => a + v, 0);
  assert.ok(goodCount >= 50, 'sensible first moves only ' + goodCount + '/60: ' + JSON.stringify(firsts));
});

test('600 engine clearly beats a random mover', () => {
  const random = seeded(99);
  for (let game = 0; game < 3; game++) {
    let state = Chess.newGame();
    for (let ply = 0; ply < 160 && !over(state); ply++) {
      const move = state.turn === 'b'
        ? Engine.pickMove(state, { rating: 600, random })
        : (() => { const ms = Chess.allLegalMoves(state); return ms[Math.floor(random() * ms.length)]; })();
      state = Chess.applyMove(state, move);
    }
    const won = Chess.getStatus(state) === 'checkmate' && state.turn === 'w';
    assert.ok(won || material(state, 'b') - material(state, 'w') >= 10, 'game ' + game + ': engine did not clearly win');
  }
});

test('stronger setting finds a mate in two', () => {
  // white: Qh5 & Bc4 vs a weak f7 — a scholar-mate-like net. Simple 2-mover: Kg6? Use a clean known one:
  // White K f6, Q a1, black K h8: 1.Qa8+ is mate? no — use: white Kf7, Qg5; black Kh8: 1.Qg7#? that is mate in 1.
  // Mate in two: white Kf6, Rook a1; black Kh8 → 1.Kg6 Kg8 2.Ra8#
  const state = Chess.fromFEN('7k/8/5K2/8/8/8/8/R7 w - - 0 1');
  const move = Engine.pickMove(state, { rating: 2000, random: () => 0.5 });
  const next = Chess.applyMove(state, move);
  // whatever black replies, white must have a mate next move
  for (const reply of Chess.allLegalMoves(next)) {
    const after = Chess.applyMove(next, reply);
    const mates = Chess.allLegalMoves(after).some((m) => Chess.getStatus(Chess.applyMove(after, m)) === 'checkmate');
    assert.ok(mates, 'no mate after ' + JSON.stringify(reply));
  }
});

test('engine thinks fast enough at 600', () => {
  let state = Chess.newGame();
  const random = seeded(5);
  let worst = 0;
  for (let ply = 0; ply < 20 && !over(state); ply++) {
    const t0 = Date.now();
    const move = Engine.pickMove(state, { rating: 600, random });
    worst = Math.max(worst, Date.now() - t0);
    state = Chess.applyMove(state, move);
  }
  assert.ok(worst < 600, 'slowest move took ' + worst + 'ms');
});
