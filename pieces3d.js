// 3D 슬라임 체스 말. window.Piece3D.build(색, 종류) -> THREE.Group (바닥 y=0, 위로 자란다)
// 옆모습 윤곽을 부드러운 곡선으로 이어 회전시켜 만들고, 나이트만 옆모습에 두께를 줘서 만든다.
// 디자인 참고: 물 슬라임(파랑, 위는 밝은 하늘빛·아래는 짙은 파랑, 빨강 테 + 노랑 눈동자)과
//             불 슬라임(위는 붉은 주황·아래는 노랑, 빛나고 머리에 불꽃, 흰 테 + 초록 눈동자).
// 먼저 두는 쪽(w, 나) = 물 슬라임, 나중 쪽(b, 엔진) = 불 슬라임.
// three.js(vendor/three.min.js)가 먼저 불러와져 있어야 한다.
(function (root) {
  'use strict';
  const THREE = root.THREE;
  const SEG = 40; // 둘레 분할 수 (많을수록 둥글다)

  const SLIME = {
    w: { top: 0xaef3ff, bottom: 0x1f4fb5, inside: 0x2f6fd0, glow: 0x1b55c0, glowI: 0.12, ring: 0xe2352b, iris: 0xffd31f, bubble: 0xeefcff, flames: false },
    b: { top: 0xff4a17, bottom: 0xffc93f, inside: 0xff7a22, glow: 0xff5a10, glowI: 0.38, ring: 0xfff5e6, iris: 0x3fb35c, bubble: 0xffe0a0, flames: true },
  };

  // 몸통 재질: 속이 비치는 젤리. 색은 꼭짓점마다 칠한 위→아래 그라데이션(paint)이 정한다.
  const mats = {};
  function material(color) {
    if (!mats[color]) {
      const s = SLIME[color];
      mats[color] = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.05, // 젖은 듯 매끈한 표면
        metalness: 0,
        transmission: 0.85, // 속이 비친다
        thickness: 0.6,
        ior: 1.33, // 물의 굴절률
        attenuationColor: new THREE.Color(s.inside),
        attenuationDistance: 0.6,
        emissive: new THREE.Color(s.glow), // 스스로 내는 빛 (불 슬라임은 더 밝게)
        emissiveIntensity: s.glowI,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        specularIntensity: 1,
      });
    }
    return mats[color];
  }

  // 터진 덩어리용: 그라데이션 없이 가운데 색 한 가지
  const chunkMats = {};
  function chunkMaterial(color) {
    if (!chunkMats[color]) {
      const s = SLIME[color];
      const m = material(color).clone();
      m.vertexColors = false;
      m.color = new THREE.Color(s.bottom).lerp(new THREE.Color(s.top), 0.5);
      chunkMats[color] = m;
    }
    return chunkMats[color];
  }

  // 2D 윤곽 [y, 반폭] (그림판 100x100, 바닥 y=94) -> 3D 길이 (1 = 그림판 100)
  const H = (y) => (94 - y) / 100;
  const R = (hw) => hw / 100;

  function shadowed(m) {
    m.castShadow = m.receiveShadow = true;
    return m;
  }

  // 몸통: profile = [[y, 반폭], ...] 아래에서 위로. 점들을 곡선으로 이어서 모서리 없이 둥글게 돌린다.
  function lathe(profile, mat) {
    const raw = profile.map(([y, hw]) => new THREE.Vector2(R(hw), H(y)));
    const pts = new THREE.SplineCurve(raw).getPoints(raw.length * 5).map((p) => new THREE.Vector2(Math.max(0.0005, p.x), p.y));
    pts.unshift(new THREE.Vector2(0, pts[0].y));
    pts.push(new THREE.Vector2(0, pts[pts.length - 1].y));
    return shadowed(new THREE.Mesh(new THREE.LatheGeometry(pts, SEG), mat));
  }

  function blob(r, mat, x, y, z) {
    const m = shadowed(new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), mat));
    m.position.set(x || 0, y || 0, z || 0);
    return m;
  }

  // 모든 말이 같이 쓰는 받침 (아래 모서리를 살짝 굴렸다)
  const BASE = [[94, 30], [92, 33], [89, 32], [86, 25]];

  const builders = {
    P: (mat) => {
      const g = new THREE.Group();
      g.add(lathe(BASE.concat([[84, 17], [72, 12], [60, 9], [57, 16], [53, 16], [50, 9],
        [46, 12], [40, 14], [34, 13], [29, 9], [26, 0]]), mat));
      return g;
    },

    R: (mat) => {
      const g = new THREE.Group();
      g.add(lathe(BASE.concat([[84, 21], [78, 17], [62, 15], [56, 22], [52, 22], [38, 22], [35, 19]]), mat));
      for (let i = 0; i < 6; i++) { // 톱니 대신 동글동글한 여섯 알
        const a = (i / 6) * Math.PI * 2;
        g.add(blob(0.072, mat, Math.cos(a) * 0.15, H(35) + 0.02, Math.sin(a) * 0.15));
      }
      return g;
    },

    B: (mat) => {
      const g = new THREE.Group();
      g.add(lathe(BASE.concat([[84, 18], [72, 12], [62, 9], [58, 16], [54, 16], [50, 9],
        [46, 11], [40, 15], [32, 15], [25, 11], [20, 6], [17, 0]]), mat));
      g.add(blob(0.052, mat, 0, H(13), 0)); // 꼭대기 방울
      return g;
    },

    Q: (mat) => {
      const g = new THREE.Group();
      g.add(lathe(BASE.concat([[84, 19], [70, 12], [58, 9], [54, 17], [50, 17], [46, 10],
        [40, 14], [33, 18], [26, 21], [22, 21], [20, 17]]), mat));
      for (let i = 0; i < 8; i++) { // 왕관: 둥글게 선 구슬들
        const a = (i / 8) * Math.PI * 2;
        g.add(blob(0.052, mat, Math.cos(a) * 0.165, H(21) + 0.035, Math.sin(a) * 0.165));
      }
      g.add(blob(0.1, mat, 0, H(21) + 0.05, 0));
      g.add(blob(0.045, mat, 0, H(21) + 0.17, 0));
      return g;
    },

    K: (mat) => {
      const g = new THREE.Group();
      g.add(lathe(BASE.concat([[84, 19], [70, 12], [58, 9], [54, 17], [50, 17], [46, 10],
        [40, 14], [34, 18], [28, 21], [24, 21], [20, 18], [16, 12], [13, 5], [12, 0]]), mat));
      // 십자가: 둥근 막대 두 개
      const up = shadowed(new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.13, 6, 14), mat));
      up.position.y = H(10);
      const across = shadowed(new THREE.Mesh(new THREE.CapsuleGeometry(0.036, 0.12, 6, 14), mat));
      across.rotation.z = Math.PI / 2;
      across.position.y = H(7.5);
      g.add(up, across);
      return g;
    },

    N: (mat) => {
      const g = new THREE.Group();
      g.add(lathe(BASE.concat([[84, 19], [80, 17], [78, 13]]), mat));
      // 말 머리: 2D 옆모습 윤곽을 곡선으로 이어 두께를 주고, 가장자리를 둥글게 굴린다
      const O = [[30, 82], [26, 70], [31, 64], [24, 57], [30, 51], [27, 43], [34, 39], [32, 30],
        [41, 25], [40, 16], [49, 20], [52, 9], [57, 19], [66, 24], [76, 33], [82, 42], [80, 48],
        [72, 50], [64, 48], [58, 53], [56, 60], [63, 70], [68, 82]];
      const P = O.map(([x, y]) => new THREE.Vector2((x - 50) / 100, H(y)));
      const shape = new THREE.Shape();
      shape.moveTo(P[0].x, P[0].y);
      shape.splineThru(P.slice(1));
      shape.closePath();
      const depth = 0.14, bevel = 0.085;
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: 0.06, bevelOffset: -0.035, bevelSegments: 7, curveSegments: 28, steps: 1,
      });
      geo.translate(0, 0, -depth / 2);
      const head = shadowed(new THREE.Mesh(geo, mat));
      head.position.y = -0.01;
      g.add(head);
      g.userData.knightEye = { x: 0.12, y: H(29), z: depth / 2 + bevel * 0.9 }; // 눈은 build에서 단다
      return g;
    },
  };

  // 위(밝은 색) → 아래(짙은 색) 그라데이션을 몸통 꼭짓점마다 칠한다
  function paint(g, color) {
    const s = SLIME[color], body = material(color);
    g.updateMatrixWorld(true);
    const top = new THREE.Box3().setFromObject(g).max.y || 1;
    const cTop = new THREE.Color(s.top), cBot = new THREE.Color(s.bottom), c = new THREE.Color(), v = new THREE.Vector3();
    g.traverse((m) => {
      if (!m.isMesh || m.material !== body) return;
      const pos = m.geometry.attributes.position;
      const cols = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        const t = Math.min(1, Math.max(0, v.y / top));
        c.copy(cBot).lerp(cTop, Math.pow(t, 0.85));
        cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
      }
      m.geometry.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    });
    return top;
  }

  // 슬라임 속에 떠 있는 작은 방울들 (물 슬라임은 맑은 거품, 불 슬라임은 불씨 색)
  const bubbleMats = {};
  const bubbleGeo = new THREE.SphereGeometry(1, 8, 6);
  function addBubbles(g, kind, color) {
    if (!bubbleMats[color]) {
      const b = SLIME[color].bubble;
      bubbleMats[color] = new THREE.MeshStandardMaterial({ color: b, emissive: b, emissiveIntensity: 0.55, roughness: 0.2 });
    }
    const tall = { P: 0.42, R: 0.5, N: 0.14, B: 0.6, Q: 0.62, K: 0.66 }[kind];
    const n = kind === 'P' ? 7 : 10;
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(bubbleGeo, bubbleMats[color]);
      const a = Math.random() * Math.PI * 2;
      const low = i < 4; // 넓은 받침 속에 몇 개, 나머지는 몸통 가운데를 따라
      const rad = low ? 0.05 + Math.random() * 0.17 : Math.random() * 0.05;
      const y = low ? 0.02 + Math.random() * 0.04 : 0.1 + Math.random() * (tall - 0.1);
      m.position.set(Math.cos(a) * rad, y, Math.sin(a) * rad);
      m.scale.setScalar(0.008 + Math.random() * 0.015);
      g.add(m);
    }
  }

  // 슬라임 눈: 동그란 눈알 (바깥 테 + 눈동자 + 검은 동공 + 반짝임). 그룹의 +z가 바라보는 쪽.
  const eyeGeo = new THREE.SphereGeometry(1, 16, 12);
  const eyeMats = {};
  const flat = (hex) => new THREE.MeshBasicMaterial({ color: hex });
  function makeEye(color, size, side, fwd) {
    if (!eyeMats[color]) {
      const s = SLIME[color];
      eyeMats[color] = { ring: flat(s.ring), iris: flat(s.iris), pupil: flat(0x141414), shine: flat(0xffffff) };
    }
    const m = eyeMats[color];
    const eye = new THREE.Group();
    const part = (mat, r, x, y, z) => { const p = new THREE.Mesh(eyeGeo, mat); p.scale.setScalar(r); p.position.set(x, y, z); eye.add(p); };
    part(m.ring, 1, 0, 0, 0);
    part(m.iris, 0.68, 0, 0, 0.5);
    part(m.pupil, 0.34, 0, 0, 0.88);
    part(m.shine, 0.17, 0.26, 0.3, 1.02);
    eye.scale.set(size, size, size * 0.45);
    // board3d.js가 깜빡임·울먹임·입 위치에 쓰는 정보: 원래 높이·폭, 왼쪽(-1)/오른쪽(+1), 눈이 바라보는 방향
    Object.assign(eye.userData, { eyeH: size, eyeW: size, side, fwd });
    return eye;
  }

  // 눈 자리: [눈 높이, 그 높이의 몸통 반지름]. 화면 쪽(+z)을 본다
  const FACE = { P: [H(39), 0.135], R: [H(47), 0.2], B: [H(36), 0.145], Q: [H(31), 0.185], K: [H(31), 0.195] };
  function addEyes(g, kind, color) {
    if (kind === 'N') { // 나이트: 말 머리 양옆
      const k = g.userData.knightEye;
      for (const side of [1, -1]) {
        const eye = makeEye(color, 0.042, side, [0, side]);
        eye.position.set(k.x, k.y, side * k.z);
        eye.rotation.y = side === 1 ? 0 : Math.PI;
        g.add(eye);
      }
      return;
    }
    const [y, rad] = FACE[kind];
    const size = kind === 'P' ? 0.043 : 0.05;
    for (const side of [-1, 1]) {
      const a = side * 0.48; // 가운데에서 좌우로 벌어진 각도
      const eye = makeEye(color, size, side, [Math.sin(a), Math.cos(a)]);
      eye.position.set(Math.sin(a) * rad * 1.0, y, Math.cos(a) * rad * 1.0);
      eye.rotation.y = a;
      g.add(eye);
    }
  }

  // 불 슬라임 머리 위 불꽃: 겹친 불꽃 몇 가닥 (board3d.js가 userData.flame을 보고 일렁이게 한다)
  const flameGeo = new THREE.ConeGeometry(1, 1, 7);
  flameGeo.translate(0, 0.5, 0);
  const flameMats = [0xff6a1a, 0xffa62b, 0xffe27a].map((c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
  function addFlames(g, top) {
    const tongues = [[0, 0, 0.055, 0.2, 0], [0.04, 0.02, 0.04, 0.14, 1], [-0.04, 0.01, 0.04, 0.15, 1], [0.015, -0.035, 0.035, 0.12, 1], [0, 0, 0.028, 0.13, 2]];
    for (const [x, z, w, h, k] of tongues) {
      const f = new THREE.Mesh(flameGeo, flameMats[k]);
      f.scale.set(w, h, w);
      f.position.set(x, top - 0.035, z);
      f.rotation.set((Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4);
      f.userData.flame = { sy: h, sx: w, phase: Math.random() * Math.PI * 2 };
      g.add(f);
    }
  }

  function build(color, kind) {
    const g = builders[kind](material(color));
    const top = paint(g, color);
    addBubbles(g, kind, color);
    addEyes(g, kind, color);
    if (SLIME[color].flames) addFlames(g, top);
    // 엔진 쪽 나이트는 반대쪽(오른쪽→왼쪽)을 본다
    if (kind === 'N' && color === 'b') g.rotation.y = Math.PI;
    const holder = new THREE.Group();
    holder.add(g);
    holder.userData = { color, kind };
    return holder;
  }

  root.Piece3D = { build, material, chunkMaterial };
})(typeof self !== 'undefined' ? self : this);
