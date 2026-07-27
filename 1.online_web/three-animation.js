import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

window.ThreePointCallout = (() => {
    const CFG = {
        modelUrl: new URL("./trullo.glb", import.meta.url).href,
        pointLayer: "points-layer",

        minZoom: 9,
        delay: 500,
        margin: 70,

        referenceSize: 1440,
        minScale: 0.55,
        maxScale: 1.5,

        width: 580,
        height: 470,
        textHeight: 150,
        offset: 110,

        font: '"MSCHN", sans-serif',
        fontSize: 200,
        color: 0xffffff,

        modelRotation: [0, 0, 0],
        spinSpeed: 0.002,

        /*
         * Higher = faster drawing.
         */
        animationSpeed: 0.02
    };

    let map, renderer, scene, camera;
    let panel, frame, connector, selected, model;
    let modelTemplate, timer;

    let reveal = 0;
    let targetReveal = 0;
    let removing = false;

    function init(mapInstance, features) {
        map = mapInstance;

        if (!map || !features?.length) {
            console.error("ThreePointCallout: missing map or features.");
            return;
        }

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
            antialias: true
        });

        renderer.setPixelRatio(
            Math.min(window.devicePixelRatio, 2)
        );

        renderer.setClearColor(0, 0);

        scene = new THREE.Scene();

        camera = new THREE.OrthographicCamera(
            0, 1, 1, 0, 0.1, 2000
        );

        camera.position.z = 1000;

        scene.add(new THREE.AmbientLight(0xffffff, 2.5));

        const light = new THREE.DirectionalLight(0xffffff, 3);
        light.position.set(4, 6, 10);
        scene.add(light);
    }

    function loadModel() {
        new GLTFLoader().load(
            CFG.modelUrl,
            gltf => {
                modelTemplate = gltf.scene;
                schedule();
            },
            undefined,
            error => console.error("Cannot load trullo.glb:", error)
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
        const textH = CFG.textHeight * s;

        panel = new THREE.Group();
        frame = createFrame(w, h, textH);

        panel.add(frame);

        const text = createText(properties, w * 0.9, textH * 0.82);
        text.position.set(0, -h / 2 + textH / 2, 30);
        panel.add(text);

        if (modelTemplate) {
            model = modelTemplate.clone(true);
            fitModel(model, w, h - textH, textH);
            panel.add(model);
        }

        connector = createConnector();

        /*
         * Rectangle grows upward from its bottom centre.
         */
        panel.children.forEach(child => {
            child.userData.finalY = child.position.y;
        });

        scene.add(connector, panel);

        reveal = 0;
        targetReveal = 1;
        removing = false;

        updateReveal();
    }

    function createFrame(w, h, textH) {
        const x = w / 2;
        const y = h / 2;
        const divider = -y + textH;

        const vertices = [
            -x, -y, 0,  x, -y, 0,
             x, -y, 0,  x,  y, 0,
             x,  y, 0, -x,  y, 0,
            -x,  y, 0, -x, -y, 0,
            -x, divider, 0, x, divider, 0
        ];

        const geometry = new THREE.BufferGeometry();

        geometry.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(vertices, 3)
        );

        return new THREE.LineSegments(
            geometry,
            new THREE.LineBasicMaterial({
                color: CFG.color,
                depthTest: false
            })
        );
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
                color: CFG.color,
                depthTest: false
            })
        );
    }

    function createText(properties, w, h) {
        const canvas = document.createElement("canvas");

        canvas.width = 4096;
        canvas.height = 1536;

        const ctx = canvas.getContext("2d");

        const lines = [
            `ID: ${properties.id || "N/D"}`,
            `CONTESTO PAESAGGISTICO: ${properties.paesaggio || "N/D"}`,
            `STATO DI CONSERVAZIONE: ${properties.conservazione || "N/D"}`
        ];

        let size = CFG.fontSize;

        while (size > 70) {
            ctx.font = `500 ${size}px ${CFG.font}`;

            if (
                Math.max(
                    ...lines.map(line => ctx.measureText(line).width)
                ) <= canvas.width * 0.88
            ) {
                break;
            }

            size -= 4;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = `500 ${size}px ${CFG.font}`;
        ctx.fillStyle = "#fff";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";

        const lineHeight = size * 1.55;
        const firstY = canvas.height / 2 - lineHeight;

        lines.forEach((line, i) => {
            ctx.fillText(
                line.toUpperCase(),
                canvas.width * 0.06,
                firstY + i * lineHeight
            );
        });

        const texture = new THREE.CanvasTexture(canvas);

        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = true;
        texture.anisotropy =
            renderer.capabilities.getMaxAnisotropy();

        return new THREE.Mesh(
            new THREE.PlaneGeometry(w, h),
            new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                depthTest: false,
                depthWrite: false
            })
        );
    }

    function fitModel(object, w, modelH, textH) {
        object.rotation.set(...CFG.modelRotation);
        object.updateMatrixWorld(true);

        let box = new THREE.Box3().setFromObject(object);
        object.position.sub(box.getCenter(new THREE.Vector3()));
        object.updateMatrixWorld(true);

        box = new THREE.Box3().setFromObject(object);

        const size = box.getSize(new THREE.Vector3());

        object.scale.setScalar(
            Math.min(
                w * 0.62 / Math.max(size.x, 0.001),
                modelH * 0.62 / Math.max(size.y, 0.001),
                modelH * 0.62 / Math.max(size.z, 0.001)
            )
        );

        object.position.y = textH / 2;
        object.position.z = 50;
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

            const lineProgress =
                clamp(reveal * 2, 0, 1);

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

    function updateReveal() {
        if (!panel) return;

        const boxReveal =
            clamp((reveal - 0.5) * 2, 0, 1);

        panel.scale.set(1, boxReveal, 1);
        panel.visible = boxReveal > 0.001;
    }

    function animate() {
        requestAnimationFrame(animate);

        reveal +=
            (targetReveal - reveal) *
            CFG.animationSpeed;

        if (model) {
            model.rotation.y += CFG.spinSpeed;
        }

        updateReveal();
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

        panel = null;
        frame = null;
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