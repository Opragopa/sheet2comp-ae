/*  Person Plates from Sheet
    After Effects ExtendScript (.jsx)

    Дублирует активную композицию-шаблон и заполняет:
    - текстовый слой "ИМЯ";
    - текстовый слой "ДОЛЖНОСТЬ";
    - слой фотографии, по умолчанию "Rectangle 3" или слой N6.
*/

(function personPlatesFromSheet(thisObj) {
    var SCRIPT_NAME = "Person Plates from Sheet";
    var isWindows = $.os.indexOf("Windows") !== -1;
    var SCRIPT_FILE = new File($.fileName);
    var SCRIPT_FOLDER = SCRIPT_FILE.parent;
    var CONFIG_FILE = new File(SCRIPT_FOLDER.fsName + "/ae_parser_config.json");
    var PYTHON_SCRIPT_PATH = SCRIPT_FOLDER.fsName + "/download_person_plate_data.py";
    var SETTINGS_FILE = new File(Folder.myDocuments.fsName + "/ae_person_plate_settings.json");
    var DATA_FOLDER = new Folder(Folder.myDocuments.fsName + "/ae_plaque_data");
    var JSON_FILE_NAME = "person_plates_data.json";
    var PHOTO_FOLDER_NAME = "person_plate_photos";
    var MANUAL_TSV_NAME = "person_plates_manual.tsv";
    var REFERENCE_SHEET_URL = "https://docs.google.com/spreadsheets/d/1J6nJHM4wXF66LJO7dDNT6QgrxlQ5VPb-3B-4o7Ff0js/edit?gid=0#gid=0";

    function trimText(value) {
        return String(value || "").replace(/^\s+|\s+$/g, "");
    }

    function normalizeKey(value) {
        return trimText(value).replace(/\s+/g, " ").toLowerCase();
    }

    function normalizeGoogleSheetUrl(url) {
        var text = trimText(url);
        var match = text.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (!match) return text;
        var gidMatch = text.match(/[?&#]gid=(\d+)/);
        var gid = gidMatch ? gidMatch[1] : "0";
        return "https://docs.google.com/spreadsheets/d/" + match[1] + "/gviz/tq?tqx=out:csv&gid=" + gid;
    }

    function extractGoogleSheetGid(url) {
        var text = trimText(url);
        var gidMatch = text.match(/[?&#]gid=(\d+)/);
        return gidMatch ? gidMatch[1] : "0";
    }

    function isGoogleSheetUrl(url) {
        return trimText(url).indexOf("docs.google.com/spreadsheets") !== -1;
    }

    function applyGoogleSheetGid(url, gid) {
        var text = trimText(url);
        if (!isGoogleSheetUrl(text)) return text;

        var cleanGid = trimText(gid).replace(/[^\d]/g, "");
        if (cleanGid === "") cleanGid = "0";

        if (text === "") return text;

        if (text.match(/[?&#]gid=\d+/)) {
            return text.replace(/([?&#]gid=)\d+/g, "$1" + cleanGid);
        }

        if (text.indexOf("#") !== -1) {
            return text + "&gid=" + cleanGid;
        }

        return text + (text.indexOf("?") === -1 ? "?" : "&") + "gid=" + cleanGid;
    }

    function buildPath(folder, filename) {
        return folder.fsName + (isWindows ? "\\" : "/") + filename;
    }

    function quoteShellArg(value) {
        var text = String(value);
        if (isWindows) return "\"" + text.replace(/"/g, "\\\"") + "\"";
        return "'" + text.replace(/'/g, "'\\''") + "'";
    }

    function quoteExecutable(value) {
        var text = String(value);
        if (!isWindows && text.indexOf("/usr/bin/env ") === 0) return text;
        if (text.indexOf("/") !== -1 || text.indexOf("\\") !== -1 || text.indexOf(":") !== -1) return quoteShellArg(text);
        return text;
    }

    function loadRuntimeConfig() {
        var defaults = { pythonCmd: isWindows ? "py -3" : "/usr/bin/python3" };
        if (!CONFIG_FILE.exists) return defaults;

        try {
            CONFIG_FILE.open("r");
            CONFIG_FILE.encoding = "UTF-8";
            var text = CONFIG_FILE.read();
            CONFIG_FILE.close();
            var config = (typeof JSON !== "undefined" && JSON.parse) ? JSON.parse(text) : eval("(" + text + ")");
            if (!config.pythonCmd) config.pythonCmd = defaults.pythonCmd;
            return config;
        } catch (e) {
            return defaults;
        }
    }

    function loadSettings() {
        var defaults = {
            sheetUrl: REFERENCE_SHEET_URL,
            sheetGid: "0",
            dataMode: "Таблица",
            manualPeopleText: "",
            nameField: "ФИО спикера",
            positionField: "Должность",
            photoField: "Фото на плашку",
            shiftField: "Смена",
            shiftFilter: "единство",
            templateCompName: "",
            nameLayer: "ИМЯ",
            nameLayerIndex: "3",
            positionLayer: "ДОЛЖНОСТЬ",
            positionLayerIndex: "4",
            graphicType: "Плашка",
            photoLayer: "Rectangle 3",
            photoLayerIndex: "6",
            photoContentLayer: "",
            photoContentLayerIndex: "",
            photoCompPrefix: "PHOTO",
            requirePhotoPrecomp: false,
            autoImportPhotos: true,
            recreateExistingComps: false,
            targetFolderName: "",
            compPrefix: "Плашка",
            delimiter: "_",
            photoFolderPath: "",
            fitPhotoToPlaceholder: true,
            addToRenderQueue: false
        };

        if (!SETTINGS_FILE.exists) return defaults;

        try {
            SETTINGS_FILE.open("r");
            SETTINGS_FILE.encoding = "UTF-8";
            var data = JSON.parse(SETTINGS_FILE.read());
            SETTINGS_FILE.close();
            for (var key in defaults) {
                if (!data.hasOwnProperty(key)) data[key] = defaults[key];
            }
            if (!data.sheetUrl) data.sheetUrl = defaults.sheetUrl;
            if (!data.sheetGid) data.sheetGid = extractGoogleSheetGid(data.sheetUrl);
            if (data.dataMode !== "Вручную" && data.dataMode !== "Таблица") data.dataMode = defaults.dataMode;
            if (data.nameField === "ИМЯ ФАМИЛИЯ") data.nameField = defaults.nameField;
            if (data.positionField === "ДОЛЖНОСТЬ") data.positionField = defaults.positionField;
            if (normalizeKey(data.photoField) === normalizeKey("фото на плашку")) data.photoField = defaults.photoField;
            if (data.graphicType !== "Визитка" && data.graphicType !== "Плашка") data.graphicType = defaults.graphicType;
            return data;
        } catch (e) {
            return defaults;
        }
    }

    function saveSettings(settings) {
        try {
            SETTINGS_FILE.open("w");
            SETTINGS_FILE.encoding = "UTF-8";
            SETTINGS_FILE.write(JSON.stringify(settings, null, 2));
            SETTINGS_FILE.close();
            return true;
        } catch (e) {
            return false;
        }
    }

    function getDataJsonFile() {
        if (!DATA_FOLDER.exists) DATA_FOLDER.create();
        return new File(buildPath(DATA_FOLDER, JSON_FILE_NAME));
    }

    function getManualTsvFile() {
        if (!DATA_FOLDER.exists) DATA_FOLDER.create();
        return new File(buildPath(DATA_FOLDER, MANUAL_TSV_NAME));
    }

    function getDefaultPhotosFolder() {
        if (!DATA_FOLDER.exists) DATA_FOLDER.create();
        var folder = new Folder(buildPath(DATA_FOLDER, PHOTO_FOLDER_NAME));
        if (!folder.exists) folder.create();
        return folder;
    }

    function getPhotosFolder(settings) {
        var folderPath = settings ? trimText(settings.photoFolderPath) : "";
        var folder = folderPath !== "" ? new Folder(folderPath) : getDefaultPhotosFolder();
        if (!folder.exists) folder.create();
        return folder;
    }

    function buildPythonCommand(pythonCmd, sheetUrl, jsonPath, photosPath, photoField, nameField, autoImportPhotos) {
        var pyScript = new File(PYTHON_SCRIPT_PATH);
        var parts = [
            quoteExecutable(pythonCmd),
            quoteShellArg(pyScript.fsName),
            quoteShellArg(normalizeGoogleSheetUrl(sheetUrl)),
            quoteShellArg(jsonPath),
            quoteShellArg(photosPath),
            quoteShellArg(photoField),
            quoteShellArg(nameField),
            autoImportPhotos ? "1" : "0"
        ];
        var inner = parts.join(" ") + " 2>&1";
        if (isWindows) return "cmd /c " + inner;
        return "/bin/sh -lc " + quoteShellArg(inner);
    }

    function getSourceTextProperty(layer) {
        var textProps = layer.property("ADBE Text Properties");
        if (!textProps) return null;
        return textProps.property("ADBE Text Document");
    }

    function getTextLayerText(layer) {
        var sourceText = getSourceTextProperty(layer);
        if (!sourceText) return "";
        try {
            return String(sourceText.value.text || "");
        } catch (e1) {
            try {
                return String(sourceText.value || "");
            } catch (e2) {
                return "";
            }
        }
    }

    function normalizeLayerSearchText(value) {
        return trimText(value).replace(/\s+/g, " ").replace(/ё/g, "е").toLowerCase();
    }

    function findTextLayer(comp, layerName, layerIndexText) {
        var wanted = normalizeLayerSearchText(layerName);

        for (var i = 1; i <= comp.numLayers; i++) {
            var layer = comp.layer(i);
            if (getSourceTextProperty(layer) === null) continue;
            if (layer.name === layerName || normalizeLayerSearchText(layer.name) === wanted) return layer;
        }

        for (var t = 1; t <= comp.numLayers; t++) {
            var textLayer = comp.layer(t);
            if (getSourceTextProperty(textLayer) === null) continue;
            if (normalizeLayerSearchText(getTextLayerText(textLayer)) === wanted) return textLayer;
        }

        var index = parseInt(layerIndexText, 10);
        if (!isNaN(index) && index >= 1 && index <= comp.numLayers) {
            var indexedLayer = comp.layer(index);
            if (getSourceTextProperty(indexedLayer) !== null) return indexedLayer;
        }

        return null;
    }

    function setTextLayer(comp, layerName, layerIndexText, value) {
        var layer = findTextLayer(comp, layerName, layerIndexText);
        if (!layer) throw new Error("В композиции \"" + comp.name + "\" не найден текстовый слой \"" + layerName + "\". Проверьте имя слоя или fallback N" + layerIndexText + ".");

        var prop = getSourceTextProperty(layer);
        var currentDoc = prop.value;
        var nextDoc = new TextDocument(String(value || ""));

        try { nextDoc.font = currentDoc.font; } catch (e1) {}
        try { nextDoc.fontSize = currentDoc.fontSize; } catch (e2) {}
        try { nextDoc.fillColor = currentDoc.fillColor; } catch (e3) {}
        try { nextDoc.applyFill = currentDoc.applyFill; } catch (e4) {}
        try { nextDoc.applyStroke = currentDoc.applyStroke; } catch (e5) {}
        try { nextDoc.strokeColor = currentDoc.strokeColor; } catch (e6) {}
        try { nextDoc.strokeWidth = currentDoc.strokeWidth; } catch (e7) {}
        try { nextDoc.justification = currentDoc.justification; } catch (e8) {}
        try { nextDoc.tracking = currentDoc.tracking; } catch (e9) {}
        try { nextDoc.leading = currentDoc.leading; } catch (e10) {}

        prop.setValue(nextDoc);
        return layer;
    }

    function expressionStringLiteral(value) {
        return "\"" + String(value || "")
            .replace(/\\/g, "\\\\")
            .replace(/"/g, "\\\"")
            .replace(/\r/g, "\\r")
            .replace(/\n/g, "\\n") + "\"";
    }

    function buildPositionAutoScaleExpression(fallbackText) {
        var fallback = cleanPlateText(fallbackText) || "должность не задана";
        return [
            "function sliderValue(name, defaultValue) {",
            "    try {",
            "        return thisComp.layer(\"CONTROL\").effect(name)(\"Slider\").value;",
            "    } catch (e1) {",
            "        try {",
            "            return thisComp.layer(\"CONTROLLER\").effect(name)(\"Slider\").value;",
            "        } catch (e2) {",
            "            return defaultValue;",
            "        }",
            "    }",
            "}",
            "",
            "var fallbackText = " + expressionStringLiteral(fallback) + ";",
            "var txt = \"\";",
            "try {",
            "    if (value && value.text !== undefined) {",
            "        txt = value.text;",
            "    } else {",
            "        txt = value.toString();",
            "    }",
            "} catch (e) {",
            "    txt = \"\";",
            "}",
            "txt = txt.toString().replace(/^\\s+|\\s+$/g, \"\");",
            "if (txt === \"\") {",
            "    txt = fallbackText;",
            "}",
            "",
            "var baseSize = sliderValue(\"Regalia Base Size\", 42);",
            "var minSize = sliderValue(\"Regalia Min Size\", 10);",
            "var boxChars = sliderValue(\"Regalia Chars Per Line\", 24);",
            "var maxLines = sliderValue(\"Regalia Max Lines\", 4);",
            "var manualSize = sliderValue(\"Regalia Manual Size\", 0);",
            "",
            "var clean = txt.toString().replace(/\\s+/g, \" \");",
            "var chars = clean.length;",
            "var estimatedLines = Math.ceil(chars / Math.max(boxChars, 1));",
            "",
            "var k = maxLines / Math.max(estimatedLines, 1);",
            "var nextSize = Math.floor(baseSize * Math.min(1, k));",
            "nextSize = Math.max(minSize, nextSize);",
            "",
            "if (manualSize > 0) {",
            "    nextSize = manualSize;",
            "}",
            "",
            "txt = txt.charAt(0).toUpperCase() + txt.substring(1);",
            "",
            "style",
            "    .setFontSize(nextSize)",
            "    .setText(txt);"
        ].join("\n");
    }

    function applyPositionExpression(layer, fallbackText) {
        var prop = getSourceTextProperty(layer);
        if (!prop || !prop.canSetExpression) return false;
        prop.expression = buildPositionAutoScaleExpression(fallbackText);
        prop.expressionEnabled = true;
        return true;
    }

    function buildNameExpression() {
        return [
            "var delimiter = \"_\";",
            "",
            "function clean(v) {",
            "    return String(v || \"\").replace(/[\\r\\n\\t]+/g, \" \").replace(/\\s+/g, \" \").replace(/^\\s+|\\s+$/g, \"\");",
            "}",
            "",
            "function textValue(v) {",
            "    try {",
            "        if (v && v.text !== undefined) return clean(v.text);",
            "    } catch (e1) {}",
            "    try {",
            "        return clean(v.toString());",
            "    } catch (e2) {}",
            "    return \"\";",
            "}",
            "",
            "function getText(layerName) {",
            "    try {",
            "        return textValue(thisComp.layer(layerName).text.sourceText.value);",
            "    } catch (e) {",
            "        return \"\";",
            "    }",
            "}",
            "",
            "function stripDateTimePrefix(text) {",
            "    var t = clean(text);",
            "    t = t.replace(/^\\d{1,2}[.\\/-]\\d{1,2}[_\\s-]+\\d{1,2}[-:.]\\d{2}[_\\s-]*/, \"\");",
            "    t = t.replace(/^\\d{1,2}[-:.]\\d{2}[_\\s-]+/, \"\");",
            "    return clean(t);",
            "}",
            "",
            "function personFromCompName() {",
            "    var parts = thisComp.name.split(delimiter);",
            "    var full = \"\";",
            "    if (parts.length >= 3 && /^\\d{1,2}[.\\/-]\\d{1,2}$/.test(clean(parts[0])) && /^\\d{1,2}[-:.]\\d{2}$/.test(clean(parts[1]))) {",
            "        full = parts.slice(2).join(delimiter);",
            "    } else if (parts.length > 1) {",
            "        full = parts.slice(1).join(delimiter);",
            "    } else {",
            "        full = thisComp.name;",
            "    }",
            "    return stripDateTimePrefix(full);",
            "}",
            "",
            "function firstLastFromLastFirst(text) {",
            "    var full = stripDateTimePrefix(text);",
            "    var compactInitials = full.match(/^((?:[А-ЯЁA-Z]\\.\\s*){1,3})([А-ЯЁA-Z][а-яёa-z-]+)$/);",
            "    if (compactInitials) {",
            "        return clean(compactInitials[1].replace(/\\s+/g, \"\") + \" \" + compactInitials[2]);",
            "    }",
            "    var parts = full.split(\" \");",
            "    if (parts.length >= 2) {",
            "        return clean(parts.slice(1).join(\" \") + \" \" + parts[0]);",
            "    }",
            "    return full;",
            "}",
            "",
            "var manual = getText(\"MANUAL_NAME\");",
            "var current = textValue(value);",
            "var result = manual;",
            "if (result === \"\" && current !== \"\" && current !== \"ФИО спикера\" && current !== \"ИМЯ\" && current !== \"ИМЯ ФАМИЛИЯ\") {",
            "    result = current;",
            "}",
            "if (result === \"\") {",
            "    result = firstLastFromLastFirst(personFromCompName());",
            "}",
            "",
            "result.toUpperCase();"
        ].join("\n");
    }

    function applyNameExpression(layer) {
        var prop = getSourceTextProperty(layer);
        if (!prop || !prop.canSetExpression) return false;
        prop.expression = buildNameExpression();
        prop.expressionEnabled = true;
        return true;
    }

    function normalizeRow(row) {
        var clean = {};
        for (var key in row) {
            if (row.hasOwnProperty(key)) clean[trimText(key)] = row[key] === null || row[key] === undefined ? "" : String(row[key]);
        }
        return clean;
    }

    function getByColumn(row, columnName) {
        if (row.hasOwnProperty(columnName)) return row[columnName];

        var wanted = normalizeKey(columnName);
        for (var key in row) {
            if (row.hasOwnProperty(key) && normalizeKey(key) === wanted) return row[key];
        }
        return "";
    }

    function cleanPlateText(value) {
        return trimText(String(value || "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " "));
    }

    function safeCompText(value, delimiter) {
        var text = cleanPlateText(value);
        if (!delimiter) return text;
        return text.replace(new RegExp(escapeRegExp(delimiter), "g"), " ");
    }

    function tsvEscape(value) {
        return String(value || "").replace(/\r?\n/g, " ").replace(/\t/g, " ").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
    }

    function splitManualLine(line) {
        var text = trimText(line);
        if (text.indexOf("\t") !== -1) return text.split("\t");
        if (text.indexOf("|") !== -1) return text.split("|");
        if (text.indexOf(";") !== -1) return text.split(";");
        return [text];
    }

    function isManualHeaderLine(parts) {
        if (!parts || parts.length === 0) return false;
        var first = normalizeKey(parts[0]);
        if (first !== "фио" && first !== "фио спикера" && first !== "имя" && first !== "имя фамилия") return false;
        if (parts.length === 1) return true;
        var second = normalizeKey(parts[1]);
        return second === "" || second === "должность" || second === "регалии";
    }

    function parseManualRows(text, settings) {
        var lines = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
        var rows = [];
        for (var i = 0; i < lines.length; i++) {
            var line = trimText(lines[i]);
            if (line === "") continue;

            var parts = splitManualLine(line);
            for (var p = 0; p < parts.length; p++) parts[p] = cleanPlateText(parts[p]);
            if (rows.length === 0 && isManualHeaderLine(parts)) continue;

            var name = parts[0] || "";
            if (name === "") continue;
            rows.push({
                name: name,
                position: parts.length > 1 ? parts[1] : "",
                photo: parts.length > 2 ? parts[2] : "",
                shift: parts.length > 3 ? parts[3] : ""
            });
        }
        return rows;
    }

    function writeManualTsv(settings) {
        var rows = parseManualRows(settings.manualPeopleText, settings);
        if (rows.length === 0) {
            throw new Error("Ручной список пуст. Добавьте хотя бы одну строку: Имя Фамилия | Должность | Фото/ссылка | Смена");
        }

        var file = getManualTsvFile();
        file.encoding = "UTF-8";
        if (!file.open("w")) throw new Error("Не удалось создать ручной TSV: " + file.fsName);

        var nameHeader = trimText(settings.nameField) || "ФИО спикера";
        var positionHeader = trimText(settings.positionField) || "Должность";
        var photoHeader = trimText(settings.photoField) || "Фото на плашку";
        var shiftHeader = trimText(settings.shiftField) || "Смена";

        file.write([nameHeader, positionHeader, photoHeader, shiftHeader].join("\t") + "\n");
        for (var i = 0; i < rows.length; i++) {
            file.write([
                tsvEscape(rows[i].name),
                tsvEscape(rows[i].position),
                tsvEscape(rows[i].photo),
                tsvEscape(rows[i].shift)
            ].join("\t") + "\n");
        }
        file.close();
        return { file: file, count: rows.length };
    }

    function isRegaliaToken(value) {
        var token = cleanPlateText(value).replace(/\./g, "").replace(/ё/g, "е").toLowerCase();
        var stopWords = {
            "д": true,
            "к": true,
            "м": true,
            "н": true,
            "доктор": true,
            "кандидат": true,
            "проф": true,
            "профессор": true,
            "доцент": true,
            "академик": true,
            "заслуженный": true,
            "народный": true,
            "артист": true,
            "артистка": true,
            "рф": true,
            "наук": true,
            "искусствоведения": true,
            "филологических": true,
            "исторических": true,
            "экономических": true,
            "юридических": true,
            "педагогических": true,
            "медицинских": true,
            "технических": true,
            "dr": true,
            "phd": true
        };
        return stopWords[token] === true;
    }

    function shortCompNameText(value, delimiter) {
        var text = safeCompText(value, delimiter).replace(/\([^)]*\)/g, " ");
        text = cleanPlateText(text);
        if (text === "") return "Без имени";

        var rawParts = text.split(/\s+/);
        var parts = [];
        for (var i = 0; i < rawParts.length; i++) {
            var part = rawParts[i].replace(/^[,;:()\[\]{}"']+|[,;:()\[\]{}"']+$/g, "");
            if (part === "" || isRegaliaToken(part)) continue;
            parts.push(part);
            if (parts.length >= 2) break;
        }

        var result = parts.length > 0 ? parts.join(" ") : text;
        if (result.length > 32) result = result.substring(0, 32);
        return cleanPlateText(result);
    }

    function titleCaseNamePart(value) {
        var text = cleanPlateText(value).toLowerCase();
        if (text === "") return text;

        var chunks = text.split("-");
        for (var i = 0; i < chunks.length; i++) {
            if (chunks[i].length > 0) {
                chunks[i] = chunks[i].charAt(0).toUpperCase() + chunks[i].substring(1);
            }
        }
        return chunks.join("-");
    }

    function compPersonNameText(value) {
        var text = safeCompText(value, "_").replace(/\([^)]*\)/g, " ");
        text = cleanPlateText(text);
        if (text === "") return "Без имени";

        var rawParts = text.split(/\s+/);
        var parts = [];
        for (var i = 0; i < rawParts.length; i++) {
            var part = rawParts[i].replace(/^[,;:()\[\]{}"']+|[,;:()\[\]{}"']+$/g, "");
            if (part === "" || isRegaliaToken(part)) continue;
            parts.push(part);
            if (parts.length >= 2) break;
        }

        if (parts.length >= 2) {
            return titleCaseNamePart(parts[1]) + " " + titleCaseNamePart(parts[0]);
        }
        return titleCaseNamePart(parts[0] || text);
    }

    function cleanCompPersonNameText(value) {
        var text = safeCompText(value, "_").replace(/\([^)]*\)/g, " ");
        text = cleanPlateText(text);
        return text || "Без имени";
    }

    function buildOutputCompName(settings, name, timePrefix) {
        var prefix = cleanPlateText(settings.compPrefix) || "Визитка";
        var delimiter = settings.delimiter || "_";
        var cleanTime = cleanPlateText(timePrefix);
        // Rows from the recording plan carry an explicit date-and-time prefix.
        // It is a data contract, so it must win over any UI prefix/type setting.
        if (cleanTime !== "") {
            return cleanTime + delimiter + cleanCompPersonNameText(name);
        }
        return prefix + delimiter + cleanCompPersonNameText(name);
    }

    function uniqueNamePush(list, value) {
        var text = cleanPlateText(value);
        if (text === "") return;
        for (var i = 0; i < list.length; i++) {
            if (list[i] === text) return;
        }
        list.push(text);
    }

    function plateDataFromRow(row, settings) {
        var rawName = cleanPlateText(getByColumn(row, settings.nameField));
        var name = cleanPlateText(getByColumn(row, "__nameFirstLast")) || cleanPlateText(getByColumn(row, "__formattedName")) || rawName;
        if (rawName !== "" && name.indexOf(" ") === -1 && rawName.indexOf(" ") !== -1) {
            name = rawName.toUpperCase();
        }
        var compPersonName = cleanPlateText(getByColumn(row, "__nameLastFirst")) || compPersonNameText(rawName || name);
        var timePrefix = cleanPlateText(getByColumn(row, "__compTimePrefix"));
        return {
            rawName: rawName,
            name: name,
            compPersonName: compPersonName,
            timePrefix: timePrefix,
            position: cleanPlateText(getByColumn(row, settings.positionField)),
            photoPath: cleanPlateText(getByColumn(row, "__photoLocalPath")),
            compName: buildOutputCompName(settings, compPersonName, timePrefix)
        };
    }

    function personAliasKey(value) {
        var parts = cleanCompPersonNameText(value).split(/\s+/);
        if (parts.length < 2) return normalizeKey(value);
        var surname = parts[0];
        var first = parts[1];
        var initial = first.toUpperCase().replace(/[^A-ZА-ЯЁ]/g, "").charAt(0);
        if (initial === "") initial = first.charAt(0);
        return normalizeKey(surname + "_" + initial);
    }

    function timeSortKey(value) {
        var text = cleanPlateText(value);
        var match = text.match(/(\d{1,2})-(\d{2})/);
        if (!match) return 999999;
        return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
    }

    function removeAllLayers(comp) {
        for (var i = comp.numLayers; i >= 1; i--) {
            try { comp.layer(i).remove(); } catch (e) {}
        }
    }

    function makeLinkedPlateComp(masterComp, targetFolder, compName, sourceComp) {
        var comp = masterComp.duplicate();
        comp.parentFolder = targetFolder;
        comp.name = compName;
        removeAllLayers(comp);
        var layer = comp.layers.add(sourceComp);
        try { layer.startTime = 0; } catch (e1) {}
        try { layer.property("ADBE Transform Group").property("ADBE Position").setValue([comp.width / 2, comp.height / 2]); } catch (e2) {}
        return comp;
    }

    function possibleExistingCompNames(settings, plateData) {
        var names = [];
        uniqueNamePush(names, plateData.compName);
        uniqueNamePush(names, buildOutputCompName(settings, plateData.rawName, plateData.timePrefix));
        uniqueNamePush(names, buildOutputCompName(settings, plateData.name, plateData.timePrefix));
        uniqueNamePush(names, buildOutputCompName(settings, compPersonNameText(plateData.rawName), plateData.timePrefix));
        uniqueNamePush(names, buildOutputCompName(settings, compPersonNameText(plateData.name), plateData.timePrefix));

        var prefix = cleanPlateText(settings.compPrefix) || "Визитка";
        var delimiter = settings.delimiter || "_";
        if (plateData.rawName !== "") {
            uniqueNamePush(names, prefix + delimiter + safeCompText(plateData.rawName, delimiter));
            uniqueNamePush(names, prefix + delimiter + safeCompText(plateData.rawName.replace(/\s+/g, ""), delimiter));
        }
        return names;
    }

    var PERSON_META_MARKER = "SHEET2COMP_PERSON_META";

    function jsonEncodeObject(value) {
        if (typeof JSON !== "undefined" && JSON.stringify) return JSON.stringify(value);
        var parts = [];
        for (var key in value) {
            if (value.hasOwnProperty(key)) {
                parts.push("\"" + key + "\":\"" + String(value[key] || "").replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\r/g, "\\r").replace(/\n/g, "\\n") + "\"");
            }
        }
        return "{" + parts.join(",") + "}";
    }

    function jsonDecodeObject(text) {
        if (!text) return null;
        try {
            if (typeof JSON !== "undefined" && JSON.parse) return JSON.parse(text);
            return eval("(" + text + ")");
        } catch (e) {
            return null;
        }
    }

    function normalizeMetaPart(value) {
        return cleanPlateText(value).replace(/ё/g, "е").toLowerCase();
    }

    function plateStableKey(plateData) {
        var person = personAliasKey(plateData.compPersonName || plateData.name || plateData.rawName);
        var time = normalizeMetaPart(plateData.timePrefix);
        return (time !== "" ? time + "|" : "") + person;
    }

    function plateSignature(plateData) {
        return [
            normalizeMetaPart(plateData.name),
            normalizeMetaPart(plateData.position),
            normalizeMetaPart(plateData.photoPath)
        ].join("|");
    }

    function buildPlateMeta(settings, plateData) {
        return {
            kind: "person-plate",
            version: "1",
            key: plateStableKey(plateData),
            expectedCompName: plateData.compName,
            name: plateData.name,
            position: plateData.position,
            photoPath: plateData.photoPath,
            signature: plateSignature(plateData),
            updatedAt: (new Date()).toISOString ? (new Date()).toISOString() : String(new Date())
        };
    }

    function readPlateMeta(comp) {
        var comment = String(comp.comment || "");
        var pattern = new RegExp("\\[" + PERSON_META_MARKER + "\\]([\\s\\S]*?)\\[\\/" + PERSON_META_MARKER + "\\]");
        var match = comment.match(pattern);
        return match ? jsonDecodeObject(match[1]) : null;
    }

    function writePlateMeta(comp, meta) {
        var comment = String(comp.comment || "");
        var pattern = new RegExp("\\n?\\[" + PERSON_META_MARKER + "\\][\\s\\S]*?\\[\\/" + PERSON_META_MARKER + "\\]", "g");
        comment = comment.replace(pattern, "");
        comp.comment = trimText(comment + "\n[" + PERSON_META_MARKER + "]" + jsonEncodeObject(meta) + "[/" + PERSON_META_MARKER + "]");
    }

    function compLoosePlateKey(comp, settings) {
        var delimiter = settings.delimiter || "_";
        var name = cleanPlateText(comp.name);
        var parts = name.split(delimiter);
        if (parts.length < 2) return "";
        var time = "";
        var person = "";
        if (parts[0].match(/^\d{1,2}-\d{2}/)) {
            time = normalizeMetaPart(parts[0]);
            person = parts.slice(1).join(" ");
        } else {
            person = parts.slice(1).join(" ");
        }
        var personKey = personAliasKey(person);
        return (time !== "" ? time + "|" : "") + personKey;
    }

    function findPlateComp(settings, plateData, targetFolder, masterComp) {
        var wantedKey = plateStableKey(plateData);
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (!(item instanceof CompItem) || item === masterComp || item.parentFolder !== targetFolder) continue;
            var meta = readPlateMeta(item);
            if (meta && meta.kind === "person-plate" && meta.key === wantedKey) {
                return { comp: item, method: "meta", meta: meta };
            }
        }

        var possibleNames = possibleExistingCompNames(settings, plateData);
        var byName = findFirstCompByNamesInFolder(possibleNames, targetFolder, masterComp);
        if (byName) return { comp: byName, method: "name", meta: readPlateMeta(byName) };

        for (var c = 1; c <= app.project.numItems; c++) {
            var comp = app.project.item(c);
            if (!(comp instanceof CompItem) || comp === masterComp || comp.parentFolder !== targetFolder) continue;
            if (compLoosePlateKey(comp, settings) === wantedKey) {
                return { comp: comp, method: "loose-name", meta: readPlateMeta(comp) };
            }
        }
        return null;
    }

    function getCompTextValue(comp, layerName, layerIndexText) {
        var layer = findTextLayer(comp, layerName, layerIndexText);
        return layer ? cleanPlateText(getTextLayerText(layer)) : "";
    }

    function shouldRenameMatchedComp(match, plateData) {
        if (!match || !match.comp || match.comp.name === plateData.compName) return false;
        if (match.method === "name") return true;
        if (match.method === "meta" && match.meta && match.comp.name === match.meta.expectedCompName) return true;
        return false;
    }

    function describePlateDiff(comp, settings, plateData, meta) {
        var changes = [];
        var currentName = getCompTextValue(comp, settings.nameLayer, settings.nameLayerIndex);
        var currentPosition = getCompTextValue(comp, settings.positionLayer, settings.positionLayerIndex);
        if (normalizeMetaPart(currentName) !== normalizeMetaPart(plateData.name)) {
            changes.push("имя: \"" + currentName + "\" -> \"" + plateData.name + "\"");
        }
        if (normalizeMetaPart(currentPosition) !== normalizeMetaPart(plateData.position)) {
            changes.push("должность: \"" + currentPosition + "\" -> \"" + plateData.position + "\"");
        }
        if (meta && normalizeMetaPart(meta.photoPath) !== normalizeMetaPart(plateData.photoPath) && plateData.photoPath !== "") {
            changes.push("фото: обновить файл");
        }
        return changes;
    }

    function findCompsByNameInFolder(name, folder, exceptComp) {
        var matches = [];
        var wanted = cleanPlateText(name);
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.name === wanted && item.parentFolder === folder && item !== exceptComp) {
                matches.push(item);
            }
        }
        return matches;
    }

    function findFirstCompByNamesInFolder(names, folder, exceptComp) {
        for (var n = 0; n < names.length; n++) {
            var matches = findCompsByNameInFolder(names[n], folder, exceptComp);
            if (matches.length > 0) return matches[0];
        }
        return null;
    }

    function findCompByName(name) {
        var wanted = cleanPlateText(name);
        if (wanted === "") return null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && cleanPlateText(item.name) === wanted) {
                return item;
            }
        }
        return null;
    }

    function findOrCreateFolder(parentFolder, folderName) {
        var cleanName = cleanPlateText(folderName);
        var parent = parentFolder || app.project.rootFolder;
        if (cleanName === "") return parent;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof FolderItem && item.parentFolder === parent && item.name === cleanName) {
                return item;
            }
        }
        var folder = app.project.items.addFolder(cleanName);
        folder.parentFolder = parent;
        return folder;
    }

    function targetFolderForMaster(masterComp, settings) {
        var parent = masterComp.parentFolder || app.project.rootFolder;
        return findOrCreateFolder(parent, settings.targetFolderName);
    }

    function collectProjectComps() {
        var comps = [];
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem) comps.push(item);
        }
        comps.sort(function(a, b) {
            var an = String(a.name).toLowerCase();
            var bn = String(b.name).toLowerCase();
            if (an < bn) return -1;
            if (an > bn) return 1;
            return 0;
        });
        return comps;
    }

    function removeComps(items) {
        for (var i = items.length - 1; i >= 0; i--) {
            try {
                items[i].remove();
            } catch (removeError) {}
        }
    }

    function normalizeFilterText(value) {
        return cleanPlateText(value).replace(/ё/g, "е").toLowerCase();
    }

    function splitFilterValues(value) {
        var text = cleanPlateText(value);
        if (text === "") return [];

        var rawParts = text.split(/[,;\n\r]+/);
        var values = [];
        for (var i = 0; i < rawParts.length; i++) {
            var part = normalizeFilterText(rawParts[i]);
            if (part !== "") values.push(part);
        }
        return values;
    }

    function rowMatchesShiftFilter(row, settings) {
        var filterValues = splitFilterValues(settings.shiftFilter);
        if (filterValues.length === 0) return true;

        if (cleanPlateText(settings.shiftField) === "") return true;

        var shiftValue = getByColumn(row, settings.shiftField);
        if (settings.dataMode === "Вручную" && cleanPlateText(shiftValue) === "") return true;
        var shiftTokens = splitFilterValues(shiftValue);
        var normalizedShift = normalizeFilterText(shiftValue);
        if (shiftTokens.length === 0 && normalizedShift === "") return false;

        for (var i = 0; i < filterValues.length; i++) {
            if (normalizedShift === filterValues[i]) return true;
            for (var s = 0; s < shiftTokens.length; s++) {
                if (shiftTokens[s] === filterValues[i]) return true;
            }
        }
        return false;
    }

    function escapeRegExp(value) {
        return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function findPhotoLayer(comp, layerName, layerIndexText) {
        if (trimText(layerName) !== "") {
            for (var i = 1; i <= comp.numLayers; i++) {
                if (comp.layer(i).name === layerName) return comp.layer(i);
            }
        }

        var commonNames = ["PHOTO", "PHOTO_TEMPLATE", "Rectangle 3"];
        for (var c = 0; c < commonNames.length; c++) {
            for (var n = 1; n <= comp.numLayers; n++) {
                if (comp.layer(n).name === commonNames[c]) return comp.layer(n);
            }
        }

        var index = parseInt(layerIndexText, 10);
        if (!isNaN(index) && index >= 1 && index <= comp.numLayers) return comp.layer(index);
        return null;
    }

    function readJsonArray(file) {
        if (!file.exists) throw new Error("JSON не создан: " + file.fsName);
        file.open("r");
        file.encoding = "UTF-8";
        var text = file.read();
        file.close();
        return (typeof JSON !== "undefined" && JSON.parse) ? JSON.parse(text) : eval("(" + text + ")");
    }

    function decodeUriPath(value) {
        var text = String(value || "");
        if (text.indexOf("%") === -1) return text;
        try {
            return decodeURI(text);
        } catch (e) {
            return text;
        }
    }

    function importFootage(filePath) {
        var file = new File(decodeUriPath(filePath));
        if (!file.exists) throw new Error("Файл фото не найден: " + filePath);
        var options = new ImportOptions(file);
        options.importAs = ImportAsType.FOOTAGE;
        return app.project.importFile(options);
    }

    function copyTransform(fromLayer, toLayer) {
        var props = [
            "ADBE Anchor Point",
            "ADBE Position",
            "ADBE Scale",
            "ADBE Rotate Z",
            "ADBE Opacity"
        ];
        for (var i = 0; i < props.length; i++) {
            try {
                var fromProp = fromLayer.property("ADBE Transform Group").property(props[i]);
                var toProp = toLayer.property("ADBE Transform Group").property(props[i]);
                if (fromProp && toProp) toProp.setValue(fromProp.value);
            } catch (e) {}
        }
        try { toLayer.startTime = fromLayer.startTime; } catch (e1) {}
        try { toLayer.inPoint = fromLayer.inPoint; } catch (e2) {}
        try { toLayer.outPoint = fromLayer.outPoint; } catch (e3) {}
    }

    function getLayerVisualSize(layer) {
        var scale = layer.property("ADBE Transform Group").property("ADBE Scale").value;
        var width = 0;
        var height = 0;

        try {
            if (layer.source) {
                width = layer.source.width * scale[0] / 100;
                height = layer.source.height * scale[1] / 100;
            }
        } catch (e1) {}

        if (width <= 0 || height <= 0) {
            try {
                var rect = layer.sourceRectAtTime(0, false);
                width = rect.width * scale[0] / 100;
                height = rect.height * scale[1] / 100;
            } catch (e2) {}
        }

        return { width: width, height: height };
    }

    function fitFootageToSize(layer, footage, size) {
        if (!size || size.width <= 0 || size.height <= 0 || !footage || footage.width <= 0 || footage.height <= 0) return;
        var cover = Math.max(size.width / footage.width, size.height / footage.height) * 100;
        try {
            layer.property("ADBE Transform Group").property("ADBE Scale").setValue([cover, cover]);
        } catch (e) {}
    }

    function isReplaceablePhotoLayer(layer) {
        try {
            return layer && layer.source && !(layer.source instanceof CompItem);
        } catch (e) {
            return false;
        }
    }

    function isFilePhotoLayer(layer) {
        try {
            return isReplaceablePhotoLayer(layer) && layer.source.mainSource && layer.source.mainSource.file;
        } catch (e) {
            return false;
        }
    }

    function isPrecompLayer(layer) {
        try {
            return layer && layer.source && layer.source instanceof CompItem;
        } catch (e) {
            return false;
        }
    }

    function findLayerByName(comp, layerName) {
        for (var i = 1; i <= comp.numLayers; i++) {
            if (comp.layer(i).name === layerName) return comp.layer(i);
        }
        return null;
    }

    function findReplaceablePhotoContentLayer(photoComp, layerName, layerIndexText) {
        var wantedName = trimText(layerName);
        if (wantedName !== "") {
            for (var n = 1; n <= photoComp.numLayers; n++) {
                var namedLayer = photoComp.layer(n);
                if (namedLayer.name === wantedName && isReplaceablePhotoLayer(namedLayer)) return namedLayer;
            }
        }

        var index = parseInt(layerIndexText, 10);
        if (!isNaN(index) && index >= 1 && index <= photoComp.numLayers) {
            var indexedLayer = photoComp.layer(index);
            if (isReplaceablePhotoLayer(indexedLayer)) return indexedLayer;
        }

        for (var p = 1; p <= photoComp.numLayers; p++) {
            var photoLayer = photoComp.layer(p);
            if (isFilePhotoLayer(photoLayer)) return photoLayer;
        }

        for (var i = 1; i <= photoComp.numLayers; i++) {
            var layer = photoComp.layer(i);
            if (isReplaceablePhotoLayer(layer)) return layer;
        }

        for (var j = 1; j <= photoComp.numLayers; j++) {
            var fallback = photoComp.layer(j);
            try {
                if (fallback.source) return fallback;
            } catch (e2) {}
        }

        return null;
    }

    function getCompSize(comp) {
        return { width: comp.width, height: comp.height };
    }

    function replacePhotoInPrecomp(photoComp, footage, settings) {
        var nestedPhoto = findLayerByName(photoComp, "PHOTO");
        if (nestedPhoto && isReplaceablePhotoLayer(nestedPhoto)) {
            var nestedTargetSize = getLayerVisualSize(nestedPhoto);
            nestedPhoto.replaceSource(footage, false);
            if (settings.fitPhotoToPlaceholder) fitFootageToSize(nestedPhoto, footage, nestedTargetSize);
            return true;
        }

        if (nestedPhoto && isPrecompLayer(nestedPhoto)) {
            var nestedComp = nestedPhoto.source.duplicate();
            nestedComp.name = photoComp.name + "_INNER";
            nestedPhoto.replaceSource(nestedComp, false);
            return replacePhotoInPrecomp(nestedComp, footage, settings);
        }

        var contentLayer = findReplaceablePhotoContentLayer(photoComp, settings.photoContentLayer, settings.photoContentLayerIndex);
        if (!contentLayer) {
            var addedLayer = photoComp.layers.add(footage);
            if (settings.fitPhotoToPlaceholder) fitFootageToSize(addedLayer, footage, getCompSize(photoComp));
            return true;
        }

        var targetSize = getLayerVisualSize(contentLayer);
        contentLayer.replaceSource(footage, false);
        if (settings.fitPhotoToPlaceholder) fitFootageToSize(contentLayer, footage, targetSize);
        return true;
    }

    function isBusinessCardMode(settings) {
        return settings.graphicType === "Визитка" || settings.requirePhotoPrecomp === true;
    }

    function duplicatePhotoPrecompOnly(comp, settings, plateNumber, plateName) {
        var layer = findPhotoLayer(comp, settings.photoLayer, settings.photoLayerIndex);
        if (!layer) throw new Error("В композиции \"" + comp.name + "\" не найден слой фото. Переименуйте внешний фото-прекомп в PHOTO или PHOTO_TEMPLATE.");

        var sourceComp = null;
        try {
            if (layer.source && layer.source instanceof CompItem) sourceComp = layer.source;
        } catch (sourceError) {}

        if (!sourceComp) {
            if (isBusinessCardMode(settings)) throw new Error("В режиме \"Визитка\" слой фото должен быть прекомпом.");
            return false;
        }

        var photoComp = sourceComp.duplicate();
        var photoPrefix = cleanPlateText(settings.photoCompPrefix) || "PHOTO";
        photoComp.name = safeCompText(photoPrefix, "_") + "_" + safeCompText(plateName, "_");
        layer.replaceSource(photoComp, false);
        return true;
    }

    function replacePhotoLayer(comp, settings, photoPath, plateNumber, plateName) {
        if (!photoPath) return false;

        var layer = findPhotoLayer(comp, settings.photoLayer, settings.photoLayerIndex);
        if (!layer) throw new Error("В композиции \"" + comp.name + "\" не найден слой фото. Переименуйте внешний фото-прекомп в PHOTO или PHOTO_TEMPLATE.");

        var targetSize = getLayerVisualSize(layer);
        var footage = importFootage(photoPath);
        var sourceComp = null;

        try {
            if (layer.source && layer.source instanceof CompItem) sourceComp = layer.source;
        } catch (sourceError) {}

        if (sourceComp) {
            var photoComp = sourceComp.duplicate();
            var photoPrefix = cleanPlateText(settings.photoCompPrefix) || "PHOTO";
            photoComp.name = safeCompText(photoPrefix, "_") + "_" + safeCompText(plateName, "_");
            layer.replaceSource(photoComp, false);
            replacePhotoInPrecomp(photoComp, footage, settings);
            return true;
        }

        if (isBusinessCardMode(settings)) {
            throw new Error("В режиме \"Визитка\" слой фото \"" + settings.photoLayer + "\" должен быть прекомпом. Сейчас он не выглядит как CompItem.");
        }

        if (layer.replaceSource) {
            layer.replaceSource(footage, false);
            if (settings.fitPhotoToPlaceholder) fitFootageToSize(layer, footage, targetSize);
            return true;
        }

        var newLayer = comp.layers.add(footage);
        copyTransform(layer, newLayer);
        if (settings.fitPhotoToPlaceholder) fitFootageToSize(newLayer, footage, targetSize);
        try { newLayer.moveBefore(layer); } catch (e1) {}
        layer.enabled = false;
        return true;
    }

    function validateTemplate(masterComp, settings) {
        var warnings = [];
        if (!findTextLayer(masterComp, settings.nameLayer, settings.nameLayerIndex)) {
            warnings.push("В шаблоне \"" + masterComp.name + "\" не найден текстовый слой имени.");
        }

        if (!findTextLayer(masterComp, settings.positionLayer, settings.positionLayerIndex)) {
            warnings.push("В шаблоне \"" + masterComp.name + "\" не найден текстовый слой должности.");
        }

        if (isBusinessCardMode(settings) && !findPhotoLayer(masterComp, settings.photoLayer, settings.photoLayerIndex)) {
            warnings.push("В шаблоне \"" + masterComp.name + "\" не найден фото-прекомп PHOTO_TEMPLATE или PHOTO.");
        }
        return warnings;
    }

    function addLabeledEdit(parent, label, value, labelWidth, editWidth) {
        var row = parent.add("group");
        row.orientation = "row";
        row.alignChildren = ["left", "center"];
        row.spacing = 8;
        var lbl = row.add("statictext", undefined, label);
        lbl.preferredSize.width = labelWidth || 150;
        var edit = row.add("edittext", undefined, value);
        edit.preferredSize.width = editWidth || 260;
        return edit;
    }

    function addFolderPicker(parent, label, value, labelWidth, editWidth) {
        var row = parent.add("group");
        row.orientation = "row";
        row.alignChildren = ["left", "center"];
        row.spacing = 8;
        var lbl = row.add("statictext", undefined, label);
        lbl.preferredSize.width = labelWidth || 150;
        var edit = row.add("edittext", undefined, value);
        edit.preferredSize.width = editWidth || 250;
        var btn = row.add("button", undefined, "Выбрать");
        btn.preferredSize.width = 90;
        btn.onClick = function() {
            var current = trimText(edit.text);
            var startFolder = current !== "" ? new Folder(current) : getDefaultPhotosFolder();
            var picked = Folder.selectDialog("Выберите папку для фото плашек", startFolder);
            if (picked) edit.text = picked.fsName;
        };
        return edit;
    }

    function showWindow() {
        if (!app.project) {
            alert("Откройте проект After Effects.", SCRIPT_NAME);
            return;
        }

        var activeComp = app.project.activeItem && app.project.activeItem instanceof CompItem ? app.project.activeItem : null;
        var projectComps = collectProjectComps();
        if (projectComps.length === 0) {
            alert("В проекте нет композиций. Создайте или импортируйте композицию-шаблон.", SCRIPT_NAME);
            return;
        }

        var settings = loadSettings();
        if (cleanPlateText(settings.templateCompName) === "" && activeComp) {
            settings.templateCompName = activeComp.name;
        }
        var runtime = loadRuntimeConfig();
        var win = new Window("palette", "Плашки и визитки: имя, должность, фото", undefined, { resizeable: true });
        win.orientation = "column";
        win.alignChildren = ["fill", "top"];
        win.margins = 10;
        win.spacing = 6;

        var tabs = win.add("tabbedpanel");
        tabs.alignChildren = ["fill", "top"];
        tabs.preferredSize = [560, 360];

        var dataTab = tabs.add("tab", undefined, "Данные");
        dataTab.orientation = "column";
        dataTab.alignChildren = ["fill", "top"];
        dataTab.margins = 10;
        dataTab.spacing = 6;

        var modeRow = dataTab.add("group");
        modeRow.orientation = "row";
        modeRow.alignChildren = ["left", "center"];
        modeRow.spacing = 8;
        var modeLabel = modeRow.add("statictext", undefined, "Источник данных:");
        modeLabel.preferredSize.width = 150;
        var ddlDataMode = modeRow.add("dropdownlist", undefined, ["Таблица", "Вручную"]);
        ddlDataMode.selection = settings.dataMode === "Вручную" ? 1 : 0;
        ddlDataMode.preferredSize.width = 180;

        var edtSheetUrl = addLabeledEdit(dataTab, "Ссылка на таблицу:", settings.sheetUrl, 150, 330);
        var sheetRow = dataTab.add("group");
        sheetRow.orientation = "row";
        sheetRow.alignChildren = ["left", "center"];
        sheetRow.spacing = 8;
        var sheetGidLabel = sheetRow.add("statictext", undefined, "GID листа:");
        sheetGidLabel.preferredSize.width = 150;
        var edtSheetGid = sheetRow.add("edittext", undefined, settings.sheetGid || extractGoogleSheetGid(settings.sheetUrl));
        edtSheetGid.preferredSize.width = 110;
        var btnReadGid = sheetRow.add("button", undefined, "Взять из ссылки");
        btnReadGid.preferredSize.width = 120;
        var btnApplyGid = sheetRow.add("button", undefined, "Применить");
        btnApplyGid.preferredSize.width = 100;

        var edtNameField = addLabeledEdit(dataTab, "Колонка имени:", settings.nameField, 150, 300);
        var edtPosField = addLabeledEdit(dataTab, "Колонка должности:", settings.positionField, 150, 300);
        var edtPhotoField = addLabeledEdit(dataTab, "Колонка фото:", settings.photoField, 150, 300);
        var edtPhotoFolder = addFolderPicker(dataTab, "Папка фото:", settings.photoFolderPath || getDefaultPhotosFolder().fsName, 150, 250);
        var chkAutoImportPhotos = dataTab.add("checkbox", undefined, "Подтягивать фото автоматически");
        chkAutoImportPhotos.value = settings.autoImportPhotos !== false;
        var edtShiftField = addLabeledEdit(dataTab, "Колонка смены:", settings.shiftField, 150, 300);
        var edtShiftFilter = addLabeledEdit(dataTab, "Выгрузить смены:", settings.shiftFilter, 150, 300);

        var manualTab = tabs.add("tab", undefined, "Вручную");
        manualTab.orientation = "column";
        manualTab.alignChildren = ["fill", "top"];
        manualTab.margins = 10;
        manualTab.spacing = 6;
        manualTab.add("statictext", undefined, "Одна строка = один человек. Формат: Имя Фамилия | Должность | Фото/ссылка | Смена");
        var manualText = manualTab.add("edittext", undefined, settings.manualPeopleText || "", { multiline: true, scrolling: true });
        manualText.preferredSize = [520, 210];
        var manualHint = manualTab.add("statictext", undefined, "Можно оставить только имя. Разделители: |, табуляция или ;");
        manualHint.characters = 70;

        var layersTab = tabs.add("tab", undefined, "Слои");
        layersTab.orientation = "column";
        layersTab.alignChildren = ["fill", "top"];
        layersTab.margins = 10;
        layersTab.spacing = 6;

        var edtNameLayer = addLabeledEdit(layersTab, "Слой имени:", settings.nameLayer, 170, 240);
        var edtNameIndex = addLabeledEdit(layersTab, "Fallback имени N:", settings.nameLayerIndex, 170, 80);
        var edtPosLayer = addLabeledEdit(layersTab, "Слой должности:", settings.positionLayer, 170, 240);
        var edtPosIndex = addLabeledEdit(layersTab, "Fallback должности N:", settings.positionLayerIndex, 170, 80);
        var edtPhotoLayer = addLabeledEdit(layersTab, "Слой фото:", settings.photoLayer, 170, 240);
        var edtPhotoIndex = addLabeledEdit(layersTab, "Fallback фото N:", settings.photoLayerIndex, 170, 80);

        var createTab = tabs.add("tab", undefined, "Создание");
        createTab.orientation = "column";
        createTab.alignChildren = ["fill", "top"];
        createTab.margins = 10;
        createTab.spacing = 8;

        var templateRow = createTab.add("group");
        templateRow.orientation = "row";
        templateRow.alignChildren = ["left", "center"];
        templateRow.spacing = 8;
        var templateLabel = templateRow.add("statictext", undefined, "Композиция-шаблон:");
        templateLabel.preferredSize.width = 170;
        var ddlTemplateComp = templateRow.add("dropdownlist", undefined, []);
        ddlTemplateComp.preferredSize.width = 260;
        var btnUseActiveTemplate = templateRow.add("button", undefined, "Активная");
        btnUseActiveTemplate.preferredSize.width = 90;

        function refreshTemplateDropdown(preferredName) {
            ddlTemplateComp.removeAll();
            var preferred = cleanPlateText(preferredName);
            var selectedIndex = -1;
            for (var c = 0; c < projectComps.length; c++) {
                var item = ddlTemplateComp.add("item", projectComps[c].name);
                if (cleanPlateText(projectComps[c].name) === preferred) selectedIndex = c;
            }
            if (selectedIndex < 0 && projectComps.length > 0) selectedIndex = 0;
            if (selectedIndex >= 0) ddlTemplateComp.selection = selectedIndex;
        }

        refreshTemplateDropdown(settings.templateCompName);

        var typeRow = createTab.add("group");
        typeRow.orientation = "row";
        typeRow.alignChildren = ["left", "center"];
        typeRow.spacing = 8;
        var typeLabel = typeRow.add("statictext", undefined, "Тип графики:");
        typeLabel.preferredSize.width = 170;
        var ddlGraphicType = typeRow.add("dropdownlist", undefined, ["Плашка", "Визитка"]);
        ddlGraphicType.selection = settings.graphicType === "Визитка" ? 1 : 0;
        ddlGraphicType.preferredSize.width = 180;

        var initialCompPrefix = settings.graphicType === "Визитка" && settings.compPrefix === "Плашка" ? "Визитка" : settings.compPrefix;
        var initialPhotoLayer = settings.graphicType === "Визитка" && settings.photoLayer === "Rectangle 3" ? "PHOTO" : settings.photoLayer;
        edtPhotoLayer.text = initialPhotoLayer;

        var edtPrefix = addLabeledEdit(createTab, "Префикс композиций:", initialCompPrefix, 170, 180);
        var edtDelimiter = addLabeledEdit(createTab, "Разделитель:", settings.delimiter, 170, 80);
        var edtTargetFolder = addLabeledEdit(createTab, "Папка композиций:", settings.targetFolderName || "", 170, 180);
        var chkFit = createTab.add("checkbox", undefined, "Заполнять фото по размеру плейсхолдера");
        chkFit.value = settings.fitPhotoToPlaceholder;
        var chkRecreate = createTab.add("checkbox", undefined, "Пересоздать уже созданные композиции");
        chkRecreate.value = settings.recreateExistingComps === true;
        var chkRender = createTab.add("checkbox", undefined, "Добавить созданные композиции в Render Queue");
        chkRender.value = settings.addToRenderQueue;
        tabs.selection = settings.dataMode === "Вручную" ? manualTab : dataTab;

        btnReadGid.onClick = function() {
            edtSheetGid.text = extractGoogleSheetGid(edtSheetUrl.text);
        };

        btnApplyGid.onClick = function() {
            edtSheetUrl.text = applyGoogleSheetGid(edtSheetUrl.text, edtSheetGid.text);
        };

        ddlDataMode.onChange = function() {
            if (ddlDataMode.selection && ddlDataMode.selection.text === "Вручную") {
                tabs.selection = manualTab;
            } else {
                tabs.selection = dataTab;
            }
        };

        ddlGraphicType.onChange = function() {
            if (ddlGraphicType.selection && ddlGraphicType.selection.text === "Визитка") {
                if (trimText(edtPrefix.text) === "" || edtPrefix.text === "Плашка") edtPrefix.text = "Визитка";
                if (trimText(edtPhotoLayer.text) === "" || edtPhotoLayer.text === "Rectangle 3") edtPhotoLayer.text = "PHOTO";
            }
        };

        btnUseActiveTemplate.onClick = function() {
            var currentActive = app.project.activeItem && app.project.activeItem instanceof CompItem ? app.project.activeItem : null;
            if (!currentActive) {
                alert("Сейчас активная композиция не выбрана. Выберите композицию в Project или Timeline.", SCRIPT_NAME);
                return;
            }
            projectComps = collectProjectComps();
            refreshTemplateDropdown(currentActive.name);
        };

        var buttons = win.add("group");
        buttons.orientation = "row";
        buttons.alignChildren = ["fill", "center"];
        var btnSave = buttons.add("button", undefined, "Сохранить");
        var btnCheck = buttons.add("button", undefined, "Проверить");
        var btnNormalize = buttons.add("button", undefined, "Обновить");
        var btnCreate = buttons.add("button", undefined, "Создать");
        btnSave.preferredSize.width = 120;
        btnCheck.preferredSize.width = 120;
        btnNormalize.preferredSize.width = 150;
        btnCreate.preferredSize.width = 160;

        function collectSettings() {
            settings.dataMode = ddlDataMode.selection ? ddlDataMode.selection.text : "Таблица";
            settings.manualPeopleText = manualText.text;
            settings.sheetGid = trimText(edtSheetGid.text) || extractGoogleSheetGid(edtSheetUrl.text);
            settings.sheetUrl = applyGoogleSheetGid(edtSheetUrl.text, settings.sheetGid);
            settings.nameField = edtNameField.text;
            settings.positionField = edtPosField.text;
            settings.photoField = edtPhotoField.text;
            settings.shiftField = edtShiftField.text;
            settings.shiftFilter = edtShiftFilter.text;
            settings.templateCompName = ddlTemplateComp.selection ? ddlTemplateComp.selection.text : "";
            settings.nameLayer = edtNameLayer.text;
            settings.nameLayerIndex = edtNameIndex.text;
            settings.positionLayer = edtPosLayer.text;
            settings.positionLayerIndex = edtPosIndex.text;
            settings.photoLayer = edtPhotoLayer.text;
            settings.photoLayerIndex = edtPhotoIndex.text;
            settings.graphicType = ddlGraphicType.selection ? ddlGraphicType.selection.text : "Плашка";
            settings.photoContentLayer = "";
            settings.photoContentLayerIndex = "";
            settings.compPrefix = edtPrefix.text;
            settings.photoCompPrefix = "PHOTO";
            settings.delimiter = edtDelimiter.text;
            settings.targetFolderName = edtTargetFolder.text;
            settings.photoFolderPath = edtPhotoFolder.text;
            settings.autoImportPhotos = chkAutoImportPhotos.value;
            settings.requirePhotoPrecomp = settings.graphicType === "Визитка";
            settings.fitPhotoToPlaceholder = chkFit.value;
            settings.recreateExistingComps = chkRecreate.value;
            settings.addToRenderQueue = chkRender.value;
            return settings;
        }

        btnSave.onClick = function() {
            saveSettings(collectSettings());
            alert("Настройки сохранены.", SCRIPT_NAME);
        };

        btnCheck.onClick = function() {
            var currentSettings = collectSettings();
            var masterComp = findCompByName(currentSettings.templateCompName);
            if (!masterComp) {
                alert("Не найдена композиция-шаблон:\n" + currentSettings.templateCompName + "\n\nВыберите шаблон во вкладке \"Создание\".", SCRIPT_NAME);
                return;
            }
            var templateWarnings = validateTemplate(masterComp, currentSettings);
            if (templateWarnings.length > 0) {
                if (!confirm("Предупреждения шаблона:\n\n" + templateWarnings.join("\n") + "\n\nВсе равно проверить данные?")) {
                    return;
                }
            }
            checkData(currentSettings, runtime);
        };

        btnCreate.onClick = function() {
            var currentSettings = collectSettings();
            var masterComp = findCompByName(currentSettings.templateCompName);
            if (!masterComp) {
                alert("Не найдена композиция-шаблон:\n" + currentSettings.templateCompName + "\n\nВыберите шаблон во вкладке \"Создание\".", SCRIPT_NAME);
                return;
            }
            saveSettings(currentSettings);
            generatePlates(masterComp, currentSettings, runtime);
        };

        btnNormalize.onClick = function() {
            var currentSettings = collectSettings();
            var masterComp = findCompByName(currentSettings.templateCompName);
            if (!masterComp) {
                alert("Не найдена композиция-шаблон:\n" + currentSettings.templateCompName + "\n\nВыберите шаблон во вкладке \"Создание\".", SCRIPT_NAME);
                return;
            }
            saveSettings(currentSettings);
            normalizeExistingPlates(masterComp, currentSettings, runtime);
        };

        win.center();
        win.show();
    }

    function downloadData(settings, runtime) {
        var pyScript = new File(PYTHON_SCRIPT_PATH);
        if (!pyScript.exists) throw new Error("Python-скрипт не найден: " + PYTHON_SCRIPT_PATH);

        var jsonFile = getDataJsonFile();
        var photosFolder = getPhotosFolder(settings);
        if (jsonFile.exists) jsonFile.remove();

        var source = settings.sheetUrl;
        var manualInfo = null;
        if (settings.dataMode === "Вручную") {
            manualInfo = writeManualTsv(settings);
            source = manualInfo.file.absoluteURI || manualInfo.file.fsName;
        }

        var cmd = buildPythonCommand(
            runtime.pythonCmd,
            source,
            jsonFile.absoluteURI || jsonFile.fsName,
            photosFolder.absoluteURI || photosFolder.fsName,
            settings.photoField,
            settings.nameField,
            settings.autoImportPhotos !== false
        );
        var output = system.callSystem(cmd);
        $.sleep(500);

        if (!jsonFile.exists) throw new Error("Файл JSON не создан.\n\nВывод Python:\n" + output);
        return { rows: readJsonArray(jsonFile), output: output, manualCount: manualInfo ? manualInfo.count : 0 };
    }

    function checkData(settings, runtime) {
        try {
            var result = downloadData(settings, runtime);
            var rows = result.rows;
            var withName = 0;
            var withPosition = 0;
            var withPhoto = 0;
            var matchedShift = 0;
            var errors = [];
            var examples = [];

            for (var i = 0; i < rows.length; i++) {
                var row = normalizeRow(rows[i]);
                if (!rowMatchesShiftFilter(row, settings)) continue;
                matchedShift++;
                if (cleanPlateText(getByColumn(row, "__nameFirstLast")) !== "" || cleanPlateText(getByColumn(row, "__formattedName")) !== "" || cleanPlateText(getByColumn(row, settings.nameField)) !== "") withName++;
                if (cleanPlateText(getByColumn(row, settings.positionField)) !== "") withPosition++;
                if (cleanPlateText(getByColumn(row, "__photoLocalPath")) !== "") withPhoto++;
                if (cleanPlateText(getByColumn(row, "__photoError")) !== "" && errors.length < 5) errors.push(getByColumn(row, "__photoError"));
                if (examples.length < 3 && cleanPlateText(getByColumn(row, settings.nameField)) !== "") {
                    examples.push((cleanPlateText(getByColumn(row, "__nameFirstLast")) || cleanPlateText(getByColumn(row, "__formattedName")) || cleanPlateText(getByColumn(row, settings.nameField))) + " / " + cleanPlateText(getByColumn(row, settings.positionField)));
                }
            }

            var report = "Проверка данных\n\n";
            if (settings.dataMode === "Вручную") report += "Режим: ручной список (" + result.manualCount + " строк)\n";
            report += "Всего строк: " + rows.length + "\n";
            report += "Под фильтр смены: " + matchedShift + "\n";
            report += "С именем: " + withName + "\n";
            report += "С должностью: " + withPosition + "\n";
            if (settings.autoImportPhotos === false) {
                report += "Фото: автоматическое подтягивание выключено\n\n";
            } else {
                report += "Фото готово: " + withPhoto + "\n\n";
            }
            if (settings.autoImportPhotos !== false && withPhoto === 0) {
                report += "Фото не найдены. Проверьте, что ссылки лежат в одной из колонок: " + settings.photoField + ", Ссылка на плашку, Фото на плашку, ФОТО, Фото.\n";
                report += "Если фото лежат на диске, проверьте выбранную папку фото.\n\n";
            }
            if (examples.length > 0) report += "Примеры:\n" + examples.join("\n") + "\n\n";
            if (errors.length > 0) report += "Первые ошибки фото:\n" + errors.join("\n") + "\n\n";
            report += "Вывод Python:\n" + result.output;
            alert(report, SCRIPT_NAME);
        } catch (e) {
            alert("Ошибка проверки:\n" + e.toString() + "\nСтрока: " + e.line, SCRIPT_NAME);
        }
    }

    function normalizeExistingPlates(masterComp, settings, runtime) {
        try {
            var result = downloadData(settings, runtime);
            var rows = result.rows;
            if (!rows || rows.length === 0) throw new Error("Данные пусты.");

            var targetFolder = targetFolderForMaster(masterComp, settings);
            var renamed = 0;
            var updatedText = 0;
            var updatedPhoto = 0;
            var unchanged = 0;
            var conflicts = 0;
            var notFound = 0;
            var skippedByShift = 0;
            var textErrors = [];
            var seenTargets = {};
            var planned = [];

            for (var i = 0; i < rows.length; i++) {
                var row = normalizeRow(rows[i]);
                if (!rowMatchesShiftFilter(row, settings)) {
                    skippedByShift++;
                    continue;
                }

                var plateData = plateDataFromRow(row, settings);
                if (plateData.name === "" || plateData.name.indexOf("#") === 0 || plateData.name.indexOf("#VALUE!") !== -1) {
                    notFound++;
                    continue;
                }
                if (seenTargets[plateData.compName] === true) {
                    conflicts++;
                    continue;
                }
                seenTargets[plateData.compName] = true;

                var match = findPlateComp(settings, plateData, targetFolder, masterComp);
                if (!match || !match.comp) {
                    notFound++;
                    continue;
                }

                var comp = match.comp;
                var changes = describePlateDiff(comp, settings, plateData, match.meta);
                if (shouldRenameMatchedComp(match, plateData)) {
                    changes.unshift("имя композиции: \"" + comp.name + "\" -> \"" + plateData.compName + "\"");
                }
                planned.push({ comp: comp, plateData: plateData, meta: match.meta, changes: changes, method: match.method });
            }

            var changedCount = 0;
            var preview = [];
            for (var p = 0; p < planned.length; p++) {
                if (planned[p].changes.length === 0) {
                    unchanged++;
                } else {
                    changedCount++;
                    if (preview.length < 12) preview.push(planned[p].comp.name + "\n  " + planned[p].changes.join("\n  "));
                }
            }

            var confirmMessage = "План обновления плашек\n\n" +
                "Будут обновлены: " + changedCount + "\n" +
                "Без изменений: " + unchanged + "\n" +
                "Не найдены: " + notFound + "\n" +
                "Конфликты/дубликаты: " + conflicts + "\n" +
                "Пропущено по смене: " + skippedByShift + "\n" +
                "Всего строк: " + rows.length + "\n\n" +
                (preview.length > 0 ? "Что изменится:\n" + preview.join("\n\n") + "\n\n" : "") +
                "Применить эти изменения?";
            if (changedCount === 0) {
                alert(confirmMessage.replace("\n\nПрименить эти изменения?", ""), SCRIPT_NAME);
                return;
            }
            if (!confirm(confirmMessage)) return;

            app.beginUndoGroup("Update Person Plates");
            for (var u = 0; u < planned.length; u++) {
                var item = planned[u];
                if (item.changes.length === 0) {
                    writePlateMeta(item.comp, buildPlateMeta(settings, item.plateData));
                    continue;
                }

                if (shouldRenameMatchedComp(item, item.plateData)) {
                    var targetMatches = findCompsByNameInFolder(item.plateData.compName, targetFolder, masterComp);
                    if (targetMatches.length > 0 && targetMatches[0] !== item.comp) {
                        conflicts++;
                    } else {
                        item.comp.name = item.plateData.compName;
                        renamed++;
                    }
                }

                try {
                    var nameLayer = setTextLayer(item.comp, settings.nameLayer, settings.nameLayerIndex, item.plateData.name);
                    applyNameExpression(nameLayer);
                    var positionLayer = setTextLayer(item.comp, settings.positionLayer, settings.positionLayerIndex, item.plateData.position);
                    applyPositionExpression(positionLayer, "должность не задана");
                    updatedText++;
                } catch (textError) {
                    if (textErrors.length < 8) textErrors.push(item.comp.name + ": не обновлен текст (" + textError.toString() + ")");
                }

                if (item.meta && normalizeMetaPart(item.meta.photoPath) !== normalizeMetaPart(item.plateData.photoPath) && item.plateData.photoPath !== "") {
                    try {
                        replacePhotoLayer(item.comp, settings, item.plateData.photoPath, "000", item.plateData.name);
                        updatedPhoto++;
                    } catch (photoError) {
                        if (textErrors.length < 8) textErrors.push(item.comp.name + ": не обновлено фото (" + photoError.toString() + ")");
                    }
                }
                writePlateMeta(item.comp, buildPlateMeta(settings, item.plateData));
            }
            app.endUndoGroup();

            alert(
                "Обновление готово.\n\n" +
                "Переименовано композиций: " + renamed + "\n" +
                "Обновлено композиций с текстом: " + updatedText + "\n" +
                "Обновлено фото: " + updatedPhoto + "\n" +
                "Без изменений: " + unchanged + "\n" +
                "Конфликты имен/дубликаты: " + conflicts + "\n" +
                "Не найдены в проекте: " + notFound + "\n" +
                "Пропущено по смене: " + skippedByShift + "\n" +
                "Всего строк: " + rows.length + "\n\n" +
                (textErrors.length > 0 ? "Ошибки текста:\n" + textErrors.join("\n") : ""),
                SCRIPT_NAME
            );
        } catch (e) {
            try { app.endUndoGroup(); } catch (undoError) {}
            alert("Ошибка обновления:\n" + e.toString() + "\nСтрока: " + e.line, SCRIPT_NAME);
        }
    }

    function generatePlates(masterComp, settings, runtime) {
        app.beginUndoGroup("Person Plates from Sheet");
        try {
            var templateWarnings = validateTemplate(masterComp, settings);

            var result = downloadData(settings, runtime);
            var rows = result.rows;
            if (!rows || rows.length === 0) throw new Error("Данные пусты.");

            var targetFolder = targetFolderForMaster(masterComp, settings);
            var created = 0;
            var skipped = 0;
            var skippedExisting = 0;
            var recreated = 0;
            var noPhoto = 0;
            var linkedPlates = 0;
            var skippedByShift = 0;
            var textErrors = [];
            var photoErrors = [];
            var namesCreatedThisRun = {};
            var baseCompByPerson = {};
            var plateRows = [];

            for (var i = 0; i < rows.length; i++) {
                var row = normalizeRow(rows[i]);
                if (!rowMatchesShiftFilter(row, settings)) {
                    skippedByShift++;
                    continue;
                }

                var plateData = plateDataFromRow(row, settings);
                plateData.rowIndex = i;
                plateData.personKey = personAliasKey(plateData.compPersonName || plateData.name || plateData.rawName);
                plateRows.push(plateData);
            }

            plateRows.sort(function(a, b) {
                var at = timeSortKey(a.timePrefix);
                var bt = timeSortKey(b.timePrefix);
                if (at !== bt) return at - bt;
                return a.rowIndex - b.rowIndex;
            });

            for (var i = 0; i < plateRows.length; i++) {
                var plateData = plateRows[i];
                var name = plateData.name;
                var position = plateData.position;
                var photoPath = plateData.photoPath;

                if (name === "" || name.indexOf("#") === 0 || name.indexOf("#VALUE!") !== -1) {
                    skipped++;
                    continue;
                }

                var compName = plateData.compName;
                if (namesCreatedThisRun[compName] === true) {
                    skippedExisting++;
                    continue;
                }

                var existingComps = findCompsByNameInFolder(compName, targetFolder, masterComp);
                if (existingComps.length > 0) {
                    if (settings.recreateExistingComps === true) {
                        removeComps(existingComps);
                        recreated += existingComps.length;
                    } else {
                        if (!baseCompByPerson[plateData.personKey]) baseCompByPerson[plateData.personKey] = existingComps[0];
                        writePlateMeta(existingComps[0], buildPlateMeta(settings, plateData));
                        skippedExisting++;
                        continue;
                    }
                }

                var plateNumber = ("000" + (created + 1)).slice(-3);
                var sourceBaseComp = baseCompByPerson[plateData.personKey];
                var comp;
                if (settings.graphicType === "Плашка" && sourceBaseComp) {
                    comp = makeLinkedPlateComp(masterComp, targetFolder, compName, sourceBaseComp);
                    linkedPlates++;
                } else {
                    comp = masterComp.duplicate();
                    comp.parentFolder = targetFolder;
                    comp.name = compName;

                    try {
                        var nameLayer = setTextLayer(comp, settings.nameLayer, settings.nameLayerIndex, name);
                        applyNameExpression(nameLayer);
                    } catch (nameTextError) {
                        if (textErrors.length < 8) textErrors.push(name + ": не записано имя (" + nameTextError.toString() + ")");
                    }

                    try {
                        var positionLayer = setTextLayer(comp, settings.positionLayer, settings.positionLayerIndex, position);
                        applyPositionExpression(positionLayer, "должность не задана");
                    } catch (positionTextError) {
                        if (textErrors.length < 8) textErrors.push(name + ": не записана должность (" + positionTextError.toString() + ")");
                    }

                    if (settings.autoImportPhotos === false && isBusinessCardMode(settings)) {
                        try {
                            duplicatePhotoPrecompOnly(comp, settings, plateNumber, name);
                        } catch (manualPhotoError) {
                            if (photoErrors.length < 8) photoErrors.push(name + ": " + manualPhotoError.toString());
                        }
                        noPhoto++;
                    } else if (photoPath !== "") {
                        try {
                            replacePhotoLayer(comp, settings, photoPath, plateNumber, name);
                        } catch (photoError) {
                            noPhoto++;
                            if (photoErrors.length < 8) photoErrors.push(name + ": " + photoError.toString());
                        }
                    } else {
                        noPhoto++;
                    }

                    if (!baseCompByPerson[plateData.personKey]) {
                        baseCompByPerson[plateData.personKey] = comp;
                    }
                }

                if (settings.addToRenderQueue) {
                    app.project.renderQueue.items.add(comp);
                }
                writePlateMeta(comp, buildPlateMeta(settings, plateData));
                namesCreatedThisRun[compName] = true;
                created++;
            }

            alert(
                "Готово.\n\n" +
                "Создано композиций: " + created + "\n" +
                "Пересоздано старых композиций: " + recreated + "\n" +
                "Уже были, оставлены без изменений: " + skippedExisting + "\n" +
                "Пропущено строк: " + skipped + "\n" +
                "Пропущено по смене: " + skippedByShift + "\n" +
                "Повторных плашек-ссылок: " + linkedPlates + "\n" +
                (settings.autoImportPhotos === false ? "Фото: автоматическое подтягивание выключено\n" : "Без фото: " + noPhoto + "\n") +
                "Всего строк: " + rows.length + "\n\n" +
                (templateWarnings.length > 0 ? "Предупреждения шаблона:\n" + templateWarnings.join("\n") + "\n\n" : "") +
                (textErrors.length > 0 ? "Ошибки текста, композиции оставлены как есть:\n" + textErrors.join("\n") + "\n\n" : "") +
                (photoErrors.length > 0 ? "Ошибки фото, композиции созданы без фото:\n" + photoErrors.join("\n") + "\n\n" : "") +
                "Фото лежат здесь:\n" + getPhotosFolder(settings).fsName,
                SCRIPT_NAME
            );
        } catch (e) {
            alert("Ошибка генерации:\n" + e.toString() + "\nСтрока: " + e.line, SCRIPT_NAME);
        } finally {
            app.endUndoGroup();
        }
    }

    showWindow();
})(this);
