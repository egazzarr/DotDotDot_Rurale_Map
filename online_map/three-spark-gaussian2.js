// three-spark-gaussian2.js
//
// The Gaussian-splat (.ply) is rendered in its own small,
// self-contained three.js scene (its own canvas, camera and
// renderer, embedded inside the HTML panel) — the approach
// that has reliably worked in the past, as opposed to trying
// to embed the splat directly into the map's own 3D world.
//
// Gaussian-splat .ply files coming out of a typical training
// pipeline are usually normalized to a small, arbitrary local
// scale (not real-world metres), and that scale varies from
// file to file. So every splat is auto-fit on load: its real
// bounding box is measured, then it's centred and scaled to a
// consistent target size (CFG.targetDiagonal) inside the
// viewer, regardless of whatever scale it was authored at.
//
// The panel itself is placed once, the moment it appears, and
// then left alone — it does not re-track the map on every pan
// or rotate. If the point it belongs to ends up off-screen or
// under the camera as the user keeps navigating, the panel is
// simply left behind (and will disappear on its own once the
// pitch/zoom/selection conditions below stop being met), rather
// than jumping around trying to keep up. The splat inside it
// gets a slow, continuous left-right pan so it still reads as
// a 3D object without needing the user to move anything.
//
// Every visible point now gets a panel, whether or not it has
// a real matching .ply: resolvePlyUrl() falls back to one of
// CFG.placeholderPlyUrls (sharp_casolare7 / sharp_casolare8)
// whenever the manifest has no entry for that id — including
// the whole-manifest-empty case, e.g. ./splats/ being missing,
// unreachable, or empty. Which placeholder a given point gets
// is picked deterministically from its id, so the same
// building always shows the same stand-in model rather than a
// different random one every time it's reselected.

import * as THREE from "three";

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
        // CFG.plyFolder (real splat filenames carry an export
        // timestamp, e.g. "<id>_<timestamp>.ply", so they
        // can't be probed directly from the id alone). Built
        // by scanning splats/ — see the sibling script/README
        // if this ever needs regenerating.
        manifestUrl:
            new URL(
                "./splats-manifest.json",
                import.meta.url
            ).href,

        // Folder holding the files named in the manifest.
        plyFolder:
            "./splats/",

        // Fallback models used whenever a point has no
        // matching entry in the manifest (including when
        // ./splats/ is empty, missing, or the manifest
        // fails to load — plyManifest just ends up empty
        // and every point falls back to one of these). One
        // is picked per feature id, deterministically (so
        // the same building always shows the same
        // placeholder instead of flickering between the two
        // on reselect) — see pickPlaceholderPlyUrl().
        placeholderPlyUrls:
            [
                new URL(
                    "./sharp_casolare7.ply",
                    import.meta.url
                ).href,

                new URL(
                    "./sharp_casolare8.ply",
                    import.meta.url
                ).href
            ],


        // MapLibre point layer
        pointLayer:
            "points-layer",


        // Show callout from this zoom
        minZoom:
            9,

        // Only show the callout when the map is pitched
        // (tilted) past this many degrees.
        pitchThreshold:
            30,


        // How long the map must sit still (after the last
        // moveend/zoomend) before a selection is committed
        // and its .ply is loaded. Each of these files is a
        // multi-second load + LOD build, so this needs to be
        // long enough that a still-moving map (panning past
        // several candidate points) doesn't trigger a fresh
        // load for every intermediate point along the way.
        selectionDelay:
            900,


        // -------------------------------------------------
        // PANEL SIZE
        // -------------------------------------------------

        panelWidth:
            460,

        panelHeight:
            370,

        panelPadding:
            18,


        // Minimum distance from viewport edge (safety
        // clamp, on top of the grid-cell placement below).
        panelMargin:
            20,


        // -------------------------------------------------
        // PLACEMENT GRID
        // -------------------------------------------------
        //
        // The viewport is divided into a fixed grid. The
        // panel is placed centred inside one grid cell —
        // never on top of the point itself — chosen once
        // when the panel appears, and then left alone.

        gridColumns:
            6,

        gridRows:
            4,

        // Empty gutter kept clear inside a cell around
        // the panel.
        cellPadding:
            40,


        // -------------------------------------------------
        // GAUSSIAN — mini 3D viewer inside the panel
        // -------------------------------------------------

        // Distance of the viewer's camera from the origin.
        // The camera itself is static — it never moves.
        viewerDistance:
            4,

        // Viewer camera vertical field of view, in degrees.
        viewerFov:
            55,

        // Every loaded splat is measured (real bounding-box
        // diagonal) and rescaled so that diagonal becomes
        // this many scene units — keeps different .ply files
        // (which are rarely authored at the same native
        // scale) looking consistently sized in the viewer.
        targetDiagonal:
            1.6,

        // Extra multiplier applied on top of the auto-fit
        // scale above, for final fine-tuning.
        modelScale:
            1.0,

        rotationX:
            Math.PI,

        rotationY:
            0,

        rotationZ:
            0,

        // -------------------------------------------------
        // CONTINUOUS LEFT-RIGHT PAN
        // -------------------------------------------------
        //
        // Instead of a one-directional spin, the splat gently
        // rocks back and forth around its base rotationY, so
        // it reads as 3D without needing any user input.

        // How far (degrees) it swings to each side of centre.
        panAmplitudeDeg:
            18,

        // Radians per second of the underlying oscillation —
        // higher is faster. A full left-right-left cycle
        // takes roughly (2*PI / panSpeed) seconds.
        panSpeed:
            0.6,


        // Source .ply files run into the hundreds of
        // thousands of splats each — far more detail than a
        // small preview panel needs. Level-of-detail is
        // enabled (per SplatMesh, plus a low global budget
        // on the SparkRenderer) so only the fraction visible
        // at this panel's actual on-screen size gets drawn.
        lodSplatBudget:
            120000,


        // -------------------------------------------------
        // PANEL
        // -------------------------------------------------

        background:
            "rgba(242,241,240,0.8)",

        border:
            "1px solid rgba(0,0,0,0.12)",

        shadow:
            "0 8px 28px rgba(0,0,0,0.14)",


        // -------------------------------------------------
        // CONNECTOR
        // -------------------------------------------------
        //
        // A single strictly horizontal or vertical line —
        // never a diagonal — see updatePosition().

        connectorColor:
            "#F2F1F0",

        connectorThickness:
            2,


        // -------------------------------------------------
        // TEXT
        // -------------------------------------------------

        fontFamily:
            "\"MSCHN\", sans-serif",

        titleFontSize:
            "20px",

        titleFontWeight:
            "700", // MSCHN "L" cut

        detailFontSize:
            "12px",

        detailFontWeight:
            "500", // MSCHN "M" cut

        bottomFontSize:
            "15px",

        bottomFontWeight:
            "500", // MSCHN "M" cut

        textColor:
            "#222"
    };


    // =====================================================
    // STATE
    // =====================================================

    let map = null;

    let selected = null;

    let selectionTimer = null;

    let hasSelection = false;


    let panel = null;

    let canvas = null;

    // The connector is a single strictly horizontal or
    // vertical segment — see updatePosition().
    let connector = null;


    let renderer = null;

    let scene = null;

    let camera = null;

    let spark = null;

    // Holds a THREE.Group wrapping the current SplatMesh —
    // the group carries the base rotation + auto-fit scale,
    // the mesh inside it carries the recentring offset.
    let splat = null;

    let currentSplatUrl = null;

    // Bumped on every applySplat() call. A load whose
    // generation no longer matches by the time it finishes
    // has been superseded by a newer selection — its result
    // is discarded instead of being fit/added, so it stops
    // competing for CPU with whatever the user has actually
    // settled on.
    let splatGeneration = 0;


    // id_scheda_originale -> filename inside CFG.plyFolder,
    // loaded once from CFG.manifestUrl. Ids not present here
    // still get a panel — just with a placeholder model
    // instead of a real one, see resolvePlyUrl().
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


        createPanel();


        createThree();


        // Note: deliberately no "move" listener here — the
        // panel is positioned once (in show(), via
        // updatePosition()) and then left where it is. See
        // the file header for why.

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


        map.on(
            "resize",
            resize
        );


        resize();


        await loadManifest();


        scheduleSelection();


        animate();
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


    // =====================================================
    // HTML PANEL
    // =====================================================

    function createPanel() {

        const container =
            map.getContainer();


        // -------------------------------------------------
        // PANEL
        // -------------------------------------------------

        panel =
            document.createElement(
                "div"
            );


        panel.className =
            "gaussian-callout";


        Object.assign(
            panel.style,
            {
                position:
                    "absolute",

                width:
                    `${CFG.panelWidth}px`,

                height:
                    `${CFG.panelHeight}px`,

                left:
                    "0px",

                top:
                    "0px",

                display:
                    "none",

                zIndex:
                    "50",

                boxSizing:
                    "border-box",

                background:
                    CFG.background,

                border:
                    CFG.border,

                boxShadow:
                    CFG.shadow,

                borderRadius:
                    "0",

                overflow:
                    "hidden",

                pointerEvents:
                    "none"
            }
        );


        // -------------------------------------------------
        // TEXT HELPERS
        // -------------------------------------------------

        const makeTextBlock =
            (
                verticalSide,
                horizontalSide,
                { fontSize, fontWeight }
            ) => {

                const el =
                    document.createElement(
                        "div"
                    );

                Object.assign(
                    el.style,
                    {
                        position:
                            "absolute",

                        [verticalSide]:
                            `${CFG.panelPadding}px`,

                        [horizontalSide]:
                            `${CFG.panelPadding}px`,

                        maxWidth:
                            `calc(50% - ${CFG.panelPadding * 1.5}px)`,

                        zIndex:
                            "10",

                        fontFamily:
                            CFG.fontFamily,

                        fontSize,

                        fontWeight,

                        lineHeight:
                            "1.25",

                        color:
                            CFG.textColor,

                        textAlign:
                            horizontalSide === "left"
                                ? "left"
                                : "right"
                    }
                );

                panel.appendChild(
                    el
                );

                return el;
            };


        // -------------------------------------------------
        // TOP LEFT — titolo / tipologiaEdificio
        // -------------------------------------------------

        const titleEl =
            makeTextBlock(
                "top",
                "left",
                {
                    fontSize:
                        CFG.titleFontSize,

                    fontWeight:
                        CFG.titleFontWeight
                }
            );


        // -------------------------------------------------
        // TOP RIGHT — regione / comune, sigla
        // -------------------------------------------------

        const topRightEl =
            makeTextBlock(
                "top",
                "right",
                {
                    fontSize:
                        CFG.detailFontSize,

                    fontWeight:
                        CFG.detailFontWeight
                }
            );


        // -------------------------------------------------
        // BOTTOM LEFT — stato di conservazione
        // -------------------------------------------------

        const bottomLeftEl =
            makeTextBlock(
                "bottom",
                "left",
                {
                    fontSize:
                        CFG.bottomFontSize,

                    fontWeight:
                        CFG.bottomFontWeight
                }
            );


        // -------------------------------------------------
        // BOTTOM RIGHT — secolo
        // -------------------------------------------------

        const bottomRightEl =
            makeTextBlock(
                "bottom",
                "right",
                {
                    fontSize:
                        CFG.bottomFontSize,

                    fontWeight:
                        CFG.bottomFontWeight
                }
            );


        // -------------------------------------------------
        // THREE CANVAS (fills the panel, behind the text)
        // -------------------------------------------------

        canvas =
            document.createElement(
                "canvas"
            );


        Object.assign(
            canvas.style,
            {
                position:
                    "absolute",

                left:
                    "0",

                top:
                    "0",

                width:
                    "100%",

                height:
                    "100%",

                zIndex:
                    "1",

                pointerEvents:
                    "none"
            }
        );


        panel.appendChild(
            canvas
        );


        container.appendChild(
            panel
        );


        // Store references
        panel._titleEl =
            titleEl;

        panel._topRightEl =
            topRightEl;

        panel._bottomLeftEl =
            bottomLeftEl;

        panel._bottomRightEl =
            bottomRightEl;


        // -------------------------------------------------
        // CONNECTOR (a single plain axis-aligned rectangle
        // — no rotation needed, since it's always drawn
        // strictly horizontal or strictly vertical)
        // -------------------------------------------------

        connector =
            document.createElement(
                "div"
            );


        Object.assign(
            connector.style,
            {
                position:
                    "absolute",

                background:
                    CFG.connectorColor,

                // Above the panel (zIndex 50) so it is
                // never covered at the point where it meets
                // the panel's border.
                zIndex:
                    "51",

                display:
                    "none",

                pointerEvents:
                    "none"
            }
        );


        container.appendChild(
            connector
        );
    }


    // =====================================================
    // THREE + SPARK
    // =====================================================

    function createThree() {

        renderer =
            new THREE.WebGLRenderer({

                canvas,

                alpha:
                    true,

                antialias:
                    false,

                depth:
                    true
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
            new THREE.PerspectiveCamera(

                CFG.viewerFov,

                CFG.panelWidth /
                CFG.panelHeight,

                0.01,

                1000
            );


        camera.position.set(
            0,
            0,
            CFG.viewerDistance
        );


        camera.lookAt(
            0,
            0,
            0
        );


        spark =
            new SparkRenderer({
                renderer
            });


        spark.lodSplatCount =
            CFG.lodSplatBudget;


        scene.add(
            spark
        );

        // No placeholder — nothing is loaded until a
        // feature with a real manifest match is selected.
    }


    // Builds a Group holding one SplatMesh loaded from
    // `url`. The group carries the fixed base rotation; once
    // the mesh finishes loading, `fitMeshInGroup` measures
    // its real bounding box and centres + scales it inside
    // the group so it appears at a consistent size no matter
    // what native scale the source .ply was authored at.
    function createSplatGroup(url, generation) {

        const group =
            new THREE.Group();


        group.rotation.set(

            CFG.rotationX,

            CFG.rotationY,

            CFG.rotationZ
        );


        // Base yaw the left-right pan oscillates around —
        // captured once so the pan has a stable centre even
        // though rotation.y itself is overwritten every frame.
        group.userData.baseRotationY =
            CFG.rotationY;


        const mesh =
            new SplatMesh({

                url,

                lod:
                    true,

                onLoad(loadedMesh) {

                    // A newer selection has already taken
                    // over — drop this one instead of fitting
                    // and keeping it alive in the background.
                    if (
                        generation !==
                        splatGeneration
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


        return group;
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
                ? CFG.targetDiagonal / diagonal
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
    // RESIZE
    // =====================================================

    function resize() {

        if (!renderer) {
            return;
        }


        renderer.setSize(

            CFG.panelWidth,

            CFG.panelHeight,

            false
        );


        camera.aspect =
            CFG.panelWidth /
            CFG.panelHeight;


        camera.updateProjectionMatrix();
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
                        CFG.panelMargin,
                        CFG.panelMargin
                    ],

                    [
                        width -
                        CFG.panelMargin,

                        height -
                        CFG.panelMargin
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


        // -------------------------------------------------
        // Rank visible features by distance to map centre
        // -------------------------------------------------

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


        if (!ranked.length) {

            hide();

            return;
        }


        // -------------------------------------------------
        // Every visible point gets a panel now — the
        // closest one to centre, manifest match or not.
        // resolvePlyUrl() below falls back to a placeholder
        // when there's no real match (including the whole-
        // manifest-empty case, e.g. ./splats/ missing).
        // -------------------------------------------------

        const best =
            ranked[0].feature;

        const newId =
            getId(best);


        if (
            selected &&
            getId(selected) ===
            newId
        ) {

            // Same point still selected — leave the panel
            // exactly where it already is.
            return;
        }


        selected =
            best;


        console.log(
            "[ThreePointCallout] selected:",
            newId
        );


        updateContent();


        show();


        applySplat(
            resolvePlyUrl(
                best
            )
        );
    }


    function buildPlyUrl(filename) {

        return new URL(
            `${CFG.plyFolder}${filename}`,
            import.meta.url
        ).href;
    }


    // Returns the real .ply URL for `feature` if the
    // manifest has one, otherwise a placeholder chosen
    // deterministically from CFG.placeholderPlyUrls so the
    // same feature always gets the same placeholder rather
    // than a different random one on every reselect.
    function resolvePlyUrl(feature) {

        const id =
            getId(feature);


        if (
            plyManifest.has(id)
        ) {

            return buildPlyUrl(
                plyManifest.get(
                    id
                )
            );
        }


        return pickPlaceholderPlyUrl(
            id
        );
    }


    function pickPlaceholderPlyUrl(id) {

        const urls =
            CFG.placeholderPlyUrls;


        if (!urls.length) {

            return null;
        }


        let hash =
            0;


        for (
            let i = 0;
            i < id.length;
            i++
        ) {

            hash =
                (
                    hash * 31 +
                    id.charCodeAt(i)
                ) | 0;
        }


        const index =
            Math.abs(
                hash
            ) %
            urls.length;


        return urls[
            index
        ];
    }


    // =====================================================
    // PROPERTY → TEXT
    // =====================================================

    function updateContent() {

        if (
            !selected ||
            !panel
        ) {
            return;
        }


        const properties =
            selected.properties ||
            {};


        // -------------------------------------------------
        // TOP LEFT — titolo, fallback tipologiaEdificio
        // -------------------------------------------------

        const title =
            properties.titolo ||
            properties.tipologiaEdificio ||
            "";


        panel._titleEl.textContent =
            String(title);


        // -------------------------------------------------
        // TOP RIGHT — regione / comune, sigla provincia
        // -------------------------------------------------

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

        panel._topRightEl.innerHTML =
            [
                escapeHtml(regione),
                escapeHtml(secondLine)
            ]
                .filter(Boolean)
                .join("<br>");


        // -------------------------------------------------
        // BOTTOM LEFT — stato di conservazione
        // -------------------------------------------------

        const conservazione =
            properties.conservazione ||
            "";

        panel._bottomLeftEl.textContent =
            `stato di conservazione : ${conservazione}`;


        // -------------------------------------------------
        // BOTTOM RIGHT — secolo
        // -------------------------------------------------

        const periodoCronologico =
            properties.periodoCronologico ||
            "";

        panel._bottomRightEl.textContent =
            `secolo ${periodoCronologico}`;
    }


    function escapeHtml(value) {

        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }


    function applySplat(resolvedUrl) {

        if (!resolvedUrl) {

            console.warn(
                "[ThreePointCallout] no ply URL resolved (manifest miss and no placeholders configured) — skipping splat"
            );

            return;
        }


        if (
            resolvedUrl ===
            currentSplatUrl
        ) {

            return;
        }


        const previousSplat =
            splat;


        const generation =
            ++splatGeneration;


        const nextSplat =
            createSplatGroup(
                resolvedUrl,
                generation
            );


        scene.add(
            nextSplat
        );


        splat =
            nextSplat;


        currentSplatUrl =
            resolvedUrl;


        console.log(
            "[ThreePointCallout] Gaussian loaded:",
            resolvedUrl
        );


        if (previousSplat) {

            scene.remove(
                previousSplat
            );


            previousSplat.userData.mesh?.dispose?.();
        }
    }


    // =====================================================
    // SHOW / HIDE / VISIBILITY
    // =====================================================

    function show() {

        hasSelection =
            true;


        resize();


        // Placed exactly once, right here — nothing else
        // ever repositions the panel or the connector after
        // this until a genuinely different point is selected.
        updatePosition();


        refreshVisibility();
    }


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

        if (
            !panel ||
            !connector
        ) {
            return;
        }


        const visible =
            hasSelection &&
            isPitchOk();


        panel.style.display =
            visible
                ? "block"
                : "none";


        connector.style.display =
            visible
                ? "block"
                : "none";
    }


    // =====================================================
    // PLACEMENT GRID
    // =====================================================
    //
    // The viewport is divided into a fixed grid. The panel
    // is anchored inside a grid cell that neighbors (never
    // contains) the cell holding the point, so the point is
    // never hidden behind the panel. This is only evaluated
    // once, in show() — see the file header.
    //
    // The connector is drawn as a single strictly horizontal
    // or vertical line (never diagonal) from the point to
    // whichever side of the panel (top, bottom, left or
    // right) faces it — see buildConnectorSegment().

    function getGridMetrics() {

        const container =
            map.getContainer();


        const width =
            container.clientWidth;


        const height =
            container.clientHeight;


        // A cell has to be big enough to hold the panel
        // plus the gutter on both sides, or the "neighbour
        // cell" placement below collapses: the panel gets
        // clamped back so close to the point that the
        // connector shrinks to a stub still inside the
        // panel's own footprint (looks like it's "behind"
        // the panel, and doesn't clearly point at anything).
        const minCellWidth =
            CFG.panelWidth +
            CFG.cellPadding * 2;


        const minCellHeight =
            CFG.panelHeight +
            CFG.cellPadding * 2;


        const columns =
            clamp(
                Math.floor(
                    width /
                    minCellWidth
                ),
                1,
                CFG.gridColumns
            );


        const rows =
            clamp(
                Math.floor(
                    height /
                    minCellHeight
                ),
                1,
                CFG.gridRows
            );


        return {
            width,

            height,

            columns,

            rows,

            cellWidth:
                width /
                columns,

            cellHeight:
                height /
                rows
        };
    }


    function cellForPoint(
        x,
        y,
        metrics
    ) {

        const col =
            clamp(
                Math.floor(
                    x /
                    metrics.cellWidth
                ),
                0,
                metrics.columns - 1
            );


        const row =
            clamp(
                Math.floor(
                    y /
                    metrics.cellHeight
                ),
                0,
                metrics.rows - 1
            );


        return {
            col,
            row
        };
    }


    function cellRect(
        cell,
        metrics
    ) {

        return {
            left:
                cell.col *
                metrics.cellWidth,

            top:
                cell.row *
                metrics.cellHeight,

            width:
                metrics.cellWidth,

            height:
                metrics.cellHeight
        };
    }


    function chooseHostCell(
        pointX,
        pointY,
        metrics
    ) {

        const pointCell =
            cellForPoint(
                pointX,
                pointY,
                metrics
            );


        // Only the 4 cardinal neighbours are considered,
        // so the connector always runs top / bottom /
        // left / right — never diagonally.
        const neighborOffsets = [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1]
        ];


        const candidates = [];

        neighborOffsets.forEach(
            ([deltaCol, deltaRow]) => {

                const col =
                    pointCell.col +
                    deltaCol;

                const row =
                    pointCell.row +
                    deltaRow;

                if (
                    col >= 0 &&
                    col < metrics.columns &&
                    row >= 0 &&
                    row < metrics.rows
                ) {

                    candidates.push(
                        {
                            col,
                            row
                        }
                    );
                }
            }
        );


        if (!candidates.length) {

            // Degenerate grid (1x1) — fall back to the
            // point's own cell.
            candidates.push(
                pointCell
            );
        }


        let best =
            candidates[0];


        let bestDistance =
            Infinity;


        candidates.forEach(
            cell => {

                const rect =
                    cellRect(
                        cell,
                        metrics
                    );

                const cx =
                    rect.left +
                    rect.width / 2;

                const cy =
                    rect.top +
                    rect.height / 2;

                const distance =
                    Math.hypot(
                        cx - pointX,
                        cy - pointY
                    );

                if (
                    distance <
                    bestDistance
                ) {

                    bestDistance =
                        distance;

                    best =
                        cell;
                }
            }
        );


        return best;
    }


    function computePanelPositionInCell(
        cell,
        metrics,
        point,
        direction
    ) {

        const rect =
            cellRect(
                cell,
                metrics
            );


        // Along the axis separating the point from this
        // cell, the panel is centred in the cell as before.
        // Along the *other* (cross) axis, it's aligned to
        // the point itself instead of the cell centre, so a
        // single straight connector can reach it without
        // ever having to bend.
        const isHorizontalOffset =
            direction === "left" ||
            direction === "right";


        let panelX =
            isHorizontalOffset
                ? rect.left +
                  (
                      rect.width -
                      CFG.panelWidth
                  ) / 2
                : point.x -
                  CFG.panelWidth / 2;


        let panelY =
            isHorizontalOffset
                ? point.y -
                  CFG.panelHeight / 2
                : rect.top +
                  (
                      rect.height -
                      CFG.panelHeight
                  ) / 2;


        panelX =
            clamp(

                panelX,

                rect.left +
                CFG.cellPadding,

                rect.left +
                rect.width -
                CFG.panelWidth -
                CFG.cellPadding
            );


        panelY =
            clamp(

                panelY,

                rect.top +
                CFG.cellPadding,

                rect.top +
                rect.height -
                CFG.panelHeight -
                CFG.cellPadding
            );


        // Safety clamp against the full viewport, in case
        // a cell is smaller than the panel + padding.
        panelX =
            clamp(

                panelX,

                CFG.panelMargin,

                metrics.width -
                CFG.panelWidth -
                CFG.panelMargin
            );


        panelY =
            clamp(

                panelY,

                CFG.panelMargin,

                metrics.height -
                CFG.panelHeight -
                CFG.panelMargin
            );


        return {
            panelX,
            panelY
        };
    }


    // Builds a single, strictly axis-aligned segment from
    // the point (px,py) to the near edge of `rect` (the
    // panel), given which cardinal direction the panel was
    // placed in relative to the point:
    //
    // - "left" / "right": a horizontal line at the point's
    //   own height, out to the panel's near vertical edge.
    // - "up" / "down": a vertical line at the point's own
    //   x, out to the panel's near horizontal edge.
    //
    // Because computePanelPositionInCell() above already
    // aligns the panel's cross-axis to the point, this edge
    // sits at (or very near) the point's own coordinate on
    // that axis, so the line comes out straight rather than
    // needing a bend.
    function buildConnectorSegment(
        px,
        py,
        rect,
        direction
    ) {

        if (
            direction === "left" ||
            direction === "right"
        ) {

            const edgeX =
                direction === "right"
                    ? rect.left
                    : rect.left + rect.width;


            return {
                x1: px,
                y1: py,
                x2: edgeX,
                y2: py
            };
        }


        const edgeY =
            direction === "down"
                ? rect.top
                : rect.top + rect.height;


        return {
            x1: px,
            y1: py,
            x2: px,
            y2: edgeY
        };
    }


    // Renders one axis-aligned segment { x1,y1,x2,y2 } into
    // a plain rectangle div — no rotation involved, since
    // every segment is guaranteed to be perfectly horizontal
    // or perfectly vertical.
    function paintConnectorSegment(
        element,
        segment
    ) {

        const thickness =
            CFG.connectorThickness;


        const isHorizontal =
            segment.y1 === segment.y2;


        if (isHorizontal) {

            const left =
                Math.min(
                    segment.x1,
                    segment.x2
                );

            const width =
                Math.abs(
                    segment.x2 -
                    segment.x1
                );

            element.style.left =
                `${left}px`;

            element.style.top =
                `${segment.y1 - thickness / 2}px`;

            element.style.width =
                `${width}px`;

            element.style.height =
                `${thickness}px`;

        } else {

            const top =
                Math.min(
                    segment.y1,
                    segment.y2
                );

            const height =
                Math.abs(
                    segment.y2 -
                    segment.y1
                );

            element.style.left =
                `${segment.x1 - thickness / 2}px`;

            element.style.top =
                `${top}px`;

            element.style.width =
                `${thickness}px`;

            element.style.height =
                `${height}px`;
        }
    }


    // =====================================================
    // POSITION (called once from show(), never on "move")
    // =====================================================

    function updatePosition() {

        if (
            !selected ||
            !panel
        ) {
            return;
        }


        const metrics =
            getGridMetrics();


        const point =
            map.project(
                selected.geometry.coordinates
            );


        // -------------------------------------------------
        // Pick the grid cell that will host the panel —
        // always a neighbour of the point's own cell, so
        // the panel never covers the point.
        // -------------------------------------------------

        const pointCell =
            cellForPoint(
                point.x,
                point.y,
                metrics
            );


        const hostCell =
            chooseHostCell(
                point.x,
                point.y,
                metrics
            );


        // Which cardinal direction the panel ended up in,
        // relative to the point — determines whether the
        // connector's first leg is horizontal or vertical.
        const direction =
            hostCell.col >
            pointCell.col
                ? "right"
                : hostCell.col <
                  pointCell.col
                    ? "left"
                    : hostCell.row >
                      pointCell.row
                        ? "down"
                        : "up";


        const {
            panelX,
            panelY
        } =
            computePanelPositionInCell(
                hostCell,
                metrics,
                point,
                direction
            );


        panel.style.left =
            `${panelX}px`;


        panel.style.top =
            `${panelY}px`;


        // -------------------------------------------------
        // Connector — a single strictly horizontal or
        // vertical line from the point to the panel's near
        // edge, never diagonal. Drawn above the panel (see
        // createPanel) so it's always visible, never hidden
        // behind it.
        // -------------------------------------------------

        const panelRect = {
            left: panelX,
            top: panelY,
            width: CFG.panelWidth,
            height: CFG.panelHeight
        };


        const segment =
            buildConnectorSegment(

                point.x,
                point.y,

                panelRect,

                direction
            );


        paintConnectorSegment(
            connector,
            segment
        );
    }


    // =====================================================
    // ANIMATION
    // =====================================================

    function animate() {

        requestAnimationFrame(
            animate
        );


        // The panel (and therefore this canvas) is hidden
        // whenever there's no selection or the map isn't
        // pitched past the threshold — skip rendering
        // entirely then. These splats are hundreds of
        // thousands of points each; rendering them into a
        // hidden canvas every frame is pure wasted GPU/CPU
        // work and was previously starving the whole page.
        const isPanelVisible =
            panel &&
            panel.style.display !==
                "none";


        if (!isPanelVisible) {

            return;
        }


        if (splat) {

            const elapsedSeconds =
                performance.now() /
                1000;


            const swingRad =
                THREE.MathUtils.degToRad(
                    CFG.panAmplitudeDeg
                ) *
                Math.sin(
                    elapsedSeconds *
                    CFG.panSpeed
                );


            splat.rotation.y =
                splat.userData.baseRotationY +
                swingRad;
        }


        if (
            renderer &&
            scene &&
            camera
        ) {

            renderer.render(
                scene,
                camera
            );
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


    function clamp(
        value,
        min,
        max
    ) {

        return Math.min(
            Math.max(
                value,
                min
            ),
            max
        );
    }


    return {

        init,

        clear,

        refresh
    };

})();