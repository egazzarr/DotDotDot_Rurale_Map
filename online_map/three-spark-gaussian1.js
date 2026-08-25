// three-spark-gaussian1.js

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

        // Placeholder / fallback model, used whenever there
        // is no matching .ply for the selected feature's id.
        placeholderPlyUrl:
            new URL(
                "./sharp_casolare7.ply",
                import.meta.url
            ).href,

        // Folder that may contain a file named "<id>.ply"
        // for a given feature.
        plyFolder:
            "./splats/",

        // When choosing which visible point to show the
        // panel for, how many of the closest-to-centre
        // points are checked for a real .ply match before
        // giving up and falling back to the plain closest
        // point (with the placeholder model).
        priorityCandidateLimit:
            24,


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


        // Selection delay
        selectionDelay:
            400,


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
        // panel is always placed centred inside one grid
        // cell — never on top of the point itself — and
        // that cell is re-chosen continuously as the map
        // is panned, tilted, or zoomed.

        gridColumns:
            6,

        gridRows:
            4,

        // Empty gutter kept clear inside a cell around
        // the panel.
        cellPadding:
            40,


        // -------------------------------------------------
        // GAUSSIAN
        // -------------------------------------------------

        modelScale:
            1.0,

        rotationX:
            Math.PI,

        rotationY:
            0,

        rotationZ:
            0,

        modelX:
            0,

        modelY:
            -0,

        modelZ:
            -0,

        spin:
            0,


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
        // TEXT
        // -------------------------------------------------

        fontFamily:
            "\"MSCHN\", sans-serif",

        titleFontSize:
            "26px",

        titleFontWeight:
            "700", // MSCHN "L" cut

        detailFontSize:
            "12px",

        detailFontWeight:
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

    let connector = null;


    let renderer = null;

    let scene = null;

    let camera = null;

    let spark = null;

    let splat = null;

    let currentSplatUrl = null;

    let splatLoadToken = 0;


    // Cache of resolved model info, keyed by feature id,
    // so the filesystem is only probed once per id.
    // Value shape: { url, hasSplat }
    const plyInfoCache =
        new Map();


    // =====================================================
    // INIT
    // =====================================================

    function init(
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


        map.on(
            "move",
            updatePosition
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


        map.on(
            "resize",
            resize
        );


        resize();


        scheduleSelection();


        animate();
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
                        CFG.detailFontSize,

                    fontWeight:
                        CFG.detailFontWeight
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
                        CFG.detailFontSize,

                    fontWeight:
                        CFG.detailFontWeight
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
        // CONNECTOR
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

                height:
                    "2px",

                background:
                    CFG.background,

                transformOrigin:
                    "0 50%",

                zIndex:
                    "49",

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

                55,

                CFG.panelWidth /
                CFG.panelHeight,

                0.01,

                1000
            );


        camera.position.set(
            0,
            0,
            4
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


        scene.add(
            spark
        );


        currentSplatUrl =
            CFG.placeholderPlyUrl;


        splat =
            new SplatMesh({
                url:
                    currentSplatUrl
            });


        applySplatTransform(
            splat
        );


        scene.add(
            splat
        );


        console.log(
            "[ThreePointCallout] Gaussian loaded (placeholder):",
            currentSplatUrl
        );
    }


    function applySplatTransform(target) {

        target.rotation.set(

            CFG.rotationX,

            CFG.rotationY,

            CFG.rotationZ
        );


        target.scale.setScalar(
            CFG.modelScale
        );


        target.position.set(

            CFG.modelX,

            CFG.modelY,

            CFG.modelZ
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


    async function selectFeature() {

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
        // Give priority to points that actually have a
        // matching Gaussian splat file, among the closest
        // candidates. Falls back to the plain closest
        // point (placeholder model) if none match.
        // -------------------------------------------------

        const selectionToken =
            ++splatLoadToken;


        const candidates =
            ranked.slice(
                0,
                CFG.priorityCandidateLimit
            );


        const infos =
            await Promise.all(
                candidates.map(
                    entry =>
                        resolvePlyInfo(
                            getId(
                                entry.feature
                            )
                        )
                )
            );


        // A newer selection cycle has started while we
        // were awaiting — abandon this one.
        if (
            selectionToken !==
            splatLoadToken
        ) {

            return;
        }


        let bestIndex =
            infos.findIndex(
                info =>
                    info.hasSplat
            );


        if (bestIndex === -1) {

            bestIndex = 0;
        }


        const best =
            candidates[bestIndex].feature;

        const bestInfo =
            infos[bestIndex];


        const newId =
            getId(best);


        if (
            selected &&
            getId(selected) ===
            newId
        ) {

            updatePosition();

            return;
        }


        selected =
            best;


        console.log(
            "[ThreePointCallout] selected:",
            newId,
            bestInfo.hasSplat
                ? "(has splat)"
                : "(placeholder)"
        );


        updateContent();


        show();


        updatePosition();


        // Already resolved above — swap the model in
        // directly, no need to re-probe the filesystem.
        applySplat(
            bestInfo.url
        );
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


    // =====================================================
    // PLY RESOLUTION (per-feature model lookup)
    // =====================================================

    function buildCandidatePlyUrl(id) {

        return new URL(
            `${CFG.plyFolder}${id}.ply`,
            import.meta.url
        ).href;
    }


    async function checkFileExists(url) {

        try {

            const response =
                await fetch(
                    url,
                    {
                        method:
                            "HEAD"
                    }
                );

            return response.ok;

        } catch (error) {

            return false;
        }
    }


    // Resolves { url, hasSplat } for a given feature id,
    // caching the result so the filesystem is probed at
    // most once per id.
    async function resolvePlyInfo(id) {

        if (
            plyInfoCache.has(id)
        ) {

            return plyInfoCache.get(
                id
            );
        }


        const candidateUrl =
            buildCandidatePlyUrl(
                id
            );


        const exists =
            await checkFileExists(
                candidateUrl
            );


        const info =
            exists
                ? {
                    url:
                        candidateUrl,

                    hasSplat:
                        true
                }
                : {
                    url:
                        CFG.placeholderPlyUrl,

                    hasSplat:
                        false
                };


        plyInfoCache.set(
            id,
            info
        );


        return info;
    }


    function applySplat(resolvedUrl) {

        if (
            resolvedUrl ===
            currentSplatUrl
        ) {

            return;
        }


        const previousSplat =
            splat;


        const nextSplat =
            new SplatMesh({
                url:
                    resolvedUrl
            });


        applySplatTransform(
            nextSplat
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


            previousSplat.dispose?.();
        }
    }


    // =====================================================
    // SHOW / HIDE / VISIBILITY
    // =====================================================

    function show() {

        hasSelection =
            true;


        resize();


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
    // is always anchored inside a grid cell that neighbors
    // (never contains) the cell holding the point, so the
    // point is never hidden behind the panel. That cell is
    // re-chosen continuously as the map is panned, tilted,
    // or zoomed.
    //
    // The connector is then drawn as the segment between
    // the point and the panel's centre, clipped to the
    // panel's border — so it naturally attaches from
    // whichever side (top, bottom, left or right) faces
    // the point.

    function getGridMetrics() {

        const container =
            map.getContainer();


        const width =
            container.clientWidth;


        const height =
            container.clientHeight;


        return {
            width,

            height,

            cellWidth:
                width /
                CFG.gridColumns,

            cellHeight:
                height /
                CFG.gridRows
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
                CFG.gridColumns - 1
            );


        const row =
            clamp(
                Math.floor(
                    y /
                    metrics.cellHeight
                ),
                0,
                CFG.gridRows - 1
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
                    col < CFG.gridColumns &&
                    row >= 0 &&
                    row < CFG.gridRows
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
        metrics
    ) {

        const rect =
            cellRect(
                cell,
                metrics
            );


        let panelX =
            rect.left +
            (
                rect.width -
                CFG.panelWidth
            ) / 2;


        let panelY =
            rect.top +
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


    // Intersects the segment (px,py)→(qx,qy) with the
    // border of `rect`, returning the point on whichever
    // edge (top / bottom / left / right) is crossed first
    // starting from (px,py).
    function segmentRectIntersection(
        px,
        py,
        qx,
        qy,
        rect
    ) {

        const edges = [

            // top
            {
                x1: rect.left,
                y1: rect.top,
                x2: rect.left + rect.width,
                y2: rect.top
            },

            // bottom
            {
                x1: rect.left,
                y1: rect.top + rect.height,
                x2: rect.left + rect.width,
                y2: rect.top + rect.height
            },

            // left
            {
                x1: rect.left,
                y1: rect.top,
                x2: rect.left,
                y2: rect.top + rect.height
            },

            // right
            {
                x1: rect.left + rect.width,
                y1: rect.top,
                x2: rect.left + rect.width,
                y2: rect.top + rect.height
            }
        ];


        let best =
            null;


        let bestT =
            Infinity;


        edges.forEach(
            edge => {

                const hit =
                    lineSegmentIntersection(

                        px,
                        py,
                        qx,
                        qy,

                        edge.x1,
                        edge.y1,
                        edge.x2,
                        edge.y2
                    );

                if (
                    hit &&
                    hit.t >= 0 &&
                    hit.t < bestT
                ) {

                    bestT =
                        hit.t;

                    best =
                        {
                            x: hit.x,
                            y: hit.y
                        };
                }
            }
        );


        return (
            best ||
            {
                x: qx,
                y: qy
            }
        );
    }


    // Standard two-segment intersection. Segment A is
    // (x1,y1)-(x2,y2), segment B is (x3,y3)-(x4,y4). `t`
    // is the position of the intersection along segment A.
    function lineSegmentIntersection(
        x1, y1, x2, y2,
        x3, y3, x4, y4
    ) {

        const denom =
            (x1 - x2) * (y3 - y4) -
            (y1 - y2) * (x3 - x4);


        if (
            Math.abs(denom) <
            1e-9
        ) {

            return null;
        }


        const t =
            (
                (x1 - x3) * (y3 - y4) -
                (y1 - y3) * (x3 - x4)
            ) / denom;


        const u =
            (
                (x1 - x3) * (y1 - y2) -
                (y1 - y3) * (x1 - x2)
            ) / denom;


        if (
            u < 0 ||
            u > 1
        ) {

            return null;
        }


        return {
            x: x1 + t * (x2 - x1),
            y: y1 + t * (y2 - y1),
            t
        };
    }


    // =====================================================
    // POSITION
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

        const hostCell =
            chooseHostCell(
                point.x,
                point.y,
                metrics
            );


        const {
            panelX,
            panelY
        } =
            computePanelPositionInCell(
                hostCell,
                metrics
            );


        panel.style.left =
            `${panelX}px`;


        panel.style.top =
            `${panelY}px`;


        // -------------------------------------------------
        // Connector — runs from the point to wherever it
        // crosses the panel's border, so it attaches from
        // the correct side automatically.
        // -------------------------------------------------

        const panelRect = {
            left: panelX,
            top: panelY,
            width: CFG.panelWidth,
            height: CFG.panelHeight
        };


        const panelCenterX =
            panelX +
            CFG.panelWidth / 2;


        const panelCenterY =
            panelY +
            CFG.panelHeight / 2;


        const attach =
            segmentRectIntersection(

                point.x,
                point.y,

                panelCenterX,
                panelCenterY,

                panelRect
            );


        const dx =
            attach.x -
            point.x;


        const dy =
            attach.y -
            point.y;


        const length =
            Math.sqrt(
                dx * dx +
                dy * dy
            );


        const angle =
            Math.atan2(
                dy,
                dx
            );


        connector.style.left =
            `${point.x}px`;


        connector.style.top =
            `${point.y}px`;


        connector.style.width =
            `${length}px`;


        connector.style.transform =
            `rotate(${angle}rad)`;
    }


    // =====================================================
    // ANIMATION
    // =====================================================

    function animate() {

        requestAnimationFrame(
            animate
        );


        if (
            splat &&
            panel &&
            panel.style.display !==
                "none"
        ) {

            splat.rotation.y +=
                CFG.spin;
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