// 체스 엔진(상대 컴퓨터). Engine.pickMove(state, { rating, random }) -> 둘 수 (rules.js의 move 형태)
//
// 만드는 방법은 일반적인 체스 엔진 방식을 따른다:
//  - 탐색: 알파-베타 탐색 + 반복 심화, 잡는 수 먼저(MVV-LVA), 끝에서는 잡는 수만 더 따라가 보는 정지 탐색(quiescence)
//  - 평가: 기물 값 + 칸별 점수표(Tomasz Michniewski의 Simplified Evaluation Function), 킹은 중반/엔드게임 표를 따로
//  - 약하게 두기: 아무 수나 두지 않는다. 레이팅에 따라 (1) 몇 수 앞까지 볼지, (2) 좋은 수 몇 개 중에서 얼마나 흔들리며 고를지,
//    (3) 가끔 "상대 응수를 확인하지 않고" 두는 실수 비율을 정한다. (Stockfish의 Skill Level처럼 상위 후보 중에서 고르는 방식을 참고)
//  - 600점: 두 수 앞(내 수 + 상대 응수)까지 + 잡기 교환은 3수까지 봄, 상위 5개 중 비슷한 수끼리 흔들림, 10%는 한 수만 보고 둠.
//    공짜 퀸은 잡고, 한 수 메이트는 놓치지 않는다. 600점은 사람 대국으로 맞춘 값이 아니라 대략적인 수준이다.
//
// 빠르게 계산하려고 엔진 안에서는 자체 판(64칸 숫자 배열)으로 수를 만들고 되돌린다.
// 고른 수는 rules.js의 합법수 목록에서 같은 수를 찾아 돌려주므로, 규칙 판정은 항상 rules.js가 한다.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rules.js'));
  else root.Engine = factory(root.Chess);
})(typeof self !== 'undefined' ? self : this, function (Chess) {
  // 기물: 1 폰, 2 나이트, 3 비숍, 4 룩, 5 퀸, 6 킹. 내 편(흰=w)은 양수, 상대(검=b)는 음수. 칸 번호 = 행*8+열 (행 0 = 8랭크)
  const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
  const KIND = { P, N, B, R, Q, K };
  const LETTER = ['', 'P', 'N', 'B', 'R', 'Q', 'K'];
  const VALUE = [0, 100, 320, 330, 500, 900, 20000];
  const MATE = 100000, INF = 1e9;

  // 칸별 점수표 (흰 기준, 첫 줄이 8랭크). 출처: Simplified Evaluation Function (Tomasz Michniewski)
  const PST = [
    null,
    [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
      0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
    [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
    [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
    [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
    [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
    [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
  ];
  const KING_END = [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50];

  const KNIGHT_D = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  const KING_D = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const inside = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;

  // ---- 엔진 안의 판 ----
  // pos = { b: Int8Array(64), side: 1(흰)|-1(검), castle: {wK,wQ,bK,bQ}, ep: 칸번호|-1 }
  function fromState(state) {
    const b = new Int8Array(64);
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = state.board[r][c];
        if (p) b[r * 8 + c] = (p[0] === 'w' ? 1 : -1) * KIND[p[1]];
      }
    }
    return { b, side: state.turn === 'w' ? 1 : -1, castle: Object.assign({}, state.castling), ep: state.ep ? state.ep[0] * 8 + state.ep[1] : -1 };
  }

  // 칸 sq가 by 쪽(1|-1)에게 공격받는가
  function attacked(b, sq, by) {
    const r = sq >> 3, c = sq & 7;
    const pr = r + by; // 공격하는 폰이 있을 행 (흰 폰은 아래(+1)에서 위로 친다)
    for (const dc of [-1, 1]) if (inside(pr, c + dc) && b[pr * 8 + c + dc] === by * P) return true;
    for (const [dr, dc] of KNIGHT_D) { const rr = r + dr, cc = c + dc; if (inside(rr, cc) && b[rr * 8 + cc] === by * N) return true; }
    for (const [dr, dc] of KING_D) { const rr = r + dr, cc = c + dc; if (inside(rr, cc) && b[rr * 8 + cc] === by * K) return true; }
    for (const [dr, dc] of DIAG) {
      let rr = r + dr, cc = c + dc;
      while (inside(rr, cc)) { const p = b[rr * 8 + cc]; if (p) { if (p === by * B || p === by * Q) return true; break; } rr += dr; cc += dc; }
    }
    for (const [dr, dc] of ORTHO) {
      let rr = r + dr, cc = c + dc;
      while (inside(rr, cc)) { const p = b[rr * 8 + cc]; if (p) { if (p === by * R || p === by * Q) return true; break; } rr += dr; cc += dc; }
    }
    return false;
  }

  const kingSq = (b, side) => b.indexOf(side * K);
  const inCheck = (pos) => attacked(pos.b, kingSq(pos.b, pos.side), -pos.side);

  // 규칙상 갈 수 있는 수(자기 킹 안전은 둔 뒤 확인). move = { from, to, cap, promo, ep, castle }
  function genMoves(pos, capturesOnly) {
    const { b, side } = pos;
    const out = [];
    const add = (from, to, extra) => out.push(Object.assign({ from, to, cap: b[to] }, extra));
    for (let sq = 0; sq < 64; sq++) {
      const p = b[sq];
      if (!p || Math.sign(p) !== side) continue;
      const t = Math.abs(p), r = sq >> 3, c = sq & 7;
      if (t === P) {
        const dir = side === 1 ? -1 : 1, start = side === 1 ? 6 : 1, last = side === 1 ? 0 : 7;
        const r1 = r + dir;
        if (inside(r1, c) && !b[r1 * 8 + c]) {
          if (r1 === last) add(sq, r1 * 8 + c, { promo: Q });
          else if (!capturesOnly) {
            add(sq, r1 * 8 + c, {});
            if (r === start && !b[(r + 2 * dir) * 8 + c]) add(sq, (r + 2 * dir) * 8 + c, { dbl: true });
          }
        }
        for (const dc of [-1, 1]) {
          const cc = c + dc;
          if (!inside(r1, cc)) continue;
          const to = r1 * 8 + cc, target = b[to];
          if (target && Math.sign(target) === -side) add(sq, to, r1 === last ? { promo: Q } : {});
          else if (to === pos.ep) add(sq, to, { ep: true, cap: -side * P });
        }
        continue;
      }
      if (t === N || t === K) {
        for (const [dr, dc] of t === N ? KNIGHT_D : KING_D) {
          const rr = r + dr, cc = c + dc;
          if (!inside(rr, cc)) continue;
          const target = b[rr * 8 + cc];
          if (target && Math.sign(target) === side) continue;
          if (capturesOnly && !target) continue;
          add(sq, rr * 8 + cc, {});
        }
        if (t === K && !capturesOnly) addCastles(pos, sq, add);
        continue;
      }
      const dirs = t === B ? DIAG : t === R ? ORTHO : DIAG.concat(ORTHO);
      for (const [dr, dc] of dirs) {
        let rr = r + dr, cc = c + dc;
        while (inside(rr, cc)) {
          const target = b[rr * 8 + cc];
          if (target && Math.sign(target) === side) break;
          if (!capturesOnly || target) add(sq, rr * 8 + cc, {});
          if (target) break;
          rr += dr; cc += dc;
        }
      }
    }
    return out;
  }

  function addCastles(pos, sq, add) {
    const { b, side, castle } = pos;
    const home = side === 1 ? 7 : 0, key = side === 1 ? 'w' : 'b';
    if (sq !== home * 8 + 4) return;
    const free = (cols) => cols.every((cc) => !b[home * 8 + cc]);
    const safe = (cols) => cols.every((cc) => !attacked(b, home * 8 + cc, -side));
    if (castle[key + 'K'] && b[home * 8 + 7] === side * R && free([5, 6]) && safe([4, 5, 6])) add(sq, home * 8 + 6, { castle: 'K' });
    if (castle[key + 'Q'] && b[home * 8] === side * R && free([1, 2, 3]) && safe([4, 3, 2])) add(sq, home * 8 + 2, { castle: 'Q' });
  }

  // 수를 두고, 되돌리기에 필요한 정보를 돌려준다
  function make(pos, m) {
    const { b } = pos;
    const undo = { castle: Object.assign({}, pos.castle), ep: pos.ep, moved: b[m.from], captured: b[m.to] };
    const piece = b[m.from], side = pos.side;
    b[m.to] = m.promo ? side * m.promo : piece;
    b[m.from] = 0;
    if (m.ep) b[(m.from & ~7) + (m.to & 7)] = 0; // 앙파상: 옆의 폰을 없앤다
    if (m.castle) {
      const home = m.from >> 3;
      if (m.castle === 'K') { b[home * 8 + 5] = b[home * 8 + 7]; b[home * 8 + 7] = 0; } else { b[home * 8 + 3] = b[home * 8]; b[home * 8] = 0; }
    }
    // 캐슬링 권리: 킹·룩이 움직이거나 룩이 잡히면 사라진다
    const cr = pos.castle;
    if (Math.abs(piece) === K) { if (side === 1) cr.wK = cr.wQ = false; else cr.bK = cr.bQ = false; }
    for (const sq of [m.from, m.to]) {
      if (sq === 63) cr.wK = false; else if (sq === 56) cr.wQ = false; else if (sq === 7) cr.bK = false; else if (sq === 0) cr.bQ = false;
    }
    pos.ep = m.dbl ? (m.from + m.to) >> 1 : -1;
    pos.side = -side;
    return undo;
  }

  function unmake(pos, m, undo) {
    const { b } = pos;
    pos.side = -pos.side;
    b[m.from] = undo.moved;
    b[m.to] = undo.captured;
    if (m.ep) b[(m.from & ~7) + (m.to & 7)] = -pos.side * P;
    if (m.castle) {
      const home = m.from >> 3;
      if (m.castle === 'K') { b[home * 8 + 7] = b[home * 8 + 5]; b[home * 8 + 5] = 0; } else { b[home * 8] = b[home * 8 + 3]; b[home * 8 + 3] = 0; }
    }
    pos.castle = undo.castle;
    pos.ep = undo.ep;
  }

  // 둔 뒤 자기 킹이 공격받지 않는 수만
  function legalMoves(pos, capturesOnly) {
    const out = [];
    for (const m of genMoves(pos, capturesOnly)) {
      const u = make(pos, m);
      if (!attacked(pos.b, kingSq(pos.b, -pos.side), pos.side)) out.push(m);
      unmake(pos, m, u);
    }
    return out;
  }

  // ---- 평가: 지금 둘 차례인 쪽에게 좋을수록 큰 점수 ----
  function evaluate(pos) {
    const b = pos.b;
    let score = 0, heavy = 0;
    for (let sq = 0; sq < 64; sq++) { const t = Math.abs(b[sq]); if (t > P && t < K) heavy += VALUE[t]; }
    const endgame = heavy <= 1300;
    for (let sq = 0; sq < 64; sq++) {
      const p = b[sq];
      if (!p) continue;
      const t = Math.abs(p), white = p > 0;
      const idx = white ? sq : ((7 - (sq >> 3)) << 3) | (sq & 7); // 검은 말은 위아래를 뒤집어서 같은 표를 쓴다
      const v = VALUE[t] + (t === K && endgame ? KING_END[idx] : PST[t][idx]);
      score += white ? v : -v;
    }
    return score * pos.side;
  }

  // 잡는 수 먼저: 비싼 말을 싼 말로 잡는 수가 가장 앞 (MVV-LVA), 승급도 앞으로
  function order(pos, moves, first) {
    const key = (m) => {
      if (first && m.from === first.from && m.to === first.to) return 1e7;
      let s = 0;
      if (m.cap) s += 10 * VALUE[Math.abs(m.cap)] - VALUE[Math.abs(pos.b[m.from])];
      if (m.promo) s += 8000;
      return s;
    };
    return moves.sort((a, b) => key(b) - key(a));
  }

  // 정지 탐색: 잡는 수만 qDepth 수까지 더 따라가 교환 결과를 본다
  function quiesce(pos, alpha, beta, qDepth) {
    const stand = evaluate(pos);
    if (qDepth <= 0) return stand;
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    for (const m of order(pos, legalMoves(pos, true))) {
      const u = make(pos, m);
      const s = -quiesce(pos, -beta, -alpha, qDepth - 1);
      unmake(pos, m, u);
      if (s >= beta) return s;
      if (s > alpha) alpha = s;
    }
    return alpha;
  }

  // 알파-베타 탐색 (negamax)
  function search(pos, depth, alpha, beta, ply, qDepth) {
    if (depth <= 0) return quiesce(pos, alpha, beta, qDepth);
    const moves = legalMoves(pos, false);
    if (!moves.length) return inCheck(pos) ? -MATE + ply : 0; // 메이트(빨리 할수록 좋게) / 스테일메이트
    let best = -INF;
    for (const m of order(pos, moves)) {
      const u = make(pos, m);
      const s = -search(pos, depth - 1, -beta, -alpha, ply + 1, qDepth);
      unmake(pos, m, u);
      if (s > best) best = s;
      if (s > alpha) alpha = s;
      if (alpha >= beta) break;
    }
    return best;
  }

  // 첫 수 하나하나의 정확한 점수 (좋은 수 여러 개를 비교하려고 창을 넓게 둔다)
  function scoreRootMoves(pos, depth, qDepth) {
    const moves = order(pos, legalMoves(pos, false));
    return moves.map((m) => {
      const u = make(pos, m);
      let s;
      if (!legalMoves(pos, false).length) s = inCheck(pos) ? MATE - 1 : 0; // 이 수로 바로 메이트 / 스테일메이트
      else s = -search(pos, depth - 1, -INF, INF, 1, qDepth);
      unmake(pos, m, u);
      return { m, s };
    }).sort((a, b) => b.s - a.s);
  }

  // 레이팅 → 얼마나 깊이 보고, 얼마나 흔들리고, 얼마나 자주 한 수만 보고 두는가
  function profile(rating) {
    if (rating < 900) return { depth: 2, qDepth: 3, top: 5, temp: 45, blunder: 0.1 }; // 입문 (600점 근처)
    if (rating < 1300) return { depth: 3, qDepth: 6, top: 4, temp: 30, blunder: 0.05 };
    if (rating < 1700) return { depth: 3, qDepth: 8, top: 3, temp: 15, blunder: 0.02 };
    return { depth: 4, qDepth: 10, top: 1, temp: 1, blunder: 0 };
  }

  function choose(scored, prof, random) {
    if (scored[0].s >= MATE - 100) return scored[0]; // 메이트가 보이면 그대로 간다
    const pool = scored.slice(0, prof.top);
    const best = pool[0].s;
    const w = pool.map((x) => Math.exp((x.s - best) / prof.temp)); // 비슷한 수끼리만 흔들리고, 확 나쁜 수는 거의 안 고른다
    let roll = random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pool.length; i++) { roll -= w[i]; if (roll <= 0) return pool[i]; }
    return pool[0];
  }

  function pickMove(state, opts) {
    const o = opts || {};
    const rating = o.rating == null ? 600 : o.rating;
    const random = o.random || Math.random;
    const prof = profile(rating);
    const legal = Chess.allLegalMoves(state);
    if (!legal.length) return null;
    const pos = fromState(state);

    let pick;
    if (random() < prof.blunder) {
      // 사람다운 실수: 내 수만 보고 상대 응수는 확인하지 않는다 (메이트·공짜 기물은 여전히 본다)
      pick = choose(scoreRootMoves(pos, 1, 0), { top: 3, temp: 40 }, random);
    } else {
      pick = choose(scoreRootMoves(pos, prof.depth, prof.qDepth), prof, random);
    }
    const m = pick.m;
    return legal.find((x) => x.from[0] === m.from >> 3 && x.from[1] === (m.from & 7) && x.to[0] === m.to >> 3 && x.to[1] === (m.to & 7) &&
      (!x.promotion || x.promotion === 'Q')) || legal[0];
  }

  // 시험용: 엔진 안의 수 만들기가 규칙과 같은지 수 세기로 확인
  function perft(state, depth) {
    const pos = fromState(state);
    const count = (d) => {
      if (d === 0) return 1;
      let n = 0;
      for (const m of legalMoves(pos, false)) { const u = make(pos, m); n += count(d - 1); unmake(pos, m, u); }
      return n;
    };
    return count(depth);
  }

  return { pickMove, perft, evaluate: (state) => evaluate(fromState(state)), LETTER };
});
