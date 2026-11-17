const test = require('node:test');
const assert = require('node:assert');
const Chess = require('../rules.js');

// 표준 검증값(perft): 어떤 위치에서 N수 앞까지 가능한 경우의 수
function perft(state, depth) {
  if (depth === 0) return 1;
  const moves = Chess.allLegalMoves(state);
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) n += perft(Chess.applyMove(state, m), depth - 1);
  return n;
}

const sq = (name) => [8 - Number(name[1]), name.charCodeAt(0) - 97];
const find = (state, from, to, promo) =>
  Chess.allLegalMoves(state).find(
    (m) =>
      m.from.join() === sq(from).join() &&
      m.to.join() === sq(to).join() &&
      (promo ? m.promotion === promo : true)
  );

test('시작 위치: 흰색 첫 수는 20가지', () => {
  assert.strictEqual(Chess.allLegalMoves(Chess.newGame()).length, 20);
});

test('시작 위치 perft 1~3 (20 / 400 / 8902)', () => {
  const g = Chess.newGame();
  assert.strictEqual(perft(g, 1), 20);
  assert.strictEqual(perft(g, 2), 400);
  assert.strictEqual(perft(g, 3), 8902);
});

test('Kiwipete(캐슬링·앙파상·승급이 섞인 위치) perft 1~3', () => {
  const g = Chess.fromFEN('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
  assert.strictEqual(perft(g, 1), 48);
  assert.strictEqual(perft(g, 2), 2039);
  assert.strictEqual(perft(g, 3), 97862);
});

test('엔드게임 위치(앙파상·체크 처리) perft 1~3', () => {
  const g = Chess.fromFEN('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1');
  assert.strictEqual(perft(g, 1), 14);
  assert.strictEqual(perft(g, 2), 191);
  assert.strictEqual(perft(g, 3), 2812);
});

test('승급·캐슬링 권리 위치 perft 1~3', () => {
  const g = Chess.fromFEN('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1');
  assert.strictEqual(perft(g, 1), 6);
  assert.strictEqual(perft(g, 2), 264);
  assert.strictEqual(perft(g, 3), 9467);
});

test('체크메이트: 풀스 메이트(바보 메이트)', () => {
  let g = Chess.newGame();
  for (const [a, b] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]) {
    g = Chess.applyMove(g, find(g, a, b));
  }
  assert.strictEqual(Chess.getStatus(g), 'checkmate');
  assert.strictEqual(g.turn, 'w'); // 흰색이 졌다
});

test('스테일메이트: 체크는 아닌데 둘 수가 없으면 무승부', () => {
  const g = Chess.fromFEN('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  assert.strictEqual(Chess.getStatus(g), 'stalemate');
});

test('체크 표시', () => {
  const g = Chess.fromFEN('4k3/8/8/8/8/8/4R3/4K3 b - - 0 1');
  assert.strictEqual(Chess.getStatus(g), 'check');
});

test('자기 킹이 공격받게 되는 수는 둘 수 없다 (핀)', () => {
  // e2의 흰 비숍은 e1 킹을 e8 룩으로부터 가리고 있다
  const g = Chess.fromFEN('4r2k/8/8/8/8/8/4B3/4K3 w - - 0 1');
  const moves = Chess.legalMovesFrom(g, ...sq('e2'));
  assert.strictEqual(moves.length, 0);
});

test('폰 승급: 4가지 선택지가 생기고 적용된다', () => {
  const g = Chess.fromFEN('8/P6k/8/8/8/8/8/4K3 w - - 0 1');
  const promos = Chess.legalMovesFrom(g, ...sq('a7')).map((m) => m.promotion).sort();
  assert.deepStrictEqual(promos, ['B', 'N', 'Q', 'R']);
  const after = Chess.applyMove(g, find(g, 'a7', 'a8', 'Q'));
  assert.strictEqual(after.board[0][0], 'wQ');
});

test('앙파상: 바로 직전에 2칸 전진한 폰을 잡을 수 있다', () => {
  const g = Chess.fromFEN('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
  const ep = find(g, 'e5', 'd6');
  assert.ok(ep && ep.enPassant, '앙파상 수가 있어야 한다');
  const after = Chess.applyMove(g, ep);
  assert.strictEqual(after.board[3][3], null); // d5의 흑 폰이 사라짐
  assert.strictEqual(after.board[2][3], 'wP');
});

test('캐슬링: 킹사이드·퀸사이드 모두 가능', () => {
  const g = Chess.fromFEN('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const kingMoves = Chess.legalMovesFrom(g, ...sq('e1'));
  assert.ok(kingMoves.some((m) => m.castle === 'K'));
  assert.ok(kingMoves.some((m) => m.castle === 'Q'));
  const after = Chess.applyMove(g, find(g, 'e1', 'g1'));
  assert.strictEqual(after.board[7][6], 'wK');
  assert.strictEqual(after.board[7][5], 'wR');
});

test('캐슬링: 킹이 지나가는 칸이 공격받으면 불가', () => {
  const ok = Chess.fromFEN('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1');
  const blocked = Chess.fromFEN('4kr2/8/8/8/8/8/8/R3K2R w KQ - 0 1'); // f1이 공격받음
  assert.ok(Chess.legalMovesFrom(ok, ...sq('e1')).some((m) => m.castle === 'K'));
  assert.ok(!Chess.legalMovesFrom(blocked, ...sq('e1')).some((m) => m.castle === 'K'));
});

test('캐슬링: 체크 중에는 불가', () => {
  const g = Chess.fromFEN('4k3/8/8/8/8/8/4r3/R3K2R w KQ - 0 1');
  assert.ok(!Chess.legalMovesFrom(g, ...sq('e1')).some((m) => m.castle));
});

test('룩이 움직이면 그쪽 캐슬링 권리만 사라진다', () => {
  let g = Chess.fromFEN('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  g = Chess.applyMove(g, find(g, 'h1', 'h2'));
  assert.strictEqual(g.castling.wK, false);
  assert.strictEqual(g.castling.wQ, true);
});

test('폰은 처음에만 2칸, 막히면 못 간다', () => {
  const g = Chess.newGame();
  assert.strictEqual(Chess.legalMovesFrom(g, ...sq('e2')).length, 2);
  const blocked = Chess.fromFEN('4k3/8/8/8/8/4p3/4P3/4K3 w - - 0 1');
  assert.strictEqual(Chess.legalMovesFrom(blocked, ...sq('e2')).length, 0);
});

test('무르기: 마지막 수를 되돌릴 수 있다', () => {
  const g = Chess.newGame();
  const g1 = Chess.applyMove(g, find(g, 'e2', 'e4'));
  const back = Chess.undo(g1);
  assert.deepStrictEqual(back.board, g.board);
  assert.strictEqual(back.turn, 'w');
});

test('기보 표기: 이동 기록 문자열', () => {
  const g = Chess.newGame();
  assert.strictEqual(Chess.moveToText(g, find(g, 'g1', 'f3')), 'Nf3');
  assert.strictEqual(Chess.moveToText(g, find(g, 'e2', 'e4')), 'e4');
});
