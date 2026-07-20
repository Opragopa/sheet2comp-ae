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
            nameField: "ФИО спикера",
            positionField: "Должность",
            photoField: "Фото на плашку",
            shiftField: "Смена",
            shiftFilter: "единство",
            nameLayer: "ИМЯ",
            nameLayerIndex: "3",
            positionLayer: "ДОЛЖНОСТЬ",
            positionLayerIndex: "4",
            photoLayer: "Rectangle 3",
            photoLayerIndex: "6",
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
            // The source is always the "Справочник" sheet (gid=0), not a URL
            // that might have been saved by a previous run.
            data.sheetUrl = REFERENCE_SHEET_URL;
            if (data.nameField === "ИМЯ ФАМИЛИЯ") data.nameField = defaults.nameField;
            if (data.positionField === "ДОЛЖНОСТЬ") data.positionField = defaults.positionField;
            if (normalizeKey(data.photoField) === normalizeKey("фото на плашку")) data.photoField = defaults.photoField;
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

    function buildPythonCommand(pythonCmd, sheetUrl, jsonPath, photosPath, photoField, nameField) {
        var pyScript = new File(PYTHON_SCRIPT_PATH);
        var parts = [
            quoteExecutable(pythonCmd),
            quoteShellArg(pyScript.fsName),
            quoteShellArg(normalizeGoogleSheetUrl(sheetUrl)),
            quoteShellArg(jsonPath),
            quoteShellArg(photosPath),
            quoteShellArg(photoField),
            quoteShellArg(nameField)
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

        var shiftValue = getByColumn(row, settings.shiftField);
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

    function importFootage(filePath) {
        var file = new File(filePath);
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

    function findReplaceablePhotoContentLayer(photoComp) {
        for (var i = 1; i <= photoComp.numLayers; i++) {
            var layer = photoComp.layer(i);
            try {
                if (layer.source && !(layer.source instanceof CompItem)) return layer;
            } catch (e1) {}
        }

        for (var j = 1; j <= photoComp.numLayers; j++) {
            var fallback = photoComp.layer(j);
            try {
                if (fallback.source) return fallback;
            } catch (e2) {}
        }

        return null;
    }

    function replacePhotoInPrecomp(photoComp, footage, fitToPlaceholder) {
        var contentLayer = findReplaceablePhotoContentLayer(photoComp);
        if (!contentLayer) {
            photoComp.layers.add(footage);
            return true;
        }

        var targetSize = getLayerVisualSize(contentLayer);
        contentLayer.replaceSource(footage, false);
        if (fitToPlaceholder) fitFootageToSize(contentLayer, footage, targetSize);
        return true;
    }

    function replacePhotoLayer(comp, settings, photoPath, plateNumber, plateName) {
        if (!photoPath) return false;

        var layer = findPhotoLayer(comp, settings.photoLayer, settings.photoLayerIndex);
        if (!layer) throw new Error("В композиции \"" + comp.name + "\" не найден слой фото \"" + settings.photoLayer + "\" или слой N" + settings.photoLayerIndex + ".");

        var targetSize = getLayerVisualSize(layer);
        var footage = importFootage(photoPath);

        try {
            if (layer.source && layer.source instanceof CompItem) {
                var photoComp = layer.source.duplicate();
                photoComp.name = safeCompText(settings.photoLayer, "_") + "_" + plateNumber + "_" + safeCompText(plateName, "_");
                layer.replaceSource(photoComp, false);
                replacePhotoInPrecomp(photoComp, footage, settings.fitPhotoToPlaceholder);
                return true;
            }
        } catch (precompError) {}

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

        var masterComp = app.project.activeItem;
        if (!masterComp || !(masterComp instanceof CompItem)) {
            alert("Выделите композицию-шаблон в панели Project.", SCRIPT_NAME);
            return;
        }

        var settings = loadSettings();
        var runtime = loadRuntimeConfig();
        var win = new Window("palette", "Плашки: имя, должность, фото", undefined, { resizeable: true });
        win.orientation = "column";
        win.alignChildren = ["fill", "top"];
        win.margins = 10;
        win.spacing = 6;

        var tabs = win.add("tabbedpanel");
        tabs.alignChildren = ["fill", "top"];
        tabs.preferredSize = [520, 300];

        var dataTab = tabs.add("tab", undefined, "Данные");
        dataTab.orientation = "column";
        dataTab.alignChildren = ["fill", "top"];
        dataTab.margins = 10;
        dataTab.spacing = 6;

        dataTab.add("statictext", undefined, "Источник: Справочник (лист gid=0)");
        var sourceUrlText = dataTab.add("statictext", undefined, REFERENCE_SHEET_URL);
        sourceUrlText.characters = 62;

        var edtNameField = addLabeledEdit(dataTab, "Колонка имени:", settings.nameField, 150, 300);
        var edtPosField = addLabeledEdit(dataTab, "Колонка должности:", settings.positionField, 150, 300);
        var edtPhotoField = addLabeledEdit(dataTab, "Колонка фото:", settings.photoField, 150, 300);
        var edtPhotoFolder = addFolderPicker(dataTab, "Папка фото:", settings.photoFolderPath || getDefaultPhotosFolder().fsName, 150, 250);
        var edtShiftField = addLabeledEdit(dataTab, "Колонка смены:", settings.shiftField, 150, 300);
        var edtShiftFilter = addLabeledEdit(dataTab, "Выгрузить смены:", settings.shiftFilter, 150, 300);

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

        var edtPrefix = addLabeledEdit(createTab, "Префикс композиций:", settings.compPrefix, 170, 180);
        var edtDelimiter = addLabeledEdit(createTab, "Разделитель:", settings.delimiter, 170, 80);
        var chkFit = createTab.add("checkbox", undefined, "Заполнять фото по размеру плейсхолдера");
        chkFit.value = settings.fitPhotoToPlaceholder;
        var chkRender = createTab.add("checkbox", undefined, "Добавить созданные композиции в Render Queue");
        chkRender.value = settings.addToRenderQueue;
        tabs.selection = dataTab;

        var buttons = win.add("group");
        buttons.orientation = "row";
        buttons.alignChildren = ["fill", "center"];
        var btnSave = buttons.add("button", undefined, "Сохранить");
        var btnCheck = buttons.add("button", undefined, "Проверить");
        var btnCreate = buttons.add("button", undefined, "Создать");
        btnSave.preferredSize.width = 120;
        btnCheck.preferredSize.width = 120;
        btnCreate.preferredSize.width = 160;

        function collectSettings() {
            settings.sheetUrl = REFERENCE_SHEET_URL;
            settings.nameField = edtNameField.text;
            settings.positionField = edtPosField.text;
            settings.photoField = edtPhotoField.text;
            settings.shiftField = edtShiftField.text;
            settings.shiftFilter = edtShiftFilter.text;
            settings.nameLayer = edtNameLayer.text;
            settings.nameLayerIndex = edtNameIndex.text;
            settings.positionLayer = edtPosLayer.text;
            settings.positionLayerIndex = edtPosIndex.text;
            settings.photoLayer = edtPhotoLayer.text;
            settings.photoLayerIndex = edtPhotoIndex.text;
            settings.compPrefix = edtPrefix.text;
            settings.delimiter = edtDelimiter.text;
            settings.photoFolderPath = edtPhotoFolder.text;
            settings.fitPhotoToPlaceholder = chkFit.value;
            settings.addToRenderQueue = chkRender.value;
            return settings;
        }

        btnSave.onClick = function() {
            saveSettings(collectSettings());
            alert("Настройки сохранены.", SCRIPT_NAME);
        };

        btnCheck.onClick = function() {
            checkData(collectSettings(), runtime);
        };

        btnCreate.onClick = function() {
            saveSettings(collectSettings());
            generatePlates(masterComp, settings, runtime);
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

        var cmd = buildPythonCommand(
            runtime.pythonCmd,
            settings.sheetUrl,
            jsonFile.fsName,
            photosFolder.fsName,
            settings.photoField,
            settings.nameField
        );
        var output = system.callSystem(cmd);
        $.sleep(500);

        if (!jsonFile.exists) throw new Error("Файл JSON не создан.\n\nВывод Python:\n" + output);
        return { rows: readJsonArray(jsonFile), output: output };
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
            report += "Всего строк: " + rows.length + "\n";
            report += "Под фильтр смены: " + matchedShift + "\n";
            report += "С именем: " + withName + "\n";
            report += "С должностью: " + withPosition + "\n";
            report += "Фото скачано: " + withPhoto + "\n\n";
            if (examples.length > 0) report += "Примеры:\n" + examples.join("\n") + "\n\n";
            if (errors.length > 0) report += "Первые ошибки фото:\n" + errors.join("\n") + "\n\n";
            report += "Вывод Python:\n" + result.output;
            alert(report, SCRIPT_NAME);
        } catch (e) {
            alert("Ошибка проверки:\n" + e.toString() + "\nСтрока: " + e.line, SCRIPT_NAME);
        }
    }

    function generatePlates(masterComp, settings, runtime) {
        app.beginUndoGroup("Person Plates from Sheet");
        try {
            var result = downloadData(settings, runtime);
            var rows = result.rows;
            if (!rows || rows.length === 0) throw new Error("Данные пусты.");

            var targetFolder = masterComp.parentFolder || app.project.rootFolder;
            var created = 0;
            var skipped = 0;
            var noPhoto = 0;
            var skippedByShift = 0;
            var delimiter = settings.delimiter || "_";

            for (var i = 0; i < rows.length; i++) {
                var row = normalizeRow(rows[i]);
                if (!rowMatchesShiftFilter(row, settings)) {
                    skippedByShift++;
                    continue;
                }

                var name = cleanPlateText(getByColumn(row, "__nameFirstLast")) || cleanPlateText(getByColumn(row, "__formattedName"));
                var position = cleanPlateText(getByColumn(row, settings.positionField));
                var photoPath = cleanPlateText(getByColumn(row, "__photoLocalPath"));

                if (name === "" || name.indexOf("#") === 0 || name.indexOf("#VALUE!") !== -1) {
                    skipped++;
                    continue;
                }

                var comp = masterComp.duplicate();
                comp.parentFolder = targetFolder;
                var plateNumber = ("000" + (created + 1)).slice(-3);
                comp.name = (settings.compPrefix || "Плашка") + delimiter + plateNumber + delimiter + shortCompNameText(name, delimiter);

                setTextLayer(comp, settings.nameLayer, settings.nameLayerIndex, name);
                setTextLayer(comp, settings.positionLayer, settings.positionLayerIndex, position);

                if (photoPath !== "") {
                    replacePhotoLayer(comp, settings, photoPath, plateNumber, name);
                } else {
                    noPhoto++;
                }

                if (settings.addToRenderQueue) {
                    app.project.renderQueue.items.add(comp);
                }
                created++;
            }

            alert(
                "Готово.\n\n" +
                "Создано композиций: " + created + "\n" +
                "Пропущено строк: " + skipped + "\n" +
                "Пропущено по смене: " + skippedByShift + "\n" +
                "Без фото: " + noPhoto + "\n" +
                "Всего строк: " + rows.length + "\n\n" +
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
