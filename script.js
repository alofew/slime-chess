(function () {
  'use strict';

  const KIND_NAME = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn' };

  // One player against the computer: you are Teal (you move first), the engine (engine.js) is Orange
  const HUMAN = 'w', ENGINE = 'b', ENGINE_RATING = 600;
  const winText = (c) => (c === HUMAN ? 'You win' : 'Engine wins');
  const turnText = (c) => (c === HUMAN ? 'Your turn' : 'Engine thinking…');
  const VALUE_ORDER = ['Q', 'R', 'B', 'N', 'P'];

  const $ = (id) => document.getElementById(id);
  const boardEl = $('board');
  const promoEl = $('promo');

  // The 3D board (board3d.js). It only draws; the rules live in rules.js.
  const view = Board3D.create(boardEl);
  if (!view) {
    boardEl.classList.add('no-3d');
    boardEl.textContent = '3D graphics are not available in this browser.';
    return;
  }

  let state = Chess.newGame();
  let selected = null; // selected square [row, col]
  let options = []; // legal moves of the selected piece
  let fresh = null; // the move just played (for animations)
  let freshDropped = false; // was that move made by dragging the piece and dropping it?
  let gameOver = false;
  let drag = null; // the piece currently being held with the mouse/finger
  let hoverKey = ''; // which square the pointer is over (to avoid recomputing)

  // Moves played so far (oldest first). Each item is the state right after that move.
  function history() {
    const nodes = [];
    for (let s = state; s.prev; s = s.prev) nodes.push(s);
    return nodes.reverse();
  }

  function findKing(color) {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (state.board[r][c] === color + 'K') return [r, c];
    return null;
  }

  // Small picture of a piece (captured list, promotion dialog): a snapshot of the same 3D slime as on the board
  const pieceIcon = (code) => '<img class="art3d" alt="" draggable="false" src="' + view.icon(code[0], code[1]) + '">';

  // bag[captor] = pieces that side has captured, most valuable first
  function capturedBags() {
    const bag = { w: [], b: [] };
    for (const n of history()) {
      if (n.lastMove.capture) bag[n.lastMove.capture[0] === 'w' ? 'b' : 'w'].push(n.lastMove.capture);
    }
    for (const who of ['w', 'b']) bag[who].sort((a, b) => VALUE_ORDER.indexOf(a[1]) - VALUE_ORDER.indexOf(b[1]));
    return bag;
  }

  function render() {
    const status = Chess.getStatus(state);
    gameOver = status === 'checkmate' || status === 'stalemate' || status === 'draw';
    const kingSq = status === 'check' || status === 'checkmate' ? findKing(state.turn) : null;

    hoverKey = ''; // the position may have changed: recompute the hover on the next pointer move
    view.setPreview(null);
    // Checkmate just happened: the board plays the finale (the losing pieces burst, the checking piece eats the king
    // and becomes a king), then the GAME OVER card appears
    let mate = null;
    if (fresh && status === 'checkmate') {
      const winner = state.turn === 'w' ? 'b' : 'w';
      mate = { king: kingSq, eater: findEater(kingSq, winner, fresh), winner, loser: state.turn, onDone: () => { celebrate(); showGameOver(winner, 'Checkmate'); } };
    }
    if (fresh && (status === 'stalemate' || status === 'draw')) {
      const position = state;
      setTimeout(() => { if (state === position) showGameOver(null, status === 'stalemate' ? 'Stalemate' : 'Draw'); }, 900);
    }
    if (!gameOver) hideGameOver();

    // turn: only your own pieces react to the pointer (lift on hover); during the engine's turn none do
    view.update({ board: state.board, selected, options, last: state.lastMove, kingSq, turn: state.turn === HUMAN ? HUMAN : '-', gameOver, fresh, dropped: freshDropped, captured: capturedBags(), mate });
    freshDropped = false;

    renderStatus(status);
    fresh = null;
    if (!gameOver && state.turn === ENGINE) scheduleEngine();
  }

  // ---- The engine's turn: "think" for a moment (so your move's animation can finish), then play ----
  let engineTimer = null;
  function cancelEngine() {
    clearTimeout(engineTimer);
    engineTimer = null;
  }
  function scheduleEngine() {
    cancelEngine();
    const position = state; // the position it is answering (Undo / New Game in the meantime cancels it)
    engineTimer = setTimeout(() => {
      engineTimer = null;
      if (state !== position || gameOver) return;
      const move = Engine.pickMove(state, { rating: ENGINE_RATING });
      if (move) play(move);
    }, 700 + Math.random() * 500);
  }

  // The piece giving check (the one that just moved, if it is one of them)
  function findEater(kingSq, winner, move) {
    const asWinner = Object.assign({}, state, { turn: winner });
    const hits = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = state.board[r][c];
        if (p && p[0] === winner && Chess.legalMovesFrom(asWinner, r, c).some((m) => m.to[0] === kingSq[0] && m.to[1] === kingSq[1])) hits.push([r, c]);
      }
    }
    return hits.find((h) => h[0] === move.to[0] && h[1] === move.to[1]) || hits[0] || move.to;
  }

  // GAME OVER card
  const gameOverEl = $('gameover');
  // winner: 'w' | 'b', or null for a draw. label: 'Checkmate' | 'Stalemate' | 'Draw'
  function showGameOver(winner, label) {
    $('goLabel').textContent = label;
    $('goDot').hidden = !winner;
    if (winner) $('goDot').className = 'dot ' + winner;
    $('goText').textContent = winner ? winText(winner) : 'Draw';
    gameOverEl.hidden = false;
    $('goNew').focus();
  }
  function hideGameOver() { gameOverEl.hidden = true; }

  // There is no status text on screen any more: the board itself shows the game (the engine answers, a checked king
  // trembles, captured pieces sit on the 3D trays) and the GAME OVER card shows the result. Screen readers still hear it.
  function renderStatus(status) {
    $('undoBtn').disabled = history().length === 0;
    const said = {
      playing: turnText(state.turn),
      check: turnText(state.turn) + '. Check',
      checkmate: 'Checkmate. ' + winText(state.turn === 'w' ? 'b' : 'w'),
      stalemate: 'Stalemate. Draw',
      draw: 'Draw',
    };
    $('srStatus').textContent = said[status];
  }

  // ---- Pick up & drag: press a piece to lift it; hold it longer and it spins (the spin lives in board3d.js) ----
  const movesTo = (sq) => (sq ? options.filter((m) => m.to[0] === sq[0] && m.to[1] === sq[1]) : []);
  const sameSq = (a, b) => !!a && !!b && a[0] === b[0] && a[1] === b[1];

  function deselect() {
    selected = null;
    options = [];
    render();
  }

  function onDown(e) {
    if (e.button !== 0 || drag || gameOver || state.turn !== HUMAN) return; // wait while the engine thinks
    const sq = view.pick(e.clientX, e.clientY);
    if (!sq) return;
    e.preventDefault();
    try { view.canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointers have no capture */ }
    const [r, c] = sq;
    const piece = state.board[r][c];
    clearHover();

    if (piece && piece[0] === state.turn) {
      const wasSelected = sameSq(selected, sq);
      selected = sq;
      options = Chess.legalMovesFrom(state, r, c);
      render(); // shows its legal squares
      view.hold(r, c); // squash, then stretch up
      drag = { id: e.pointerId, from: sq, wasSelected, x0: e.clientX, y0: e.clientY, dragging: false, over: sq };
      view.setCursor('grabbing');
    } else {
      drag = { id: e.pointerId, from: null, target: sq }; // a click on an empty/other square
    }
  }

  function onMove(e) {
    const d = drag;
    if (!d) {
      if (e.target === view.canvas) hoverAt(e.clientX, e.clientY);
      return;
    }
    if (e.pointerId !== d.id || !d.from) return;
    if (!d.dragging) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 5) return;
      d.dragging = true;
    }
    d.over = view.drag(e.clientX, e.clientY); // the piece follows the pointer
    view.setDrop(movesTo(d.over).length ? d.over : null);
  }

  function onUp(e) {
    const d = drag;
    if (!d || e.pointerId !== d.id) return;
    drag = null;
    view.release();
    view.setDrop(null);
    view.setCursor('default');

    if (!d.from) { // click on a square: move there if it is a legal target, otherwise deselect
      const chosen = movesTo(d.target);
      if (chosen.length) {
        if (chosen[0].promotion) askPromotion(chosen);
        else play(chosen[0]);
      } else if (selected) {
        deselect();
      }
      return;
    }

    if (!d.dragging) { // plain click on a piece: clicking an already-selected piece puts it down
      if (d.wasSelected) deselect();
      return;
    }

    const chosen = movesTo(d.over);
    if (chosen.length) {
      if (chosen[0].promotion) {
        view.park(d.over); // waits on the last rank while the dialog is open
        askPromotion(chosen);
      } else {
        play(chosen[0], true); // dropped by hand: a capture becomes a strike
      }
    } else if (!sameSq(d.over, d.from)) {
      deselect(); // illegal square: springs back
    } // put back on its own square: stays selected
  }

  function onCancel(e) {
    const d = drag;
    if (!d || e.pointerId !== d.id) return;
    drag = null;
    view.release();
    view.setDrop(null);
    view.setCursor('default');
    render();
  }

  // Hover: lift the piece a little and preview the squares it can move to
  function hoverAt(x, y) {
    const sq = view.pick(x, y);
    const key = sq ? sq[0] + ',' + sq[1] : '';
    if (key === hoverKey) return;
    hoverKey = key;
    const p = sq ? state.board[sq[0]][sq[1]] : null;
    const mine = !!p && p[0] === HUMAN && state.turn === HUMAN && !gameOver;
    view.setHover(mine ? sq : null);
    view.setCursor(mine ? 'grab' : sq && movesTo(sq).length ? 'pointer' : 'default');
    view.setPreview(mine && !selected ? Chess.legalMovesFrom(state, sq[0], sq[1]) : null);
  }

  function clearHover() {
    hoverKey = '';
    view.setHover(null);
    view.setPreview(null);
  }

  // Checkmate: the board glows and jewel-colored sparkles burst out
  function celebrate() {
    boardEl.classList.remove('celebrate');
    void boardEl.offsetWidth;
    boardEl.classList.add('celebrate');
    const rect = boardEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    for (let i = 0; i < 28; i++) {
      const s = document.createElement('span');
      s.className = 'spark';
      s.style.setProperty('--hue', Math.floor(45 + Math.random() * 120)); // sunshine yellow → lime → mint
      const angle = Math.random() * Math.PI * 2;
      const dist = 120 + Math.random() * Math.min(rect.width, 420) * 0.7;
      s.style.setProperty('--x', cx + 'px');
      s.style.setProperty('--y', cy + 'px');
      s.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
      s.style.setProperty('--dy', Math.sin(angle) * dist + 'px');
      s.style.setProperty('--s', 10 + Math.random() * 16 + 'px');
      s.style.setProperty('--d', 0.9 + Math.random() * 0.9 + 's');
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 2000);
    }
  }

  function play(move, dropped) {
    state = Chess.applyMove(state, move);
    fresh = move;
    freshDropped = !!dropped;
    selected = null;
    options = [];
    render();
  }

  function askPromotion(moves) {
    const box = $('promoChoices');
    box.innerHTML = '';
    for (const m of moves) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = state.turn;
      b.innerHTML = pieceIcon(state.turn + m.promotion);
      b.setAttribute('aria-label', KIND_NAME[m.promotion]);
      b.addEventListener('click', () => {
        promoEl.hidden = true;
        play(m);
      });
      box.appendChild(b);
    }
    promoEl.hidden = false;
    box.firstChild.focus();
  }

  view.canvas.addEventListener('pointerdown', onDown);
  view.canvas.addEventListener('pointerleave', () => { if (!drag) { clearHover(); view.setCursor('default'); } });
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);

  promoEl.addEventListener('click', (e) => {
    if (e.target === promoEl) { // click outside to cancel: the pawn goes back
      promoEl.hidden = true;
      deselect();
    }
  });

  // Undo takes back the engine's reply too, so it is your turn again
  function undoMove() {
    cancelEngine();
    state = Chess.undo(state);
    if (state.turn === ENGINE && state.prev) state = Chess.undo(state);
    selected = null;
    options = [];
    render();
  }

  function newGame() {
    cancelEngine();
    state = Chess.newGame();
    selected = null;
    options = [];
    render();
  }

  $('undoBtn').addEventListener('click', undoMove);
  $('newBtn').addEventListener('click', () => {
    if (history().length && !gameOver && !confirm('Start a new game? The current game will be lost.')) return;
    newGame();
  });

  // GAME OVER card: Undo / New Game, or click outside to look at the board
  $('goUndo').addEventListener('click', undoMove);
  $('goNew').addEventListener('click', newGame);
  gameOverEl.addEventListener('click', (e) => { if (e.target === gameOverEl) hideGameOver(); });

  render();
})();
