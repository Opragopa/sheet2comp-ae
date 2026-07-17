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
        delimiter: "_",
        compPrefix: "Плашка"
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

    // ГРУППА: Ссылка на таблицу
    var grpUrl = win.add("panel", undefined, "📊 Google Таблица");
    grpUrl.orientation = "column";
    grpUrl.alignChildren = ["fill", "top"];
    grpUrl.margins = 10;
    grpUrl.spacing = 5;

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
        settings.nameField = edtName.text;
        settings.positionField = edtPos.text;
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
        checkData(edtUrl.text, fieldsStr);
    };

    btnGenerate.onClick = function() {
        settings.csvUrl = edtUrl.text;
        settings.nameField = edtName.text;
        settings.positionField = edtPos.text;
        settings.compPrefix = edtPrefix.text;
        settings.delimiter = edtDelim.text;
        
        saveSettings(settings);
        generatePlates(masterComp, settings);
    };

    var updateExample = function() {
        var prefix = edtPrefix.text || "Плашка";
        var delim = edtDelim.text || "_";
        var name = edtName.text ? "Иван Иванов" : "Имя";
        var pos = edtPos.text ? "Директор" : "Должность";
        lblExample.text = "Пример: " + prefix + delim + name + delim + pos;
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

function checkData(csvUrl, fieldsConfig) {
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
        var pyScriptFile = new File(PYTHON_SCRIPT_PATH);
        if (!pyScriptFile.exists) {
            alert("❌ Python-скрипт не найден:\n" + PYTHON_SCRIPT_PATH + "\n\nОтредактируйте путь в начале скрипта.", "Проверка");
            progressWin.close();
            return;
        }
        
        var jsonFile = getDataJsonFile();
        
        // Удалить старый JSON
        if (jsonFile.exists) {
            jsonFile.remove();
        }
        
        progressBar.value = 20;
        progressText.text = "Запуск Python...";
        
        var cmd = buildPythonCommand(PYTHON_CMD, pyScriptFile.fsName, csvUrl, jsonFile.fsName);
        var cmdResult = system.callSystem(cmd);
        
        $.sleep(1000);
        progressBar.value = 50;
        progressText.text = "Анализ...";
        
        if (!jsonFile.exists) {
            alert("❌ Файл data.json не создан.\n\nВывод:\n" + cmdResult, "Проверка");
            progressWin.close();
            return;
        }
        
        var dataArray = [];
        if (jsonFile.open("r")) {
            jsonFile.encoding = "UTF-8";
            var jsonData = jsonFile.read();
            jsonFile.close();
            
            try {
                if (typeof JSON !== "undefined" && JSON.parse) {
                    dataArray = JSON.parse(jsonData);
                } else {
                    dataArray = eval("(" + jsonData + ")");
                }
            } catch (e) {
                alert("❌ Ошибка JSON:\n" + e.toString(), "Проверка");
                progressWin.close();
                return;
            }
        }
        
        progressBar.value = 70;
        progressText.text = "Подсчёт...";
        
        // Нормализация
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
        var pyScriptFile = new File(PYTHON_SCRIPT_PATH);
        if (!pyScriptFile.exists) {
            alert("❌ Python-скрипт не найден:\n" + PYTHON_SCRIPT_PATH + "\n\nОтредактируйте путь в начале скрипта.", "Генератор");
            return;
        }
        
        var jsonFile = getDataJsonFile();
        
        // Удалить старый JSON
        if (jsonFile.exists) {
            jsonFile.remove();
        }
        
        var cmd = buildPythonCommand(PYTHON_CMD, pyScriptFile.fsName, settings.csvUrl, jsonFile.fsName);
        var cmdResult = system.callSystem(cmd);
        
        $.sleep(1000);
        
        if (!jsonFile.exists) {
            alert("❌ data.json не создан.\n\nВывод:\n" + cmdResult, "Генератор");
            return;
        }
        
        var dataArray = [];
        if (jsonFile.open("r")) {
            jsonFile.encoding = "UTF-8";
            var jsonData = jsonFile.read();
            jsonFile.close();
            
            try {
                if (typeof JSON !== "undefined" && JSON.parse) {
                    dataArray = JSON.parse(jsonData);
                } else {
                    dataArray = eval("(" + jsonData + ")");
                }
            } catch (e) {
                alert("❌ Ошибка JSON:\n" + e.toString(), "Генератор");
                return;
            }
        }
        
        if (dataArray.length === 0) {
            alert("❌ Данные пусты.", "Генератор");
            return;
        }
        
        // Нормализация
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
        
        // Автоочистка
        var targetFolder = masterComp.parentFolder;
        if (!targetFolder) {
            targetFolder = app.project.rootFolder;
        }
        
        var prefix = settings.compPrefix || "Плашка";
        var itemsToDelete = [];
        for (var i = 1; i <= app.project.items.length; i++) {
            var item = app.project.items[i];
            if (item instanceof CompItem && 
                item.parentFolder === targetFolder && 
                item.name.indexOf(prefix) === 0) {
                itemsToDelete.push(item);
            }
        }
        
        for (var j = 0; j < itemsToDelete.length; j++) {
            itemsToDelete[j].remove();
        }
        
        // Генерация
        var createdCount = 0;
        var skippedCount = 0;
        var nameField = settings.nameField;
        var posField = settings.positionField;
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
            
            var newComp = masterComp.duplicate();
            var delimRegex = new RegExp(escapeRegExp(delim), "g");
            var fullName = speakerName.toString().replace(delimRegex, " ");
            var position = (rowData[posField] || "").toString().replace(delimRegex, " ");
            
            newComp.name = prefix + delim + trimText(fullName) + delim + trimText(position);
            newComp.parentFolder = targetFolder;
            
            createdCount++;
        }
        
        var message = "✅ Готово!\n\n" +
                      "Создано: " + createdCount + "\n" +
                      "Пропущено: " + skippedCount + "\n" +
                      "Всего: " + cleanData.length + "\n\n" +
                      "📌 Expressions:\n" +
                      "• ФИО: thisComp.name.split(\"" + delim + "\")[1]\n" +
                      "• Должность: thisComp.name.split(\"" + delim + "\")[2]";
        
        alert(message, "Генератор плашек");
        
    } catch (e) {
        alert("❌ Ошибка:\n" + e.toString() + "\nСтрока: " + e.line, "Генератор");
    } finally {
        app.endUndoGroup();
    }
}

// Запуск
main();
