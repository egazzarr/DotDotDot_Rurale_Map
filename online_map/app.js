import * as maplibregl from "https://unpkg.com/maplibre-gl@6.0.0/dist/maplibre-gl.mjs";


/*
 * =========================================================
 * PMTILES SUPPORT
 * =========================================================
 */

if (window.pmtiles) {
    const protocol =
        new pmtiles.Protocol();

    maplibregl.addProtocol(
        "pmtiles",
        protocol.tile
    );
}


/*
 * =========================================================
 * FILES AND DATA SETTINGS
 * =========================================================
 */

const EPSG_25832 =
    "+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs";

const WGS84 =
    "EPSG:4326";

const GEOJSON_FILE =
    "./data/lat_long.json";

const CSV_FILE =
    "./data/dati_schede_min.csv";

const MAP_STYLE =
    "./styles_maputnik/bw.json";


/*
 * =========================================================
 * MAPLIBRE IDS
 * =========================================================
 */

const POINT_SOURCE =
    "points-source";

const POINT_LAYER =
    "points-layer";

const SQUARE_LAYER =
    "squares-layer";


/*
 * =========================================================
 * SAVED POINT SHAPE
 * =========================================================
 */

const POINT_SHAPE_SETTINGS_KEY =
    "map-point-shape";

let POINT_SHAPE =
    localStorage.getItem(
        POINT_SHAPE_SETTINGS_KEY
    ) || "circle";


/*
 * =========================================================
 * CSV COLUMN NAMES
 * =========================================================
 */

const TARGET_ID =
    "id_scheda_originale";

const TARGET_CONSERVAZIONE =
    "stato_conservazione";

const TARGET_PAESAGGIO =
    "contesto_paesaggistico";


/*
 * =========================================================
 * CATEGORY MERGING
 * =========================================================
 */

const CATEGORY_MAP = {
    "buono": "buono",
    "discreto": "medio",
    "mediocre": "medio",
    "cattivo": "pessimo",
    "pessimo": "pessimo",
    "non disponibile": "non disponibile"
};

const LANDSCAPE_MAP = {
    /*
     * Coste
     */
    "costa (bassa)":
        "costa",

    "costa (alta, falesie)":
        "costa",

    /*
     * Valli
     */
    "valle":
        "valle e fondovalle",

    "fondovalle":
        "valle e fondovalle",

    "conca intramontana":
        "valle e fondovalle",

    "pedemontano":
        "valle e fondovalle",


    /*
     * Zone umide e ambienti d'acqua
     */
    "lagunare":
        "zone umide e acque interne",

    "lacustre":
        "zone umide e acque interne",

    "palustre":
        "zone umide e acque interne",

    "foce fluviale":
        "zone umide e acque interne",

            /*
     * Montagna
     */
    "montagna":
        "montagna",

    "versante ripido":
        "montagna",

     "crinale/dorsale":
        "montagna",

            /*
     * collina
     */

    "versante a debole pendenza":
        "collina",

    "collina":
        "collina",


    /*
     * Le categorie non elencate rimangono invariate:
     * pianura, collina, montagna, altopiano,
     * pedemontano, crinale/dorsale, carsico...
     */
};

/*
 * =========================================================
 * EDITABLE STYLE SETTINGS
 * =========================================================
 */

const MIN_DOT_ZOOM = 5;
const MAX_DOT_ZOOM = 18;

let DOT_RADIUS_AT_MIN_ZOOM = 1;
let DOT_RADIUS_AT_MAX_ZOOM = 8;

let CIRCLE_BLUR = 0.7;
let OPACITY_DEFAULT = 0.9;
let OPACITY_NON_DISPONIBILE = 0.8;

const COLORS = {
    buono: "#7380A6",
    medio: "#FFCD8E",
    pessimo: "#EC8553",
    "non disponibile": "#807670"
};

const STYLE_SETTINGS_KEY =
    "map-point-style-settings";

    const BASE_COLOR_SETTINGS_KEY =
    "map-base-color-settings";

const BASE_COLOR_TARGETS = [
    {
        layerId: "baseColor",
        paintProp: "background-color",
        suffix: "base",
        label: "Colore base"
    },
    {
        layerId: "hills",
        paintProp: "hillshade-shadow-color",
        suffix: "hillshade-shadow",
        label: "Hillshade ombra"
    },
    {
        layerId: "hills",
        paintProp: "hillshade-highlight-color",
        suffix: "hillshade-highlight",
        label: "Hillshade luce"
    },
    {
        layerId: "hills",
        paintProp: "hillshade-accent-color",
        suffix: "hillshade-accent",
        label: "Hillshade accento"
    }
];

const PANEL_3D_SETTINGS_KEY =
    "map-3d-panel-enabled";


/*
 * =========================================================
 * MAP
 * =========================================================
 */

const map =
    new maplibregl.Map({
        container: "map",
        style: MAP_STYLE,

        center: [
            12.5,
            42.5
        ],

        zoom: 5,
        pitch: 10,
        bearing: 0,
        maxPitch: 60,

        attributionControl: false,

        canvasContextAttributes: {
            antialias: true
        }
    });


map.on(
    "error",
    event => {
        console.error(
            "[MapLibre error]",
            event.error || event
        );
    }
);


map.on(
    "load",
    () => {
        console.log(
            "[app.js] map loaded"
        );

        bindStyleControls();
        loadData();
    }
);


/*
 * =========================================================
 * LOAD CSV AND GEOJSON
 * =========================================================
 */

async function loadData() {
    try {
        const [
            geojsonResponse,
            csvResponse
        ] = await Promise.all([
            fetch(GEOJSON_FILE),
            fetch(CSV_FILE)
        ]);

        if (!geojsonResponse.ok) {
            throw new Error(
                `GeoJSON non caricato: ${geojsonResponse.status}`
            );
        }

        if (!csvResponse.ok) {
            throw new Error(
                `CSV non caricato: ${csvResponse.status}`
            );
        }

        const geojson =
            await geojsonResponse.json();

        const csvText =
            await csvResponse.text();

        Papa.parse(
            csvText,
            {
                header: true,
                skipEmptyLines: true,

                complete(results) {
                    createMapData(
                        geojson,
                        results.data
                    );
                },

                error(error) {
                    console.error(
                        "[CSV error]",
                        error
                    );
                }
            }
        );
    } catch (error) {
        console.error(
            "[Data loading error]",
            error
        );
    }
}


/*
 * =========================================================
 * COMBINE CSV AND GEOJSON
 * =========================================================
 */

function createMapData(
    geojson,
    csvRows
) {
    if (!csvRows.length) {
        console.warn(
            "Il CSV è vuoto."
        );

        return;
    }

    const csvKeys =
        findCsvKeys(
            csvRows[0]
        );

    if (
        !csvKeys.id ||
        !csvKeys.conservazione ||
        !csvKeys.paesaggio
    ) {
        console.error(
            "Colonne CSV richieste non trovate:",
            csvKeys
        );

        return;
    }

    const rowsById =
        new Map();

    csvRows.forEach(row => {
        const id =
            cleanValue(
                row[csvKeys.id]
            );

        if (id) {
            rowsById.set(
                id,
                row
            );
        }
    });

    const features =
        geojson.features
            .map(feature => {
                const id =
                    cleanValue(
                        feature.properties?.ID
                    );

                const csvRow =
                    rowsById.get(id);

                if (!csvRow) {
                    return null;
                }

                const coordinates =
                    feature.geometry
                        ?.coordinates;

                if (
                    !Array.isArray(
                        coordinates
                    ) ||
                    coordinates.length < 2
                ) {
                    return null;
                }

                const x =
                    Number(
                        coordinates[0]
                    );

                const y =
                    Number(
                        coordinates[1]
                    );

                if (
                    !Number.isFinite(x) ||
                    !Number.isFinite(y)
                ) {
                    return null;
                }

                const [lng, lat] =
                    proj4(
                        EPSG_25832,
                        WGS84,
                        [x, y]
                    );

                const rawConservazione =
                    cleanValue(
                        csvRow[
                            csvKeys.conservazione
                        ]
                    ).toLowerCase();

                const rawPaesaggio =
                    cleanValue(
                        csvRow[
                            csvKeys.paesaggio
                        ]
                    ).toLowerCase();

                const paesaggioRaggruppato =
                    LANDSCAPE_MAP[
                        rawPaesaggio
                    ] ||
                    rawPaesaggio;

                return {
                    type: "Feature",

                    geometry: {
                        type: "Point",

                        coordinates: [
                            lng,
                            lat
                        ]
                    },

                    properties: {
                        id,

                        conservazione:
                            CATEGORY_MAP[
                                rawConservazione
                            ] ||
                            "non disponibile",

                        paesaggio:
                            paesaggioRaggruppato
                    }
                };
            })
            .filter(Boolean);

    if (!features.length) {
        console.warn(
            "Nessun punto corrispondente trovato."
        );

        return;
    }

    console.log(
        `[app.js] valid points: ${features.length}`
    );

    addPointsLayer(
        features
    );

    createLandscapeFilter(
        features
    );

    initializeThreeCallout(
        features
    );
}


/*
 * =========================================================
 * FIND CSV COLUMN NAMES
 * =========================================================
 */

function findCsvKeys(firstRow) {
    const result = {
        id: "",
        conservazione: "",
        paesaggio: ""
    };

    Object.keys(firstRow)
        .forEach(key => {
            const normalized =
                key
                    .trim()
                    .toLowerCase();

            if (
                normalized.includes(
                    TARGET_ID
                        .toLowerCase()
                )
            ) {
                result.id =
                    key;
            }

            if (
                normalized.includes(
                    TARGET_CONSERVAZIONE
                        .toLowerCase()
                )
            ) {
                result.conservazione =
                    key;
            }

            if (
                normalized.includes(
                    TARGET_PAESAGGIO
                        .toLowerCase()
                )
            ) {
                result.paesaggio =
                    key;
            }
        });

    return result;
}


function cleanValue(value) {
    if (
        value === undefined ||
        value === null
    ) {
        return "";
    }

    return String(value).trim();
}


/*
 * =========================================================
 * SHARED MAPLIBRE EXPRESSIONS
 * =========================================================
 */

function createRadiusExpression() {
    return [
        "interpolate",
        ["linear"],
        ["zoom"],

        MIN_DOT_ZOOM,
        DOT_RADIUS_AT_MIN_ZOOM,

        MAX_DOT_ZOOM,
        DOT_RADIUS_AT_MAX_ZOOM
    ];
}


function createSquareSizeExpression() {
    /*
     * The generated square has a visible half-size
     * of 16 logical pixels.
     */
    return [
        "interpolate",
        ["linear"],
        ["zoom"],

        MIN_DOT_ZOOM,
        DOT_RADIUS_AT_MIN_ZOOM / 16,

        MAX_DOT_ZOOM,
        DOT_RADIUS_AT_MAX_ZOOM / 16
    ];
}


function createOpacityExpression() {
    return [
        "match",
        ["get", "conservazione"],

        "non disponibile",
        OPACITY_NON_DISPONIBILE,

        OPACITY_DEFAULT
    ];
}


function createColorExpression() {
    return [
        "match",
        ["get", "conservazione"],

        "buono",
        COLORS.buono,

        "medio",
        COLORS.medio,

        "pessimo",
        COLORS.pessimo,

        COLORS["non disponibile"]
    ];
}


/*
 * =========================================================
 * CIRCLES AND SQUARES
 * =========================================================
 */

function addPointsLayer(features) {
    map.addSource(
        POINT_SOURCE,
        {
            type: "geojson",

            data: {
                type: "FeatureCollection",
                features
            }
        }
    );

    /*
     * Generate square symbols before adding
     * the square layer.
     */
    updateSquareImages();


    /*
     * Circle layer.
     */
    map.addLayer({
        id: POINT_LAYER,
        type: "circle",
        source: POINT_SOURCE,

        layout: {
            visibility:
                POINT_SHAPE === "circle"
                    ? "visible"
                    : "none"
        },

        paint: {
            "circle-radius":
                createRadiusExpression(),

            "circle-color":
                createColorExpression(),

            "circle-opacity":
                createOpacityExpression(),

            "circle-blur":
                CIRCLE_BLUR
        }
    });


    /*
     * Square layer.
     */
    map.addLayer({
        id: SQUARE_LAYER,
        type: "symbol",
        source: POINT_SOURCE,

        layout: {
            visibility:
                POINT_SHAPE === "square"
                    ? "visible"
                    : "none",

            "icon-image": [
                "match",
                ["get", "conservazione"],

                "buono",
                "generated-square-buono",

                "medio",
                "generated-square-medio",

                "pessimo",
                "generated-square-pessimo",

                "generated-square-non-disponibile"
            ],

            "icon-size":
                createSquareSizeExpression(),

            "icon-allow-overlap":
                true,

            "icon-ignore-placement":
                true
        },

        paint: {
            "icon-opacity":
                createOpacityExpression()
        }
    });
}


/*
 * =========================================================
 * GENERATED SQUARE SYMBOLS
 * =========================================================
 */

function createSquareImage(color) {
    /*
     * The square is generated in JavaScript.
     * No SVG or external image is used.
     */
    const size = 128;

    const canvas =
        document.createElement(
            "canvas"
        );

    canvas.width =
        size;

    canvas.height =
        size;

    const context =
        canvas.getContext(
            "2d"
        );

    context.clearRect(
        0,
        0,
        size,
        size
    );

    context.save();

    /*
     * Canvas blur for squares.
     * CIRCLE_BLUR ranges from 0 to 1.
     */
    context.filter =
        `blur(${CIRCLE_BLUR * 12}px)`;

    context.fillStyle =
        color;

    /*
     * Draw a square in the centre.
     * Transparent space around it leaves room
     * for the blur.
     */
    context.fillRect(
        32,
        32,
        64,
        64
    );

    context.restore();

    return context.getImageData(
        0,
        0,
        size,
        size
    );
}


function updateSquareImages() {
    const squareImages = {
        "generated-square-buono":
            COLORS.buono,

        "generated-square-medio":
            COLORS.medio,

        "generated-square-pessimo":
            COLORS.pessimo,

        "generated-square-non-disponibile":
            COLORS["non disponibile"]
    };

    Object.entries(
        squareImages
    ).forEach(
        ([imageId, color]) => {
            const image =
                createSquareImage(
                    color
                );

            if (
                map.hasImage(
                    imageId
                )
            ) {
                map.updateImage(
                    imageId,
                    image
                );
            } else {
                map.addImage(
                    imageId,
                    image,
                    {
                        pixelRatio: 2
                    }
                );
            }
        }
    );
}


/*
 * =========================================================
 * LIVE STYLE UPDATES
 * =========================================================
 */

function applyPointStyle() {
    /*
     * The controls are created before the data layers,
     * so there may not be a layer yet.
     */
    if (
        !map.getLayer(
            POINT_LAYER
        )
    ) {
        return;
    }


    /*
     * Update circles.
     */
    map.setPaintProperty(
        POINT_LAYER,
        "circle-radius",
        createRadiusExpression()
    );

    map.setPaintProperty(
        POINT_LAYER,
        "circle-blur",
        CIRCLE_BLUR
    );

    map.setPaintProperty(
        POINT_LAYER,
        "circle-color",
        createColorExpression()
    );

    map.setPaintProperty(
        POINT_LAYER,
        "circle-opacity",
        createOpacityExpression()
    );


    /*
     * Regenerate squares using the same
     * colors and blur.
     */
    updateSquareImages();


    /*
     * Update square radius and opacity.
     */
    if (
        map.getLayer(
            SQUARE_LAYER
        )
    ) {
        map.setLayoutProperty(
            SQUARE_LAYER,
            "icon-size",
            createSquareSizeExpression()
        );

        map.setPaintProperty(
            SQUARE_LAYER,
            "icon-opacity",
            createOpacityExpression()
        );
    }
}

function getBaseColorValue(target) {
    if (!map.getLayer(target.layerId)) {
        return "#000000";
    }

    let value =
        map.getPaintProperty(
            target.layerId,
            target.paintProp
        );

    /*
     * Defensive: some style files wrap a plain
     * color string in an array by mistake.
     */
    if (Array.isArray(value)) {
        value = value[0];
    }

    return (
        normalizeHexColor(value) ||
        "#000000"
    );
}


function setBaseColorValue(target, color) {
    if (!map.getLayer(target.layerId)) {
        return;
    }

    map.setPaintProperty(
        target.layerId,
        target.paintProp,
        color
    );
}


function saveBaseColorSettings() {
    try {
        const values = {};

        BASE_COLOR_TARGETS.forEach(target => {
            values[target.paintProp] =
                getBaseColorValue(target);
        });

        localStorage.setItem(
            BASE_COLOR_SETTINGS_KEY,
            JSON.stringify(values)
        );
    } catch (error) {
        console.warn(
            "[Base color settings not saved]",
            error
        );
    }
}


function loadSavedBaseColorSettings() {
    try {
        const saved =
            JSON.parse(
                localStorage.getItem(
                    BASE_COLOR_SETTINGS_KEY
                ) || "null"
            );

        if (!saved) {
            return;
        }

        BASE_COLOR_TARGETS.forEach(target => {
            const color =
                normalizeHexColor(
                    saved[target.paintProp]
                );

            if (color) {
                setBaseColorValue(
                    target,
                    color
                );
            }
        });
    } catch (error) {
        console.warn(
            "[Base color settings not loaded]",
            error
        );
    }
}

/*
 * =========================================================
 * SWITCH BETWEEN CIRCLES AND SQUARES
 * =========================================================
 */

function setPointShape(shape) {
    if (
        shape !== "circle" &&
        shape !== "square"
    ) {
        return;
    }

    POINT_SHAPE =
        shape;

    localStorage.setItem(
        POINT_SHAPE_SETTINGS_KEY,
        POINT_SHAPE
    );

    if (
        map.getLayer(
            POINT_LAYER
        )
    ) {
        map.setLayoutProperty(
            POINT_LAYER,
            "visibility",

            shape === "circle"
                ? "visible"
                : "none"
        );
    }

    if (
        map.getLayer(
            SQUARE_LAYER
        )
    ) {
        map.setLayoutProperty(
            SQUARE_LAYER,
            "visibility",

            shape === "square"
                ? "visible"
                : "none"
        );
    }
}


/*
 * =========================================================
 * BIND SETTINGS PANEL
 * =========================================================
 */

function bindStyleControls() {
    loadSavedStyleSettings();
    loadSavedBaseColorSettings();
    createStyleControls();

    const bindBaseMapColor = target => {
        const picker =
            document.getElementById(
                `ctrl-color-${target.suffix}`
            );

        const text =
            document.getElementById(
                `ctrl-color-${target.suffix}-text`
            );

        if (!picker || !text) {
            return;
        }

        const update = value => {
            const color =
                normalizeHexColor(value);

            if (!color) {
                text.classList.add(
                    "style-control-invalid"
                );
                return;
            }

            text.classList.remove(
                "style-control-invalid"
            );

            picker.value = color;
            text.value = color.toUpperCase();

            setBaseColorValue(target, color);
            saveBaseColorSettings();
        };

        picker.addEventListener("input", () =>
            update(picker.value)
        );

        text.addEventListener("input", () => {
            if (normalizeHexColor(text.value)) {
                update(text.value);
            } else {
                text.classList.add(
                    "style-control-invalid"
                );
            }
        });
    };

    BASE_COLOR_TARGETS.forEach(bindBaseMapColor);

const bindNumber = (
        id,
        setter,
        minimum,
        maximum
    ) => {
        const element =
            document.getElementById(id);

        if (!element) {
            return;
        }

        element.addEventListener(
            "input",
            () => {
                const value =
                    Number(
                        element.value
                    );

                if (
                    !Number.isFinite(
                        value
                    )
                ) {
                    return;
                }

                const limitedValue =
                    Math.min(
                        maximum,
                        Math.max(
                            minimum,
                            value
                        )
                    );

                setter(
                    limitedValue
                );

                applyPointStyle();
                saveStyleSettings();
            }
        );
    };


    const bindColor = (
        status,
        suffix
    ) => {
        const picker =
            document.getElementById(
                `ctrl-color-${suffix}`
            );

        const text =
            document.getElementById(
                `ctrl-color-${suffix}-text`
            );

        if (
            !picker ||
            !text
        ) {
            return;
        }

        const update =
            value => {
                const color =
                    normalizeHexColor(
                        value
                    );

                if (!color) {
                    text.classList.add(
                        "style-control-invalid"
                    );

                    return;
                }

                text.classList.remove(
                    "style-control-invalid"
                );

                picker.value =
                    color;

                text.value =
                    color.toUpperCase();

                COLORS[status] =
                    color;

                applyPointStyle();
                saveStyleSettings();
            };

        picker.addEventListener(
            "input",
            () => {
                update(
                    picker.value
                );
            }
        );

        text.addEventListener(
            "input",
            () => {
                if (
                    normalizeHexColor(
                        text.value
                    )
                ) {
                    update(
                        text.value
                    );
                } else {
                    text.classList.add(
                        "style-control-invalid"
                    );
                }
            }
        );
    };


    bindNumber(
        "ctrl-radius-min",
        value => {
            DOT_RADIUS_AT_MIN_ZOOM =
                value;
        },
        0,
        50
    );

    bindNumber(
        "ctrl-radius-max",
        value => {
            DOT_RADIUS_AT_MAX_ZOOM =
                value;
        },
        0,
        50
    );

    bindNumber(
        "ctrl-blur",
        value => {
            CIRCLE_BLUR =
                value;
        },
        0,
        1
    );

    bindNumber(
        "ctrl-opacity",
        value => {
            OPACITY_DEFAULT =
                value;
        },
        0,
        1
    );

    bindNumber(
        "ctrl-opacity-non-disp",
        value => {
            OPACITY_NON_DISPONIBILE =
                value;
        },
        0,
        1
    );

    bindColor(
        "buono",
        "buono"
    );

    bindColor(
        "medio",
        "medio"
    );

    bindColor(
        "pessimo",
        "pessimo"
    );

    bindColor(
        "non disponibile",
        "non-disp"
    );

    applyPointStyle();
}


/*
 * =========================================================
 * CREATE SETTINGS PANEL
 * =========================================================
 */

function createStyleControls() {
    if (
        document.getElementById(
            "point-style-controls"
        )
    ) {
        return;
    }

    const panel =
        document.createElement(
            "div"
        );

    panel.id =
        "point-style-controls";

    panel.innerHTML = `
        <h3>Stile punti</h3>

        <label class="style-checkbox-row">
            <span>3D panel</span>

            <input
                id="ctrl-3d-panel"
                type="checkbox"
                ${is3dPanelEnabled() ? "checked" : ""}
            >
        </label>

        <label class="style-checkbox-row">
            <span>Quadrati</span>

            <input
                id="ctrl-square-points"
                type="checkbox"
                ${POINT_SHAPE === "square" ? "checked" : ""}
            >
        </label>

        ${numberControl(
            "Raggio (zoom lontano)",
            "ctrl-radius-min",
            DOT_RADIUS_AT_MIN_ZOOM,
            0,
            50,
            0.1
        )}

        ${numberControl(
            "Raggio (zoom vicino)",
            "ctrl-radius-max",
            DOT_RADIUS_AT_MAX_ZOOM,
            0,
            50,
            0.1
        )}

        ${numberControl(
            "Blur",
            "ctrl-blur",
            CIRCLE_BLUR,
            0,
            1,
            0.01
        )}

        ${numberControl(
            "Opacità",
            "ctrl-opacity",
            OPACITY_DEFAULT,
            0,
            1,
            0.01
        )}

        ${numberControl(
            "Opacità non disp.",
            "ctrl-opacity-non-disp",
            OPACITY_NON_DISPONIBILE,
            0,
            1,
            0.01
        )}

        ${colorControl(
            "Buono",
            "buono",
            COLORS.buono
        )}

        ${colorControl(
            "Medio",
            "medio",
            COLORS.medio
        )}

        ${colorControl(
            "Pessimo",
            "pessimo",
            COLORS.pessimo
        )}

        ${colorControl(
            "Non disponibile",
            "non-disp",
            COLORS["non disponibile"]
        )}

        ${BASE_COLOR_TARGETS.map(target =>
            colorControl(
                target.label,
                target.suffix,
                getBaseColorValue(target)
            )
        ).join("")}
    `;

    document.body.appendChild(
        panel
    );


    /*
     * Square checkbox:
     * unchecked = circles
     * checked = squares
     */
    const squarePointsCheckbox =
        document.getElementById(
            "ctrl-square-points"
        );

    squarePointsCheckbox
        .addEventListener(
            "change",
            event => {
                setPointShape(
                    event.target.checked
                        ? "square"
                        : "circle"
                );
            }
        );


    /*
     * 3D panel checkbox.
     */
    const panel3dCheckbox =
        document.getElementById(
            "ctrl-3d-panel"
        );

    panel3dCheckbox
        .addEventListener(
            "change",
            event => {
                localStorage.setItem(
                    PANEL_3D_SETTINGS_KEY,
                    String(
                        event.target.checked
                    )
                );

                /*
                 * Reload because an imported module
                 * cannot be unloaded dynamically.
                 */
                window.location.reload();
            }
        );
}


/*
 * =========================================================
 * CONTROL HTML HELPERS
 * =========================================================
 */

function numberControl(
    label,
    id,
    value,
    minimum,
    maximum,
    step
) {
    return `
        <label>
            <span>${label}</span>

            <input
                id="${id}"
                type="number"
                value="${value}"
                min="${minimum}"
                max="${maximum}"
                step="${step}"
            >
        </label>
    `;
}


function colorControl(
    label,
    suffix,
    value
) {
    return `
        <label>
            <span>${label}</span>

            <span class="style-color-fields">
                <input
                    id="ctrl-color-${suffix}"
                    type="color"
                    value="${value}"
                >

                <input
                    id="ctrl-color-${suffix}-text"
                    type="text"
                    value="${value}"
                    maxlength="7"
                    spellcheck="false"
                    aria-label="${label}: colore esadecimale"
                >
            </span>
        </label>
    `;
}


/*
 * =========================================================
 * VALIDATION AND SAVED SETTINGS
 * =========================================================
 */

function normalizeHexColor(value) {
    const color =
        String(value).trim();

    const withHash =
        color.startsWith("#")
            ? color
            : `#${color}`;

    return /^#[0-9a-f]{6}$/i.test(
        withHash
    )
        ? withHash.toUpperCase()
        : null;
}


function saveStyleSettings() {
    try {
        localStorage.setItem(
            STYLE_SETTINGS_KEY,

            JSON.stringify({
                radiusMin:
                    DOT_RADIUS_AT_MIN_ZOOM,

                radiusMax:
                    DOT_RADIUS_AT_MAX_ZOOM,

                blur:
                    CIRCLE_BLUR,

                opacity:
                    OPACITY_DEFAULT,

                opacityNonDisponibile:
                    OPACITY_NON_DISPONIBILE,

                colors:
                    COLORS
            })
        );
    } catch (error) {
        console.warn(
            "[Style settings not saved]",
            error
        );
    }
}


function loadSavedStyleSettings() {
    try {
        const saved =
            JSON.parse(
                localStorage.getItem(
                    STYLE_SETTINGS_KEY
                ) || "null"
            );

        if (!saved) {
            return;
        }

        DOT_RADIUS_AT_MIN_ZOOM =
            readSavedNumber(
                saved.radiusMin,
                0,
                50,
                DOT_RADIUS_AT_MIN_ZOOM
            );

        DOT_RADIUS_AT_MAX_ZOOM =
            readSavedNumber(
                saved.radiusMax,
                0,
                50,
                DOT_RADIUS_AT_MAX_ZOOM
            );

        CIRCLE_BLUR =
            readSavedNumber(
                saved.blur,
                0,
                1,
                CIRCLE_BLUR
            );

        OPACITY_DEFAULT =
            readSavedNumber(
                saved.opacity,
                0,
                1,
                OPACITY_DEFAULT
            );

        OPACITY_NON_DISPONIBILE =
            readSavedNumber(
                saved.opacityNonDisponibile,
                0,
                1,
                OPACITY_NON_DISPONIBILE
            );

        Object.keys(COLORS)
            .forEach(status => {
                const color =
                    normalizeHexColor(
                        saved.colors?.[status]
                    );

                if (color) {
                    COLORS[status] =
                        color;
                }
            });
    } catch (error) {
        console.warn(
            "[Style settings not loaded]",
            error
        );
    }
}


function readSavedNumber(
    value,
    minimum,
    maximum,
    fallback
) {
    const number =
        Number(value);

    return Number.isFinite(number)
        ? Math.min(
            maximum,
            Math.max(
                minimum,
                number
            )
        )
        : fallback;
}


function is3dPanelEnabled() {
    return (
        localStorage.getItem(
            PANEL_3D_SETTINGS_KEY
        ) !== "false"
    );
}


/*
 * =========================================================
 * LANDSCAPE FILTER
 * =========================================================
 */

function createLandscapeFilter(
    features
) {
    const select =
        document.getElementById(
            "filter-paesaggio"
        );

    if (!select) {
        console.warn(
            "#filter-paesaggio not found"
        );

        return;
    }

    const values = [
        ...new Set(
            features
                .map(
                    feature =>
                        feature
                            .properties
                            .paesaggio
                )
                .filter(Boolean)
        )
    ].sort(
        (a, b) =>
            a.localeCompare(
                b,
                "it",
                {
                    sensitivity:
                        "base"
                }
            )
    );

    values.forEach(value => {
        const option =
            document.createElement(
                "option"
            );

        option.value =
            value;

        option.textContent =
            value;

        select.appendChild(
            option
        );
    });

    select.addEventListener(
        "change",
        () => {
            const selected =
                select.value;

            if (!selected) {
                setPointsFilter(
                    null
                );

                return;
            }

            const filter = [
                "==",
                ["get", "paesaggio"],
                selected
            ];

            /*
             * Apply the same filter to circles
             * and squares.
             */
            setPointsFilter(
                filter
            );

            const filtered =
                features.filter(
                    feature =>
                        feature
                            .properties
                            .paesaggio ===
                        selected
                );

            fitMapToFeatures(
                filtered
            );
        }
    );
}


/*
 * Apply the landscape filter to both possible
 * representations.
 */

function setPointsFilter(filter) {
    if (
        map.getLayer(
            POINT_LAYER
        )
    ) {
        map.setFilter(
            POINT_LAYER,
            filter
        );
    }

    if (
        map.getLayer(
            SQUARE_LAYER
        )
    ) {
        map.setFilter(
            SQUARE_LAYER,
            filter
        );
    }
}


/*
 * =========================================================
 * FIT MAP AFTER FILTERING
 * =========================================================
 */

function fitMapToFeatures(features) {
    if (!features.length) {
        return;
    }

    const bounds =
        new maplibregl
            .LngLatBounds();

    features.forEach(feature => {
        bounds.extend(
            feature
                .geometry
                .coordinates
        );
    });

    map.fitBounds(
        bounds,
        {
            padding: 60,
            maxZoom: 14,
            duration: 700
        }
    );
}


/*
 * =========================================================
 * THREE.JS CALLOUT INITIALIZATION
 * =========================================================
 */

function initializeThreeCallout(features) {
    if (!is3dPanelEnabled()) {
        console.log(
            "[app.js] 3D panel disabled"
        );

        return;
    }

    console.log(
        "[app.js] ThreePointCallout:",
        Boolean(
            window.ThreePointCallout
        )
    );

    if (!window.ThreePointCallout) {
        console.error(
            "three-fade.js is not loaded."
        );

        return;
    }

    window.ThreePointCallout.init(
        map,
        features
    );
}