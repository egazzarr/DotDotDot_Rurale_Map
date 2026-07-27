import * as maplibregl from "https://unpkg.com/maplibre-gl@6.0.0/dist/maplibre-gl.mjs";

/*
 * =========================================================
 * PMTILES SUPPORT
 * =========================================================
 *
 * Keep this only when your style.json uses pmtiles:// URLs.
 */
if (window.pmtiles) {
    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);
}


/*
 * =========================================================
 * FILES AND DATA SETTINGS
 * =========================================================
 */

const EPSG_25832 =
    "+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs";

const WGS84 = "EPSG:4326";

const GEOJSON_FILE =
    "./data/data_reduced/lat_long.json";

const CSV_FILE =
    "./data/data_reduced/dati_schede.csv";

const MAP_STYLE =
    "./styles_maputnik/style_dark_black.json";


/*
 * MapLibre IDs
 */
const POINT_SOURCE =
    "points-source";

const POINT_LAYER =
    "points-layer";
/*
 * CSV column names
 */
const TARGET_ID =
    "id_scheda_originale";

const TARGET_CONSERVAZIONE =
    "stcstato_di_conservazione__stccstato_di_conservazione_generale";

const TARGET_PAESAGGIO =
    "cacontesto_ambientale_naturale_paesaggistico__cabcontesto_paesaggistico";


/*
 * Palette loaded before app.js.
 */
const PALETTE =
    window.CONSERVATION_PALETTE;

if (!PALETTE?.colors) {
    throw new Error(
        "Palette non trovata. Caricare il file palette prima di app.js."
    );
}

// size of dots

const MIN_DOT_ZOOM = 5;
const MAX_DOT_ZOOM = 18;

const DOT_RADIUS_AT_MIN_ZOOM = 1; // when far
const DOT_RADIUS_AT_MAX_ZOOM = 7;

/*
 * =========================================================
 * MAP
 * =========================================================
 */

const map = new maplibregl.Map({
    container: "map",
    style: MAP_STYLE,

    center: [12.5, 42.5],
    zoom: 5,

    /*
     * Use a nonzero pitch so the Three.js callout
     * can be perceived in 3D.
     */
    pitch: 10,
    bearing: 0,

    maxPitch: 60, //case sensitive!!

    attributionControl: false,

    canvasContextAttributes: {
        antialias: true
    }
});


map.on("error", event => {
    console.error(
        "[MapLibre error]",
        event.error || event
    );
});


map.on("load", () => {
    console.log("[app.js] map loaded");

    loadData();
});


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

        Papa.parse(csvText, {
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
        });
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
        findCsvKeys(csvRows[0]);

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
                    !Array.isArray(coordinates) ||
                    coordinates.length < 2
                ) {
                    return null;
                }

                const x =
                    Number(coordinates[0]);

                const y =
                    Number(coordinates[1]);

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
                            cleanValue(
                                csvRow[
                                    csvKeys
                                        .conservazione
                                ]
                            ).toLowerCase(),

                        paesaggio:
                            cleanValue(
                                csvRow[
                                    csvKeys
                                        .paesaggio
                                ]
                            )
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
    addPointsLayer(features);
    createLandscapeFilter(features);

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

    Object.keys(firstRow).forEach(key => {
        const normalized =
            key
                .trim()
                .toLowerCase();

        if (
            normalized.includes(
                TARGET_ID.toLowerCase()
            )
        ) {
            result.id = key;
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
 * POINT LAYER
 * =========================================================
 */
function addPointsLayer(features) {
    map.addSource(POINT_SOURCE, {
        type: "geojson",
        data: {
            type: "FeatureCollection",
            features
        }
    });

    map.addLayer({
        id: POINT_LAYER,
        type: "circle",
        source: POINT_SOURCE,

        paint: {
            "circle-radius": [
                "interpolate",
                ["linear"],
                ["zoom"],

                MIN_DOT_ZOOM,
                DOT_RADIUS_AT_MIN_ZOOM,

                MAX_DOT_ZOOM,
                DOT_RADIUS_AT_MAX_ZOOM
            ], 

            "circle-color": [
                "match",
                ["get", "conservazione"],

                "non disponibile",
                PALETTE.colors["non disponibile"],

                "pessimo",
                PALETTE.colors.pessimo,

                "mediocre",
                PALETTE.colors.mediocre,

                "discreto",
                PALETTE.colors.discreto,

                "cattivo",
                PALETTE.colors.cattivo,

                "buono",
                PALETTE.colors.buono,

                PALETTE.colors["non disponibile"]
            ],

            "circle-opacity": [
                "match",
                ["get", "conservazione"],

                "non disponibile",
                PALETTE.opacity["non disponibile"],

                1, 
            ], "circle-blur": 0.7
        }
    });

    createConservationLegend();
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

        option.value = value;
        option.textContent = value;

        select.appendChild(option);
    });

    select.addEventListener(
        "change",
        () => {
            const selected =
                select.value;

            if (!selected) {
                map.setFilter(
                    POINT_LAYER,
                    null
                );

                /*
                 * Keep the current camera.
                 */
                return;
            }

            map.setFilter(
                POINT_LAYER,
                [
                    "==",
                    [
                        "get",
                        "paesaggio"
                    ],
                    selected
                ]
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
 * =========================================================
 * FIT MAP AFTER FILTERING
 * =========================================================
 */

function fitMapToFeatures(
    features
) {
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
 * CONSERVATION LEGEND
 * =========================================================
 */

function createConservationLegend() {
    document
        .getElementById(
            "conservation-legend"
        )
        ?.remove();

    const legend =
        document.createElement(
            "div"
        );

    legend.id =
        "conservation-legend";

    const title =
        document.createElement(
            "div"
        );

    title.className =
        "legend-title";

    title.textContent =
        "Stato di conservazione";

    legend.appendChild(title);

    PALETTE.order.forEach(
        status => {
            const item =
                document.createElement(
                    "div"
                );

            item.className =
                "legend-item";

            const square =
                document.createElement(
                    "span"
                );

            square.className =
                "legend-swatch";

            square.style
                .backgroundColor =
                PALETTE.colors[
                    status
                ];

            square.style.opacity =
                PALETTE.opacity[
                    status
                ];

            const label =
                document.createElement(
                    "span"
                );

            label.textContent =
                status
                    .charAt(0)
                    .toUpperCase() +
                status.slice(1);

            item.appendChild(square);
            item.appendChild(label);
            legend.appendChild(item);
        }
    );

    document.body.appendChild(
        legend
    );
}


/*
 * =========================================================
 * THREE.JS CALLOUT INITIALIZATION
 * =========================================================
 */

function initializeThreeCallout(features) {
    console.log(
        "[app.js] ThreePointCallout:",
        Boolean(window.ThreePointCallout)
    );

    if (!window.ThreePointCallout) {
        console.error(
            "three-point-callout.js is not loaded."
        );

        return;
    }

    window.ThreePointCallout.init(
        map,
        features
    );
}