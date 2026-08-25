// three-spark-gaussian3.js
//
// WHY THIS IS A DIFFERENT ARCHITECTURE THAN gaussian2.js
// ============================================================
// gaussian2.js positions an HTML <div> panel using CSS
// left/top computed from map.project(lngLat), and renders the
// splat in a small independent mini-scene inside it. That
// works well and is simple, but it has two hard limits that
// can't be patched around:
//
//   1. The panel is a flat 2D screen overlay. It has no real
//      3D orientation, so it can never behave like a physical
//      object you walk around and see from the side — it is
//      always, by construction, fully facing the screen.
//
//   2. Because the panel's position is frozen in screen-space
//      pixels (deliberately, so it doesn't jump around), the
//      connector line's start point is also frozen — but the
//      real point keeps moving on screen as the camera moves.
//      There's no way to keep the line glued to the point
//      without recomputing it every frame from the point's
//      live position, and a *literal* HTML div can't easily
//      express "flat object anchored in 3D, seen from any
//      angle" no matter how the connector line is redrawn.
//
// This version fixes both by making the card, the splat and
// the connector all genuine Three.js objects living inside the
// map's own 3D world, via a MapLibre "custom layer" whose
// render(gl, matrix) callback hands us the map's live camera
// matrix every frame (the standard MapLibre/Mapbox "add a 3D
// model" recipe). Consequences:
//
//   - The connector is a real 3D line from the ground point up
//     to the card. It is anchored at (0,0,0) in local space —
//     the point itself — so it is automatically, always,
//     exactly attached to the point. There is no "start
//     drifts away" failure mode possible, because nothing is
//     manually recomputed in screen space.
//
//   - The card's rotation is set once, from the map's bearing
//     at the moment it appears, and is never touched again.
//     Orbit the map and the card stays put in its initial
//     facing — it reads as a real flat sign hanging in space,
//     visible edge-on from the side, exactly as asked.
//
// TUNING WARNING: CFG.modelTargetDiagonalMeters, cardHeightMeters,
// panelWidthMeters/panelHeightMeters are starting guesses. I
// have no way to preview your actual building scale or camera
// distances from here — expect to nudge these once you see it
// live.

import * as THREE from "three";

import * as maplibregl from "https://unpkg.com/maplibre-gl@6.0.0/dist/maplibre-gl.mjs";

import {
    SparkRenderer,
    SplatMesh
} from "@sparkjsdev/spark";


window.ThreePointCallout = (() => {

    // =====================================================
    // CONFIG
    // =====================================================

    const CFG = {

        // -------------------------------------------------
        // GAUSSIAN PLY SOURCES
        // -------------------------------------------------

        // Maps id_scheda_originale -> actual filename inside
        // CFG.plyFolder. Only ids present here ever get a
        // panel at all — see selectFeature().
        manifestUrl:
            new URL(
                "./splats-manifest.json",
                import.meta.url
            ).href,

        plyFolder:
            "./splats/",


        // MapLibre point layer
        pointLayer:
            "points-layer",


        // Show callout from this zoom
        minZoom:
            5,

        // Only show the callout when the map is pitched
        // (tilted) past this many degrees.
        pitchThreshold:
            30,

        // How long the map must sit still before a
        // selection is committed and its .ply is loaded.
        selectionDelay:
            900,


        // -------------------------------------------------
        // 3D PLACEMENT (all in real-world metres, relative
        // to the selected point on the ground)
        // -------------------------------------------------

        // How high above the point the card floats.
        cardHeightMeters:
            14,

        panelWidthMeters:
            10,

        panelHeightMeters:
            7,

        // Every loaded splat is measured (real bounding-box
        // diagonal) and rescaled so that diagonal becomes
        // this many metres — keeps different .ply files
        // (rarely authored at the same native scale) looking
        // consistently sized regardless of source scale.
        modelTargetDiagonalMeters:
            9,

        // Extra multiplier on top of the auto-fit scale
        // above, for final fine-tuning.
        modelScale:
            1.0,

        modelX:
            0,

        modelY:
            0,

        modelZ:
            0,

        // Local flip/spin applied to the splat itself, on
        // top of the scene-wide up-axis correction.
        rotationX:
            Math.PI,

        rotationY:
            0,

        rotationZ:
            0,

        // Angular offset applied when aiming the card at the
        // camera bearing at selection time. Flip by Math.PI
        // if the card renders facing away from you.
        cardBearingOffsetRad:
            0,


        // -------------------------------------------------
        // CARD TEXTURE
        // -------------------------------------------------

        cardPixelsPerMeter:
            80,

        cardPaddingPx:
            26,

        background:
            "rgba(242,241,240,0.92)",

        border:
            "rgba(0,0,0,0.12)",

        fontFamily:
            "MSCHN",

        titleFontPx:
            56,

        titleFontWeight:
            "700",

        detailFontPx:
            26,

        detailFontWeight:
            "500",

        textColor:
            "#222222",


        // -------------------------------------------------
        // CONNECTOR — a literal 3D line, always anchored at
        // the point, never a screen-space approximation.
        // -------------------------------------------------

        connectorColor:
            "#F2F1F0",

        connectorOpacity:
            0.9
    };


    // =====================================================
    // STATE
    // =====================================================

    let map = null;

    let selected = null;

    let selectionTimer = null;

    let hasSelection = false;

    let selectionToken = 0;


    let scene = null;

    let camera = null;

    let renderer = null;

    let spark = null;

    let anchorGroup = null;

    let cardMesh = null;

    let connectorLine = null;

    let splatGroup = null;

    // Fixed per-selection transform: translates/scales the
    // whole scene so (0,0,0) in local metre-space sits
    // exactly on the selected point. Only changes when the
    // selection changes.
    let currentTransform = null;

    let fontsReadyPromise = null;


    // id_scheda_originale -> filename inside CFG.plyFolder.
    let plyManifest = new Map();


    // =====================================================
    // INIT
    // =====================================================

    async function init(
        mapInstance,
        features
    ) {

        map =
            mapInstance;


        console.log(
            "[ThreePointCallout] init"
        );


        fontsReadyPromise =
            preloadFonts();


        map.addLayer(
            createCustomLayer()
        );


        map.on(
            "moveend",
            scheduleSelection
        );


        map.on(
            "zoomend",
            scheduleSelection
        );


        map.on(
            "pitch",
            refreshVisibility
        );


        map.on(
            "pitchend",
            refreshVisibility
        );


        await loadManifest();


        scheduleSelection();
    }


    function preloadFonts() {

        if (
            !document.fonts ||
            !document.fonts.load
        ) {

            return Promise.resolve();
        }


        return Promise.all(
            [
                document.fonts.load(
                    `${CFG.titleFontWeight} ${CFG.titleFontPx}px ${CFG.fontFamily}`
                ),

                document.fonts.load(
                    `${CFG.detailFontWeight} ${CFG.detailFontPx}px ${CFG.fontFamily}`
                )
            ]
        ).catch(
            error => {

                console.warn(
                    "[ThreePointCallout] font preload failed",
                    error
                );
            }
        );
    }


    async function loadManifest() {

        try {

            const response =
                await fetch(
                    CFG.manifestUrl
                );

            if (!response.ok) {

                console.error(
                    "[ThreePointCallout] failed to load splats manifest:",
                    response.status
                );

                return;
            }


            const data =
                await response.json();


            plyManifest =
                new Map(
                    Object.entries(data)
                );


            console.log(
                "[ThreePointCallout] splats manifest loaded:",
                plyManifest.size,
                "entries"
            );

        } catch (error) {

            console.error(
                "[ThreePointCallout] failed to load splats manifest:",
                error
            );
        }
    }


    function buildPlyUrl(filename) {

        return new URL(
            `${CFG.plyFolder}${filename}`,
            import.meta.url
        ).href;
    }


    // =====================================================
    // MAPLIBRE CUSTOM 3D LAYER
    // =====================================================

    function createCustomLayer() {

        return {

            id:
                "gaussian-callout-3d-layer",

            type:
                "custom",

            renderingMode:
                "3d",

            onAdd(
                layerMap,
                gl
            ) {

                scene =
                    new THREE.Scene();


                camera =
                    new THREE.PerspectiveCamera();


                renderer =
                    new THREE.WebGLRenderer({

                        canvas:
                            layerMap.getCanvas(),

                        context:
                            gl,

                        antialias:
                            true
                    });


                renderer.autoClear =
                    false;


                spark =
                    new SparkRenderer({
                        renderer
                    });


                scene.add(
                    spark
                );


                anchorGroup =
                    new THREE.Group();


                anchorGroup.visible =
                    false;


                scene.add(
                    anchorGroup
                );


                buildConnectorLine();
            },

            render(
                gl,
                matrix
            ) {

                if (
                    !currentTransform ||
                    !anchorGroup.visible
                ) {

                    return;
                }


                const upAxisCorrection =
                    new THREE.Matrix4().makeRotationAxis(

                        new THREE.Vector3(
                            1,
                            0,
                            0
                        ),

                        Math.PI / 2
                    );


                const cameraMatrix =
                    new THREE.Matrix4().fromArray(
                        matrix
                    );


                const localTransform =
                    new THREE.Matrix4()
                        .makeTranslation(

                            currentTransform.translateX,

                            currentTransform.translateY,

                            currentTransform.translateZ
                        )
                        .scale(

                            new THREE.Vector3(

                                currentTransform.scale,

                                -currentTransform.scale,

                                currentTransform.scale
                            )
                        )
                        .multiply(
                            upAxisCorrection
                        );


                camera.projectionMatrix =
                    cameraMatrix.multiply(
                        localTransform
                    );


                renderer.resetState();


                renderer.render(
                    scene,
                    camera
                );


                map.triggerRepaint();
            }
        };
    }


    function buildConnectorLine() {

        const points = [

            new THREE.Vector3(
                0,
                0,
                0
            ),

            new THREE.Vector3(
                0,
                CFG.cardHeightMeters,
                0
            )
        ];


        const geometry =
            new THREE.BufferGeometry().setFromPoints(
                points
            );


        const material =
            new THREE.LineBasicMaterial({

                color:
                    new THREE.Color(
                        CFG.connectorColor
                    ),

                transparent:
                    true,

                opacity:
                    CFG.connectorOpacity,

                depthTest:
                    false
            });


        connectorLine =
            new THREE.Line(
                geometry,
                material
            );


        connectorLine.renderOrder =
            10;


        anchorGroup.add(
            connectorLine
        );
    }


    // =====================================================
    // SELECT FEATURE
    // =====================================================

    function scheduleSelection() {

        clearTimeout(
            selectionTimer
        );


        if (
            map.getZoom() <
            CFG.minZoom
        ) {

            hide();

            return;
        }


        selectionTimer =
            setTimeout(
                selectFeature,
                CFG.selectionDelay
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


        const features =
            map.queryRenderedFeatures(
                [
                    [
                        0,
                        0
                    ],

                    [
                        width,
                        height
                    ]
                ],
                {
                    layers: [
                        CFG.pointLayer
                    ]
                }
            );


        if (!features.length) {

            hide();

            return;
        }


        const centerX =
            width / 2;


        const centerY =
            height / 2;


        const ranked =
            features
                .filter(
                    feature =>
                        feature.geometry &&
                        feature.geometry.coordinates
                )
                .map(feature => {

                    const point =
                        map.project(
                            feature.geometry.coordinates
                        );

                    const distance =

                        Math.abs(
                            point.x -
                            centerX
                        )

                        +

                        Math.abs(
                            point.y -
                            centerY
                        );

                    return {
                        feature,
                        distance
                    };
                })
                .sort(
                    (a, b) =>
                        a.distance -
                        b.distance
                );


        // Only points with a real matching .ply get a
        // panel at all.
        const matched =
            ranked.find(
                entry =>
                    plyManifest.has(
                        getId(
                            entry.feature
                        )
                    )
            );


        if (!matched) {

            hide();

            return;
        }


        const best =
            matched.feature;

        const newId =
            getId(best);


        if (
            selected &&
            getId(selected) ===
            newId
        ) {

            return;
        }


        selected =
            best;


        console.log(
            "[ThreePointCallout] selected:",
            newId
        );


        anchorToFeature(
            best,
            plyManifest.get(
                newId
            )
        );
    }


    // =====================================================
    // ANCHOR THE SCENE TO THE SELECTED FEATURE
    // =====================================================

    async function anchorToFeature(
        feature,
        plyFilename
    ) {

        const thisSelectionToken =
            ++selectionToken;


        const [
            lng,
            lat
        ] =
            feature.geometry.coordinates;


        // Fixed the moment a point is selected — never
        // recomputed afterwards. This is what makes the
        // panel (and the point it's anchored to) hold still
        // in space regardless of camera movement.
        const mercator =
            maplibregl.MercatorCoordinate.fromLngLat(
                [
                    lng,
                    lat
                ],
                0
            );


        currentTransform = {

            translateX:
                mercator.x,

            translateY:
                mercator.y,

            translateZ:
                mercator.z,

            scale:
                mercator.meterInMercatorCoordinateUnits()
        };


        // Fixed at selection time, from the live camera
        // bearing — then never touched again. This is what
        // makes the card hold its facing as you orbit,
        // instead of billboarding toward the camera.
        const bearingRad =
            THREE.MathUtils.degToRad(
                map.getBearing()
            );


        await updateCard(
            feature,
            bearingRad
        );


        if (
            thisSelectionToken !==
            selectionToken
        ) {

            return;
        }


        applySplat(
            buildPlyUrl(
                plyFilename
            ),
            thisSelectionToken
        );


        hasSelection =
            true;


        refreshVisibility();


        map.triggerRepaint();
    }


    // =====================================================
    // PROPERTY → CARD TEXTURE
    // =====================================================

    async function updateCard(
        feature,
        bearingRad
    ) {

        if (fontsReadyPromise) {

            await fontsReadyPromise;
        }


        const texture =
            buildCardTexture(
                feature.properties ||
                {}
            );


        if (!cardMesh) {

            const geometry =
                new THREE.PlaneGeometry(
                    CFG.panelWidthMeters,
                    CFG.panelHeightMeters
                );


            const material =
                new THREE.MeshBasicMaterial(
                    {
                        map:
                            texture,

                        transparent:
                            true,

                        side:
                            THREE.DoubleSide,

                        depthWrite:
                            false
                    }
                );


            cardMesh =
                new THREE.Mesh(
                    geometry,
                    material
                );


            anchorGroup.add(
                cardMesh
            );

        } else {

            cardMesh.material.map?.dispose();

            cardMesh.material.map =
                texture;

            cardMesh.material.needsUpdate =
                true;
        }


        cardMesh.position.set(
            0,
            CFG.cardHeightMeters,
            0
        );


        cardMesh.rotation.set(
            0,
            bearingRad +
                CFG.cardBearingOffsetRad,
            0
        );
    }


    function buildCardTexture(properties) {

        const textureWidth =
            Math.round(
                CFG.panelWidthMeters *
                CFG.cardPixelsPerMeter
            );


        const textureHeight =
            Math.round(
                CFG.panelHeightMeters *
                CFG.cardPixelsPerMeter
            );


        const canvas =
            document.createElement(
                "canvas"
            );


        canvas.width =
            textureWidth;

        canvas.height =
            textureHeight;


        const ctx =
            canvas.getContext(
                "2d"
            );


        ctx.fillStyle =
            CFG.background;

        ctx.fillRect(
            0,
            0,
            textureWidth,
            textureHeight
        );


        ctx.strokeStyle =
            CFG.border;

        ctx.lineWidth =
            2;

        ctx.strokeRect(
            1,
            1,
            textureWidth - 2,
            textureHeight - 2
        );


        const padding =
            CFG.cardPaddingPx;


        // TOP LEFT — titolo, fallback tipologiaEdificio
        const title =
            properties.titolo ||
            properties.tipologiaEdificio ||
            "";


        ctx.fillStyle =
            CFG.textColor;

        ctx.textBaseline =
            "top";

        ctx.textAlign =
            "left";

        ctx.font =
            `${CFG.titleFontWeight} ${CFG.titleFontPx}px ${CFG.fontFamily}`;

        ctx.fillText(
            String(title),
            padding,
            padding,
            textureWidth * 0.55
        );


        // TOP RIGHT — regione / comune, sigla provincia
        const regione =
            properties.regione ||
            "";

        const comune =
            properties.comune ||
            "";

        const siglaProvincia =
            properties.siglaProvincia ||
            "";

        const secondLine =
            [
                comune,
                siglaProvincia
            ]
                .filter(Boolean)
                .join(", ");


        ctx.textAlign =
            "right";

        ctx.font =
            `${CFG.detailFontWeight} ${CFG.detailFontPx}px ${CFG.fontFamily}`;

        ctx.fillText(
            regione,
            textureWidth - padding,
            padding,
            textureWidth * 0.4
        );

        ctx.fillText(
            secondLine,
            textureWidth - padding,
            padding +
                CFG.detailFontPx * 1.25,
            textureWidth * 0.4
        );


        // BOTTOM LEFT — stato di conservazione
        const conservazione =
            properties.conservazione ||
            "";


        ctx.textAlign =
            "left";

        ctx.textBaseline =
            "bottom";

        ctx.fillText(
            `stato di conservazione : ${conservazione}`,
            padding,
            textureHeight - padding,
            textureWidth * 0.6
        );


        // BOTTOM RIGHT — secolo
        const periodoCronologico =
            properties.periodoCronologico ||
            "";


        ctx.textAlign =
            "right";

        ctx.fillText(
            `secolo ${periodoCronologico}`,
            textureWidth - padding,
            textureHeight - padding,
            textureWidth * 0.35
        );


        const texture =
            new THREE.CanvasTexture(
                canvas
            );


        texture.needsUpdate =
            true;

        texture.colorSpace =
            THREE.SRGBColorSpace;


        return texture;
    }


    // =====================================================
    // SPLAT (auto-fit, per-feature, from manifest)
    // =====================================================

    function applySplat(
        url,
        thisSelectionToken
    ) {

        const previousGroup =
            splatGroup;


        const group =
            new THREE.Group();


        group.rotation.set(

            CFG.rotationX,

            CFG.rotationY,

            CFG.rotationZ
        );


        const mesh =
            new SplatMesh({

                url,

                lod:
                    true,

                onLoad(loadedMesh) {

                    // A newer selection has taken over —
                    // drop this one instead of fitting it.
                    if (
                        thisSelectionToken !==
                        selectionToken
                    ) {

                        loadedMesh.dispose?.();

                        return;
                    }


                    fitMeshInGroup(
                        loadedMesh,
                        group
                    );
                }
            });


        group.add(
            mesh
        );


        group.userData.mesh =
            mesh;


        group.position.set(

            CFG.modelX,

            CFG.modelY,

            CFG.modelZ
        );


        anchorGroup.add(
            group
        );


        splatGroup =
            group;


        console.log(
            "[ThreePointCallout] Gaussian loading:",
            url
        );


        if (previousGroup) {

            anchorGroup.remove(
                previousGroup
            );


            previousGroup.userData.mesh?.dispose?.();
        }
    }


    function fitMeshInGroup(
        mesh,
        group
    ) {

        let box;

        try {

            box =
                mesh.getBoundingBox();

        } catch (error) {

            return;
        }


        const size =
            box.getSize(
                new THREE.Vector3()
            );

        const center =
            box.getCenter(
                new THREE.Vector3()
            );

        const diagonal =
            size.length();


        const fitScale =
            diagonal > 1e-6
                ? CFG.modelTargetDiagonalMeters /
                  diagonal
                : 1;


        mesh.position
            .copy(center)
            .multiplyScalar(-1);


        group.scale.setScalar(
            fitScale *
            CFG.modelScale
        );
    }


    // =====================================================
    // SHOW / HIDE / VISIBILITY
    // =====================================================

    function hide() {

        selected =
            null;

        hasSelection =
            false;


        refreshVisibility();
    }


    function isPitchOk() {

        return (
            map.getPitch() >
            CFG.pitchThreshold
        );
    }


    function refreshVisibility() {

        if (!anchorGroup) {

            return;
        }


        anchorGroup.visible =
            hasSelection &&
            isPitchOk();


        if (map) {

            map.triggerRepaint();
        }
    }


    // =====================================================
    // PUBLIC
    // =====================================================

    function clear() {

        hide();
    }


    function refresh() {

        scheduleSelection();
    }


    // =====================================================
    // HELPERS
    // =====================================================

    function getId(feature) {

        return String(

            feature.properties?.id ??

            feature.id ??

            feature.geometry
                .coordinates
                .join(",")

        );
    }


    return {

        init,

        clear,

        refresh
    };

})();
