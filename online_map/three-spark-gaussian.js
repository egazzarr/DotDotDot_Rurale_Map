import * as THREE from "three";
import { SparkRenderer, SplatMesh, SplatLoader } from "@sparkjsdev/spark";

window.ThreePointCallout = (() => {
    const CFG = {
        plyUrl: new URL("./sharp_casolare7.ply", import.meta.url).href,
        pointLayer: "points-layer",
        imageBasePath: new URL("../../3.dati_schede/1.output_png_schede/", import.meta.url).href, // New: Path to PNGs

        minZoom: 9,
        delay: 500,
        margin: 70,

        referenceSize: 1440,
        minScale: 0.55,
        maxScale: 1.5,

        width: 580,
        height: 470,
        titleHeight: 110,
        footerHeight: 130,
        offset: 110,

        font: '"MSCHN", sans-serif',
        titleFontSize: 150,
        bodyFontSize: 130,

        panelColor: "#F2F1F0",
        panelOpacity: 0.97,
        frameColor: "#F2F1F0",
        frameOpacity: 1,
        textColor: "#2b2924",

        modelRotation: [0, 0, 0],
        spinSpeed: 0.002,
        animationSpeed: 0.05
    };

    const PHASES = 3;

    let map, renderer, scene, camera, spark;
    let panel, background, border, divider, titleText, footerText, connector, selected, model, imageMesh;
    let splatTemplate, timer;
    let textureLoader;

    let reveal = 0;
    let targetReveal = 0;
    let removing = false;

    function init(mapInstance, features) {
        map = mapInstance;

        if (!map || !features?.length) {
            console.error("ThreePointCallout: missing map or features.");
            return;
        }

        textureLoader = new THREE.TextureLoader(); // Initialize loader

        createRenderer();
        loadModel();

        map.on("move", render);
        map.on("moveend", schedule);
        map.on("resize", resize);

        document.fonts?.ready.then(schedule);

        resize();
        schedule();
        animate();
    }

    function createRenderer() {
        const canvas = document.createElement("canvas");

        Object.assign(canvas.style, {
            position: "absolute",
            inset: "0",
            width: "100%",
            height: "100%",
            zIndex: "5",
            pointerEvents: "none"
        });

        map.getContainer().appendChild(canvas);

        renderer = new THREE.WebGLRenderer({
            canvas,
            alpha: true,
            antialias: true,
            depth: true
        });

        renderer.setPixelRatio(
            Math.min(window.devicePixelRatio, 2)
        );

        renderer.setClearColor(0, 0, 0, 0);

        scene = new THREE.Scene();

        camera = new THREE.OrthographicCamera(
            0, 1, 1, 0, 0.1, 2000
        );
        
        camera.position.z = 1000;
        camera.lookAt(0, 0, 0);

        spark = new SparkRenderer({ renderer });
        scene.add(spark);
    }

    function loadModel() {
        new SplatLoader().load(
            CFG.plyUrl,
            packedSplats => {
                splatTemplate = packedSplats;
                console.log(`ThreePointCallout: loaded ${packedSplats.numSplats} splats from ${CFG.plyUrl}`);

                if (selected) {
                    build(selected.properties || {});
                } else {
                    schedule();
                }
            },
            undefined,
            error => console.error("Cannot load .ply:", error)
        );
    }

    function resize() {
        const el = map.getContainer();
        const w = el.clientWidth;
        const h = el.clientHeight;

        renderer.setSize(w, h, false);

        camera.left = 0;
        camera.right = w;
        camera.bottom = 0;
        camera.top = h;
        camera.updateProjectionMatrix();

        render();
    }

    function schedule() {
        clearTimeout(timer);

        if (map.getZoom() < CFG.minZoom) {
            hide();
            return;
        }

        timer = setTimeout(selectFeature, CFG.delay);
    }

    function selectFeature() {
        if (!map.getLayer(CFG.pointLayer)) return;

        const el = map.getContainer();
        const w = el.clientWidth;
        const h = el.clientHeight;

        const features = map.queryRenderedFeatures(
            [
                [CFG.margin, CFG.margin],
                [w - CFG.margin, h - CFG.margin]
            ],
            { layers: [CFG.pointLayer] }
        );

        if (!features.length) return;

        const next = features.reduce((best, feature) => {
            const p = map.project(feature.geometry.coordinates);
            const score =
                Math.abs(p.x - w / 2) +
                Math.abs(p.y - h / 2);

            return !best || score < best.score
                ? { feature, score }
                : best;
        }, null).feature;

        if (
            selected &&
            getId(selected) === getId(next)
        ) {
            return;
        }

        selected = next;
        build(selected.properties || {});
    }

    function build(properties) {
        removeObjects();

        const s = uiScale();
        const w = CFG.width * s;
        const h = CFG.height * s;
        const titleH = CFG.titleHeight * s;
        const footerH = CFG.footerHeight * s;
        const modelH = h - titleH - footerH;

        panel = new THREE.Group();

        background = createBackground(w, h);
        border = createBorder(w, h);

        panel.add(background, border);

        titleText = createTitleText(properties, w * 0.9, titleH * 0.8);
        titleText.position.set(0, h / 2 - titleH / 2, 30);
        panel.add(titleText);

        footerText = createFooterText(properties, w * 0.88, footerH * 0.5);
        footerText.position.set(0, -h / 2 + footerH / 2, 30);
        panel.add(footerText);

        // Load and add PNG image if available
        const id = getId(selected);
        const imgUrl = new URL(`${id}.png`, CFG.imageBasePath).href;
        
        textureLoader.load(
            imgUrl,
            (texture) => {
                // Image loaded successfully
                createImageMesh(texture, w, h, titleH, footerH);
            },
            undefined,
            () => {
                // Image failed to load (404 or error) - do nothing, just silently fail
                console.log(`Image not found for ID ${id}: ${imgUrl}`);
            }
        );

        if (splatTemplate) {
            model = new SplatMesh({ packedSplats: splatTemplate });
            fitModel(model, w, modelH, titleH, footerH);

            spark.add(model);
        }

        connector = createConnector();

        scene.add(connector, panel);

        reveal = 0;
        targetReveal = PHASES;
        removing = false;

        updatePanelState();
    }

    function createImageMesh(texture, w, h, titleH, footerH) {
        if (!texture) return;

        const modelH = h - titleH - footerH;
        const availableW = w * 0.62;
        const availableH = modelH * 0.62;

        const geometry = new THREE.PlaneGeometry(availableW, availableH);
        
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: 0, // Start hidden for animation
            depthTest: false, // Ensure it renders on top
            depthWrite: false,
            side: THREE.DoubleSide
        });

        imageMesh = new THREE.Mesh(geometry, material);
        
        // Position image slightly in front of the splat (Z=60 vs Splats Z=50)
        const verticalCenter = (footerH - titleH) / 2;
        imageMesh.position.set(0, verticalCenter, 60);
        
        // Add to the main scene or panel? 
        // Since the splat is added to 'spark' (scene), we add imageMesh to 'scene' directly
        // to ensure it sits on the correct Z plane relative to the camera.
        scene.add(imageMesh);
        
        // Mark for removal in removeObjects
        imageMesh.userData.isImage = true;
    }

    function createBackground(w, h) {
        const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(w, h),
            new THREE.MeshBasicMaterial({
                color: CFG.panelColor,
                transparent: true,
                opacity: 0,
                depthTest: false,
                depthWrite: false
            })
        );

        mesh.renderOrder = 0;
        mesh.position.z = 0;

        return mesh;
    }

    function createBorder(w, h) {
        const half = w / 2;
        const halfH = h / 2;

        const pts = [
            [0, -halfH],
            [half, -halfH],
            [half, halfH],
            [-half, halfH],
            [-half, -halfH],
            [0, -halfH]
        ];

        const lengths = [];
        let total = 0;

        for (let i = 0; i < pts.length - 1; i++) {
            const dx = pts[i + 1][0] - pts[i][0];
            const dy = pts[i + 1][1] - pts[i][1];
            const len = Math.hypot(dx, dy);

            lengths.push(len);
            total += len;
        }

        const positions = new Float32Array(pts.length * 3);

        pts.forEach((p, i) => {
            positions[i * 3] = p[0];
            positions[i * 3 + 1] = p[1];
            positions[i * 3 + 2] = 2;
        });

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geometry.setDrawRange(0, 1);

        const line = new THREE.Line(
            geometry,
            new THREE.LineBasicMaterial({
                color: CFG.frameColor,
                depthTest: false
            })
        );

        line.renderOrder = 1;
        line.visible = false;
        line.userData.pts = pts;
        line.userData.lengths = lengths;
        line.userData.total = total;

        return line;
    }

    function updateBorder(line, t) {
        const { pts, lengths, total } = line.userData;
        const geometry = line.geometry;
        const position = geometry.attributes.position;

        const dist = clamp(t, 0, 1) * total;

        let covered = 0;
        let segIndex = lengths.length - 1;
        let segT = 1;

        for (let i = 0; i < lengths.length; i++) {
            if (dist <= covered + lengths[i] || i === lengths.length - 1) {
                segIndex = i;
                segT = lengths[i] > 0
                    ? clamp((dist - covered) / lengths[i], 0, 1)
                    : 1;
                break;
            }

            covered += lengths[i];
        }

        pts.forEach((p, i) => {
            position.setXYZ(i, p[0], p[1], 2);
        });

        const from = pts[segIndex];
        const to = pts[segIndex + 1];

        position.setXYZ(
            segIndex + 1,
            from[0] + (to[0] - from[0]) * segT,
            from[1] + (to[1] - from[1]) * segT,
            2
        );

        position.needsUpdate = true;
        geometry.setDrawRange(0, segIndex + 2);
        line.visible = t > 0.001;
    }


    function createConnector() {
        const geometry = new THREE.BufferGeometry();

        geometry.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(
                [0, 0, 0, 0, 0, 0],
                3
            )
        );

        return new THREE.Line(
            geometry,
            new THREE.LineBasicMaterial({
                color: CFG.frameColor,
                depthTest: false
            })
        );
    }


    function textMesh(entries, w, h, startSize) {
        const canvas = document.createElement("canvas");

        canvas.width = 4096;
        canvas.height = 900;

        const ctx = canvas.getContext("2d");

        let size = startSize;

        while (size > 60) {
            ctx.font = `500 ${size}px ${CFG.font}`;

            const widest = Math.max(
                ...entries.map(e => ctx.measureText(e.text).width)
            );

            const combined = entries.length > 1
                ? entries.reduce((sum, e) => sum + ctx.measureText(e.text).width, 0) +
                  canvas.width * 0.06
                : widest;

            if (combined <= canvas.width * 0.94) break;

            size -= 4;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = `500 ${size}px ${CFG.font}`;
        ctx.fillStyle = CFG.textColor;
        ctx.textBaseline = "middle";

        const midY = canvas.height / 2;

        entries.forEach(entry => {
            ctx.textAlign = entry.align;
            const x = entry.align === "left"
                ? canvas.width * 0.03
                : canvas.width * 0.97;

            ctx.fillText(entry.text, x, midY);
        });

        const texture = new THREE.CanvasTexture(canvas);

        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = true;
        texture.anisotropy =
            renderer.capabilities.getMaxAnisotropy();

        const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(w, h),
            new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                opacity: 0,
                depthTest: false,
                depthWrite: false
            })
        );

        mesh.renderOrder = 2;

        return mesh;
    }

    function fitModel(splatMesh, w, modelH, titleH, footerH) {
        splatMesh.rotation.set(0, 0, 0);
        splatMesh.scale.set(1, 1, 1);
        splatMesh.updateMatrixWorld(true);

        let box;
        try {
            box = splatMesh.getBoundingBox();
        } catch (e) {
            box = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
        }

        const center = box.getCenter(new THREE.Vector3());
        splatMesh.position.sub(center);
        splatMesh.updateMatrixWorld(true);

        box = splatMesh.getBoundingBox();
        const size = box.getSize(new THREE.Vector3());

        const availableW = w * 0.62;
        const availableH = modelH * 0.62;
        const availableD = modelH * 0.62;

        const scaleX = availableW / Math.max(size.x, 0.001);
        const scaleY = availableH / Math.max(size.y, 0.001);
        const scaleZ = availableD / Math.max(size.z, 0.001);

        const scale = Math.min(scaleX, scaleY, scaleZ);

        splatMesh.scale.setScalar(scale);
        splatMesh.updateMatrixWorld(true);

        const verticalCenter = (footerH - titleH) / 2;
        model.userData.localOffset =
            new THREE.Vector3(0, verticalCenter, 50);

        splatMesh.position.copy(model.userData.localOffset);
        
        splatMesh.position.z = 50;

        const material = splatMesh.material || splatMesh.materials?.[0];
        
        if (material) {
            material.depthTest = false;
            material.depthWrite = false;
            material.transparent = true;
        }

        splatMesh.renderOrder = 100;

        console.log("Splat Fit Info:", {
            scale: scale,
            position: splatMesh.position,
            sizeAfterScale: size.clone().multiplyScalar(scale),
            renderOrder: splatMesh.renderOrder,
            material: material ? "Found" : "None"
        });

        splatMesh.visible = true;
        splatMesh.opacity = 1;
    }
    
    function removeObjects() {
        if (panel) scene.remove(panel);
        if (connector) scene.remove(connector);

        if (model) {
            spark.remove(model);
            model.dispose?.();
        }

        // Remove image mesh if it exists
        if (imageMesh) {
            scene.remove(imageMesh);
            imageMesh.geometry.dispose();
            if (imageMesh.material.map) imageMesh.material.map.dispose();
            imageMesh.material.dispose();
            imageMesh = null;
        }

        panel = null;
        background = null;
        border = null;
        titleText = null;
        footerText = null;
        connector = null;
        model = null;
    }


    function createTitleText(properties, w, h) {
        const titolo = properties.titolo || properties.tipologiaEdificio || "N/D";

        const left =
            titolo.charAt(0).toUpperCase() + titolo.slice(1);

        const right =
            [
                properties.regione ? `${properties.regione},` : "",
                properties.comune
                    ? `${properties.comune}${properties.siglaProvincia ? ` [${properties.siglaProvincia}]` : ""}`
                    : ""
            ]
                .filter(Boolean)
                .join("\n");

        return textMesh(
            [
                { text: left, align: "left" },
                { text: right, align: "right" }
            ],
            w,
            h,
            CFG.titleFontSize
        );
    }

    function createFooterText(properties, w, h) {
        const left =
            `Stato di conservazione:\n${properties.conservazione || "N/D"}`;

        const right =
            `${properties.periodoCronologico || "N/D"} secolo`;

        return textMesh(
            [
                { text: left, align: "left" },
                { text: right, align: "right" }
            ],
            w,
            h,
            CFG.bodyFontSize
        );
    }


    function render() {
        if (!renderer) return;

        if (selected && panel && connector) {
            const el = map.getContainer();
            const w = el.clientWidth;
            const h = el.clientHeight;

            const projected = map.project(
                selected.geometry.coordinates
            );

            const anchorX = projected.x;
            const anchorY = h - projected.y;

            const s = uiScale();
            const halfW = CFG.width * s / 2;
            const halfH = CFG.height * s / 2;

            const panelX = clamp(
                anchorX,
                halfW + 12,
                w - halfW - 12
            );

            const panelY = clamp(
                anchorY + CFG.offset * s + halfH,
                halfH + 12,
                h - halfH - 12
            );

            panel.position.set(panelX, panelY, 0);
            
            if (model) {
                const offset = model.userData.localOffset;

                model.position.set(
                    panelX + offset.x,
                    panelY + offset.y,
                    offset.z
                );
            }

            // Update image mesh position if it exists
            if (imageMesh) {
                const verticalCenter = (CFG.footerHeight * s - CFG.titleHeight * s) / 2;
                imageMesh.position.set(
                    panelX,
                    panelY + verticalCenter,
                    60 // Same Z as in createImageMesh
                );
            }

            const lineProgress = clamp(reveal, 0, 1);

            const endX =
                anchorX +
                (panelX - anchorX) *
                lineProgress;

            const endY =
                anchorY +
                (panelY - halfH - anchorY) *
                lineProgress;

            const p =
                connector.geometry.attributes.position;

            p.setXYZ(0, anchorX, anchorY, 0);
            p.setXYZ(1, endX, endY, 0);
            p.needsUpdate = true;
        }

        renderer.render(scene, camera);
    }

    function updatePanelState() {
        if (!panel) return;

        const connectorT = clamp(reveal, 0, 1);
        const borderT = clamp(reveal - 1, 0, 1);
        const fillT = clamp(reveal - 2, 0, 1);

        panel.visible = connectorT > 0.001;

        if (border) updateBorder(border, borderT);

        if (background) background.material.opacity = CFG.panelOpacity * fillT;
        if (titleText) titleText.material.opacity = fillT;
        if (footerText) footerText.material.opacity = fillT;

        if (model) {
            model.opacity = 1;
            model.visible = true;
        }

        // Animate image mesh opacity if it exists
        if (imageMesh) {
            imageMesh.material.opacity = fillT;
            imageMesh.visible = fillT > 0.001;
        }
    }

    function animate() {
        requestAnimationFrame(animate);

        reveal +=
            (targetReveal - reveal) *
            CFG.animationSpeed;

        if (model) {
            model.rotation.y += CFG.spinSpeed;
        }

        updatePanelState();
        render();

        if (
            removing &&
            reveal < 0.005
        ) {
            removeObjects();
            selected = null;
            removing = false;
            reveal = 0;
        }
    }

    function hide() {
        clearTimeout(timer);
        targetReveal = 0;
        removing = true;
    }

    function removeObjects() {
        if (panel) scene.remove(panel);
        if (connector) scene.remove(connector);

        if (model) spark.remove(model);

        if (model) model.dispose?.();

        if (imageMesh) {
            scene.remove(imageMesh);
            imageMesh.geometry.dispose();
            if (imageMesh.material.map) imageMesh.material.map.dispose();
            imageMesh.material.dispose();
            imageMesh = null;
        }

        panel = null;
        background = null;
        border = null;
        titleText = null;
        footerText = null;
        connector = null;
        model = null;
    }

    function uiScale() {
        const el = map.getContainer();

        return clamp(
            Math.min(el.clientWidth, el.clientHeight) /
                CFG.referenceSize,
            CFG.minScale,
            CFG.maxScale
        );
    }

    function getId(feature) {
        return String(
            feature.properties?.id ??
            feature.id ??
            feature.geometry.coordinates.join(",")
        );
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    return {
        init,
        clear: hide,
        refresh: schedule
    };
})();