// =====================================================================
// ГЕНЕРАТОР ПЛАШЕК ДЛЯ AFTER EFFECTS
// Версия: 4.0 (кроссплатформенный: Windows + macOS)
// =====================================================================

// =====================================================================
// АВТООПРЕДЕЛЕНИЕ ОС И НАСТРОЙКА ПУТЕЙ
// =====================================================================

var isWindows = $.os.indexOf("Windows") !== -1;
var isMac = $.os.indexOf("Mac") !== -1;
var SCRIPT_FILE = new File($.fileName);
var SCRIPT_FOLDER = SCRIPT_FILE.parent;
var CONFIG_FILE = new File(SCRIPT_FOLDER.fsName + "/ae_parser_config.json");

var PYTHON_CMD = loadRuntimeConfig().pythonCmd;
var PYTHON_SCRIPT_PATH = SCRIPT_FOLDER.fsName + "/download_data.py";
var JSON_FILE_NAME = "data.json";

// Файл для сохранения настроек
var SETTINGS_FILE = new File(Folder.myDocuments.fsName + "/ae_plaque_settings.json");
var DATA_FOLDER = new Folder(Folder.myDocuments.fsName + "/ae_plaque_data");

// =====================================================================
// ЗАГРУЗКА / СОХРАНЕНИЕ НАСТРОЕК
// =====================================================================

function loadSettings() {
    var defaults = {
        csvUrl: "https://docs.google.com/spreadsheets/d/12lVA34EgWG6oy4xw8w7tKga7pOqCpxyXtUoka4XYDWc/gviz/tq?tqx=out:csv&gid=1878161624",
        nameField: "ФИО спикера",
        positionField: "Должность",
        nameLayer: "ИМЯ",
        positionLayer: "РЕГАЛИИ",
        delimiter: "_",
        compPrefix: "Плашка",
        dataMode: "Таблица",
        manualPlatesText: ""
    };
    
    if (SETTINGS_FILE.exists) {
        try {
            SETTINGS_FILE.open("r");
            SETTINGS_FILE.encoding = "UTF-8";
            var data = JSON.parse(SETTINGS_FILE.read());
            SETTINGS_FILE.close();
            
            for (var key in defaults) {
                if (!data.hasOwnProperty(key)) {
                    data[key] = defaults[key];
                }
            }
            return data;
        } catch (e) {
            return defaults;
        }
    }
    return defaults;
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

function loadRuntimeConfig() {
    var defaults = {
        pythonCmd: isWindows ? "py -3" : "/usr/bin/python3"
    };

    if (!CONFIG_FILE.exists) {
        return defaults;
    }

    try {
        CONFIG_FILE.open("r");
        CONFIG_FILE.encoding = "UTF-8";
        var text = CONFIG_FILE.read();
        CONFIG_FILE.close();
        var config = (typeof JSON !== "undefined" && JSON.parse) ? JSON.parse(text) : eval("(" + text + ")");
        if (!config.pythonCmd) {
            config.pythonCmd = defaults.pythonCmd;
        }
        return config;
    } catch (e) {
        return defaults;
    }
}

// =====================================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// =====================================================================

// Получить разделитель путей для текущей ОС
function getPathSeparator() {
    return isWindows ? "\\" : "/";
}

// Сформировать путь к файлу
function buildPath(folder, filename) {
    return folder.fsName + getPathSeparator() + filename;
}

function trimText(value) {
    return value.toString().replace(/^\s+|\s+$/g, "");
}

function escapeRegExp(value) {
    return value.toString().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSearchText(value) {
    return trimText(value || "").replace(/\s+/g, " ").toLowerCase();
}

function normalizeCompNameKey(value) {
    return normalizeSearchText(value);
}

function collectExistingCompNames() {
    var names = {};
    for (var i = 1; i <= app.project.items.length; i++) {
        var item = app.project.items[i];
        if (item instanceof CompItem) {
            names[normalizeCompNameKey(item.name)] = true;
        }
    }
    return names;
}

function itemNameExistsInFolder(folder, name) {
    var key = normalizeCompNameKey(name);
    for (var i = 1; i <= app.project.items.length; i++) {
        var item = app.project.items[i];
        if (item.parentFolder === folder && normalizeCompNameKey(item.name) === key) {
            return true;
        }
    }
    return false;
}

function makeUniqueFolderName(parentFolder, baseName) {
    var name = baseName;
    var index = 2;
    while (itemNameExistsInFolder(parentFolder, name)) {
        name = baseName + " " + index;
        index++;
    }
    return name;
}

function createNewPlatesFolder(parentFolder, prefix) {
    var now = new Date();
    var yyyy = now.getFullYear();
    var mm = ("0" + (now.getMonth() + 1)).slice(-2);
    var dd = ("0" + now.getDate()).slice(-2);
    var hh = ("0" + now.getHours()).slice(-2);
    var mi = ("0" + now.getMinutes()).slice(-2);
    var baseName = prefix + "_новые_" + yyyy + "-" + mm + "-" + dd + "_" + hh + "-" + mi;
    var folder = app.project.items.addFolder(makeUniqueFolderName(parentFolder, baseName));
    folder.parentFolder = parentFolder;
    return folder;
}

function getSourceTextProperty(layer) {
    if (!layer) {
        return null;
    }

    var textProps = layer.property("ADBE Text Properties");
    if (!textProps) {
        return null;
    }

    return textProps.property("ADBE Text Document");
}

function getSourceTextValue(textProp) {
    if (!textProp) {
        return "";
    }

    var value = textProp.value;
    if (value && value.text !== undefined) {
        return value.text;
    }

    return value ? value.toString() : "";
}

function candidateMatches(value, candidates) {
    var normalized = normalizeSearchText(value);
    for (var i = 0; i < candidates.length; i++) {
        if (normalized === normalizeSearchText(candidates[i])) {
            return true;
        }
    }
    return false;
}

function expressionReadsCompNamePart(textProp, splitIndex) {
    if (!textProp || !textProp.expression) {
        return false;
    }

    var expression = textProp.expression.toString();
    return expression.indexOf("thisComp.name") !== -1 &&
        expression.indexOf(".split") !== -1 &&
        expression.indexOf("[" + splitIndex + "]") !== -1;
}

function findTextLayer(comp, candidates, splitIndex) {
    var layer;
    var textProp;

    for (var i = 1; i <= comp.numLayers; i++) {
        layer = comp.layer(i);
        textProp = getSourceTextProperty(layer);
        if (textProp && candidateMatches(layer.name, candidates)) {
            return layer;
        }
    }

    for (var j = 1; j <= comp.numLayers; j++) {
        layer = comp.layer(j);
        textProp = getSourceTextProperty(layer);
        if (textProp && candidateMatches(getSourceTextValue(textProp), candidates)) {
            return layer;
        }
    }

    for (var k = 1; k <= comp.numLayers; k++) {
        layer = comp.layer(k);
        textProp = getSourceTextProperty(layer);
        if (textProp && expressionReadsCompNamePart(textProp, splitIndex)) {
            return layer;
        }
    }

    return null;
}

function expressionStringLiteral(value) {
    return "\"" + String(value || "")
        .replace(/\\/g, "\\\\")
        .replace(/"/g, "\\\"")
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n") + "\"";
}

function buildRegaliaAutoScaleExpression(value) {
    return [
        "function sliderValue(name, defaultValue) {",
        "    try {",
        "        return thisComp.layer(\"CONTROLLER\").effect(name)(\"Slider\").value;",
        "    } catch (e) {",
        "        return defaultValue;",
        "    }",
        "}",
        "",
        "var txt = " + expressionStringLiteral(value) + ";",
        "if (txt === \"\") {",
        "    txt = \"Должность не задана\";",
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
        "style",
        "    .setFontSize(nextSize)",
        "    .setText(txt);"
    ].join("\n");
}

function setTextLayerValue(comp, candidates, splitIndex, value, label, expressionText) {
    var layer = findTextLayer(comp, candidates, splitIndex);
    if (!layer) {
        throw new Error("В композиции \"" + comp.name + "\" не найден текстовый слой для поля \"" + label + "\". Проверьте имя слоя: " + candidates.join(" / "));
    }

    var textProp = getSourceTextProperty(layer);
    if (textProp.canSetExpression) {
        try {
            textProp.expressionEnabled = false;
            if (textProp.expression) {
                textProp.expression = "";
            }
        } catch (expressionError) {
            textProp.expressionEnabled = false;
        }
    }

    var textDocument = textProp.value;
    if (textDocument && textDocument.text !== undefined) {
        textDocument.text = value;
        textProp.setValue(textDocument);
    } else {
        textProp.setValue(value);
    }

    if (expressionText && textProp.canSetExpression) {
        textProp.expression = expressionText;
        textProp.expressionEnabled = true;
    }
}

var COMMON_FIRST_NAMES = {
    "александр": true, "александра": true, "алексей": true, "алена": true, "алина": true,
    "анастасия": true, "анатолий": true, "андрей": true, "анна": true, "антон": true,
    "арина": true, "артем": true, "борис": true, "вадим": true, "валентин": true,
    "валентина": true, "валерий": true, "валерия": true, "василий": true, "вера": true,
    "виктор": true, "виктория": true, "виталий": true, "владимир": true, "владислав": true,
    "вячеслав": true, "галина": true, "георгий": true, "глеб": true, "дарья": true,
    "денис": true, "дмитрий": true, "евгений": true, "евгения": true, "екатерина": true,
    "елена": true, "елизавета": true, "элла": true, "иван": true, "игорь": true, "илья": true,
    "инна": true, "ирина": true, "кирилл": true, "константин": true, "ксения": true,
    "лев": true, "леонид": true, "любовь": true, "людмила": true, "максим": true,
    "маргарита": true, "марина": true, "мария": true, "михаил": true, "надежда": true,
    "наталья": true, "никита": true, "николай": true, "олег": true, "ольга": true,
    "павел": true, "петр": true, "полина": true, "роман": true, "светлана": true,
    "семен": true, "сергей": true, "софия": true, "станислав": true, "степан": true,
    "татьяна": true, "тимофей": true, "федор": true, "юлия": true, "юрий": true,
    "яна": true, "ярослав": true
};

function normalizeNameToken(value) {
    return trimText(value).toLowerCase().replace(/ё/g, "е").replace(/\.$/, "");
}

function isKnownFirstName(value) {
    return COMMON_FIRST_NAMES[normalizeNameToken(value)] === true;
}

function isPatronymic(value) {
    var text = normalizeNameToken(value);
    return /(вич|вна|ич|ична|оглы|кызы)$/.test(text);
}

function looksLikeSurname(value) {
    var text = normalizeNameToken(value);
    return /(ов|ова|ев|ева|ёв|ёва|ин|ина|ын|ына|ский|ская|цкий|цкая|енко|ко|ук|юк|ич|ых|их)$/.test(text);
}

function cleanNameToken(value) {
    return trimText(value)
        .replace(/\.$/, "")
        .replace(/^[,;:()\[\]{}"']+|[,;:()\[\]{}"']+$/g, "");
}

function formatNameForPlate(value) {
    var text = trimText(value || "")
        .replace(/[\r\n\t]+/g, " ")
        .replace(/\s+/g, " ");
    if (text === "") {
        return "";
    }

    var rawParts = text.replace(/[,;]+/g, " ").split(" ");
    var parts = [];
    for (var i = 0; i < rawParts.length; i++) {
        var part = cleanNameToken(rawParts[i]);
        if (part !== "" && !isPatronymic(part)) {
            parts.push(part);
        }
    }

    if (parts.length === 0) {
        return "";
    }
    if (parts.length === 1) {
        return parts[0].toUpperCase();
    }

    var first = parts[0];
    var second = parts[1];
    var firstIsName = isKnownFirstName(first);
    var secondIsName = isKnownFirstName(second);
    var firstIsSurname = looksLikeSurname(first);
    var secondIsSurname = looksLikeSurname(second);
    var name;
    var surname;

    if (firstIsName && !secondIsName) {
        name = first;
        surname = second;
    } else if (secondIsName && !firstIsName) {
        name = second;
        surname = first;
    } else if (firstIsSurname && !secondIsSurname) {
        name = second;
        surname = first;
    } else if (secondIsSurname && !firstIsSurname) {
        name = first;
        surname = second;
    } else if (rawParts.length >= 3) {
        name = second;
        surname = first;
    } else {
        name = first;
        surname = second;
    }

    return trimText(name + " " + surname).toUpperCase();
}

function quoteShellArg(value) {
    var text = value.toString();
    if (isWindows) {
        return "\"" + text.replace(/"/g, "\\\"") + "\"";
    }
    return "'" + text.replace(/'/g, "'\\''") + "'";
}

function quoteExecutable(value) {
    var text = value.toString();
    if (!isWindows && text.indexOf("/usr/bin/env ") === 0) {
        return text;
    }
    if (text.indexOf("/") !== -1 || text.indexOf("\\") !== -1 || text.indexOf(":") !== -1) {
        return quoteShellArg(text);
    }
    return text;
}

function getDataJsonFile() {
    if (!DATA_FOLDER.exists) {
        DATA_FOLDER.create();
    }
    return new File(buildPath(DATA_FOLDER, JSON_FILE_NAME));
}

function cleanManualValue(value) {
    return trimText(String(value || "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " "));
}

function splitManualLine(line) {
    var text = trimText(line);
    if (text.indexOf("|") !== -1) return text.split("|");
    if (text.indexOf(";") !== -1) return text.split(";");
    if (text.indexOf("\t") !== -1) return text.split("\t");
    return [text];
}

function normalizeManualHeader(value) {
    return trimText(value || "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}

function isManualHeaderLine(parts) {
    if (!parts || parts.length === 0) return false;
    var first = normalizeManualHeader(parts[0]);
    if (first !== "фио" && first !== "фио спикера" && first !== "имя" && first !== "имя фамилия") return false;
    if (parts.length === 1) return true;
    var second = normalizeManualHeader(parts[1]);
    return second === "" || second === "должность" || second === "регалии";
}

function parseManualPlates(text, settings) {
    var lines = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    var rows = [];
    var nameField = trimText(settings.nameField) || "ФИО спикера";
    var positionField = trimText(settings.positionField) || "Должность";

    for (var i = 0; i < lines.length; i++) {
        var line = trimText(lines[i]);
        if (line === "") continue;

        var parts = splitManualLine(line);
        for (var p = 0; p < parts.length; p++) {
            parts[p] = cleanManualValue(parts[p]);
        }
        if (rows.length === 0 && isManualHeaderLine(parts)) continue;

        if ((parts[0] || "") === "") continue;

        var row = {};
        row[nameField] = parts[0] || "";
        row[positionField] = parts.length > 1 ? parts[1] : "";
        rows.push(row);
    }

    if (rows.length === 0) {
        throw new Error("Ручной список пуст. Добавьте хотя бы одну строку: Имя Фамилия | Должность");
    }

    return rows;
}

function readDataJson(jsonFile) {
    var dataArray = [];
    if (jsonFile.open("r")) {
        jsonFile.encoding = "UTF-8";
        var jsonData = jsonFile.read();
        jsonFile.close();

        if (typeof JSON !== "undefined" && JSON.parse) {
            dataArray = JSON.parse(jsonData);
        } else {
            dataArray = eval("(" + jsonData + ")");
        }
    }
    return dataArray;
}

function normalizeRows(dataArray) {
    var cleanData = [];
    for (var i = 0; i < dataArray.length; i++) {
        var row = dataArray[i];
        var cleanRow = {};
        for (var key in row) {
            if (row.hasOwnProperty(key)) {
                var cleanKey = trimText(key);
                var cleanValue = row[key] ? trimText(row[key]) : "";
                cleanRow[cleanKey] = cleanValue;
            }
        }
        cleanData.push(cleanRow);
    }
    return cleanData;
}

function loadDataRows(settings) {
    if (settings.dataMode === "Вручную") {
        return parseManualPlates(settings.manualPlatesText, settings);
    }

    var pyScriptFile = new File(PYTHON_SCRIPT_PATH);
    if (!pyScriptFile.exists) {
        throw new Error("Python-скрипт не найден:\n" + PYTHON_SCRIPT_PATH + "\n\nОтредактируйте путь в начале скрипта.");
    }

    var jsonFile = getDataJsonFile();
    if (jsonFile.exists) {
        jsonFile.remove();
    }

    var cmd = buildPythonCommand(PYTHON_CMD, pyScriptFile.fsName, settings.csvUrl, jsonFile.fsName);
    var cmdResult = system.callSystem(cmd);

    $.sleep(1000);

    if (!jsonFile.exists) {
        throw new Error("Файл data.json не создан.\n\nВывод:\n" + cmdResult);
    }

    try {
        return readDataJson(jsonFile);
    } catch (e) {
        throw new Error("Ошибка JSON:\n" + e.toString());
    }
}

// Сформировать команду для вызова Python
function buildPythonCommand(pythonPath, scriptPath, csvUrl, jsonPath) {
    if (isWindows) {
        return "cmd /c " + quoteExecutable(pythonPath) + " " + quoteShellArg(scriptPath) + " " + quoteShellArg(csvUrl) + " " + quoteShellArg(jsonPath) + " 2>&1";
    } else {
        var innerCmd = quoteExecutable(pythonPath) + " " + quoteShellArg(scriptPath) + " " + quoteShellArg(csvUrl) + " " + quoteShellArg(jsonPath) + " 2>&1";
        return "/bin/sh -lc " + quoteShellArg(innerCmd);
    }
}

// =====================================================================
// ОСНОВНОЙ UI
// =====================================================================

function main() {
    if (app.project == null) {
        alert("Ошибка: Откройте или создайте проект в After Effects.", "Генератор плашек");
        return;
    }

    var masterComp = app.project.activeItem;
    if (masterComp == null || !(masterComp instanceof CompItem)) {
        alert("Ошибка: Выделите композицию-шаблон в панели Project.", "Генератор плашек");
        return;
    }

    var settings = loadSettings();
    var osName = isWindows ? "Windows" : "macOS";

    var win = new Window("palette", "🎬 Генератор плашек v4.0 (" + osName + ")", undefined, {resizeable: true});
    win.orientation = "column";
    win.alignChildren = ["fill", "top"];
    win.margins = 15;
    win.spacing = 10;

    // ГРУППА: Источник данных
    var grpUrl = win.add("panel", undefined, "📊 Источник данных");
    grpUrl.orientation = "column";
    grpUrl.alignChildren = ["fill", "top"];
    grpUrl.margins = 10;
    grpUrl.spacing = 5;

    var modeGroup = grpUrl.add("group");
    modeGroup.orientation = "row";
    modeGroup.alignChildren = ["left", "center"];
    modeGroup.add("statictext", undefined, "Источник:");
    var ddlDataMode = modeGroup.add("dropdownlist", undefined, ["Таблица", "Вручную"]);
    ddlDataMode.selection = settings.dataMode === "Вручную" ? 1 : 0;

    var lblUrl = grpUrl.add("statictext", undefined, "Ссылка на CSV:");
    var edtUrl = grpUrl.add("edittext", undefined, settings.csvUrl);
    edtUrl.preferredSize.height = 40;

    var btnConvertUrl = grpUrl.add("button", undefined, "🔄 Конвертировать ссылку");
    btnConvertUrl.onClick = function() {
        var url = edtUrl.text;
        var match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
        var gidMatch = url.match(/gid=(\d+)/);
        
        if (match) {
            var gid = gidMatch ? gidMatch[1] : "0";
            edtUrl.text = "https://docs.google.com/spreadsheets/d/" + match[1] + "/gviz/tq?tqx=out:csv&gid=" + gid;
            alert("✅ Ссылка конвертирована!", "Генератор плашек");
        } else {
            alert("❌ Не удалось распознать ссылку.", "Генератор плашек");
        }
    };

    var manualLabel = grpUrl.add("statictext", undefined, "Ручной список: одна строка = одна плашка");
    var manualText = grpUrl.add("edittext", undefined, settings.manualPlatesText || "", {multiline: true, scrolling: true});
    manualText.preferredSize.height = 120;
    var manualHint = grpUrl.add("statictext", undefined, "Формат: Имя Фамилия | Должность. Также можно использовать ;");
    manualHint.graphics.font = ScriptUI.newFont("dialog", "Italic", 10);

    function updateSourceModeUi() {
        var manualMode = ddlDataMode.selection && ddlDataMode.selection.text === "Вручную";
        lblUrl.enabled = !manualMode;
        edtUrl.enabled = !manualMode;
        btnConvertUrl.enabled = !manualMode;
        manualLabel.enabled = manualMode;
        manualText.enabled = manualMode;
        manualHint.enabled = manualMode;
    }

    ddlDataMode.onChange = updateSourceModeUi;
    updateSourceModeUi();

    // ГРУППА: Названия полей
    var grpFields = win.add("panel", undefined, "🏷️ Названия полей");
    grpFields.orientation = "column";
    grpFields.alignChildren = ["fill", "top"];
    grpFields.margins = 10;
    grpFields.spacing = 5;

    var lblName = grpFields.add("statictext", undefined, "Колонка с ФИО:");
    var edtName = grpFields.add("edittext", undefined, settings.nameField);

    var lblPos = grpFields.add("statictext", undefined, "Колонка с должностью:");
    var edtPos = grpFields.add("edittext", undefined, settings.positionField);

    var lblNameLayer = grpFields.add("statictext", undefined, "Слой имени:");
    var edtNameLayer = grpFields.add("edittext", undefined, settings.nameLayer);

    var lblPosLayer = grpFields.add("statictext", undefined, "Слой регалий:");
    var edtPosLayer = grpFields.add("edittext", undefined, settings.positionLayer);

    // ГРУППА: Формат имени композиции
    var grpFormat = win.add("panel", undefined, "📝 Формат имени");
    grpFormat.orientation = "column";
    grpFormat.alignChildren = ["fill", "top"];
    grpFormat.margins = 10;
    grpFormat.spacing = 5;

    var lblPrefix = grpFormat.add("statictext", undefined, "Префикс:");
    var edtPrefix = grpFormat.add("edittext", undefined, settings.compPrefix);

    var lblDelim = grpFormat.add("statictext", undefined, "Разделитель:");
    var edtDelim = grpFormat.add("edittext", undefined, settings.delimiter);

    var lblExample = grpFormat.add("statictext", undefined, "Пример: Плашка_Иван Иванов_Директор");
    lblExample.graphics.font = ScriptUI.newFont("dialog", "Italic", 10);

    // КНОПКИ
    var grpButtons = win.add("group");
    grpButtons.orientation = "row";
    grpButtons.alignChildren = ["fill", "center"];
    grpButtons.spacing = 10;

    var btnSave = grpButtons.add("button", undefined, "💾 Сохранить");
    var btnCheck = grpButtons.add("button", undefined, "🔍 Проверить");
    var btnGenerate = grpButtons.add("button", undefined, "▶ Создать");
    btnGenerate.preferredSize.height = 35;
    btnGenerate.graphics.font = ScriptUI.newFont("dialog", "Bold", 12);

    // ОБРАБОТЧИКИ
    btnSave.onClick = function() {
        settings.csvUrl = edtUrl.text;
        settings.dataMode = ddlDataMode.selection ? ddlDataMode.selection.text : "Таблица";
        settings.manualPlatesText = manualText.text;
        settings.nameField = edtName.text;
        settings.positionField = edtPos.text;
        settings.nameLayer = edtNameLayer.text;
        settings.positionLayer = edtPosLayer.text;
        settings.compPrefix = edtPrefix.text;
        settings.delimiter = edtDelim.text;
        
        if (saveSettings(settings)) {
            alert("✅ Настройки сохранены!", "Генератор плашек");
        } else {
            alert("❌ Ошибка сохранения.", "Генератор плашек");
        }
    };

    btnCheck.onClick = function() {
        var fieldsStr = edtName.text + ", " + edtPos.text;
        settings.csvUrl = edtUrl.text;
        settings.dataMode = ddlDataMode.selection ? ddlDataMode.selection.text : "Таблица";
        settings.manualPlatesText = manualText.text;
        settings.nameField = edtName.text;
        settings.positionField = edtPos.text;
        checkData(settings, fieldsStr);
    };

    btnGenerate.onClick = function() {
        settings.csvUrl = edtUrl.text;
        settings.dataMode = ddlDataMode.selection ? ddlDataMode.selection.text : "Таблица";
        settings.manualPlatesText = manualText.text;
        settings.nameField = edtName.text;
        settings.positionField = edtPos.text;
        settings.nameLayer = edtNameLayer.text;
        settings.positionLayer = edtPosLayer.text;
        settings.compPrefix = edtPrefix.text;
        settings.delimiter = edtDelim.text;
        
        saveSettings(settings);
        generatePlates(masterComp, settings);
    };

    var updateExample = function() {
        var prefix = edtPrefix.text || "Плашка";
        var delim = edtDelim.text || "_";
        var name = edtName.text ? "Иван Иванов" : "Имя";
        lblExample.text = "Пример: " + prefix + delim + name;
    };

    edtPrefix.onChanging = updateExample;
    edtDelim.onChanging = updateExample;
    edtName.onChanging = updateExample;
    edtPos.onChanging = updateExample;

    win.center();
    win.show();
}

// =====================================================================
// ПРОВЕРКА ДАННЫХ
// =====================================================================

function checkData(settings, fieldsConfig) {
    var progressWin = new Window("palette", "🔍 Проверка...", undefined, {resizeable: false});
    progressWin.orientation = "column";
    progressWin.alignChildren = ["fill", "top"];
    progressWin.margins = 15;
    
    var progressText = progressWin.add("statictext", undefined, "Загрузка...");
    var progressBar = progressWin.add("progressbar", undefined, 0, 100);
    progressBar.preferredSize.width = 300;
    
    progressWin.center();
    progressWin.show();
    
    try {
        progressBar.value = 20;
        progressText.text = settings.dataMode === "Вручную" ? "Разбор ручного списка..." : "Запуск Python...";

        var dataArray = loadDataRows(settings);

        progressBar.value = 50;
        progressText.text = "Анализ...";

        progressBar.value = 70;
        progressText.text = "Подсчёт...";

        var cleanData = normalizeRows(dataArray);
        
        var rawFieldNames = fieldsConfig.split(",");
        var fieldNames = [];
        for (var fIndex = 0; fIndex < rawFieldNames.length; fIndex++) {
            var fieldNamePart = trimText(rawFieldNames[fIndex]);
            if (fieldNamePart !== "") {
                fieldNames.push(fieldNamePart);
            }
        }
        var primaryField = fieldNames.length > 0 ? fieldNames[0] : "ФИО спикера";
        
        var totalRecords = cleanData.length;
        var validRecords = 0;
        var errorRecords = 0;
        var emptyRecords = 0;
        var validExamples = [];
        
        for (var i = 0; i < cleanData.length; i++) {
            var row = cleanData[i];
            var fieldValue = row[primaryField] || "";
            
            if (fieldValue === "") {
                emptyRecords++;
            } else if (fieldValue.indexOf("#VALUE!") !== -1 || fieldValue.indexOf("#") === 0) {
                errorRecords++;
            } else {
                validRecords++;
                if (validExamples.length < 5) {
                    validExamples.push(row);
                }
            }
        }
        
        progressBar.value = 90;
        progressText.text = "Отчёт...";
        
        var report = "📊 СТАТИСТИКА\n";
        report += "═══════════════════════\n\n";
        report += "Источник: " + (settings.dataMode || "Таблица") + "\n";
        report += "Всего: " + totalRecords + "\n";
        report += "✅ ОК: " + validRecords + "\n";
        report += "❌ Ошибки: " + errorRecords + "\n";
        report += "⚠️ Пустые: " + emptyRecords + "\n\n";
        
        report += "🔍 ПОЛЯ:\n";
        report += "──────────────────────\n";
        for (var f = 0; f < fieldNames.length; f++) {
            var fieldName = fieldNames[f];
            var filledCount = 0;
            for (var i = 0; i < cleanData.length; i++) {
                if (cleanData[i][fieldName] && cleanData[i][fieldName] !== "") {
                    filledCount++;
                }
            }
            report += "• " + fieldName + ": " + filledCount + "/" + totalRecords + "\n";
        }
        
        report += "\n📋 ПРИМЕРЫ:\n";
        report += "──────────────────────\n";
        if (validExamples.length === 0) {
            report += "⚠️ Нет данных\n";
        } else {
            for (var i = 0; i < validExamples.length; i++) {
                var example = validExamples[i];
                report += "\n#" + (i + 1) + ":\n";
                for (var f = 0; f < fieldNames.length; f++) {
                    var fieldName = fieldNames[f];
                    var value = example[fieldName] || "(пусто)";
                    report += "  " + fieldName + ": " + value + "\n";
                }
            }
        }
        
        report += "\n\n💡 ИТОГ:\n";
        if (validRecords === 0) {
            report += "⚠️ Нет данных с заполненным полем!";
        } else {
            report += "✅ Всё ОК! Можно создавать плашки.";
        }
        
        progressWin.close();
        alert(report, "🔍 Проверка данных");
        
    } catch (e) {
        progressWin.close();
        alert("❌ Ошибка:\n" + e.toString() + "\nСтрока: " + e.line, "Проверка");
    }
}

// =====================================================================
// ГЕНЕРАЦИЯ ПЛАШЕК
// =====================================================================

function generatePlates(masterComp, settings) {
    app.beginUndoGroup("Создание плашек");
    
    try {
        var dataArray = loadDataRows(settings);
        
        if (dataArray.length === 0) {
            alert("❌ Данные пусты.", "Генератор");
            return;
        }
        
        var cleanData = normalizeRows(dataArray);
        
        // Новые плашки будут складываться в новую папку рядом с master-comp.
        var parentFolder = masterComp.parentFolder;
        if (!parentFolder) {
            parentFolder = app.project.rootFolder;
        }
        
        var prefix = settings.compPrefix || "Плашка";
        var existingCompNames = collectExistingCompNames();
        var targetFolder = null;
        
        // Генерация
        var createdCount = 0;
        var skippedCount = 0;
        var skippedExistingCount = 0;
        var nameField = settings.nameField;
        var posField = settings.positionField;
        var nameLayer = settings.nameLayer || "ИМЯ";
        var positionLayer = settings.positionLayer || "РЕГАЛИИ";
        var delim = settings.delimiter;
        
        for (var i = 0; i < cleanData.length; i++) {
            var rowData = cleanData[i];
            var speakerName = rowData[nameField] || "";
            
            if (speakerName === "" || 
                speakerName.indexOf("#VALUE!") !== -1 || 
                speakerName.indexOf("#") === 0) {
                skippedCount++;
                continue;
            }
            
            var delimRegex = new RegExp(escapeRegExp(delim), "g");
            var fullName = formatNameForPlate(speakerName.toString().replace(delimRegex, " "));
            var position = (rowData[posField] || "").toString().replace(delimRegex, " ");
            var compName = prefix + delim + fullName;

            if (existingCompNames[normalizeCompNameKey(compName)]) {
                skippedExistingCount++;
                continue;
            }
            
            var newComp = masterComp.duplicate();
            if (!targetFolder) {
                targetFolder = createNewPlatesFolder(parentFolder, prefix);
            }
            
            newComp.name = compName;
            newComp.parentFolder = targetFolder;
            setTextLayerValue(newComp, [nameLayer, "ИМЯ", "ИМЯ ФАМИЛИЯ"], 1, fullName, "ФИО");
            setTextLayerValue(newComp, [positionLayer, "РЕГАЛИИ", "ДОЛЖНОСТЬ"], 2, trimText(position), "Регалии", buildRegaliaAutoScaleExpression(trimText(position)));
            
            existingCompNames[normalizeCompNameKey(compName)] = true;
            createdCount++;
        }
        
        var message = "✅ Готово!\n\n" +
                      "Новых плашек создано: " + createdCount + "\n" +
                      "Источник: " + (settings.dataMode || "Таблица") + "\n" +
                      "Уже были в проекте: " + skippedExistingCount + "\n" +
                      "Пропущено строк без ФИО/с ошибкой: " + skippedCount + "\n" +
                      "Всего: " + cleanData.length + "\n\n" +
                      (targetFolder ? "Папка новых плашек: " + targetFolder.name + "\n\n" : "Новых плашек не было, папка не создана.\n\n") +
                      "Имена композиций: " + prefix + delim + "ИМЯ ФАМИЛИЯ\n" +
                      "ФИО записано в текстовый слой, регалии записаны в expression автоподгонки размера.";
        
        alert(message, "Генератор плашек");
        
    } catch (e) {
        alert("❌ Ошибка:\n" + e.toString() + "\nСтрока: " + e.line, "Генератор");
    } finally {
        app.endUndoGroup();
    }
}

// Запуск
main();
