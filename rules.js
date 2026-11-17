// 체스 규칙 엔진 (화면과 분리). 브라우저에서는 window.Chess, Node(테스트)에서는 require로 쓴다.
// 판 좌표: board[행][열], 행 0 = 8번 줄(검정 쪽), 행 7 = 1번 줄(흰색 쪽). 말은 'wP','bK'처럼 색+종류.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Chess = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const FILES = 'abcdefgh';

  const inside = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
  const other = (color) => (color === 'w' ? 'b' : 'w');
  const squareName = (r, c) => FILES[c] + (8 - r);

  function fromFEN(fen) {
    const [pos, turn, cast = '-', ep = '-', half = '0', full = '1'] = fen.trim().split(/\s+/);
    const board = pos.split('/').map((row) => {
      const cells = [];
      for (const ch of row) {
        if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) cells.push(null);
        else cells.push((ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase());
      }
      return cells;
    });
    return {
      board,
      turn,
      castling: { wK: cast.includes('K'), wQ: cast.includes('Q'), bK: cast.includes('k'), bQ: cast.includes('q') },
      ep: ep === '-' ? null : [8 - Number(ep[1]), ep.charCodeAt(0) - 97],
      halfmove: Number(half),
      fullmove: Number(full),
      prev: null,
      lastMove: null,
    };
  }

  const newGame = () => fromFEN(START_FEN);

  // (r,c) 칸을 byColor 색의 말이 공격하고 있는가
  function isAttacked(board, r, c, byColor) {
    const pawnRow = byColor === 'w' ? r + 1 : r - 1;
    for (const dc of [-1, 1]) {
      if (inside(pawnRow, c + dc) && board[pawnRow][c + dc] === byColor + 'P') return true;
    }
    for (const [dr, dc] of KNIGHT) {
      const rr = r + dr, cc = c + dc;
      if (inside(rr, cc) && board[rr][cc] === byColor + 'N') return true;
    }
    for (const [dr, dc] of KING) {
      const rr = r + dr, cc = c + dc;
      if (inside(rr, cc) && board[rr][cc] === byColor + 'K') return true;
    }
    const slide = (dirs, kinds) => {
      for (const [dr, dc] of dirs) {
        let rr = r + dr, cc = c + dc;
        while (inside(rr, cc)) {
          const p = board[rr][cc];
          if (p) {
            if (p[0] === byColor && kinds.includes(p[1])) return true;
            break;
          }
          rr += dr;
          cc += dc;
        }
      }
      return false;
    };
    return slide(ROOK_DIRS, 'RQ') || slide(BISHOP_DIRS, 'BQ');
  }

  function findKing(board, color) {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (board[r][c] === color + 'K') return [r, c];
    return null;
  }

  function isInCheck(state, color) {
    const k = findKing(state.board, color);
    return k ? isAttacked(state.board, k[0], k[1], other(color)) : false;
  }

  // 규칙상 "갈 수는 있는" 수(자기 킹이 공격받는지는 아직 안 따짐)
  function pseudoMoves(state, r, c) {
    const { board } = state;
    const piece = board[r][c];
    if (!piece) return [];
    const color = piece[0], kind = piece[1];
    const moves = [];
    const add = (extra) => moves.push(Object.assign({ from: [r, c], piece }, extra));

    if (kind === 'P') {
      const dir = color === 'w' ? -1 : 1;
      const startRow = color === 'w' ? 6 : 1;
      const lastRow = color === 'w' ? 0 : 7;
      const push = (tr, tc, extra) => {
        if (tr === lastRow) for (const promotion of ['Q', 'R', 'B', 'N']) add(Object.assign({ to: [tr, tc], promotion }, extra));
        else add(Object.assign({ to: [tr, tc] }, extra));
      };
      if (inside(r + dir, c) && !board[r + dir][c]) {
        push(r + dir, c, {});
        if (r === startRow && !board[r + 2 * dir][c]) add({ to: [r + 2 * dir, c], double: true });
      }
      for (const dc of [-1, 1]) {
        const tr = r + dir, tc = c + dc;
        if (!inside(tr, tc)) continue;
        const target = board[tr][tc];
        if (target && target[0] !== color) push(tr, tc, { capture: target });
        else if (!target && state.ep && state.ep[0] === tr && state.ep[1] === tc) {
          add({ to: [tr, tc], capture: board[r][tc], enPassant: true });
        }
      }
    } else if (kind === 'N' || kind === 'K') {
      for (const [dr, dc] of kind === 'N' ? KNIGHT : KING) {
        const tr = r + dr, tc = c + dc;
        if (!inside(tr, tc)) continue;
        const target = board[tr][tc];
        if (!target) add({ to: [tr, tc] });
        else if (target[0] !== color) add({ to: [tr, tc], capture: target });
      }
      if (kind === 'K') addCastling(state, r, c, color, add);
    } else {
      const dirs = kind === 'R' ? ROOK_DIRS : kind === 'B' ? BISHOP_DIRS : ROOK_DIRS.concat(BISHOP_DIRS);
      for (const [dr, dc] of dirs) {
        let tr = r + dr, tc = c + dc;
        while (inside(tr, tc)) {
          const target = board[tr][tc];
          if (!target) add({ to: [tr, tc] });
          else {
            if (target[0] !== color) add({ to: [tr, tc], capture: target });
            break;
          }
          tr += dr;
          tc += dc;
        }
      }
    }
    return moves;
  }

  function addCastling(state, r, c, color, add) {
    const home = color === 'w' ? 7 : 0;
    if (r !== home || c !== 4) return;
    const { board, castling } = state;
    const foe = other(color);
    if (isAttacked(board, home, 4, foe)) return; // 체크 중에는 캐슬링 불가
    if (castling[color + 'K'] && board[home][7] === color + 'R' && !board[home][5] && !board[home][6] &&
        !isAttacked(board, home, 5, foe) && !isAttacked(board, home, 6, foe)) {
      add({ to: [home, 6], castle: 'K' });
    }
    if (castling[color + 'Q'] && board[home][0] === color + 'R' && !board[home][1] && !board[home][2] && !board[home][3] &&
        !isAttacked(board, home, 2, foe) && !isAttacked(board, home, 3, foe)) {
      add({ to: [home, 2], castle: 'Q' });
    }
  }

  // 수를 두고 새 상태를 돌려준다(원래 상태는 그대로 둔다)
  function applyMove(state, move) {
    const board = state.board.map((row) => row.slice());
    const [fr, fc] = move.from, [tr, tc] = move.to;
    const piece = board[fr][fc];
    const color = piece[0];
    board[fr][fc] = null;
    if (move.enPassant) board[fr][tc] = null;
    board[tr][tc] = move.promotion ? color + move.promotion : piece;
    if (move.castle) {
      if (move.castle === 'K') { board[tr][5] = board[tr][7]; board[tr][7] = null; }
      else { board[tr][3] = board[tr][0]; board[tr][0] = null; }
    }

    const castling = Object.assign({}, state.castling);
    if (piece[1] === 'K') { castling[color + 'K'] = false; castling[color + 'Q'] = false; }
    const corners = { '7,0': 'wQ', '7,7': 'wK', '0,0': 'bQ', '0,7': 'bK' };
    for (const key of [fr + ',' + fc, tr + ',' + tc]) if (corners[key]) castling[corners[key]] = false;

    return {
      board,
      turn: other(state.turn),
      castling,
      ep: move.double ? [(fr + tr) / 2, fc] : null,
      halfmove: piece[1] === 'P' || move.capture ? 0 : state.halfmove + 1,
      fullmove: state.fullmove + (state.turn === 'b' ? 1 : 0),
      prev: state,
      lastMove: move,
    };
  }

  function legalMovesFrom(state, r, c) {
    const piece = state.board[r][c];
    if (!piece || piece[0] !== state.turn) return [];
    return pseudoMoves(state, r, c).filter((m) => !isInCheck(applyMove(state, m), state.turn));
  }

  function allLegalMoves(state) {
    const result = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = state.board[r][c];
        if (p && p[0] === state.turn) result.push(...legalMovesFrom(state, r, c));
      }
    }
    return result;
  }

  function insufficientMaterial(board) {
    const rest = [];
    for (const row of board) for (const p of row) if (p && p[1] !== 'K') rest.push(p);
    if (rest.length === 0) return true;
    return rest.length === 1 && (rest[0][1] === 'B' || rest[0][1] === 'N');
  }

  // 'playing' | 'check' | 'checkmate' | 'stalemate' | 'draw'
  function getStatus(state) {
    const check = isInCheck(state, state.turn);
    if (allLegalMoves(state).length === 0) return check ? 'checkmate' : 'stalemate';
    if (insufficientMaterial(state.board) || state.halfmove >= 100) return 'draw';
    return check ? 'check' : 'playing';
  }

  const undo = (state) => state.prev || state;

  // 기록용 글자: 예) e4, Nf3, Bxe5, O-O, e8=Q+
  function moveToText(state, move) {
    const [fr, fc] = move.from, [tr, tc] = move.to;
    const piece = state.board[fr][fc];
    let text;
    if (move.castle) text = move.castle === 'K' ? 'O-O' : 'O-O-O';
    else {
      const kind = piece[1];
      const cap = move.capture ? 'x' : '';
      if (kind === 'P') {
        text = (move.capture ? FILES[fc] : '') + cap + squareName(tr, tc) + (move.promotion ? '=' + move.promotion : '');
      } else {
        // 같은 종류 말이 같은 칸으로 갈 수 있으면 구분 글자를 붙인다
        const rivals = allLegalMoves(state).filter(
          (m) => m !== move && m.piece === piece && m.to[0] === tr && m.to[1] === tc && (m.from[0] !== fr || m.from[1] !== fc)
        );
        let hint = '';
        if (rivals.length) hint = rivals.some((m) => m.from[1] === fc) ? String(8 - fr) : FILES[fc];
        text = kind + hint + cap + squareName(tr, tc);
      }
    }
    const status = getStatus(applyMove(state, move));
    return text + (status === 'checkmate' ? '#' : status === 'check' ? '+' : '');
  }

  return { newGame, fromFEN, allLegalMoves, legalMovesFrom, applyMove, getStatus, isInCheck, undo, moveToText, squareName };
});
