// three-spark-gaussian2.js
//
// Each panel is its own independent Three.js viewer — own
// WebGLRenderer, own SparkRenderer, own scene/camera, own
// EffectComposer with a duotone ShaderPass — set up like the
// proven-working four-quadrant-splats.html example. Up to
// CFG.maxPanels can be alive at once; each lives for
// CFG.panelLifetimeMs (counted from when it actually becomes
// visible, not from when it started loading) then fades out,
// and any camera movement fades every already-visible panel
// immediately (still-loading ones are just cancelled outright,
// since they were never shown).
//
// A panel's DOM (box + connector) is created but kept fully
// transparent and unappended-to-view from the moment selection
// happens; it's only revealed once the splat's onLoad fires —
// so panels always pop in already showing their model, instead
// of appearing empty and filling in a moment later.

import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

window.ThreePointCallout = (() => {

  const CFG = {
    manifestUrl: new URL("./splats-manifest.json", import.meta.url).href,
    plyFolder: "./splats/",
    placeholderPlyUrls: ["sharp_casolare7.ply", "sharp_casolare8.ply"]
      .map(f => new URL(f, import.meta.url).href),

    pointLayer: "points-layer",
    minZoom: 7, // lower it to get them show up earlier
    pitchThreshold: 30, // lower it to get ply appear at near top view

    selectionDelay: 100,

    maxPanels: 5,
    panelLifetimeMs: 10000,
    fadeDurationMs: 1000,

    panelWidth: 260,
    panelHeight: 210,
    panelPadding: 12,
    panelMargin: 16,
    gridColumns: 6,
    gridRows: 4,
    cellPadding: 24,

    // Gap kept between the point's own cell edge and the
    // panel — this, not a full cell width, is what mostly
    // determines the connector's length. See placeInCell().
    connectorGap: 14,

    // Matches four-quadrant-splats.html's MODEL_CENTRE /
    // INITIAL_CAMERA_DISTANCE.
    modelCentreZ: 0,
    viewerDistance: 2,
    viewerFov: 50,
    modelScale: 0.4,

    // Small offsets in the same units as the scene (roughly
    // -2..2 is the usable range at the default viewerDistance
    // — much bigger pushes the model outside the camera's
    // view entirely). negative X = left, positive Y = up.
    modelOffsetX: -1,
    modelOffsetY: .8,

    panAmplitudeDeg: 2,
    panSpeed: 0.5,

    background: "rgba(242,241,240,0.85)",
    border: "1px solid rgba(0,0,0,0.12)",
    shadow: "0 6px 20px rgba(0,0,0,0.14)",
    connectorColor: "#F2F1F0",
    connectorThickness: 1,

    fontFamily: '"MSCHN", sans-serif',
    titleFontSize: "15px",
    titleFontWeight: "700",
    detailFontSize: "9px",
    detailFontWeight: "500",
    bottomFontSize: "11px",
    bottomFontWeight: "500",
    textColor: "#222",

    // Duotone filter, applied per-panel via a ShaderPass (so
    // it only ever touches that panel's splat, never the map
    // or the text). Two palettes, interchangeable — just
    // change duotonePalette to "rose" or "stone" any time.
    duotonePalettes: {
      stone: { dark: "#807873", light: "#F2F1F0"},
      // Pink now sits at the shadow end, light stays near-
      // white — matches wanting most of the model to read as
      // plain light grey, with the tint only in dark areas.
      rose: { dark: "#C98A8A", mid: "#EAC0C0", light: "#F2F1F0" }
    },
    // Master on/off switch for the duotone effect — set to
    // false to render splats with their normal colours,
    // regardless of which palette is selected above.
    duotoneEnabled: false,
    duotonePalette: "stone",
    duotoneContrast: 1.1,
    duotoneBrightness: 0.3,

    // Applied to every splat via mesh.opacity — 1 is fully
    // solid, lower values add transparency.
    modelOpacity: 0.85
  };

  const DuotoneShader = {
    uniforms: {
      tDiffuse: { value: null },
      darkColour: { value: new THREE.Color("#000000") },
      midColour: { value: new THREE.Color("#808080") },
      lightColour: { value: new THREE.Color("#ffffff") },
      contrast: { value: 1 },
      brightness: { value: 0 }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform vec3 darkColour;
      uniform vec3 midColour;
      uniform vec3 lightColour;
      uniform float contrast;
      uniform float brightness;
      varying vec2 vUv;
      void main() {
        vec4 source = texture2D(tDiffuse, vUv);
        if (source.a < 0.001) { gl_FragColor = vec4(0.0); return; }
        float lum = dot(source.rgb, vec3(0.2126, 0.7152, 0.0722));
        lum = clamp((lum - 0.5) * contrast + 0.5 + brightness, 0.0, 1.0);
        vec3 col = lum < 0.5
          ? mix(darkColour, midColour, smoothstep(0.0, 0.5, lum))
          : mix(midColour, lightColour, smoothstep(0.5, 1.0, lum));
        gl_FragColor = vec4(col, source.a);
      }
    `
  };

  let map;
  let manifest = new Map();
  const existsCache = new Map();
  const callouts = new Map();   // id -> callout
  const occupied = new Set();   // "col,row" cells in use
  const activeSegments = new Map(); // id -> connector segment, for crossing checks
  let selectTimer, gateOpen = false;

  // ---------- init ----------

  async function init(mapInstance) {
    map = mapInstance;
    await loadManifest();

    map.on("movestart", fadeAllNow);
    map.on("moveend", scheduleSelect);
    map.on("zoomend", scheduleSelect);
    map.on("pitch", updateGate);
    map.on("pitchend", updateGate);

    updateGate();
    scheduleSelect();
    animate();
  }

  async function loadManifest() {
    try {
      const res = await fetch(CFG.manifestUrl);
      if (res.ok) manifest = new Map(Object.entries(await res.json()));
      console.log("[ThreePointCallout] manifest entries:", manifest.size);
    } catch (e) {
      console.error("[ThreePointCallout] manifest load failed:", e);
    }
  }

  function updateGate() {
    const wasOpen = gateOpen;
    gateOpen = map.getPitch() > CFG.pitchThreshold;
    if (wasOpen && !gateOpen) fadeAllNow();
  }

  // ---------- selection ----------

  function scheduleSelect() {
    clearTimeout(selectTimer);
    if (map.getZoom() < CFG.minZoom || !gateOpen) return;
    selectTimer = setTimeout(trySpawn, CFG.selectionDelay);
  }

  function trySpawn() {
    if (!gateOpen || !map.getLayer(CFG.pointLayer)) return;
    const slots = CFG.maxPanels - callouts.size;
    if (slots <= 0) return;

    const { clientWidth: w, clientHeight: h } = map.getContainer();
    const cx = w / 2, cy = h / 2;

    const candidates = map
      .queryRenderedFeatures([[0, 0], [w, h]], { layers: [CFG.pointLayer] })
      .filter(f => f.geometry?.coordinates)
      .map(f => {
        const id = getId(f);
        const p = map.project(f.geometry.coordinates);
        return { f, id, p, d: Math.abs(p.x - cx) + Math.abs(p.y - cy) };
      })
      .filter(c => manifest.has(c.id) && !callouts.has(c.id))
      .sort((a, b) => a.d - b.d);

    for (const c of candidates.slice(0, slots)) {
      if (!spawnCallout(c.f, c.id, c.p)) break; // grid full, stop trying
    }
  }

  // ---------- one callout: panel + connector + independent viewer ----------

  function spawnCallout(feature, id, point) {
    const m = gridMetrics();
    const pc = cellFor(point.x, point.y, m);

    // Preference order: straight up first, then sideways,
    // down as a last resort. Among whichever directions have
    // room at all, prefer one that doesn't cross an already-
    // placed connector; only accept a crossing if literally
    // every available direction would cross something.
    const attempts = ["up", "left", "right", "down"]
      .map(dir => attemptPlacement(dir, point, m, pc))
      .filter(Boolean);
    if (!attempts.length) return false; // no free cell in any direction

    const chosen = attempts.find(a => !a.crosses) || attempts[0];

    occupied.add(chosen.cell.key);
    activeSegments.set(id, chosen.segment);

    // Built and positioned now, but invisible — revealed only
    // once the splat has actually finished loading (see
    // revealCallout()).
    const panel = buildPanel(feature.properties || {});
    panel.style.left = `${chosen.panelX}px`;
    panel.style.top = `${chosen.panelY}px`;
    panel.style.opacity = "0";
    map.getContainer().appendChild(panel);

    const connector = document.createElement("div");
    Object.assign(connector.style, {
      position: "absolute", background: CFG.connectorColor,
      zIndex: "51", pointerEvents: "none", opacity: "0"
    });
    paintSegment(connector, chosen.segment);
    map.getContainer().appendChild(connector);

    const co = { id, panel, connector, cellKey: chosen.cell.key, fading: false, ready: false };
    co.viewer = createViewer(panel);
    callouts.set(id, co);

    resolveActualPlyUrl(id).then(url => {
      if (!callouts.has(id) || co.fading) return;
      co.viewer.load(url, () => {
        if (!callouts.has(id) || co.fading) return;
        revealCallout(co);
      });
    });

    return true;
  }

  function revealCallout(co) {
    co.ready = true;
    [co.panel, co.connector].forEach(el => {
      el.style.transition = `opacity ${CFG.fadeDurationMs}ms`;
      el.style.opacity = "1";
    });
    co.expireTimer = setTimeout(() => startFade(co), CFG.panelLifetimeMs);
  }

  function startFade(co) {
    if (co.fading) return;
    co.fading = true;
    clearTimeout(co.expireTimer);
    [co.panel, co.connector].forEach(el => {
      el.style.transition = `opacity ${CFG.fadeDurationMs}ms`;
      el.style.opacity = "0";
    });
    setTimeout(() => removeCallout(co), CFG.fadeDurationMs);
  }

  function fadeAllNow() {
    // Already-visible panels fade out normally; ones still
    // loading are just dropped outright — nothing was ever
    // shown for them, so there's nothing to fade.
    callouts.forEach(co => co.ready ? startFade(co) : removeCallout(co));
  }

  function removeCallout(co) {
    clearTimeout(co.expireTimer);
    co.panel.remove();
    co.connector.remove();
    co.viewer?.dispose();
    occupied.delete(co.cellKey);
    activeSegments.delete(co.id);
    callouts.delete(co.id);
  }

  // ---------- per-panel viewer (renderer + composer + splat) ----------

  function createViewer(panelEl) {
    const scene = new THREE.Scene();
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(CFG.panelWidth, CFG.panelHeight, false);
    if (!renderer.getContext()) {
      console.warn("[ThreePointCallout] WebGL context creation failed for a panel");
    }
    Object.assign(renderer.domElement.style, {
      position: "absolute", inset: "0", zIndex: "1"
    });
    panelEl.prepend(renderer.domElement);

    const spark = new SparkRenderer({ renderer, preBlurAmount: 0, blurAmount: 0 });
    scene.add(spark);

    const camera = new THREE.PerspectiveCamera(CFG.viewerFov, CFG.panelWidth / CFG.panelHeight, 0.01, 1000);
    const centre = new THREE.Vector3(0, 0, CFG.modelCentreZ);
    camera.position.set(centre.x, centre.y, centre.z + CFG.viewerDistance);
    camera.lookAt(centre);

    const rotationGroup = new THREE.Group();
    rotationGroup.position.copy(centre);
    scene.add(rotationGroup);

    let composer = null;
    if (CFG.duotoneEnabled) {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      const duotonePass = new ShaderPass(DuotoneShader);
      const palette = CFG.duotonePalettes[CFG.duotonePalette] || CFG.duotonePalettes.stone;
      duotonePass.uniforms.darkColour.value.set(palette.dark);
      duotonePass.uniforms.midColour.value.set(
        palette.mid || duotonePass.uniforms.darkColour.value.clone().lerp(new THREE.Color(palette.light), 0.5)
      );
      duotonePass.uniforms.lightColour.value.set(palette.light);
      duotonePass.uniforms.contrast.value = CFG.duotoneContrast;
      duotonePass.uniforms.brightness.value = CFG.duotoneBrightness;
      composer.addPass(duotonePass);
      composer.setSize(CFG.panelWidth, CFG.panelHeight);
    }

    let mesh = null;

    return {
      // Called once the actual .ply URL has been resolved.
      // onReady fires once Spark's own onLoad fires — i.e.
      // once there's actually something to show.
      load(url, onReady) {
        mesh = new SplatMesh({
          url,
          onLoad: () => {
            console.log("[ThreePointCallout] splat loaded:", url);
            onReady?.();
          }
        });
        // (1,0,0,0) as a quaternion is a 180° flip about X.
        mesh.quaternion.set(1, 0, 0, 0);
        mesh.position.set(CFG.modelOffsetX, CFG.modelOffsetY, 0);
        mesh.scale.setScalar(CFG.modelScale);
        mesh.opacity = CFG.modelOpacity;
        rotationGroup.add(mesh);
      },
      render(t) {
        if (!mesh) return; // nothing loaded yet — skip Spark/composer entirely
        rotationGroup.rotation.y = THREE.MathUtils.degToRad(CFG.panAmplitudeDeg) * Math.sin(t * CFG.panSpeed);
        if (composer) composer.render();
        else renderer.render(scene, camera);
      },
      dispose() {
        mesh?.dispose?.();
        composer?.dispose?.();
        renderer.dispose();
        // dispose() alone frees this renderer's own resources
        // but leaves the actual WebGL context alive until GC
        // gets to it. With panels churning every few seconds,
        // that was outrunning garbage collection and piling up
        // contexts past the browser's hard limit (usually 16)
        // — forceContextLoss() releases it immediately instead
        // of waiting.
        renderer.forceContextLoss();
        renderer.domElement.remove();
      }
    };
  }

  function animate() {
    requestAnimationFrame(animate);
    const t = performance.now() / 1000;
    callouts.forEach(co => co.viewer?.render(t));
  }

  // ---------- panel DOM ----------

  function buildPanel(props) {
    const panel = document.createElement("div");
    Object.assign(panel.style, {
      position: "absolute", width: `${CFG.panelWidth}px`, height: `${CFG.panelHeight}px`,
      zIndex: "50", boxSizing: "border-box", background: CFG.background,
      border: CFG.border, boxShadow: CFG.shadow, overflow: "hidden", pointerEvents: "none"
    });

    const text = (v, s, w, side, valign) => {
      const el = document.createElement("div");
      Object.assign(el.style, {
        position: "absolute", [valign]: `${CFG.panelPadding}px`, [side]: `${CFG.panelPadding}px`,
        maxWidth: `calc(50% - ${CFG.panelPadding * 1.5}px)`, zIndex: "10",
        fontFamily: CFG.fontFamily, fontSize: s, fontWeight: w, lineHeight: "1.25",
        color: CFG.textColor, textAlign: side
      });
      el.innerHTML = v;
      panel.appendChild(el);
    };

    const title = props.titolo || props.tipologiaEdificio || "";
    const regione = props.regione || "";
    const secondLine = [props.comune, props.siglaProvincia].filter(Boolean).join(", ");
    const conservazione = props.conservazione || "";
    const periodo = props.periodoCronologico || "";

    text(escapeHtml(title), CFG.titleFontSize, CFG.titleFontWeight, "left", "top");
    text([escapeHtml(regione), escapeHtml(secondLine)].filter(Boolean).join("<br>"),
      CFG.detailFontSize, CFG.detailFontWeight, "right", "top");
    text(`conservazione: ${escapeHtml(conservazione)}`,
      CFG.bottomFontSize, CFG.bottomFontWeight, "left", "bottom");
    text(`secolo ${escapeHtml(periodo)}`,
      CFG.bottomFontSize, CFG.bottomFontWeight, "right", "bottom");

    return panel;
  }

  function escapeHtml(v) {
    return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ---------- grid placement ----------

  function gridMetrics() {
    const { clientWidth: w, clientHeight: h } = map.getContainer();
    const minCw = CFG.panelWidth + CFG.cellPadding * 2;
    const minCh = CFG.panelHeight + CFG.cellPadding * 2;
    const cols = clamp(Math.floor(w / minCw), 1, CFG.gridColumns);
    const rows = clamp(Math.floor(h / minCh), 1, CFG.gridRows);
    return { w, h, cols, rows, cw: w / cols, ch: h / rows };
  }

  const cellFor = (x, y, m) => ({
    col: clamp(Math.floor(x / m.cw), 0, m.cols - 1),
    row: clamp(Math.floor(y / m.ch), 0, m.rows - 1)
  });

  const cellRect = (cell, m) => ({
    left: cell.col * m.cw, top: cell.row * m.ch, width: m.cw, height: m.ch
  });

  // Nearest free cell strictly along one axis from the point's
  // own cell — not "nearest overall", so each direction can be
  // tried in an explicit preference order (see attemptPlacement).
  function nearestFreeInDirection(dir, pc, m) {
    if (dir === "up") {
      for (let r = pc.row - 1; r >= 0; r--) {
        const key = `${pc.col},${r}`;
        if (!occupied.has(key)) return { col: pc.col, row: r, key };
      }
    } else if (dir === "down") {
      for (let r = pc.row + 1; r < m.rows; r++) {
        const key = `${pc.col},${r}`;
        if (!occupied.has(key)) return { col: pc.col, row: r, key };
      }
    } else if (dir === "left") {
      for (let c = pc.col - 1; c >= 0; c--) {
        const key = `${c},${pc.row}`;
        if (!occupied.has(key)) return { col: c, row: pc.row, key };
      }
    } else if (dir === "right") {
      for (let c = pc.col + 1; c < m.cols; c++) {
        const key = `${c},${pc.row}`;
        if (!occupied.has(key)) return { col: c, row: pc.row, key };
      }
    }
    return null;
  }

  // Works out what placing the panel in `dir` would actually
  // look like — cell, panel position, and the resulting
  // connector segment — and whether that segment would cross
  // any already-active connector. Returns null if there's no
  // free cell at all in that direction.
  function attemptPlacement(dir, point, m, pc) {
    const cell = nearestFreeInDirection(dir, pc, m);
    if (!cell) return null;

    const rect = cellRect(cell, m);
    const pointCellRect = cellRect(pc, m);
    const { panelX, panelY } = placeInCell(rect, pointCellRect, point, dir, m);
    const panelRect = { left: panelX, top: panelY, width: CFG.panelWidth, height: CFG.panelHeight };
    const segment = connectorSegment(point.x, point.y, panelRect, dir);
    const crosses = [...activeSegments.values()].some(existing => segmentsCross(segment, existing));

    return { dir, cell, panelX, panelY, segment, crosses };
  }

  // Both segments are guaranteed axis-aligned (see
  // connectorSegment), so this only needs the parallel and
  // perpendicular cases — no general line-intersection math.
  function segmentsCross(a, b) {
    const aVert = a.x1 === a.x2, bVert = b.x1 === b.x2;

    if (aVert && bVert) {
      if (a.x1 !== b.x1) return false;
      return Math.max(Math.min(a.y1, a.y2), Math.min(b.y1, b.y2))
           < Math.min(Math.max(a.y1, a.y2), Math.max(b.y1, b.y2));
    }
    if (!aVert && !bVert) {
      if (a.y1 !== b.y1) return false;
      return Math.max(Math.min(a.x1, a.x2), Math.min(b.x1, b.x2))
           < Math.min(Math.max(a.x1, a.x2), Math.max(b.x1, b.x2));
    }

    const v = aVert ? a : b, h = aVert ? b : a;
    const withinX = v.x1 >= Math.min(h.x1, h.x2) && v.x1 <= Math.max(h.x1, h.x2);
    const withinY = h.y1 >= Math.min(v.y1, v.y2) && h.y1 <= Math.max(v.y1, v.y2);
    return withinX && withinY;
  }

  // Cross-axis aligned to the point so the connector stays a
  // single straight line. On the primary axis, the panel is
  // placed flush against the edge of the POINT's own cell
  // (plus a small connectorGap) rather than centred inside the
  // far/free cell, so the connector's length reflects where
  // the point actually is. The final containment clamp is what
  // stops the line ending "in the void": without it, the cell/
  // viewport clamps above could occasionally push the panel far
  // enough that the point's own coordinate fell outside the
  // panel's span, so the connector's endpoint (aligned to that
  // coordinate) never actually touched the panel.
  function placeInCell(rect, pointCellRect, point, dir, m) {
    const horiz = dir === "left" || dir === "right";
    const gap = CFG.connectorGap;

    let x, y;
    if (horiz) {
      x = dir === "right"
        ? pointCellRect.left + pointCellRect.width + gap
        : pointCellRect.left - gap - CFG.panelWidth;
      y = point.y - CFG.panelHeight / 2;
    } else {
      x = point.x - CFG.panelWidth / 2;
      y = dir === "down"
        ? pointCellRect.top + pointCellRect.height + gap
        : pointCellRect.top - gap - CFG.panelHeight;
    }

    x = clamp(x, rect.left + CFG.cellPadding, rect.left + rect.width - CFG.panelWidth - CFG.cellPadding);
    y = clamp(y, rect.top + CFG.cellPadding, rect.top + rect.height - CFG.panelHeight - CFG.cellPadding);
    x = clamp(x, CFG.panelMargin, m.w - CFG.panelWidth - CFG.panelMargin);
    y = clamp(y, CFG.panelMargin, m.h - CFG.panelHeight - CFG.panelMargin);

    // Guarantee the point's own coordinate stays within the
    // panel's span on the cross axis, overriding the clamps
    // above if they'd otherwise push it out.
    if (horiz) {
      y = clamp(y, point.y - CFG.panelHeight, point.y);
    } else {
      x = clamp(x, point.x - CFG.panelWidth, point.x);
    }

    return { panelX: x, panelY: y };
  }

  function connectorSegment(px, py, rect, dir) {
    if (dir === "left" || dir === "right") {
      return { x1: px, y1: py, x2: dir === "right" ? rect.left : rect.left + rect.width, y2: py };
    }
    return { x1: px, y1: py, x2: px, y2: dir === "down" ? rect.top : rect.top + rect.height };
  }

  // Rounded to whole pixels — sub-pixel positions at low
  // thickness values anti-alias horizontal vs vertical bars
  // differently, which was making the line look thicker in
  // one orientation than the other.
  function paintSegment(el, s) {
    const t = Math.round(CFG.connectorThickness);
    if (s.y1 === s.y2) {
      Object.assign(el.style, {
        left: `${Math.round(Math.min(s.x1, s.x2))}px`, top: `${Math.round(s.y1 - t / 2)}px`,
        width: `${Math.round(Math.abs(s.x2 - s.x1))}px`, height: `${t}px`
      });
    } else {
      Object.assign(el.style, {
        left: `${Math.round(s.x1 - t / 2)}px`, top: `${Math.round(Math.min(s.y1, s.y2))}px`,
        width: `${t}px`, height: `${Math.round(Math.abs(s.y2 - s.y1))}px`
      });
    }
  }

  // ---------- ply resolution ----------

  function buildPlyUrl(filename) {
    return new URL(`${CFG.plyFolder}${filename}`, import.meta.url).href;
  }

  async function checkFileExists(url) {
    try { return (await fetch(url, { method: "HEAD" })).ok; }
    catch { return false; }
  }

  // `id` is only ever called with a real manifest entry — the
  // manifest is reliable, the .ply binaries may not be (e.g.
  // GitHub large-file limits), so this checks reachability and
  // falls back to a placeholder (deterministic per id) if not.
  async function resolveActualPlyUrl(id) {
    const url = buildPlyUrl(manifest.get(id));
    let exists = existsCache.get(id);
    if (exists === undefined) {
      exists = await checkFileExists(url);
      existsCache.set(id, exists);
    }
    if (exists) return url;
    const urls = CFG.placeholderPlyUrls;
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
    return urls[Math.abs(hash) % urls.length];
  }

  // ---------- helpers ----------

  function getId(f) {
    return String(f.properties?.id ?? f.id ?? f.geometry.coordinates.join(","));
  }
  const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

  return {
    init,
    clear: fadeAllNow,
    refresh: scheduleSelect
  };
})();