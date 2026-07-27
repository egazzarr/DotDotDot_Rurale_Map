import * as THREE from "three";

window.ThreePointCallout = (() => {
    const CFG = {
        pointLayer: "points-layer",

        manifestUrl:
            new URL(
                "png-manifest.json",
                import.meta.url
            ).href,

        imageFolder:
            new URL(
                "../3.dati_schede/3.output_images_vintage/",
                import.meta.url
            ).href,

        minZoom: 8,
        delay: 500,
        margin: 70,

        referenceSize: 1440,
        minScale: 0.55,
        maxScale: 1.5,

        width: 780,
        height: 570,
        textHeight: 150,
        offset: 110,

        font: '"MSCHN", sans-serif',
        fontSize: 100,
        color: 0xffffff,

        fadeSpeed: 0.04
    };

    let map;
    let renderer;
    let scene;
    let camera;

    let panel;
    let connector;
    let selected;
    let timer;

    let opacity = 0;
    let targetOpacity = 0;
    let pendingRemoval = false;

    let availableIds = new Set();
    let previousId = null;

    const textureLoader =
        new THREE.TextureLoader();

    const textureCache =
        new Map();


    async function init(
        mapInstance,
        features
    ) {
        map = mapInstance;

        if (!map || !features?.length) {
            console.error(
                "ThreePointCallout: map or features missing."
            );

            return;
        }

        try {
            const response =
                await fetch(
                    CFG.manifestUrl,
                    {
                        cache: "no-store"
                    }
                );

            if (!response.ok) {
                throw new Error(
                    `Manifest HTTP ${response.status}`
                );
            }

            const ids =
                await response.json();

            availableIds =
                new Set(
                    ids.map(
                        id =>
                            String(id).trim()
                    )
                );

            console.log(
                "PNG IDs available:",
                availableIds.size
            );
        } catch (error) {
            console.error(
                "Cannot load PNG manifest:",
                error
            );

            return;
        }

        createRenderer();

        map.on("move", render);
        map.on("moveend", schedule);
        map.on("resize", resize);

        document.fonts?.ready.then(
            schedule
        );

        resize();
        schedule();
        animate();
    }


    function createRenderer() {
        const canvas =
            document.createElement("canvas");

        Object.assign(
            canvas.style,
            {
                position: "absolute",
                inset: "0",
                width: "100%",
                height: "100%",
                zIndex: "5",
                pointerEvents: "none"
            }
        );

        map.getContainer()
            .appendChild(canvas);

        renderer =
            new THREE.WebGLRenderer({
                canvas,
                alpha: true,
                antialias: true
            });

        renderer.setPixelRatio(
            Math.min(
                window.devicePixelRatio,
                2
            )
        );

        renderer.setClearColor(
            0x000000,
            0
        );

        scene =
            new THREE.Scene();

        camera =
            new THREE.OrthographicCamera(
                0,
                1,
                1,
                0,
                0.1,
                2000
            );

        camera.position.z = 1000;
    }


    function resize() {
        const container =
            map.getContainer();

        const width =
            container.clientWidth;

        const height =
            container.clientHeight;

        renderer.setSize(
            width,
            height,
            false
        );

        camera.left = 0;
        camera.right = width;
        camera.bottom = 0;
        camera.top = height;

        camera.updateProjectionMatrix();

        render();
    }


    function schedule() {
        clearTimeout(timer);

        if (
            map.getZoom() <
            CFG.minZoom
        ) {
            clear();
            return;
        }

        timer = setTimeout(
            selectFeature,
            CFG.delay
        );
    }

    function hasRoomAbove(feature) {
        const container = map.getContainer();
        const screen = map.project(
            feature.geometry.coordinates
        );

        const scale = uiScale();
        const panelHeight = CFG.height * scale;
        const gap = CFG.offset * scale;
        const viewportPadding = 12;

        /*
        * Map coordinates use Y-down. The distance from
        * the point to the top of the viewport is screen.y.
        */
        return (
            screen.y >=
            panelHeight + gap + viewportPadding
        );
    }

    function selectFeature() {
        if (
            !map.getLayer(
                CFG.pointLayer
            )
        ) {
            return;
        }

        const container =
            map.getContainer();

        const width =
            container.clientWidth;

        const height =
            container.clientHeight;

        const visible =
            map.queryRenderedFeatures(
                [
                    [
                        CFG.margin,
                        CFG.margin
                    ],
                    [
                        width -
                            CFG.margin,

                        height -
                            CFG.margin
                    ]
                ],
                {
                    layers: [
                        CFG.pointLayer
                    ]
                }
            );

        /*
         * Keep only points whose IDs have PNGs.
         */
        const valid =
            visible.filter(
                feature =>
                    availableIds.has(
                        getId(feature)
                    ) &&
                    hasRoomAbove(feature)
            );

        if (!valid.length) {
            clear();
            return;
        }
        

        /*
         * Avoid selecting the same point twice
         * when alternatives are available.
         */
        const alternatives =
            valid.filter(
                feature =>
                    getId(feature) !==
                    previousId
            );

        const pool =
            alternatives.length
                ? alternatives
                : valid;

        selected =
            pool[
                Math.floor(
                    Math.random() *
                    pool.length
                )
            ];

        previousId =
            getId(selected);

        buildPanel(
            selected.properties || {}
        );
    }


    async function buildPanel(
        properties
    ) {
        removePanel();

        const id =
            String(
                properties.id || ""
            ).trim();

        if (
            !id ||
            !availableIds.has(id)
        ) {
            return;
        }

        const scale =
            uiScale();

        const width =
            CFG.width * scale;

        const height =
            CFG.height * scale;

        const textHeight =
            CFG.textHeight * scale;

        panel =
            new THREE.Group();

        panel.add(
            createFrame(
                width,
                height,
                textHeight
            )
        );

        const text =
            createText(
                properties,
                width * 0.9,
                textHeight * 0.82
            );

        text.position.set(
            0,
            -height / 2 +
                textHeight / 2,
            30
        );

        panel.add(text);

        /*
         * Load the PNG associated with this ID.
         */
        try {
            const texture =
                await loadTexture(id);

            /*
             * The selected point may have changed
             * while the image was loading.
             */
            if (
                !panel ||
                !selected ||
                getId(selected) !== id
            ) {
                return;
            }

            const image =
                createImage(
                    texture,
                    width,
                    height - textHeight,
                    textHeight
                );

            panel.add(image);

        } catch (error) {
            console.error(
                `Cannot load PNG for ${id}:`,
                error
            );
        }

        connector =
            createConnector();

        scene.add(
            connector,
            panel
        );

        opacity = 0;
        targetOpacity = 1;
        pendingRemoval = false;

        setOpacity(panel, 0);
        setOpacity(connector, 0);

        render();
    }


    function loadTexture(id) {
        if (
            textureCache.has(id)
        ) {
            return Promise.resolve(
                textureCache.get(id)
            );
        }

        const url =
            `${CFG.imageFolder}` +
            `${encodeURIComponent(id)}.jpg`;

        return new Promise(
            (resolve, reject) => {
                textureLoader.load(
                    url,

                    texture => {
                        texture.colorSpace =
                            THREE.SRGBColorSpace;

                        texture.minFilter =
                            THREE.LinearMipmapLinearFilter;

                        texture.magFilter =
                            THREE.LinearFilter;

                        texture.generateMipmaps =
                            true;

                        texture.anisotropy =
                            renderer
                                .capabilities
                                .getMaxAnisotropy();

                        textureCache.set(
                            id,
                            texture
                        );

                        resolve(texture);
                    },

                    undefined,

                    reject
                );
            }
        );
    }


    function createImage(
        texture,
        panelWidth,
        imageAreaHeight,
        textHeight
    ) {
        const image =
            texture.image;

        const imageRatio =
            image.width /
            image.height;

        const maximumWidth =
            panelWidth * 0.8;

        const maximumHeight =
            imageAreaHeight * 0.8;

        let width =
            maximumWidth;

        let height =
            width / imageRatio;

        if (
            height >
            maximumHeight
        ) {
            height =
                maximumHeight;

            width =
                height *
                imageRatio;
        }

        const material =
            new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                depthTest: false,
                depthWrite: false
            });

        const mesh =
            new THREE.Mesh(
                new THREE.PlaneGeometry(
                    width,
                    height
                ),
                material
            );

        /*
         * Centre it inside the upper section.
         */
        mesh.position.set(
            0,
            textHeight / 2,
            20
        );

        return mesh;
    }


    function createFrame(
        width,
        height,
        textHeight
    ) {
        const x =
            width / 2;

        const y =
            height / 2;

        const divider =
            -y + textHeight;

        const vertices = [
            -x, -y, 0, x, -y, 0,
             x, -y, 0, x,  y, 0,
             x,  y, 0, -x, y, 0,
            -x,  y, 0, -x, -y, 0,

            -x, divider, 0,
             x, divider, 0
        ];

        const geometry =
            new THREE.BufferGeometry();

        geometry.setAttribute(
            "position",
            new THREE
                .Float32BufferAttribute(
                    vertices,
                    3
                )
        );

        return new THREE.LineSegments(
            geometry,

            new THREE.LineBasicMaterial({
                color: CFG.color,
                depthTest: false
            })
        );
    }


    function createText(
        properties,
        width,
        height
    ) {
        const canvas =
            document.createElement(
                "canvas"
            );

        canvas.width = 4096;
        canvas.height = 1536;

        const context =
            canvas.getContext("2d");

        const lines = [
            `ID: ${
                properties.id || "N/D"
            }`,

            `CONTESTO PAESAGGISTICO: ${
                properties.paesaggio ||
                "N/D"
            }`,

            `STATO DI CONSERVAZIONE: ${
                properties.conservazione ||
                "N/D"
            }`
        ];

        let size =
            CFG.fontSize * 2;

        while (size > 68) {
            context.font =
                `500 ${size}px ` +
                `${CFG.font}`;

            const widest =
                Math.max(
                    ...lines.map(
                        line =>
                            context
                                .measureText(line)
                                .width
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

        context.clearRect(
            0,
            0,
            canvas.width,
            canvas.height
        );

        // context.fillStyle =
        //     "rgba(0, 0, 0, 0.8)";

        // context.fillRect(
        //     0,
        //     0,
        //     canvas.width,
        //     canvas.height
        // );

        context.font =
            `500 ${size}px ` +
            `${CFG.font}`;

        context.fillStyle =
            "#ffffff";

        context.textAlign =
            "left";

        context.textBaseline =
            "middle";

        const lineHeight =
            size * 1.55;

        const firstY =
            canvas.height / 2 -
            lineHeight;

        lines.forEach(
            (line, index) => {
                context.fillText(
                    line.toUpperCase(),
                    canvas.width * 0.06,
                    firstY +
                        index *
                        lineHeight
                );
            }
        );

        const texture =
            new THREE.CanvasTexture(
                canvas
            );

        texture.colorSpace =
            THREE.SRGBColorSpace;

        texture.minFilter =
            THREE.LinearMipmapLinearFilter;

        texture.magFilter =
            THREE.LinearFilter;

        texture.generateMipmaps =
            true;

        texture.anisotropy =
            renderer
                .capabilities
                .getMaxAnisotropy();

        return new THREE.Mesh(
            new THREE.PlaneGeometry(
                width,
                height
            ),

            new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                depthTest: false,
                depthWrite: false
            })
        );
    }


    function createConnector() {
        const geometry =
            new THREE.BufferGeometry();

        geometry.setAttribute(
            "position",
            new THREE
                .Float32BufferAttribute(
                    [
                        0, 0, 0,
                        0, 0, 0
                    ],
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

        if (
            selected &&
            panel &&
            connector
        ) {
            const container =
                map.getContainer();

            const screen =
                map.project(
                    selected
                        .geometry
                        .coordinates
                );

            const width =
                container.clientWidth;

            const height =
                container.clientHeight;

            const anchorX =
                screen.x;

            const anchorY =
                height -
                screen.y;

            const scale =
                uiScale();

            const halfWidth =
                CFG.width *
                scale / 2;

            const halfHeight =
                CFG.height *
                scale / 2;

            const panelX =
                clamp(
                    anchorX,
                    halfWidth + 12,
                    width -
                        halfWidth -
                        12
                );

            const gap =
                CFG.offset * scale;

            const panelBottom =
                anchorY + gap;

            const panelY =
                panelBottom + halfHeight;

            panel.position.set(
                panelX,
                panelY,
                0
            );

            const positions =
                connector
                    .geometry
                    .attributes
                    .position;

            positions.setXYZ(
                0,
                anchorX,
                anchorY,
                0
            );

            positions.setXYZ(
                1,
                panelX,
                panelY -
                    halfHeight,
                0
            );

            positions.needsUpdate =
                true;
        }

        renderer.render(
            scene,
            camera
        );
    }


    function animate() {
        requestAnimationFrame(
            animate
        );

        opacity +=
            (
                targetOpacity -
                opacity
            ) *
            CFG.fadeSpeed;

        setOpacity(
            panel,
            opacity
        );

        setOpacity(
            connector,
            opacity
        );

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
        const container =
            map.getContainer();

        return clamp(
            Math.min(
                container.clientWidth,
                container.clientHeight
            ) /
            CFG.referenceSize,

            CFG.minScale,
            CFG.maxScale
        );
    }


    function clear() {
        clearTimeout(timer);

        targetOpacity = 0;
        pendingRemoval = true;
    }


    function removePanel() {
        [
            panel,
            connector
        ].forEach(object => {
            if (!object) {
                return;
            }

            object.traverse(
                child => {
                    child.geometry
                        ?.dispose();

                    /*
                     * Do not dispose cached PNG textures.
                     * Canvas text textures can be disposed.
                     */
                    if (
                        child.material?.map &&
                        ![
                            ...textureCache.values()
                        ].includes(
                            child.material.map
                        )
                    ) {
                        child.material
                            .map
                            .dispose();
                    }

                    child.material
                        ?.dispose();
                }
            );

            scene?.remove(object);
        });

        panel = null;
        connector = null;
    }


    function setOpacity(
        object,
        value
    ) {
        if (!object) {
            return;
        }

        object.traverse(
            child => {
                if (!child.material) {
                    return;
                }

                child.material.transparent =
                    true;

                child.material.opacity =
                    value;
            }
        );
    }


    function getId(feature) {
        return String(
            feature.properties?.id ??
            feature.id ??
            ""
        ).trim();
    }


    function clamp(
        value,
        minimum,
        maximum
    ) {
        return Math.min(
            Math.max(
                value,
                minimum
            ),
            maximum
        );
    }


    return {
        init,
        clear,
        refresh: schedule
    };
})();