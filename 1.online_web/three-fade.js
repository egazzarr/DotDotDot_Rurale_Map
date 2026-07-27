import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

console.log("[three-point-callout.js] loaded");

window.ThreePointCallout = (() => {
    const CFG = {
        modelUrl: new URL("../3.dati_schede/gaussian_tests_spz/trullo.glb", import.meta.url).href,
        pointLayer: "points-layer",

        minZoom: 8,
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
        fontSize: 100,
        color: 0xffffff,

        modelRotationX: 0,
        modelRotationY: 0,
        modelRotationZ: 0,
        spinSpeed: 0.002, 

        fadeSpeed: 0.01
    };

    let map;
    let renderer;
    let scene;
    let camera;

    let panel = null;
    let connector = null;
    let selected = null;
    let timer = null;

    let modelTemplate = null;
    let currentModel = null;

    let opacity = 0;
    let targetOpacity = 0;
    let pendingRemoval = false;


    function init(mapInstance, features) {
        map = mapInstance;

        if (!map || !features?.length) {
            console.error("ThreePointCallout: map or features missing.");
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

        renderer.setClearColor(0x000000, 0);

        scene = new THREE.Scene();

        camera = new THREE.OrthographicCamera(
            0,
            1,
            1,
            0,
            0.1,
            2000
        );

        camera.position.set(0, 0, 1000);
        camera.lookAt(0, 0, 0);

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

            error => {
                console.error("Cannot load trullo.glb:", error);
            }
        );
    }

    function resize() {
        const container = map.getContainer();
        const width = container.clientWidth;
        const height = container.clientHeight;

        renderer.setSize(width, height, false);

        /*
         * Conventional Three.js coordinates:
         * origin bottom-left, positive Y upward.
         */
        camera.left = 0;
        camera.right = width;
        camera.bottom = 0;
        camera.top = height;

        camera.updateProjectionMatrix();
        render();
    }

    function schedule() {
        clearTimeout(timer);

        if (map.getZoom() < CFG.minZoom) {
            clear();
            return;
        }

        timer = setTimeout(selectFeature, CFG.delay);
    }

    function selectFeature() {
        if (!map.getLayer(CFG.pointLayer)) {
            return;
        }

        const container = map.getContainer();
        const width = container.clientWidth;
        const height = container.clientHeight;

        const features = map.queryRenderedFeatures(
            [
                [CFG.margin, CFG.margin],
                [
                    width - CFG.margin,
                    height - CFG.margin
                ]
            ],
            {
                layers: [CFG.pointLayer]
            }
        );

        if (!features.length) {
            return;
        }

        selected = features.reduce((best, feature) => {
            const point = map.project(
                feature.geometry.coordinates
            );

            const score =
                Math.abs(point.x - width / 2) +
                Math.abs(point.y - height / 2);

            return !best || score < best.score
                ? { feature, score }
                : best;
        }, null).feature;

        buildPanel(selected.properties || {});
    }

    function buildPanel(properties) {
        removePanel();

        const scale = uiScale();
        const width = CFG.width * scale;
        const height = CFG.height * scale;
        const textHeight = CFG.textHeight * scale;

        panel = new THREE.Group();

        panel.add(
            createFrame(width, height, textHeight)
        );

        const text = createText(
            properties,
            width * 0.9,
            textHeight * 0.82
        );

        /*
         * Text sits in the lower section.
         */
        text.position.set(
            0,
            -height / 2 + textHeight / 2,
            30
        );

        panel.add(text);

        if (modelTemplate) {
            currentModel = modelTemplate.clone(true);

            fitModel(
                currentModel,
                width,
                height - textHeight
            );

            panel.add(currentModel);
        }

        connector = createConnector();

        scene.add(connector);
        scene.add(panel);

        opacity = 0;
        targetOpacity = 1;
        pendingRemoval = false;

        setOpacity(panel, 0);
        setOpacity(connector, 0);

        render();
    }

    function createFrame(width, height, textHeight) {
        const x = width / 2;
        const y = height / 2;
        const dividerY = -y + textHeight;

        const vertices = [
            -x, -y, 0,  x, -y, 0,
             x, -y, 0,  x,  y, 0,
             x,  y, 0, -x,  y, 0,
            -x,  y, 0, -x, -y, 0,

            -x, dividerY, 0,
             x, dividerY, 0
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

    function createText(properties, width, height) {
        const canvas = document.createElement("canvas");
            canvas.width = 4096;
            canvas.height = 1536;
        const ctx = canvas.getContext("2d");

        const lines = [
            `ID: ${properties.id || "N/D"}`,
            `CONTESTO PAESAGGISTICO: ${properties.paesaggio || "N/D"}`,
            `STATO DI CONSERVAZIONE: ${properties.conservazione || "N/D"}`
        ];

        let size = CFG.fontSize*2;

        while (size > 68) {
            ctx.font =
                `500 ${size}px ${CFG.font}`;

            const widest =
                Math.max(
                    ...lines.map(
                        line =>
                            ctx.measureText(line).width
                    )
                );

            if (
                widest <=
                canvas.width * 0.88
            ) {
                break;
            }

            size -= 4;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // /*
        // * Black text-panel background at 80% opacity.
        // */
        // ctx.fillStyle = "rgba(0, 0, 0, 0.8)";

        // ctx.fillRect(
        //     0,
        //     0,
        //     canvas.width,
        //     canvas.height
        // );

        ctx.font = `500 ${size}px ${CFG.font}`;
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";

        const lineHeight = size * 1.55;
        const firstY = canvas.height / 2 - lineHeight;

        lines.forEach((line, index) => {
            ctx.fillText(
                line.toUpperCase(),
                canvas.width * 0.06,
                firstY + index * lineHeight
            );
        });

        const texture = new THREE.CanvasTexture(canvas);

        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter =
            THREE.LinearMipmapLinearFilter;

        texture.magFilter =
            THREE.LinearFilter;

        texture.generateMipmaps = true;

        texture.anisotropy =
            renderer.capabilities
                .getMaxAnisotropy();

        texture.needsUpdate = true;

        const geometry = new THREE.PlaneGeometry(
            width,
            height
        );

        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            side: THREE.FrontSide
        });

        return new THREE.Mesh(geometry, material);
    }

    function fitModel(model, width, modelHeight) {
        model.rotation.set(
            CFG.modelRotationX,
            CFG.modelRotationY,
            CFG.modelRotationZ
        );

        model.updateMatrixWorld(true);

        let box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());

        model.position.sub(center);
        model.updateMatrixWorld(true);

        box = new THREE.Box3().setFromObject(model);

        const size = box.getSize(new THREE.Vector3());

        const factor = Math.min(
            width * 0.62 / Math.max(size.x, 0.001),
            modelHeight * 0.62 / Math.max(size.y, 0.001),
            modelHeight * 0.62 / Math.max(size.z, 0.001)
        );

        model.scale.setScalar(factor);

        /*
         * Centre model in the upper section.
         */
        model.position.y =
            CFG.textHeight * uiScale() / 2;

        model.position.z = 50;
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

    function render() {
        if (!renderer) {
            return;
        }

        if (selected && panel && connector) {
            const container = map.getContainer();
            const width = container.clientWidth;
            const height = container.clientHeight;

            const projected = map.project(
                selected.geometry.coordinates
            );

            /*
             * Convert MapLibre Y-down coordinates
             * into Three.js Y-up coordinates.
             */
            const anchorX = projected.x;
            const anchorY = height - projected.y;

            const scale = uiScale();
            const halfWidth = CFG.width * scale / 2;
            const halfHeight = CFG.height * scale / 2;

            let panelX = anchorX;

            /*
             * Positive Y means visually above the point.
             */
            let panelY =
                anchorY +
                CFG.offset * scale +
                halfHeight;

            panelX = clamp(
                panelX,
                halfWidth + 12,
                width - halfWidth - 12
            );

            panelY = clamp(
                panelY,
                halfHeight + 12,
                height - halfHeight - 12
            );

            panel.position.set(
                panelX,
                panelY,
                0
            );

            /*
             * Connector begins exactly at the map point
             * and ends at the bottom edge of the panel.
             */
            const positions =
                connector.geometry.attributes.position;

            positions.setXYZ(
                0,
                anchorX,
                anchorY,
                0
            );

            positions.setXYZ(
                1,
                panelX,
                panelY - halfHeight,
                0
            );

            positions.needsUpdate = true;
        }

        renderer.render(scene, camera);
    }

    function animate() {
        requestAnimationFrame(animate);

        opacity +=
            (targetOpacity - opacity) *
            CFG.fadeSpeed;

        if (panel) {
            setOpacity(panel, opacity);
        }

        if (connector) {
            setOpacity(connector, opacity);
        }

        if (currentModel) {
            currentModel.rotation.y +=
                CFG.spinSpeed;
        }

        if (
            pendingRemoval &&
            opacity < 0.01
        ) {
            removePanel();
            selected = null;
            pendingRemoval = false;
            opacity = 0;
        }

        render();
    }


    function uiScale() {
        const container = map.getContainer();

        const viewportScale =
            Math.min(
                container.clientWidth,
                container.clientHeight
            ) / CFG.referenceSize;

        return clamp(
            viewportScale,
            CFG.minScale,
            CFG.maxScale
        );
    }

    function removePanel() {
        [panel, connector].forEach(object => {
            if (!object) {
                return;
            }

            object.traverse(child => {
                child.geometry?.dispose();
                child.material?.map?.dispose();
                child.material?.dispose();
            });

            scene?.remove(object);
        });

        panel = null;
        connector = null;
        currentModel = null;
    }

    function clear() {
        clearTimeout(timer);

        targetOpacity = 0;
        pendingRemoval = true;
    }

    function setOpacity(object, value) {
        if (!object) {
            return;
        }

        object.traverse(child => {
            if (!child.material) {
                return;
            }

            child.material.transparent = true;
            child.material.opacity = value;
        });
    }

    function clamp(value, minimum, maximum) {
        return Math.min(
            Math.max(value, minimum),
            maximum
        );
    }

    return {
        init,
        clear,
        refresh: schedule
    };
})();