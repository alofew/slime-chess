// 3D 체스판. window.Board3D.create(컨테이너) -> view (WebGL을 못 쓰면 null)
// 판·말·강조 표시·집기/드래그/뱅그르르·잡기 효과를 전부 three.js로 그린다.
// 규칙은 모르고, script.js가 view.update({...})로 현재 모습을 알려준다.
// 의존: vendor/three.min.js, pieces3d.js
(function (root) {
  'use strict';
  const THREE = root.THREE;
  const reduce = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const SCALE = 1.1; // 말 크기 (칸 하나 = 1)
  const LIFT = { held: 0.42, drag: 0.24, sel: 0.16, hover: 0.08 };
  const HOLD_Y = 0.3; // 끄는 동안 마우스가 말을 잡는 높이 (낮을수록 가리키는 칸과 말 위치가 덜 어긋난다)
  const SPIN_AFTER = 800, SPIN_EVERY = 2500, SPIN_MS = 1450;
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const EL = (44 * Math.PI) / 180; // 카메라가 내려다보는 각도
  const INK = 0x10200f; // 갈 수 있는 칸 점·고리 색 (아주 어두운 초록)

  const sqX = (c) => c - 3.5;
  const sqZ = (r) => r - 3.5;
  const sqFromXZ = (x, z) => {
    const c = Math.floor(x + 4), r = Math.floor(z + 4);
    return r >= 0 && r < 8 && c >= 0 && c < 8 ? [r, c] : null;
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const easeOutBack = (t) => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

  function disposeObj(o) {
    o.traverse((n) => { if (n.geometry) n.geometry.dispose(); });
  }

  function create(container) {
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (err) {
      return null;
    }
    renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const canvas = renderer.domElement;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Chessboard');
    container.appendChild(canvas);

    // ---- 좌표 글자 (a-h, 1-8): 화면 위치만 계산해서 겹쳐 놓는다 ----
    const labelLayer = document.createElement('div');
    labelLayer.className = 'coords';
    container.appendChild(labelLayer);
    const rankEls = [], fileEls = [];
    for (let i = 0; i < 8; i++) {
      const rk = document.createElement('span');
      rk.className = 'coord';
      rk.textContent = String(8 - i);
      labelLayer.appendChild(rk);
      rankEls.push(rk);
      const fl = document.createElement('span');
      fl.className = 'coord';
      fl.textContent = 'abcdefgh'[i];
      labelLayer.appendChild(fl);
      fileEls.push(fl);
    }

    // ---- 장면, 카메라, 조명 ----
    const scene = new THREE.Scene();
    const world = new THREE.Group(); // 흔들림 효과용
    scene.add(world);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 60);

    scene.add(new THREE.HemisphereLight(0xd4ecf2, 0x5e8a3c, 0.42)); // 위: 맑은 하늘, 아래: 풀빛 반사
    const sun = new THREE.DirectionalLight(0xfff0d0, 0.62); // 따뜻한 햇빛
    sun.position.set(-4, 8, 5.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 25 });
    sun.shadow.radius = 4;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);
    const rimLight = new THREE.DirectionalLight(0xd8f2b8, 0.45); // 뒤쪽에서 비추는 빛: 젤리 가장자리의 윤기
    rimLight.position.set(5, 5, -6);
    scene.add(rimLight);

    // ---- 슬라임 표면에 비칠 주변 환경: 위는 밝고 아래는 어두운 하늘 + 밝은 조명판 몇 장 ----
    (() => {
      const env = new THREE.Scene();
      const cv = document.createElement('canvas');
      cv.width = 4; cv.height = 256;
      const g = cv.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, '#b9dcec'); // 맑은 하늘
      grad.addColorStop(0.42, '#eef3dc'); // 지평선 아지랑이
      grad.addColorStop(0.55, '#a9d27a'); // 풀밭
      grad.addColorStop(1, '#3d5a26'); // 발밑 그늘
      g.fillStyle = grad;
      g.fillRect(0, 0, 4, 256);
      env.add(new THREE.Mesh(new THREE.SphereGeometry(30, 32, 16), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), side: THREE.BackSide })));
      const panel = (x, y, z, w, h, power) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(power, power, power), side: THREE.DoubleSide }));
        m.position.set(x, y, z);
        m.lookAt(0, 0, 0);
        env.add(m);
      };
      panel(-7, 9, 6, 7, 7, 7); // 왼쪽 위 앞의 큰 조명
      panel(8, 6, -5, 4, 7, 4); // 오른쪽 뒤
      panel(0, 12, 0, 9, 9, 2); // 머리 위
      const pm = new THREE.PMREMGenerator(renderer);
      const tex = pm.fromScene(env, 0.02).texture;
      for (const c of ['w', 'b']) {
        const m = Piece3D.material(c);
        m.envMap = tex;
        m.envMapIntensity = 1.7;
        m.needsUpdate = true;
      }
      pm.dispose();
    })();

    // ---- 판 ----
    const tileMat = {
      light: new THREE.MeshStandardMaterial({ color: 0xa9cc78, roughness: 0.9 }), // 햇빛 받은 연두 풀밭
      dark: new THREE.MeshStandardMaterial({ color: 0x5f9440, roughness: 0.9 }), // 싱그러운 풀색
    };
    const tileGeo = new THREE.BoxGeometry(0.985, 0.12, 0.985);
    const baseMesh = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.3, 8.2), new THREE.MeshStandardMaterial({ color: 0x4f3622, roughness: 1 })); // 판 밑바닥: 흙
    baseMesh.position.y = -0.19;
    baseMesh.receiveShadow = true;
    world.add(baseMesh);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x8a6440, roughness: 0.95 }); // 테두리: 햇빛 받은 흙길
    [[8.64, 0.32, 0, -4.16], [8.64, 0.32, 0, 4.16], [0.32, 8.0, -4.16, 0], [0.32, 8.0, 4.16, 0]].forEach(([w, d, x, z]) => {
      const rim = new THREE.Mesh(new THREE.BoxGeometry(w, 0.18, d), rimMat);
      rim.position.set(x, -0.07, z);
      rim.receiveShadow = true;
      world.add(rim);
    });
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const t = new THREE.Mesh(tileGeo, (r + c) % 2 === 0 ? tileMat.light : tileMat.dark);
        t.position.set(sqX(c), -0.06, sqZ(r));
        t.receiveShadow = true;
        world.add(t);
      }
    }

    // ---- 잡초: 칸 모서리(말 받침과 겹치지 않는 자리)와 흙 테두리에 풀 포기, 몇 개엔 작은 들꽃. 바람에 살랑인다 ----
    // 클릭 판정에는 들어가지 않는다(말·바닥만 고른다). 매번 같은 자리에 나도록 정해진 난수를 쓴다.
    const tufts = [];
    (() => {
      let seed = 917;
      const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      const bladeMats = [0x4c8a2c, 0x6cb03a, 0x96d257].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, flatShading: true }));
      const flowerMats = [0xff9ccf, 0xffe066, 0xffffff].map((c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.15, roughness: 0.6 }));
      const bladeGeo = new THREE.ConeGeometry(1, 1, 3);
      bladeGeo.translate(0, 0.5, 0); // 밑동이 원점에 오게
      const headGeo = new THREE.IcosahedronGeometry(1, 0);

      function tuft(x, y, z, size, flower) {
        const g = new THREE.Group();
        const n = 6 + Math.floor(rnd() * 4);
        for (let i = 0; i < n; i++) {
          const b = new THREE.Mesh(bladeGeo, bladeMats[Math.floor(rnd() * 3)]);
          const a = rnd() * Math.PI * 2, d = rnd() * 0.05 * size;
          b.scale.set(0.03 * size, (0.24 + rnd() * 0.22) * size, 0.03 * size);
          b.position.set(Math.cos(a) * d * 1.6, 0, Math.sin(a) * d * 1.6);
          b.rotation.set((rnd() - 0.5) * 0.9, a, (rnd() - 0.5) * 0.9); // 사방으로 살짝 벌어진다
          b.castShadow = true;
          g.add(b);
        }
        if (flower) {
          const h = (0.38 + rnd() * 0.12) * size;
          const stem = new THREE.Mesh(bladeGeo, bladeMats[0]);
          stem.scale.set(0.012 * size, h, 0.012 * size);
          const head = new THREE.Mesh(headGeo, flowerMats[Math.floor(rnd() * 3)]);
          head.scale.setScalar(0.05 * size);
          head.position.y = h;
          const f = new THREE.Group();
          f.add(stem, head);
          f.rotation.set((rnd() - 0.5) * 0.4, 0, (rnd() - 0.5) * 0.4);
          f.position.set((rnd() - 0.5) * 0.06, 0, (rnd() - 0.5) * 0.06);
          g.add(f);
        }
        g.position.set(x, y, z);
        world.add(g);
        tufts.push({ g, phase: rnd() * Math.PI * 2, speed: 0.8 + rnd() * 0.6 });
      }

      // 판 위: 안쪽 칸 모서리 49곳 중 12곳
      const corners = [];
      for (let i = 1; i <= 7; i++) for (let j = 1; j <= 7; j++) corners.push([i - 4, j - 4]);
      for (let k = 0; k < 12; k++) {
        const [x, z] = corners.splice(Math.floor(rnd() * corners.length), 1)[0];
        tuft(x + (rnd() - 0.5) * 0.08, 0, z + (rnd() - 0.5) * 0.08, 0.85 + rnd() * 0.3, rnd() < 0.3);
      }
      // 흙 테두리 위: 네 변에 조금 더 큰 풀 포기
      for (let k = 0; k < 12; k++) {
        const along = (rnd() - 0.5) * 8.2, side = Math.floor(rnd() * 4);
        const edge = side % 2 ? 4.16 : -4.16;
        const [x, z] = side < 2 ? [along, edge] : [edge, along];
        tuft(x, 0.02, z, 1.3 + rnd() * 0.4, rnd() < 0.45);
      }
    })();

    // ---- 칸 위의 강조 표시들 ----
    function overlayMat(color) {
      return new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    }
    const checkTex = (() => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 128;
      const g = cv.getContext('2d');
      const grad = g.createRadialGradient(64, 64, 8, 64, 64, 62);
      grad.addColorStop(0, 'rgba(232,76,76,0.9)');
      grad.addColorStop(0.45, 'rgba(232,76,76,0.75)');
      grad.addColorStop(1, 'rgba(232,76,76,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(cv);
    })();
    const squareRingGeo = new THREE.RingGeometry(0.62, 0.68, 4);
    squareRingGeo.rotateZ(Math.PI / 4);
    const planeGeo = new THREE.PlaneGeometry(0.985, 0.985);
    const dotGeo = new THREE.CircleGeometry(0.12, 20);
    const ringGeo = new THREE.RingGeometry(0.33, 0.4, 28);
    const ov = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const o = {
          tint: new THREE.Mesh(planeGeo, overlayMat(0xffd678)),
          sel: new THREE.Mesh(squareRingGeo, overlayMat(0xffffff)),
          dot: new THREE.Mesh(dotGeo, overlayMat(INK)),
          ring: new THREE.Mesh(ringGeo, overlayMat(INK)),
          check: new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ map: checkTex, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })),
        };
        [o.tint, o.sel, o.dot, o.ring, o.check].forEach((m, i) => {
          m.rotation.x = -Math.PI / 2;
          m.position.set(sqX(c), 0.004 + i * 0.001, sqZ(r));
          m.visible = false;
          world.add(m);
        });
        ov.push(o);
      }
    }
    const setOv = (mesh, opacity, color) => {
      mesh.visible = opacity > 0;
      mesh.material.opacity = opacity;
      if (color !== undefined) mesh.material.color.setHex(color);
    };

    // ---- 상태 ----
    let data = { board: null, selected: null, options: [], last: null, kingSq: null, turn: 'w', gameOver: false };
    let preview = null; // 호버 미리보기로 보여줄 이동들
    let dropSq = null;
    let hoverPc = null;
    let holdPc = null;
    let lastReleased = null;

    function refreshOverlays() {
      const sel = data.selected, last = data.last;
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const o = ov[r * 8 + c];
          let tint = 0, tintColor = 0xffd678, selRing = 0;
          if (last && ((last.from[0] === r && last.from[1] === c) || (last.to[0] === r && last.to[1] === c))) tint = 0.38;
          if (sel && sel[0] === r && sel[1] === c) { tint = 0.6; tintColor = 0xffe08c; selRing = 0.55; }
          if (dropSq && dropSq[0] === r && dropSq[1] === c) { tint = 0.35; tintColor = 0xffffff; selRing = 0.85; }
          setOv(o.tint, tint, tintColor);
          setOv(o.sel, selRing);
          setOv(o.dot, 0);
          setOv(o.ring, 0);
          o.check.visible = false; // 체크는 칸 대신 킹이 바들바들 떨며 울먹이는 것으로 보여 준다
        }
      }
      const show = (moves, alpha) => {
        for (const m of moves) {
          const o = ov[m.to[0] * 8 + m.to[1]];
          if (m.capture) setOv(o.ring, alpha * 1.15); else setOv(o.dot, alpha);
        }
      };
      if (data.options && data.options.length) show(data.options, 0.28);
      else if (preview) show(preview, 0.2);
    }

    // ---- 말 ----
    const pieces = [];
    const grid = Array.from({ length: 8 }, () => Array(8).fill(null));
    const fxList = []; // {t0, dur, step(t), end()}
    const shards = []; // 젤리 덩어리들
    const chunkGeo = new THREE.SphereGeometry(1, 16, 12);
    let shakeT = -1, shakeAmp = 0.05;

    const baseRot = (code) => (code[1] === 'N' ? (code[0] === 'w' ? 0.45 : -0.45) : 0);

    function makePc(r, c, code) {
      const rootG = new THREE.Group();
      const model = Piece3D.build(code[0], code[1]);
      model.rotation.y = baseRot(code);
      const jig = new THREE.Group(); // 젤리 출렁임: 찌그러짐·기울어짐 행렬을 직접 넣는다
      jig.matrixAutoUpdate = false;
      jig.add(model);
      rootG.add(jig);
      world.add(rootG);
      return {
        r, c, code, root: rootG, model, jig,
        wx: 0, wz: 0, wvx: 0, wvz: 0, j: 0, jv: 0, px: sqX(c), pz: sqZ(r), pvx: 0, pvz: 0, jLand: -1, jPress: 0,
        x: sqX(c), z: sqZ(r), vx: 0, vz: 0, y: 0,
        held: false, dragging: false, dragX: 0, dragZ: 0, press: 0, spinAt: 0, spinStart: -1,
        landT: -1, releasedAt: -9999, move: null, parked: null, sel: false, can: false,
        popT: -1, popDelay: 0,
      };
    }

    function addFx(dur, step, end) {
      fxList.push({ t0: performance.now(), dur: dur * 1000, step, end });
    }

    function removePcVisual(pc, animate) {
      if (!animate || reduce) { world.remove(pc.root); disposeObj(pc.root); return; }
      const s0 = pc.root.scale.x;
      addFx(0.25, (t) => { pc.root.scale.setScalar(s0 * (1 - t)); pc.root.position.y += 0.01; }, () => { world.remove(pc.root); disposeObj(pc.root); });
    }

    // 잡힌 말: 먼저 젤리처럼 찌그러지고(맞은 방향으로 쏠리며), 그다음 말랑한 덩어리들로 찢어진다.
    // hit = {dx, dz}: 내리쳐 맞은 방향. 있으면 더 세게 찌그러지고 덩어리가 그쪽으로 더 많이 튄다.
    function shatter(pc, hit) {
      if (reduce) { world.remove(pc.root); disposeObj(pc.root); return; }
      const dx = hit ? hit.dx : 0, dz = hit ? hit.dz : 0;
      const flat = hit ? 0.62 : 0.4, wide = hit ? 0.55 : 0.32;
      addFx(hit ? 0.14 : 0.1, (t) => {
        const e = easeOutCubic(t);
        const sy = 1 - flat * e, sx = 1 + wide * e;
        pc.jig.matrix.set(sx, dx * 0.6 * e, 0, 0, 0, sy, 0, 0, 0, dz * 0.6 * e, sx, 0, 0, 0, 0, 1);
        pc.jig.matrixWorldNeedsUpdate = true;
      }, () => burst(pc, hit));
      shakeT = performance.now();
      shakeAmp = hit ? 0.1 : 0.04;
    }

    function burst(pc, hit) {
      world.remove(pc.root);
      disposeObj(pc.root);
      const mat = Piece3D.chunkMaterial(pc.code[0]);
      const dx = hit ? hit.dx : 0, dz = hit ? hit.dz : 0;
      const now = performance.now();
      const count = hit ? 17 : 11;
      const push = hit ? 2.2 : 0;
      for (let i = 0; i < count; i++) {
        const m = new THREE.Mesh(chunkGeo, mat);
        m.castShadow = true;
        const r = 0.07 + Math.random() * 0.085;
        const a = Math.random() * Math.PI * 2, sp = 0.4 + Math.random() * (hit ? 1.9 : 1.5);
        m.position.set(pc.x + Math.cos(a) * 0.14, 0.1 + Math.random() * (hit ? 0.3 : 0.5), pc.z + Math.sin(a) * 0.14);
        m.scale.setScalar(r);
        world.add(m);
        const fwd = push * (0.3 + Math.random());
        shards.push({
          m, r, sq: -0.35, sqv: 0, // sq: 찌그러진 정도(음수면 납작). 처음엔 눌린 채로 튀어나온다
          vx: Math.cos(a) * sp + dx * fwd, vy: 1.4 + Math.random() * 2.6, vz: Math.sin(a) * sp + dz * fwd,
          t0: now, life: 1.5 + Math.random() * 0.5,
        });
      }
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 28), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(pc.x, 0.012, pc.z);
      world.add(ring);
      addFx(0.5, (t) => { ring.scale.setScalar(1 + t * 3.2); ringMat.opacity = 0.5 * (1 - t); }, () => { world.remove(ring); ring.geometry.dispose(); ringMat.dispose(); });
    }

    function convertPc(pc, code) {
      pc.jig.remove(pc.model);
      disposeObj(pc.model);
      pc.code = code;
      pc.model = Piece3D.build(code[0], code[1]);
      pc.model.rotation.y = baseRot(code);
      pc.jig.add(pc.model);
    }

    // 승급 변신: 그 자리에서 "뿅"(눌렸다 튐) "뿅!"(더 높이 튀며 반짝, 그 순간 새 말로 바뀜) 하고 내려앉는다
    const MORPH_MS = 900;
    function startMorph(pc, code) {
      if (reduce) { convertPc(pc, code); return; }
      pc.morph = { t0: performance.now(), code, puff1: false, swapped: false };
    }

    // 반짝이: 말 둘레로 작은 빛 방울이 톡 퍼졌다 사라진다
    const sparkGeo = new THREE.SphereGeometry(1, 8, 6);
    function puff(pc, n, power) {
      const tint = Piece3D.material(pc.code[0]).attenuationColor;
      const mats = [new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }), new THREE.MeshBasicMaterial({ color: tint, transparent: true, depthWrite: false })];
      const x0 = pc.x, z0 = pc.z;
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(sparkGeo, mats[i % 2]);
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
        const v = power * (0.6 + Math.random() * 0.6);
        const y0 = 0.25 + Math.random() * 0.45;
        const size = 0.03 + Math.random() * 0.025;
        world.add(m);
        addFx(0.5, (t) => {
          const e = easeOutCubic(t);
          m.position.set(x0 + Math.cos(a) * v * e, y0 + Math.sin(Math.PI * t) * v * 0.35, z0 + Math.sin(a) * v * e);
          m.scale.setScalar(size * (1 - t));
        }, () => world.remove(m));
      }
      addFx(0.5, (t) => { for (const mt of mats) mt.opacity = 1 - t; }, () => { for (const mt of mats) mt.dispose(); });
    }

    // ---- 체크메이트 연출: 진 쪽 말들이 한꺼번에 터지고 → 체크를 건 말이 입을 벌려 킹을 삼키고 → 킹으로 변신 ----
    const mouthGeo = new THREE.SphereGeometry(1, 20, 14);
    const mouthMat = new THREE.MeshBasicMaterial({ color: 0x2a0816 });
    function addMouth(pc) {
      const eyes = pc.eyes || [];
      const m = new THREE.Mesh(mouthGeo, mouthMat);
      if (pc.code[1] === 'N') { // 나이트는 주둥이 끝에
        m.position.set(0.3, 0.47, 0);
        m.rotation.y = Math.PI / 2;
      } else if (eyes.length) { // 나머지는 두 눈 아래 가운데
        const ax = (eyes[0].position.x + eyes[eyes.length - 1].position.x) / 2;
        const az = (eyes[0].position.z + eyes[eyes.length - 1].position.z) / 2;
        m.position.set(ax, eyes[0].position.y - eyes[0].userData.eyeH * 2.2, az + 0.012);
      }
      (eyes[0] ? eyes[0].parent : pc.model).add(m);
      m.scale.set(0.05, 0.008, 0.022);
      pc.mouth = m;
      pc.mouthAmt = 0;
    }
    function dropMouth(pc) {
      if (pc.mouth && pc.mouth.parent) pc.mouth.parent.remove(pc.mouth);
      pc.mouth = null;
      pc.mouthOpen = false;
    }

    let cine = null; // 진행 중인 연출 (Undo·New Game이면 끊는다)
    function cancelCine() {
      if (!cine) return;
      cine = null;
      for (const pc of pieces) {
        if (pc.eat && !pc.eat.kGone) { world.remove(pc.eat.king.root); disposeObj(pc.eat.king.root); }
        pc.eat = null; pc.stTilt = 0; pc.faceYaw = 0; pc.happy = false;
        dropMouth(pc); pc.gulpOn = false; pc.chewT = -1;
      }
    }

    // ---- 먹기: 체크를 건 말(e)이 킹(k)에게 다가가 입을 쩍 벌리고 덥석 삼킨 뒤 우물우물 씹는다 ----
    const EAT_MS = 2300;
    const mouthW = new THREE.Vector3(), rootW = new THREE.Vector3();
    function startEat(e, k) {
      pieces.splice(pieces.indexOf(k), 1);
      grid[e.r][e.c] = null;
      e.r = k.r; e.c = k.c;
      grid[k.r][k.c] = e;
      e.move = null;
      addMouth(e);
      const kx = sqX(k.c), kz = sqZ(k.r);
      let dx = kx - e.x, dz = kz - e.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      // 입이 지금 보고 있는 방향 → 킹 쪽으로 돌려야 할 각도
      e.root.updateMatrixWorld(true);
      e.mouth.getWorldPosition(mouthW);
      e.root.getWorldPosition(rootW);
      const a0 = Math.atan2(mouthW.x - rootW.x, mouthW.z - rootW.z);
      let yaw = Math.atan2(dx, dz) - a0;
      yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
      e.eat = { t0: performance.now(), king: k, kx, kz, dx, dz, fx: e.x, fz: e.z, yaw, ks: k.root.scale.x, kGone: false };
    }

    function stepEat(pc, now) {
      const E = pc.eat, k = E.king;
      const t = Math.min(1, (now - E.t0) / EAT_MS);
      let sy = 1, sxz = 1, hop = 0;
      pc.stDx = E.dx; pc.stDz = E.dz;
      pc.vx = pc.vz = 0;
      pc.happy = false;
      // 몸을 돌려 킹을 마주보고, 끝날 무렵 다시 정면으로
      pc.faceYaw = E.yaw * easeOutCubic(Math.min(1, t / 0.15)) * (t < 0.9 ? 1 : 1 - (t - 0.9) / 0.1);
      const ax = E.kx - E.dx * 0.85, az = E.kz - E.dz * 0.85; // 킹 바로 앞, 멈춰 서는 자리
      if (t < 0.18) { // 1. 깡총 다가간다
        const u = t / 0.18, e = easeInOut(u);
        pc.x = lerp(E.fx, ax, e); pc.z = lerp(E.fz, az, e);
        hop = Math.sin(Math.PI * u) * 0.35;
        pc.mouthAmt = 0.3 * u; pc.stTilt = 0;
      } else if (t < 0.36) { // 2. 뒤로 젖히며 입을 쩍 벌린다
        const u = (t - 0.18) / 0.18, e = easeOutCubic(u);
        pc.x = ax; pc.z = az;
        pc.stTilt = -0.4 * e;
        pc.mouthAmt = 0.3 + 1.4 * e;
        sy = 1 + 0.16 * e; sxz = 1 - 0.05 * e; hop = 0.1 * e;
      } else if (t < 0.46) { // 3. 덥석! 앞으로 덮친다
        const u = (t - 0.36) / 0.1, e = u * u;
        pc.x = lerp(ax, E.kx, e); pc.z = lerp(az, E.kz, e);
        pc.stTilt = lerp(-0.4, 0.55, e);
        pc.mouthAmt = 1.7;
        sy = 1.16 - 0.12 * e; hop = 0.1 + 0.15 * Math.sin(Math.PI * u);
      } else if (t < 0.5) { // 입을 콱 다문다
        pc.x = E.kx; pc.z = E.kz; pc.stTilt = 0.55;
        pc.mouthAmt = 1.7 * (1 - (t - 0.46) / 0.04);
      } else if (t < 0.66) { // 4. 꿀꺽: 몸이 불룩해졌다 돌아온다
        const u = (t - 0.5) / 0.16;
        pc.x = E.kx; pc.z = E.kz; pc.mouthAmt = 0;
        pc.stTilt = 0.55 * (1 - easeOutCubic(u));
        const w = Math.sin(Math.PI * u) * 0.32;
        sxz = 1 + w; sy = 1 - w * 0.6;
      } else { // 5. 우물우물 씹는다, 눈은 ^^
        const u = (t - 0.66) / 0.34;
        pc.x = E.kx; pc.z = E.kz; pc.stTilt = 0;
        pc.mouthAmt = 0.12 + 0.16 * Math.max(0, Math.sin(u * Math.PI * 8));
        pc.happy = u < 0.85;
        const w = Math.sin(u * Math.PI * 4) * 0.12 * (1 - u);
        sy = 1 - w; sxz = 1 + w * 0.6;
      }
      // 킹: 덜덜 떨다가, 덥석하는 순간 쭉 늘어나며 입속으로 빨려 들어간다
      if (k && !E.kGone) {
        const s = now / 1000;
        if (t < 0.4) {
          k.root.position.set(E.kx + Math.sin(s * 80) * 0.03, 0, E.kz + Math.sin(s * 97) * 0.02);
        } else {
          const u = Math.min(1, (t - 0.4) / 0.09);
          pc.mouth.getWorldPosition(mouthW);
          k.root.position.set(lerp(E.kx, mouthW.x, u), lerp(0, mouthW.y - 0.25, u), lerp(E.kz, mouthW.z, u));
          const f = 1 - u;
          k.root.scale.set(E.ks * f * 0.8 + 0.0001, E.ks * f * (1 + 0.7 * u) + 0.0001, E.ks * f * 0.8 + 0.0001);
          if (u >= 1) {
            E.kGone = true;
            world.remove(k.root);
            disposeObj(k.root);
            puff(pc, 10, 0.35);
          }
        }
      }
      if (t >= 1) { pc.eat = null; pc.stTilt = 0; pc.faceYaw = 0; pc.happy = false; pc.mouthAmt = 0; pc.landT = now; }
      return { sy, sxz, hop };
    }

    // info = { king: [r,c], eater: [r,c], winner, loser, onDone }
    function playMate(info) {
      cancelCine();
      if (reduce) { if (info.onDone) info.onDone(); return; }
      const token = {};
      cine = token;
      const at = (ms, fn) => setTimeout(() => { if (cine === token) fn(); }, ms);
      const eaterAt = () => grid[info.eater[0]][info.eater[1]];
      const first = eaterAt();
      let t = (first && first.move ? first.move.dur * 1000 : 400) + 300;

      // 1. 진 쪽의 킹을 뺀 말들이 한꺼번에 터진다
      at(t, () => {
        for (const pc of pieces.slice()) {
          if (pc.code[0] !== info.loser || pc.code[1] === 'K') continue;
          pieces.splice(pieces.indexOf(pc), 1);
          if (grid[pc.r][pc.c] === pc) grid[pc.r][pc.c] = null;
          setTimeout(() => shatter(pc), Math.random() * 90);
        }
        setTimeout(() => { shakeT = performance.now(); shakeAmp = 0.15; }, 110);
      });
      t += 1100;

      // 2~4. 체크를 건 말이 킹을 먹는다 (다가가기 → 입 쩍 → 덥석 → 꿀꺽 → 우물우물)
      at(t, () => {
        const e = eaterAt(), k = grid[info.king[0]][info.king[1]];
        if (e && k && e !== k) startEat(e, k);
      });
      t += EAT_MS + 150;

      // 5. 뿅뿅 하고 스스로 킹이 된다
      at(t, () => {
        const e = grid[info.king[0]][info.king[1]];
        if (!e) return;
        dropMouth(e);
        startMorph(e, info.winner + 'K');
      });
      t += MORPH_MS + 300;

      // 6. 게임 오버
      at(t, () => {
        cine = null;
        if (info.onDone) info.onDone();
      });
    }

    // 매 프레임: 변신 중이면 눌림·튀어오름·크기를 돌려준다
    function stepMorph(pc, now) {
      const m = pc.morph;
      const t = (now - m.t0) / MORPH_MS;
      if (t >= 1) { pc.morph = null; pc.landT = now; return null; }
      let sy = 1, sxz = 1, up = 0, grow = 1;
      const bump = (a, b, depth) => { const u = (t - a) / (b - a); const w = Math.sin(Math.PI * u) * depth; sy = 1 - w; sxz = 1 + w * 0.7; };
      const hop = (a, b, height) => { const u = (t - a) / (b - a); up = Math.sin(Math.PI * u) * height; sy = 1 + 0.12 * Math.sin(Math.PI * u); sxz = 1 - 0.06 * Math.sin(Math.PI * u); };
      if (t < 0.16) bump(0, 0.16, 0.22); // 눌림 1
      else if (t < 0.36) { hop(0.16, 0.36, 0.22); if (!m.puff1) { m.puff1 = true; puff(pc, 8, 0.45); } } // 뿅
      else if (t < 0.5) bump(0.36, 0.5, 0.32); // 눌림 2 (더 깊게)
      else if (t < 0.84) { // 뿅! 가장 높은 곳에서 새 말로 바뀐다
        hop(0.5, 0.84, 0.48);
        if (!m.swapped && t >= 0.64) { m.swapped = true; convertPc(pc, m.code); puff(pc, 16, 0.85); }
        if (m.swapped) grow = 0.55 + 0.45 * easeOutBack(Math.min(1, (t - 0.64) / 0.2));
      } else { const u = (t - 0.84) / 0.16; const w = Math.sin(Math.PI * u) * 0.25; sy = 1 - w; sxz = 1 + w * 0.6; } // 착지
      return { sy, sxz, up, grow };
    }

    // ---- 잡힌 말 진열대: 세로로 긴 화면에서만 판 위(Orange가 잡은 것)·아래(Teal이 잡은 것)에 놓는다 ----
    const TRAY_SCALE = SCALE * 0.7;
    // 세로 화면(rows): 판 위(엔진=Orange가 잡은 것)·아래(내가 잡은 것)에 가로 줄로
    // 가로로 긴 화면(cols): 판 왼쪽(엔진이 잡은 것)·오른쪽(내가 잡은 것)에 세로 줄로
    const TRAY = { b: { at: -5.15, dir: -1 }, w: { at: 5.15, dir: 1 } }; // 키 = 잡은 쪽 색
    let trayMode = null; // 'rows' | 'cols' | null(숨김)
    const trayGroup = new THREE.Group();
    trayGroup.visible = false;
    world.add(trayGroup);
    const plateMat = new THREE.MeshStandardMaterial({ color: 0x6e4f33, roughness: 1 }); // 가는 흙길 받침
    const plates = { rows: [], cols: [] };
    for (const side of ['w', 'b']) {
      const t = TRAY[side];
      const row = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.05, 1.05), plateMat);
      row.position.set(0, -0.1, t.at);
      const col = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.05, 7.4), plateMat);
      col.position.set(t.at, -0.1, 0);
      for (const p of [row, col]) { p.receiveShadow = true; trayGroup.add(p); }
      plates.rows.push(row);
      plates.cols.push(col);
    }
    const trayItems = { w: [], b: [] };

    // 진열대 위 자리 계산. snap이면 미끄러지지 않고 바로 그 자리에 놓는다(화면 방향이 바뀔 때)
    function layoutTray(snap) {
      for (const p of plates.rows) p.visible = trayMode === 'rows';
      for (const p of plates.cols) p.visible = trayMode === 'cols';
      for (const side of ['w', 'b']) {
        const t = TRAY[side], list = trayItems[side];
        list.forEach((it, i) => {
          const line = Math.floor(i / 8), inLine = Math.min(8, list.length - line * 8);
          const along = (i % 8 - (inLine - 1) / 2) * 0.92;
          const out = t.at + t.dir * line * 0.85;
          if (trayMode === 'cols') { it.tx = out; it.tz = along; } else { it.tx = along; it.tz = out; }
          if (snap || !it.placed) { it.x = it.tx; it.z = it.tz; it.placed = true; }
        });
      }
    }

    function makeTrayItem(code, delay) {
      const rootG = new THREE.Group();
      const model = Piece3D.build(code[0], code[1]);
      model.rotation.y = baseRot(code);
      rootG.add(model);
      trayGroup.add(rootG);
      const eyes = [];
      model.traverse((n) => { if (n.userData && n.userData.eyeH) eyes.push(n); });
      return { code, root: rootG, eyes, x: 0, z: 0, tx: 0, tz: 0, placed: false, popT: performance.now(), popDelay: reduce ? 0 : delay, blinkAt: performance.now() + 800 + Math.random() * 4000 };
    }

    function syncTray(captured, fresh) {
      for (const side of ['w', 'b']) {
        const list = (captured && captured[side]) || [];
        const pool = trayItems[side].slice();
        const next = [];
        // 방금 잡은 말은 덩어리로 흩어진 뒤(약 1초) 진열대에서 다시 뭉친다
        const delay = fresh && fresh.capture && fresh.piece[0] === side ? 1.0 : 0.1;
        for (const code of list) {
          const i = pool.findIndex((it) => it.code === code);
          next.push(i >= 0 ? pool.splice(i, 1)[0] : makeTrayItem(code, delay));
        }
        for (const it of pool) removeTrayItem(it); // 되돌리기·새 게임
        trayItems[side] = next;
      }
      layoutTray(false);
    }

    function removeTrayItem(it) {
      if (reduce) { trayGroup.remove(it.root); disposeObj(it.root); return; }
      const s0 = it.root.scale.x;
      addFx(0.22, (t) => it.root.scale.setScalar(s0 * (1 - t)), () => { trayGroup.remove(it.root); disposeObj(it.root); });
    }

    function stepTray(now, dt) {
      const k = 1 - Math.exp(-10 * dt);
      for (const side of ['w', 'b']) {
        for (const it of trayItems[side]) {
          it.x += (it.tx - it.x) * k;
          it.z += (it.tz - it.z) * k;
          // 뭉치듯 튀어나온다: 커지면서 위아래로 출렁
          let s = 1, w = 0;
          if (it.popT > 0) {
            const t = (now - it.popT - it.popDelay * 1000) / 520;
            if (t < 0) s = 0.0001;
            else if (t >= 1) it.popT = -1;
            else { s = Math.max(0.0001, easeOutBack(Math.min(1, t * 1.6))); w = Math.sin(t * Math.PI * 3) * (1 - t) * 0.28; }
          }
          it.root.visible = s > 0.001;
          it.root.position.set(it.x, 0, it.z);
          it.root.scale.set(TRAY_SCALE * s * (1 - w * 0.5), TRAY_SCALE * s * (1 + w), TRAY_SCALE * s * (1 - w * 0.5));
          // 진열된 슬라임도 가끔 깜빡인다
          let lid = 1;
          if (!reduce && now >= it.blinkAt) {
            const t = (now - it.blinkAt) / 150;
            if (t >= 1) it.blinkAt = now + 2200 + Math.random() * 4500;
            else lid = 1 - Math.sin(Math.PI * t) * 0.92;
          }
          for (const e of it.eyes) e.scale.y = e.userData.eyeH * lid;
        }
      }
    }

    // 판의 모습(board)에 맞게 말들을 맞춘다. 바뀐 만큼은 미끄러져 움직이거나 터지거나 나타난다.
    function sync(board, fresh, dropped) {
      let strike = null; // 끌어다 놓아서 잡았을 때: {delay(ms), dx, dz}
      const now = performance.now();
      const firstSync = pieces.length === 0;
      const extra = [], need = [];
      for (const pc of pieces) if (board[pc.r][pc.c] !== pc.code) extra.push(pc);
      const extraSet = new Set(extra);
      grid.forEach((row) => row.fill(null));
      for (const pc of pieces) if (!extraSet.has(pc)) grid[pc.r][pc.c] = pc;
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (board[r][c] && !grid[r][c]) need.push({ r, c, code: board[r][c] });

      const take = (arr, fn) => { const i = arr.findIndex(fn); return i < 0 ? null : arr.splice(i, 1)[0]; };
      const pairs = [];
      let mover = null;
      if (fresh) {
        const e = take(extra, (p) => p.r === fresh.from[0] && p.c === fresh.from[1] && p.code === fresh.piece);
        const n = e && take(need, (q) => q.r === fresh.to[0] && q.c === fresh.to[1]);
        if (e && n) { pairs.push({ pc: e, n }); mover = e; } else if (e) extra.push(e);
      }
      for (const n of need.slice()) { // 캐슬링의 룩, 되돌리기 등: 같은 말 중 가장 가까운 것이 간다
        let best = -1, bd = 1e9;
        extra.forEach((p, i) => {
          if (p.code !== n.code) return;
          const d = Math.abs(p.r - n.r) + Math.abs(p.c - n.c);
          if (d < bd) { bd = d; best = i; }
        });
        if (best >= 0) {
          const p = extra.splice(best, 1)[0];
          need.splice(need.indexOf(n), 1);
          pairs.push({ pc: p, n });
        }
      }

      for (const { pc, n } of pairs) {
        pc.r = n.r; pc.c = n.c;
        grid[n.r][n.c] = pc;
        const dist = Math.hypot(sqX(n.c) - pc.x, sqZ(n.r) - pc.z);
        const quick = now - pc.releasedAt < 500; // 손으로 끌어다 놓은 말은 짧게 내려앉는다
        const knight = pc.code[1] === 'N';
        pc.parked = null;
        pc.stTilt = 0;
        pc.move = {
          fx: pc.x, fz: pc.z, t0: now,
          dur: reduce ? 0.05 : quick ? clamp(dist * 0.08, 0.14, 0.3) : Math.min(0.58, 0.24 + dist * 0.07),
          hop: quick ? 0.06 : knight ? 0.55 : 0.28,
        };
        if (pc === mover && dropped && fresh.capture && !fresh.enPassant && !fresh.promotion && !reduce) {
          // 들고 있던 말로 내리친다: 뒤로 젖혔다가(0~34%) 내리찍고(~52%) 잠깐 멈춘 뒤(~60%) 똑바로 선다
          let dx = sqX(n.c) - pc.x, dz = sqZ(n.r) - pc.z;
          if (Math.hypot(dx, dz) < 0.35) { dx = fresh.to[1] - fresh.from[1]; dz = fresh.to[0] - fresh.from[0]; }
          const len = Math.hypot(dx, dz) || 1;
          dx /= len; dz /= len;
          pc.move = { fx: pc.x, fz: pc.z, t0: now, dur: 0.62, hop: 0, strike: true, dx, dz };
          strike = { delay: 0.62 * 0.52 * 1000, dx, dz };
        }
        if (pc === mover && fresh.promotion && n.code !== pc.code) {
          const code = n.code;
          setTimeout(() => startMorph(pc, code), pc.move.dur * 1000); // 칸에 닿으면 그 자리에서 변신
        }
      }

      const capSq = fresh && fresh.capture ? (fresh.enPassant ? [fresh.from[0], fresh.to[1]] : fresh.to) : null;
      for (const pc of extra) {
        pieces.splice(pieces.indexOf(pc), 1);
        if (pc === holdPc) holdPc = null;
        const victim = capSq && pc.r === capSq[0] && pc.c === capSq[1] && pc.code === fresh.capture;
        if (victim && strike) { const hit = strike; setTimeout(() => shatter(pc, hit), hit.delay); } // 내리찍히는 순간 부서진다
        else if (victim) setTimeout(() => shatter(pc), mover && mover.move ? mover.move.dur * 1000 : 0); // 공격한 말이 닿는 순간 부서진다
        else removePcVisual(pc, !firstSync);
      }

      const many = need.length >= 8;
      for (const n of need) {
        const pc = makePc(n.r, n.c, n.code);
        pc.popT = now;
        pc.popDelay = many ? (n.c + (7 - n.r) * 0.5) * 0.03 : 0.12;
        if (reduce) pc.popDelay = 0;
        pieces.push(pc);
        grid[n.r][n.c] = pc;
      }
    }

    function update(d) {
      data = d;
      sync(d.board, d.fresh || null, !!d.dropped);
      syncTray(d.captured, d.fresh || null);
      for (const pc of pieces) {
        pc.sel = !!(d.selected && d.selected[0] === pc.r && d.selected[1] === pc.c);
        pc.can = pc.code[0] === d.turn && !d.gameOver;
        pc.parked = null;
        pc.scared = !!(d.kingSq && d.kingSq[0] === pc.r && d.kingSq[1] === pc.c); // 체크된 킹
      }
      if (d.mate) playMate(d.mate); else cancelCine();
      refreshOverlays();
    }

    // ---- 마우스/터치 ----
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const HOLD_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), -HOLD_Y);
    const tmp = new THREE.Vector3();
    function setRay(cx, cy) {
      const rc = canvas.getBoundingClientRect();
      ndc.set(((cx - rc.left) / rc.width) * 2 - 1, -(((cy - rc.top) / rc.height) * 2 - 1));
      ray.setFromCamera(ndc, camera);
    }

    function pick(cx, cy) { // 눌린 칸 [행, 열] 또는 null
      setRay(cx, cy);
      const hits = ray.intersectObjects(pieces.map((p) => p.root), true); // 실제 말 모양으로 판정한다
      if (hits.length) {
        let o = hits[0].object;
        while (o && !pieces.some((p) => p.root === o)) o = o.parent;
        const pc = pieces.find((p) => p.root === o);
        if (pc) return [pc.r, pc.c];
      }
      const P = ray.ray.intersectPlane(GROUND, tmp);
      return P ? sqFromXZ(P.x, P.z) : null;
    }

    function hold(r, c) {
      const pc = grid[r][c];
      if (!pc) return;
      holdPc = pc;
      pc.held = true;
      pc.dragging = false;
      pc.press = performance.now();
      pc.spinAt = pc.press + SPIN_AFTER;
    }

    function drag(cx, cy) { // 끌고 있는 말 밑의 칸을 돌려준다
      if (!holdPc) return null;
      setRay(cx, cy);
      const P = ray.ray.intersectPlane(HOLD_PLANE, tmp);
      if (!P) return null;
      holdPc.dragging = true;
      holdPc.dragX = clamp(P.x, -4.4, 4.4);
      holdPc.dragZ = clamp(P.z, -4.4, 4.4);
      const G = ray.ray.intersectPlane(GROUND, tmp); // 놓일 칸은 마우스가 가리키는 바닥의 칸
      return G ? sqFromXZ(G.x, G.z) : null;
    }

    function release() {
      const pc = holdPc;
      holdPc = null;
      if (!pc) return;
      pc.held = false;
      pc.dragging = false;
      pc.releasedAt = performance.now();
      pc.landT = pc.releasedAt;
      lastReleased = pc;
    }

    function park(sq) { // 승급 창이 떠 있는 동안 그 칸 위에 놓아 둔다
      if (lastReleased && sq) lastReleased.parked = { x: sqX(sq[1]), z: sqZ(sq[0]) };
    }

    function setHover(sq) { hoverPc = sq ? grid[sq[0]][sq[1]] : null; }
    function setDrop(sq) { dropSq = sq; refreshOverlays(); }
    function setPreview(moves) { preview = moves; refreshOverlays(); }
    function setCursor(v) { canvas.style.cursor = v; }

    // ---- 크기 맞춤: 판 전체가 들어오도록 카메라 거리를 잡는다 ----
    const dirV = new THREE.Vector3();
    const camTarget = new THREE.Vector3(0, 0.25, 0.15);
    const fitPts = [[-4.4, 0, -4.4], [4.4, 0, -4.4], [-4.4, 0, 4.4], [4.4, 0, 4.4], [-3.8, 1.5, -3.8], [3.8, 1.5, -3.8]].map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    // 세로 화면: 위아래 진열대(말 높이 포함)까지 화면에 들어오게 잡는다
    const fitPtsTall = [[-3.95, 0, -6.3], [3.95, 0, -6.3], [-3.95, 0, 6.3], [3.95, 0, 6.3], [-3.5, 1.0, -6.0], [3.5, 1.0, -6.0]].map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    // 가로 화면: 좌우 진열대까지
    const fitPtsWide = [[-6.3, 0, -4.4], [6.3, 0, -4.4], [-6.3, 0, 4.4], [6.3, 0, 4.4], [-6.0, 1.0, -4.0], [6.0, 1.0, -4.0]].map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    function placeLabel(el, x, z, w, h) {
      const q = tmp.set(x, 0, z).project(camera);
      el.style.left = ((q.x + 1) / 2) * w + 'px';
      el.style.top = ((1 - q.y) / 2) * h + 'px';
    }
    function fit() {
      const w = container.clientWidth, h = container.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // 세로로 긴 화면(폰)일수록 더 위에서 내려다봐서 판이 세로로도 크게 보이게 한다
      const tall = w / h < 0.8; // 폰처럼 세로로 긴 화면이면 진열대를 꺼낸다
      const maxEl = ((tall ? 72 : 66) * Math.PI) / 180;
      const el = EL + clamp((1 - w / h) / 0.55, 0, 1) * (maxEl - EL);
      dirV.set(0, Math.sin(el), Math.cos(el));
      const mode = tall ? 'rows' : w / h >= 1.5 ? 'cols' : null; // 정사각형에 가까우면 판을 크게 두려고 숨긴다
      if (mode !== trayMode) { trayMode = mode; layoutTray(true); }
      trayGroup.visible = !!mode;
      camTarget.z = tall ? 0 : 0.15;
      const pts = mode === 'rows' ? fitPts.concat(fitPtsTall) : mode === 'cols' ? fitPts.concat(fitPtsWide) : fitPts;
      for (let D = 6; D < 60; D += 0.1) {
        camera.position.copy(camTarget).addScaledVector(dirV, D);
        camera.lookAt(camTarget);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
        if (pts.every((p) => { const q = p.clone().project(camera); return Math.abs(q.x) <= 0.97 && Math.abs(q.y) <= 0.94; })) break; // 창을 꽉 채우되 가장자리에 살짝 여유
      }
      for (let i = 0; i < 8; i++) {
        placeLabel(rankEls[i], -4.4, sqZ(i), w, h);
        placeLabel(fileEls[i], sqX(i), 4.45, w, h);
      }
    }
    if (root.ResizeObserver) new root.ResizeObserver(fit).observe(container);
    root.addEventListener('resize', fit);
    fit();

    // ---- 매 프레임 ----
    let prev = performance.now();
    const UP = new THREE.Vector3(0, 1, 0);
    const TILT_AXIS = new THREE.Vector3(1, 0, -0.6).normalize(); // 윗부분이 카메라 쪽 + 오른쪽으로 기운다
    const qTilt = new THREE.Quaternion(), qSpin = new THREE.Quaternion();
    const pivot = new THREE.Vector3(), pivotR = new THREE.Vector3(), axisV = new THREE.Vector3();
    const qShake = new THREE.Quaternion(), AXIS_Z = new THREE.Vector3(0, 0, 1);

    // 눈물: 눈 아래에 맺혔다가(60%) 몸을 타고 똑 떨어진다(40%), 1.3초마다 반복
    const tearGeo = new THREE.SphereGeometry(1, 12, 10);
    const tearMat = new THREE.MeshStandardMaterial({ color: 0xc8f2ff, emissive: 0x4cc4ff, emissiveIntensity: 0.65, roughness: 0.05, transparent: true, opacity: 0.95 });
    function stepTears(pc, now) {
      const want = pc.scared && !reduce;
      if (want && !pc.tears) {
        pc.tearT0 = now;
        pc.tears = pc.eyes.map((e, i) => {
          const m = new THREE.Mesh(tearGeo, tearMat);
          e.parent.add(m);
          return { m, e, phase: i * 0.47 + Math.random() * 0.2 };
        });
      } else if (!want && pc.tears) {
        for (const t of pc.tears) if (t.m.parent) t.m.parent.remove(t.m);
        pc.tears = null;
      }
      if (!pc.tears) return;
      for (const t of pc.tears) {
        const u = t.e.userData;
        const p = ((now - pc.tearT0) / 1300 + t.phase) % 1;
        const R = 0.038;
        let s, dy = 0, stretch = 1;
        if (p < 0.6) s = R * easeOutCubic(p / 0.6); // 맺힌다
        else { const q = (p - 0.6) / 0.4; s = R * (1 - q * 0.4); dy = q * q * 0.34; stretch = 1 + q * 0.7; } // 똑 떨어진다
        t.m.position.set(t.e.position.x + u.fwd[0] * 0.03, t.e.position.y - u.eyeH * 0.9 - s * 0.5 - dy, t.e.position.z + u.fwd[1] * 0.03);
        t.m.scale.set(s, s * stretch, s);
        t.m.visible = s > 0.002;
      }
    }
    function stepPiece(pc, now, dt) {
      const tx = sqX(pc.c), tz = sqZ(pc.r);
      let hop = 0;
      let eatOv = null;
      if (pc.eat) { // 메이트 연출: 킹을 먹는 중 (위치·기울기·입은 stepEat이 정한다)
        eatOv = stepEat(pc, now);
        hop = eatOv.hop;
      } else if (pc.move) {
        const m = pc.move;
        const t = (now - m.t0) / (m.dur * 1000);
        if (t >= 1) {
          pc.x = tx; pc.z = tz; pc.vx = pc.vz = 0;
          pc.move = null;
          pc.landT = now;
          pc.stTilt = 0;
        } else if (m.strike) {
          const tt = Math.max(0, t);
          const bx = tx - m.dx * 0.85, bz = tz - m.dz * 0.85; // 젖히는 자리(상대 말 앞)
          const hx = tx - m.dx * 0.3, hz = tz - m.dz * 0.3; // 내리찍는 자리
          pc.stDx = m.dx; pc.stDz = m.dz;
          if (tt < 0.34) {
            const e = easeOutCubic(tt / 0.34);
            pc.x = lerp(m.fx, bx, e); pc.z = lerp(m.fz, bz, e);
            hop = 0.75 * e; pc.stTilt = -0.5 * e;
          } else if (tt < 0.52) {
            const e = Math.pow((tt - 0.34) / 0.18, 2.2);
            pc.x = lerp(bx, hx, e); pc.z = lerp(bz, hz, e);
            hop = 0.75 * (1 - e) + 0.04; pc.stTilt = lerp(-0.5, 1.05, e);
          } else if (tt < 0.6) { // 맞는 순간 잠깐 멈춘다
            pc.x = hx; pc.z = hz; hop = 0.04; pc.stTilt = 1.05;
          } else {
            const u = (tt - 0.6) / 0.4;
            pc.x = lerp(hx, tx, easeOutCubic(u)); pc.z = lerp(hz, tz, easeOutCubic(u));
            hop = 0.04 * (1 - u); pc.stTilt = 1.05 * (1 - easeOutBack(u));
          }
        } else {
          const tt = Math.max(0, t), e = easeInOut(tt);
          pc.x = lerp(m.fx, tx, e);
          pc.z = lerp(m.fz, tz, e);
          hop = Math.sin(Math.PI * tt) * m.hop;
        }
      } else if (pc.held && pc.dragging) {
        const k = 1 - Math.exp(-22 * dt);
        pc.x += (pc.dragX - pc.x) * k;
        pc.z += (pc.dragZ - pc.z) * k;
        pc.vx = pc.vz = 0;
      } else if (!pc.held) { // 튕기듯 제자리로 돌아간다
        const gx = pc.parked ? pc.parked.x : tx, gz = pc.parked ? pc.parked.z : tz;
        pc.vx += ((gx - pc.x) * 170 - pc.vx * 17) * dt;
        pc.vz += ((gz - pc.z) * 170 - pc.vz * 17) * dt;
        pc.x += pc.vx * dt;
        pc.z += pc.vz * dt;
      }

      const wantLift = pc.held ? (pc.dragging ? LIFT.drag : LIFT.held) : pc.sel ? LIFT.sel : hoverPc === pc && pc.can ? LIFT.hover : 0;
      pc.y += (wantLift - pc.y) * (1 - Math.exp(-14 * dt));

      let sy = 1, sxz = 1;
      if (!reduce) {
        if (pc.held) { // 눌렸다가 늘어난다
          const t = Math.min(1, (now - pc.press) / 400);
          const w = Math.sin(t * Math.PI * 1.6) * (1 - t) * 0.16;
          sy = 1 - w; sxz = 1 + w * 0.7;
        } else if (pc.landT > 0) { // 내려앉을 때 납작했다 돌아온다
          const t = Math.min(1, (now - pc.landT) / 420);
          const w = Math.sin(t * Math.PI * 2.2) * (1 - t) * 0.2;
          sy = 1 - w; sxz = 1 + w * 0.6;
          if (t >= 1) pc.landT = -1;
        }
        if (pc.held && now >= pc.spinAt) { // 오래 들고 있으면 뱅그르르
          pc.spinStart = now;
          pc.spinAt = now + SPIN_EVERY;
        }
      }
      // 살펴보기(Weapon Inspect): 비스듬히 기울인 채 반 바퀴 휙 돌려 뒷면을 보이고, 잠깐 머문 뒤 튕기듯 돌아온다
      let spin = 0, insp = 0;
      if (pc.spinStart > 0) {
        const t = (now - pc.spinStart) / SPIN_MS;
        if (t >= 1) pc.spinStart = -1;
        else {
          const turn = t < 0.36 ? 0.5 * easeOutCubic(t / 0.36) : t < 0.52 ? 0.5 + 0.03 * ((t - 0.36) / 0.16) : 0.53 + 0.47 * easeOutBack(easeInOut((t - 0.52) / 0.48));
          spin = turn * Math.PI * 2;
          insp = Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.5); // 기울기: 빨리 올라가서 오래 머물다 내려온다
        }
      }

      let pop = 1;
      if (pc.popT > 0) {
        const t = (now - pc.popT - pc.popDelay * 1000) / 350;
        if (t < 0) pop = 0.0001;
        else if (t >= 1) pc.popT = -1;
        else pop = Math.max(0.0001, easeOutBack(t));
      }

      if (eatOv) { sy = eatOv.sy; sxz = eatOv.sxz; }
      if (pc.morph) { // 승급 변신 중: 눌림·튀어오름·커짐을 덮어쓴다
        const mo = stepMorph(pc, now);
        if (mo) { sy = mo.sy; sxz = mo.sxz; hop += mo.up; pop *= mo.grow; }
      }
      // 메이트 연출: 우물우물 씹기, 먹기 전에 몸 부풀리기, 입 벌리기
      if (pc.chewT > 0) {
        const u = (now - pc.chewT) / 700;
        if (u >= 1) pc.chewT = -1;
        else { const w = Math.sin(u * Math.PI * 4) * 0.13 * (1 - u * 0.5); sy *= 1 - w; sxz *= 1 + w * 0.6; }
      }
      pc.gulp = (pc.gulp || 0) + ((pc.gulpOn ? 1 : 0) - (pc.gulp || 0)) * (1 - Math.exp(-9 * dt));
      if (pc.gulp > 0.001) pop *= 1 + 0.25 * pc.gulp;
      if (pc.mouth) {
        if (!pc.eat) pc.mouthAmt += ((pc.mouthOpen ? 1 : 0) - pc.mouthAmt) * (1 - Math.exp(-12 * dt));
        const a = pc.mouthAmt;
        pc.mouth.scale.set(0.05 + 0.05 * a, 0.008 + 0.085 * a, 0.022);
      }

      pc.root.visible = pop > 0.001;
      if (pc.stTilt) qTilt.setFromAxisAngle(axisV.set(pc.stDz, 0, -pc.stDx), pc.stTilt); // 내리치기: 치는 방향으로 기운다
      else qTilt.setFromAxisAngle(TILT_AXIS, insp * 0.8);
      qSpin.setFromAxisAngle(UP, spin + (pc.faceYaw || 0));
      pc.root.quaternion.copy(qTilt).multiply(qSpin); // 기울어진 자기 축을 중심으로 돈다
      pivot.set(0, 0.42 * SCALE, 0); // 바닥이 아니라 몸통 가운데를 중심으로 기울인다
      pivotR.copy(pivot).applyQuaternion(qTilt);
      const big = 1 + insp * 0.07;
      pc.root.position.set(pc.x + pivot.x - pivotR.x, pc.y + hop + insp * 0.2 + pivot.y - pivotR.y, pc.z + pivot.z - pivotR.z);
      pc.root.scale.setScalar(SCALE * pop * big);
      if (pc.scared && !reduce) { // 체크된 킹: 바들바들 떤다
        const s = now / 1000;
        pc.root.position.x += (Math.sin(s * 71) + Math.sin(s * 113) * 0.6) * 0.024;
        pc.root.position.z += Math.sin(s * 89 + 1.3) * 0.014;
        qShake.setFromAxisAngle(AXIS_Z, Math.sin(s * 64) * 0.07);
        pc.root.quaternion.multiply(qShake);
      }

      // 젤리 출렁임: 몸통 윗부분이 움직임을 늦게 따라오고(기울어짐), 집거나 내려앉을 때 위아래로 출렁인다
      if (!reduce && dt > 0) {
        const vx = (pc.x - pc.px) / dt, vz = (pc.z - pc.pz) / dt;
        pc.wvx -= clamp(vx - pc.pvx, -6, 6) * 0.17;
        pc.wvz -= clamp(vz - pc.pvz, -6, 6) * 0.17;
        pc.pvx = vx; pc.pvz = vz;
        if (pc.held && pc.press !== pc.jPress) { pc.jPress = pc.press; pc.jv += 2.6; }
        if (pc.landT > 0 && pc.landT !== pc.jLand) { pc.jLand = pc.landT; pc.jv -= 3.4; }
        pc.wvx += (-pc.wx * 230 - pc.wvx * 6) * dt;
        pc.wvz += (-pc.wz * 230 - pc.wvz * 6) * dt;
        pc.wx = clamp(pc.wx + pc.wvx * dt, -0.45, 0.45);
        pc.wz = clamp(pc.wz + pc.wvz * dt, -0.45, 0.45);
        pc.jv += (-pc.j * 300 - pc.jv * 7) * dt;
        pc.j = clamp(pc.j + pc.jv * dt, -0.35, 0.35);
      }
      // 눈: 가끔 깜빡이고(때로는 두 번), 들려 있을 때는 놀란 듯 커진다
      if (pc.eyesOf !== pc.model) {
        pc.eyesOf = pc.model;
        pc.eyes = [];
        pc.flames = [];
        pc.model.traverse((n) => {
          if (!n.userData) return;
          if (n.userData.eyeH) pc.eyes.push(n);
          if (n.userData.flame) pc.flames.push(n);
        });
        pc.blinkAt = now + 600 + Math.random() * 4500;
        pc.blinks = 1;
      }
      // 불 슬라임 머리 위 불꽃이 일렁인다
      if (!reduce) {
        for (const f of pc.flames) {
          const u = f.userData.flame, s = now / 1000;
          const k = 0.75 + 0.3 * Math.sin(s * 11 + u.phase) + 0.15 * Math.sin(s * 23 + u.phase * 2);
          f.scale.set(u.sx * (1.1 - 0.2 * k), u.sy * k, u.sx * (1.1 - 0.2 * k));
        }
      }
      let lid = 1;
      if (!reduce && now >= pc.blinkAt) {
        const t = (now - pc.blinkAt) / 150;
        if (t >= 1) {
          pc.blinks--;
          if (pc.blinks > 0) pc.blinkAt = now + 90; // 연달아 한 번 더
          else { pc.blinkAt = now + 2000 + Math.random() * 4200; pc.blinks = Math.random() < 0.25 ? 2 : 1; }
        } else lid = 1 - Math.sin(Math.PI * t) * 0.92;
      }
      pc.wide = (pc.wide || 1) + ((pc.held ? 1.25 : 1) - (pc.wide || 1)) * (1 - Math.exp(-12 * dt));
      // 체크된 킹: 눈 바깥쪽이 처지고 촉촉하게 일렁이며(깜빡이지 않는다), 눈물이 맺혔다 똑 떨어진다
      pc.sad = (pc.sad || 0) + ((pc.scared ? 1 : 0) - (pc.sad || 0)) * (1 - Math.exp(-8 * dt));
      pc.eyes.forEach((e, i) => {
        const u = e.userData;
        const quiver = reduce ? 0 : pc.sad * Math.sin(now / 42 + i * 1.7);
        e.scale.y = u.eyeH * (pc.happy ? 0.3 : pc.scared ? 0.82 + 0.06 * quiver : lid) * pc.wide; // happy = 씹으며 ^^
        e.scale.x = u.eyeW * (1 + 0.1 * quiver + 0.12 * pc.sad); // 그렁그렁 커지며 일렁인다
        e.rotation.z = (u.side || 0) * 0.45 * pc.sad;
      });
      stepTears(pc, now);

      pc.px = pc.x; pc.pz = pc.z;
      const jy = sy * (1 + pc.j), jx = sxz * (1 - pc.j * 0.5);
      pc.jig.matrix.set(jx, pc.wx, 0, 0, 0, jy, 0, 0, 0, pc.wz, jx, 0, 0, 0, 0, 1);
      pc.jig.matrixWorldNeedsUpdate = true;
    }

    function tick(now) {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      for (const pc of pieces) stepPiece(pc, now, dt);
      if (trayGroup.visible) stepTray(now, dt);
      if (!reduce) { // 잡초가 바람에 살랑인다
        const s = now / 1000;
        for (const t of tufts) {
          t.g.rotation.z = Math.sin(s * 1.6 * t.speed + t.phase) * 0.08;
          t.g.rotation.x = Math.cos(s * 1.2 * t.speed + t.phase) * 0.05;
        }
      }

      for (let i = fxList.length - 1; i >= 0; i--) {
        const f = fxList[i];
        const t = Math.min(1, (now - f.t0) / f.dur);
        f.step(t);
        if (t >= 1) { fxList.splice(i, 1); if (f.end) f.end(); }
      }
      for (let i = shards.length - 1; i >= 0; i--) {
        const s = shards[i];
        const age = (now - s.t0) / 1000;
        if (age >= s.life) { world.remove(s.m); shards.splice(i, 1); continue; }
        // 말랑한 덩어리: 바닥에 닿으면 납작해졌다 튀고, 출렁이다가 끝에는 녹듯이 퍼지며 사라진다
        const left = 1 - age / s.life;
        const melt = left < 0.38 ? left / 0.38 : 1;
        const sy = Math.max(0.12, (1 + s.sq) * (0.2 + 0.8 * melt));
        const sx = (1 - s.sq * 0.5) * (1 + (1 - melt) * 0.6);
        const floor = s.r * sy * 0.92;
        s.vy -= 9.5 * dt;
        s.m.position.x += s.vx * dt;
        s.m.position.y += s.vy * dt;
        s.m.position.z += s.vz * dt;
        if (s.m.position.y < floor) {
          s.m.position.y = floor;
          if (s.vy < -0.7) { s.sqv -= Math.min(9, -s.vy * 2.3); s.vy *= -0.45; s.vx *= 0.72; s.vz *= 0.72; }
          else { s.vy = 0; const drag = Math.max(0, 1 - 7 * dt); s.vx *= drag; s.vz *= drag; }
        }
        s.sqv += (-s.sq * 190 - s.sqv * 6) * dt;
        s.sq = clamp(s.sq + s.sqv * dt, -0.6, 0.6);
        const k = s.r * Math.min(1, left / 0.1);
        s.m.scale.set(k * sx, k * sy, k * sx);
      }

      if (shakeT > 0) { // 부딪힐 때 판이 살짝 흔들린다
        const t = (now - shakeT) / 260;
        if (t >= 1) { shakeT = -1; world.position.set(0, 0, 0); }
        else { const a = shakeAmp * (1 - t); world.position.set(Math.sin(t * 70) * a, 0, Math.cos(t * 55) * a * 0.6); }
      }

      const pulse = 0.7 + 0.3 * Math.sin(now / 220);
      for (const o of ov) if (o.check.visible) o.check.material.opacity = pulse;

      renderer.render(scene, camera);
      root.requestAnimationFrame(tick);
    }
    root.requestAnimationFrame(tick);

    // ---- 아이콘: 잡힌 말 목록·승급 창에 쓸 작은 그림. 판 위와 같은 3D 슬라임을 정면에서 살짝 위로 보고 찍는다 ----
    // 배경이 투명한 그림이라 빛이 굴절되는 재질 대신, 같은 색의 반투명 젤리 재질로 바꿔서 찍는다. 종류별로 한 번만 찍는다.
    const iconCache = {};
    let iconKit = null;
    function icon(color, kind) {
      const key = color + kind;
      if (iconCache[key]) return iconCache[key];
      if (!iconKit) {
        const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
        r.setPixelRatio(1);
        r.setSize(160, 160, false);
        r.setClearColor(0x000000, 0);
        const sc = new THREE.Scene();
        sc.add(new THREE.HemisphereLight(0xf3f0d8, 0x2c3a22, 0.55));
        const key1 = new THREE.DirectionalLight(0xfff3dd, 0.75);
        key1.position.set(-2, 3, 3);
        const back = new THREE.DirectionalLight(0xd8f2b8, 0.7);
        back.position.set(2, 2, -3);
        sc.add(key1, back);
        const cam = new THREE.OrthographicCamera(-0.58, 0.58, 0.58, -0.58, 0.1, 20);
        cam.position.set(0, 1.05, 3);
        cam.lookAt(0, 0.47, 0);
        const jelly = {};
        for (const c of ['w', 'b']) {
          const src = Piece3D.material(c);
          jelly[c] = new THREE.MeshPhysicalMaterial({
            color: 0xf2f2f2, vertexColors: true, // 위→아래 그라데이션은 말 꼭짓점 색에서 온다
            emissive: src.attenuationColor, emissiveIntensity: 0.32,
            roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05,
            transparent: true, opacity: 0.9, envMap: src.envMap, envMapIntensity: 0.9,
          });
        }
        iconKit = { r, sc, cam, jelly };
      }
      const { r, sc, cam, jelly } = iconKit;
      const model = Piece3D.build(color, kind);
      model.rotation.y = baseRot(color + kind);
      const body = Piece3D.material(color);
      model.traverse((n) => { if (n.material === body) n.material = jelly[color]; });
      sc.add(model);
      r.render(sc, cam);
      iconCache[key] = r.domElement.toDataURL('image/png');
      sc.remove(model);
      disposeObj(model);
      return iconCache[key];
    }

    return { canvas, update, pick, hold, drag, release, park, setHover, setDrop, setPreview, setCursor, icon };
  }

  root.Board3D = { create };
})(typeof self !== 'undefined' ? self : this);
