// Sheets to AE Comp Generator

var SCRIPT_FILE = new File($.fileName);
var SCRIPT_FOLDER = SCRIPT_FILE.parent;
var PYTHON_SCRIPT_PATH = SCRIPT_FOLDER.fsName + "/download_data.py";
var CONFIG_FILE = new File(SCRIPT_FOLDER.fsName + "/ae_parser_config.json");
var SETTINGS_FILE = new File(Folder.myDocuments.fsName + "/ae_plaque_settings.json");
var JSON_FILE_NAME = "data.json";

function isWindows() {
    return $.os.toLowerCase().indexOf("windows") !== -1;
}

function trimText(value) {
    return value.toString().replace(/^\s+|\s+$/g, "");
}

function escapeRegExp(value) {
    return value.toString().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function quoteArg(value) {
    var text = value.toString();
    if (isWindows()) {
        return "\"" + text.replace(/"/g, "\\\"") + "\"";
    }
    return "'" + text.replace(/'/g, "'\\''") + "'";
}

function getPythonCommand() {
    var cmd = loadRuntimeConfig().pythonCmd;
    if (isWindows() && cmd.charAt(0) !== "\"" && (cmd.indexOf("\\") !== -1 || cmd.indexOf(":") !== -1)) {
        return quoteArg(cmd);
    }
    return cmd;
}

function readJsonFile(file, dialogTitle) {
    if (!file.open("r")) {
        alert("Не удалось открыть файл:\n" + file.fsName, dialogTitle);
        return null;
    }

    file.encoding = "UTF-8";
    var text = file.read();
    file.close();

    try {
        if (typeof JSON !== "undefined" && JSON.parse) {
            return JSON.parse(text);
        }
        return eval("(" + text + ")");
    } catch (e) {
        alert("Ошибка парсинга JSON:\n" + e.toString(), dialogTitle);
        return null;
    }
}

function parseFieldNames(fieldsConfig) {
    var raw = fieldsConfig.split(",");
    var fields = [];
    for (var i = 0; i < raw.length; i++) {
        var name = trimText(raw[i]);
        if (name !== "") {
            fields.push(name);
        }
    }
    return fields;
}

function loadRuntimeConfig() {
    var defaults = {
        pythonCmd: isWindows() ? "py -3" : "/usr/bin/env python3"
    };

    if (!CONFIG_FILE.exists) {
        return defaults;
    }

    var config = readJsonFile(CONFIG_FILE, "Конфигурация");
    if (config == null) {
        return defaults;
    }

    if (!config.pythonCmd) {
        config.pythonCmd = defaults.pythonCmd;
    }
    return config;
}

function loadSettings() {
    var defaults = {
        csvUrl: "https://docs.google.com/spreadsheets/d/12lVA34EgWG6oy4xw8w7tKga7pOqCpxyXtUoka4XYDWc/gviz/tq?tqx=out:csv&gid=1878161624",
        nameField: "ФИО спикера",
        positionField: "Должность",
        delimiter: "_",
        compPrefix: "Плашка"
    };

    if (!SETTINGS_FILE.exists) {
        return defaults;
    }

    var data = readJsonFile(SETTINGS_FILE, "Настройки");
    if (data == null) {
        return defaults;
    }

    for (var key in defaults) {
        if (defaults.hasOwnProperty(key) && !data.hasOwnProperty(key)) {
            data[key] = defaults[key];
        }
    }
    return data;
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

function runPython(csvUrl, jsonFile, pyScriptFile) {
    var cmd = getPythonCommand() + " " + quoteArg(pyScriptFile.fsName) + " " + quoteArg(csvUrl) + " " + quoteArg(jsonFile.fsName);

    if (isWindows()) {
        cmd = "cmd /c \"" + cmd + " 2>&1\"";
    } else {
        cmd = "/bin/sh -lc " + quoteArg(cmd + " 2>&1");
    }

    return system.callSystem(cmd);
}

function downloadJson(csvUrl, dialogTitle) {
    var pyScriptFile = new File(PYTHON_SCRIPT_PATH);
    if (!pyScriptFile.exists) {
        alert("Python-скрипт не найден:\n" + PYTHON_SCRIPT_PATH, dialogTitle);
        return null;
    }

    var jsonFile = new File(SCRIPT_FOLDER.fsName + "/" + JSON_FILE_NAME);
    if (jsonFile.exists) {
        jsonFile.remove();
    }

    var output = runPython(csvUrl, jsonFile, pyScriptFile);
    if (!jsonFile.exists) {
        alert("Файл data.json не создан.\n\nВывод Python:\n" + output, dialogTitle);
        return null;
    }

    return readJsonFile(jsonFile, dialogTitle);
}

function cleanRows(dataArray) {
    var cleanData = [];
    for (var i = 0; i < dataArray.length; i++) {
        var row = dataArray[i];
        var cleanRow = {};
        for (var key in row) {
            if (row.hasOwnProperty(key)) {
                cleanRow[trimText(key)] = row[key] ? trimText(row[key]) : "";
            }
        }
        cleanData.push(cleanRow);
    }
    return cleanData;
}

function checkData(csvUrl, fieldsConfig) {
    var dataArray = downloadJson(csvUrl, "Проверка данных");
    if (dataArray == null) {
        return;
    }

    var cleanData = cleanRows(dataArray);
    var fieldNames = parseFieldNames(fieldsConfig);
    var primaryField = fieldNames.length > 0 ? fieldNames[0] : "ФИО спикера";
    var validRecords = 0;
    var errorRecords = 0;
    var emptyRecords = 0;
    var validExamples = [];

    for (var i = 0; i < cleanData.length; i++) {
        var fieldValue = cleanData[i][primaryField] || "";
        if (fieldValue === "") {
            emptyRecords++;
        } else if (fieldValue.indexOf("#VALUE!") !== -1 || fieldValue.indexOf("#") === 0) {
            errorRecords++;
        } else {
            validRecords++;
            if (validExamples.length < 5) {
                validExamples.push(cleanData[i]);
            }
        }
    }

    var report = "СТАТИСТИКА ТАБЛИЦЫ\n\n";
    report += "Всего записей: " + cleanData.length + "\n";
    report += "С заполненным ФИО: " + validRecords + "\n";
    report += "С ошибками: " + errorRecords + "\n";
    report += "Пустые: " + emptyRecords + "\n\n";
    report += "ПОЛЯ:\n";

    for (var f = 0; f < fieldNames.length; f++) {
        var fieldName = fieldNames[f];
        var filledCount = 0;
        for (var r = 0; r < cleanData.length; r++) {
            if (cleanData[r][fieldName] && cleanData[r][fieldName] !== "") {
                filledCount++;
            }
        }
        report += fieldName + ": " + filledCount + "/" + cleanData.length + "\n";
    }

    report += "\nПРИМЕРЫ:\n";
    for (var e = 0; e < validExamples.length; e++) {
        report += "\nЗапись #" + (e + 1) + ":\n";
        for (var n = 0; n < fieldNames.length; n++) {
            var exampleField = fieldNames[n];
            report += exampleField + ": " + (validExamples[e][exampleField] || "(пусто)") + "\n";
        }
    }

    alert(report, "Проверка данных");
}

function generatePlates(masterComp, settings) {
    app.beginUndoGroup("Создание плашек из таблицы");

    try {
        var dataArray = downloadJson(settings.csvUrl, "Генератор плашек");
        if (dataArray == null) {
            return;
        }

        if (dataArray.length === 0) {
            alert("Данные в таблице отсутствуют.", "Генератор плашек");
            return;
        }

        var cleanData = cleanRows(dataArray);
        var targetFolder = masterComp.parentFolder || app.project.rootFolder;
        var prefix = settings.compPrefix || "Плашка";
        var nameField = settings.nameField;
        var posField = settings.positionField;
        var delim = settings.delimiter || "_";
        var delimRegex = new RegExp(escapeRegExp(delim), "g");
        var itemsToDelete = [];

        for (var i = 1; i <= app.project.items.length; i++) {
            var item = app.project.items[i];
            if (item instanceof CompItem && item.parentFolder === targetFolder && item.name.indexOf(prefix) === 0) {
                itemsToDelete.push(item);
            }
        }

        for (var d = 0; d < itemsToDelete.length; d++) {
            itemsToDelete[d].remove();
        }

        var createdCount = 0;
        var skippedCount = 0;
        for (var r = 0; r < cleanData.length; r++) {
            var rowData = cleanData[r];
            var speakerName = rowData[nameField] || "";
            if (speakerName === "" || speakerName.indexOf("#VALUE!") !== -1 || speakerName.indexOf("#") === 0) {
                skippedCount++;
                continue;
            }

            var fullName = speakerName.toString().replace(delimRegex, " ");
            var position = (rowData[posField] || "").toString().replace(delimRegex, " ");
            var newComp = masterComp.duplicate();
            newComp.name = prefix + delim + trimText(fullName) + delim + trimText(position);
            newComp.parentFolder = targetFolder;
            createdCount++;
        }

        alert("Готово!\n\nСоздано: " + createdCount + "\nПропущено: " + skippedCount + "\nВсего: " + cleanData.length, "Генератор плашек");
    } catch (e) {
        alert("Критическая ошибка:\n" + e.toString() + "\nСтрока: " + e.line, "Генератор плашек");
    } finally {
        app.endUndoGroup();
    }
}

function main() {
    if (app.project == null) {
        alert("Откройте или создайте проект After Effects.", "Генератор плашек");
        return;
    }

    var masterComp = app.project.activeItem;
    if (masterComp == null || !(masterComp instanceof CompItem)) {
        alert("Выделите композицию-шаблон в Project.", "Генератор плашек");
        return;
    }

    var settings = loadSettings();
    var win = new Window("palette", "Генератор плашек", undefined, {resizeable: true});
    win.orientation = "column";
    win.alignChildren = ["fill", "top"];
    win.margins = 15;
    win.spacing = 10;

    var grpUrl = win.add("panel", undefined, "Google Таблица");
    grpUrl.orientation = "column";
    grpUrl.alignChildren = ["fill", "top"];
    grpUrl.margins = 10;
    var edtUrl = grpUrl.add("edittext", undefined, settings.csvUrl);
    edtUrl.preferredSize.height = 40;

    var btnConvertUrl = grpUrl.add("button", undefined, "Конвертировать ссылку в CSV");
    btnConvertUrl.onClick = function() {
        var match = edtUrl.text.match(/\/d\/([a-zA-Z0-9_-]+)/);
        var gidMatch = edtUrl.text.match(/gid=(\d+)/);
        if (!match) {
            alert("Не удалось распознать ссылку.", "Генератор плашек");
            return;
        }
        edtUrl.text = "https://docs.google.com/spreadsheets/d/" + match[1] + "/export?format=csv&gid=" + (gidMatch ? gidMatch[1] : "0");
    };

    var grpFields = win.add("panel", undefined, "Поля");
    grpFields.orientation = "column";
    grpFields.alignChildren = ["fill", "top"];
    grpFields.margins = 10;
    grpFields.add("statictext", undefined, "Колонка с ФИО:");
    var edtName = grpFields.add("edittext", undefined, settings.nameField);
    grpFields.add("statictext", undefined, "Колонка с должностью:");
    var edtPos = grpFields.add("edittext", undefined, settings.positionField);

    var grpFormat = win.add("panel", undefined, "Имя композиции");
    grpFormat.orientation = "column";
    grpFormat.alignChildren = ["fill", "top"];
    grpFormat.margins = 10;
    grpFormat.add("statictext", undefined, "Префикс:");
    var edtPrefix = grpFormat.add("edittext", undefined, settings.compPrefix);
    grpFormat.add("statictext", undefined, "Разделитель:");
    var edtDelim = grpFormat.add("edittext", undefined, settings.delimiter);

    var grpButtons = win.add("group");
    grpButtons.orientation = "row";
    var btnSave = grpButtons.add("button", undefined, "Сохранить");
    var btnCheck = grpButtons.add("button", undefined, "Проверить данные");
    var btnGenerate = grpButtons.add("button", undefined, "Создать плашки");

    function syncSettings() {
        settings.csvUrl = edtUrl.text;
        settings.nameField = edtName.text;
        settings.positionField = edtPos.text;
        settings.compPrefix = edtPrefix.text;
        settings.delimiter = edtDelim.text;
    }

    btnSave.onClick = function() {
        syncSettings();
        alert(saveSettings(settings) ? "Настройки сохранены." : "Ошибка сохранения.", "Генератор плашек");
    };

    btnCheck.onClick = function() {
        syncSettings();
        checkData(settings.csvUrl, settings.nameField + "," + settings.positionField);
    };

    btnGenerate.onClick = function() {
        syncSettings();
        saveSettings(settings);
        generatePlates(masterComp, settings);
    };

    win.center();
    win.show();
}

main();
