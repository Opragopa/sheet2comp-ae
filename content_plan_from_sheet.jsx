/*  Content Plan Launcher
    After Effects ExtendScript (.jsx)

    Готовит TSV из общей программной Google Sheet и открывает существующие
    генераторы тем, плашек и визиток на подготовленных файлах.
*/

(function contentPlanFromSheet(thisObj) {
    var SCRIPT_NAME = "Content Plan from Sheet";
    var SCRIPT_FOLDER = File($.fileName).parent;
    var CONFIG_FILE = new File(SCRIPT_FOLDER.fsName + "/ae_parser_config.json");
    var PYTHON_SCRIPT = new File(SCRIPT_FOLDER.fsName + "/extract_content_plan.py");
    var SESSION_SCRIPT = new File(SCRIPT_FOLDER.fsName + "/session_topics_from_sheet.jsx");
    var PERSON_SCRIPT = new File(SCRIPT_FOLDER.fsName + "/person_plates_from_sheet.jsx");
    var PERSON_SETTINGS_FILE = new File(Folder.myDocuments.fsName + "/ae_person_plate_settings.json");
    var SETTINGS_FILE = new File(Folder.myDocuments.fsName + "/ae_content_plan_settings.json");
    var DEFAULT_URL = "https://docs.google.com/spreadsheets/d/10C3eoaG146WgOeQeoli90dQCHPruoJ_d4_rqcyoUR8M/edit?gid=213088400#gid=213088400";
    var DEFAULT_OUTPUT_DIR = new Folder(Folder.myDocuments.fsName + "/ae_plaque_data/content_plan");

    function trimText(value) {
        return String(value || "").replace(/^\s+|\s+$/g, "");
    }

    function isWindows() {
        return $.os.toLowerCase().indexOf("windows") >= 0;
    }

    function quoteShellArg(value) {
        var text = String(value || "");
        if (isWindows()) return "\"" + text.replace(/"/g, "\\\"") + "\"";
        return "'" + text.replace(/'/g, "'\\''") + "'";
    }

    function quoteExecutable(value) {
        return quoteShellArg(value);
    }

    function readJsonFile(file) {
        if (!file.exists) return null;
        try {
            file.open("r");
            file.encoding = "UTF-8";
            var text = file.read();
            file.close();
            return (typeof JSON !== "undefined" && JSON.parse) ? JSON.parse(text) : eval("(" + text + ")");
        } catch (e) {
            try { file.close(); } catch (closeErr) {}
            return null;
        }
    }

    function writeJsonFile(file, data) {
        file.open("w");
        file.encoding = "UTF-8";
        file.write(JSON.stringify(data, null, 2));
        file.close();
    }

    function loadRuntime() {
        var config = readJsonFile(CONFIG_FILE) || {};
        return {
            pythonCmd: config.pythonCmd || (isWindows() ? "python" : "/usr/bin/python3")
        };
    }

    function ensureFolder(folder) {
        if (!folder.exists && !folder.create()) {
            throw new Error("Не удалось создать папку:\n" + folder.fsName);
        }
    }

    function ensureFolderTree(folder) {
        if (folder.exists) return;
        var parentFolder = folder.parent;
        if (parentFolder && !parentFolder.exists) {
            ensureFolderTree(parentFolder);
        }
        ensureFolder(folder);
    }

    function hasBrokenPath(value) {
        return String(value || "").indexOf("????") >= 0;
    }

    function isFileUri(value) {
        return /^file:\/\//i.test(String(value || ""));
    }

    function hasPercentEncoding(value) {
        return /%[0-9A-Fa-f]{2}/.test(String(value || ""));
    }

    function normalizeFolderArg(value) {
        var text = trimText(value);
        if (text === "") return "";
        if (hasBrokenPath(text)) {
            throw new Error("Путь уже поврежден символами ????. Выбери папку заново кнопкой \"Выбрать\".");
        }
        if (isFileUri(text)) return text;
        if (text.charAt(0) === "/" && hasPercentEncoding(text)) return "file://" + text;
        var folder = new Folder(text);
        return folder.absoluteURI || folder.fsName;
    }

    function fileArg(file) {
        return file.absoluteURI || file.fsName;
    }

    function buildPythonCommand(pythonCmd, source, outputDir, day, statusFile) {
        if (!PYTHON_SCRIPT.exists) {
            throw new Error("Не найден Python-скрипт:\n" + PYTHON_SCRIPT.fsName);
        }

        var parts = [
            quoteExecutable(pythonCmd),
            quoteShellArg(PYTHON_SCRIPT.fsName),
            quoteShellArg(source),
            "-o",
            quoteShellArg(outputDir),
            "--status-json",
            quoteShellArg(fileArg(statusFile))
        ];
        if (trimText(day) !== "") {
            parts.push("--day");
            parts.push(quoteShellArg(day));
        }

        var inner = parts.join(" ") + " 2>&1";
        if (isWindows()) return "cmd /c " + inner;
        return "/bin/sh -lc " + quoteShellArg(inner);
    }

    function statusFileForRun() {
        return new File(Folder.temp.absoluteURI + "/ae_content_plan_status_" + (new Date().getTime()) + ".json");
    }

    function readStatusFile(file) {
        var data = readJsonFile(file);
        if (!data) return null;
        return data;
    }

    function shortOutputFallback(output) {
        var text = String(output || "");
        if (text.length > 1200) text = text.substring(0, 1200) + "\n...";
        return text;
    }

    function contentFile(outputDir, fileName) {
        var folderPath = normalizeFolderArg(outputDir);
        if (isFileUri(folderPath)) {
            return new File(folderPath + "/" + File.encode(fileName));
        }
        return new File(new Folder(folderPath).fsName + "/" + fileName);
    }

    function importReportFile(outputDir) {
        return contentFile(outputDir, "import_report.json");
    }

    function readImportReport(outputDir) {
        return readJsonFile(importReportFile(outputDir));
    }

    function assertPrepared(outputDir, fileName) {
        var file = contentFile(outputDir, fileName);
        if (!file.exists) {
            throw new Error("Файл еще не создан:\n" + file.fsName + "\n\nСначала нажми \"Подготовить TSV\".");
        }
        return file;
    }

    function runPrepare(source, outputDir, day, statusText, silent) {
        var outputArg = normalizeFolderArg(outputDir);
        if (trimText(source) === "") throw new Error("Вставь ссылку Google Sheet или выбери TSV.");
        if (outputArg === "") throw new Error("Выбери папку для TSV.");

        var outputFolder = new Folder(outputArg);
        if (!outputFolder.exists) {
            if (!confirm("Папка TSV не существует:\n" + outputFolder.fsName + "\n\nСоздать ее?")) {
                throw new Error("Подготовка отменена: папка TSV не создана.");
            }
            ensureFolderTree(outputFolder);
        }

        var runtime = loadRuntime();
        var statusFile = statusFileForRun();
        try { if (statusFile.exists) statusFile.remove(); } catch (removeStatus) {}
        var cmd = buildPythonCommand(runtime.pythonCmd, source, outputArg, day, statusFile);
        statusText.text = "Готовлю TSV...";

        var oldSessionsFile = contentFile(outputArg, "content_plan_sessions.tsv");
        var oldPlatesFile = contentFile(outputArg, "content_plan_plates.tsv");
        var oldCardsFile = contentFile(outputArg, "content_plan_cards.tsv");
        var oldAllFile = contentFile(outputArg, "content_plan_all_people.tsv");
        try { if (oldSessionsFile.exists) oldSessionsFile.remove(); } catch (remove1) {}
        try { if (oldPlatesFile.exists) oldPlatesFile.remove(); } catch (remove2) {}
        try { if (oldCardsFile.exists) oldCardsFile.remove(); } catch (remove3) {}
        try { if (oldAllFile.exists) oldAllFile.remove(); } catch (remove4) {}

        var output = system.callSystem(cmd);
        $.sleep(300);
        var status = readStatusFile(statusFile);

        if (status && status.ok === false) {
            throw new Error("Python остановил подготовку.\n\n" + status.error);
        }
        if (!status) {
            throw new Error("Python не создал UTF-8 отчет.\n\nВывод консоли:\n" + shortOutputFallback(output));
        }
        if (status.ok !== true) {
            throw new Error("Python не подтвердил успешную подготовку.\n\nВывод консоли:\n" + shortOutputFallback(output));
        }

        var sessionsFile = contentFile(outputArg, "content_plan_sessions.tsv");
        var platesFile = contentFile(outputArg, "content_plan_plates.tsv");
        var cardsFile = contentFile(outputArg, "content_plan_cards.tsv");
        if (!sessionsFile.exists || !platesFile.exists || !cardsFile.exists) {
            throw new Error("Подготовка не создала все TSV.\n\nВывод Python:\n" + output);
        }
        statusText.text = status.message || ("TSV готовы: " + outputFolder.fsName);
        if (silent !== true) {
            alert(
                "Готово.\n\n" +
                "Сессии: " + status.sessions + "\n" +
                "Уникальные люди: " + status.unique_people + "\n" +
            "Дубликатов объединено: " + status.duplicates_merged + "\n" +
            "Найдено в справочнике ФИО: " + (status.people_ref_matches || 0) + "\n" +
            "Плашки: " + status.plates + "\n" +
                "Визитки: " + status.cards + "\n" +
                "Визитки без фото: " + status.cards_missing_photo + "\n" +
                "Появлений людей: " + status.people_total + "\n\n" +
                "Найдены дни: " + (status.days || []).join(", ") + "\n" +
                ((status.warnings && status.warnings.length) ? "\nПредупреждения:\n- " + status.warnings.join("\n- ") + "\n" : "") +
                "Папка:\n" + status.output
            );
        }
    }

    function tempCheckFolder() {
        var folder = new Folder(Folder.temp.absoluteURI + "/ae_content_plan_check_" + (new Date().getTime()));
        ensureFolderTree(folder);
        return folder;
    }

    function summarizeStatus(status) {
        if (!status) return "Нет отчета.";
        return [
            "Сессии: " + status.sessions,
            "Уникальные люди: " + status.unique_people,
            "Плашки: " + status.plates,
            "Визитки: " + status.cards,
            "Дубликатов объединено: " + status.duplicates_merged,
            "Найдено в справочнике ФИО: " + (status.people_ref_matches || 0),
            "Визитки без фото: " + status.cards_missing_photo
        ].join("\n");
    }

    function runCheckOnly(source, day, statusText) {
        var checkFolder = tempCheckFolder();
        var oldText = statusText.text;
        try {
            statusText.text = "Проверяю изменения...";
            runPrepare(source, checkFolder.absoluteURI || checkFolder.fsName, day, statusText, true);
            statusText.text = oldText;
            return readImportReport(checkFolder.absoluteURI || checkFolder.fsName);
        } catch (err) {
            statusText.text = oldText;
            throw err;
        }
    }

    function checkChanges(source, outputDir, day, statusText) {
        var outputArg = normalizeFolderArg(outputDir);
        var currentReport = readImportReport(outputArg);
        if (!currentReport || !currentReport.data_hash) {
            if (confirm("Текущий import_report.json не найден или создан старой версией без data_hash.\n\nПодготовить TSV заново?")) {
                runPrepare(source, outputArg, day, statusText);
            }
            return;
        }

        var latestReport = runCheckOnly(source, day, statusText);
        if (!latestReport || !latestReport.data_hash) {
            throw new Error("Проверка не вернула data_hash. Обнови extract_content_plan.py и повтори.");
        }

        if (latestReport.data_hash === currentReport.data_hash) {
            statusText.text = "Изменений нет";
            alert("Изменений в таблице не найдено.\n\n" + summarizeStatus(latestReport), SCRIPT_NAME);
            return;
        }

        var message =
            "В таблице появились изменения.\n\n" +
            "Текущие данные:\n" + summarizeStatus(currentReport) + "\n\n" +
            "Новые данные:\n" + summarizeStatus(latestReport) + "\n\n" +
            "Обновить TSV сейчас?";

        if (confirm(message)) {
            runPrepare(source, outputArg, day, statusText);
        } else {
            statusText.text = "Есть изменения, TSV не обновлены";
        }
    }

    function openSessionTopics(outputDir) {
        var file = assertPrepared(outputDir, "content_plan_sessions.tsv");
        if (!SESSION_SCRIPT.exists) throw new Error("Не найден скрипт:\n" + SESSION_SCRIPT.fsName);
        $.global.__sheet2compSessionTopicsPreset = {
            sourceMode: "file",
            filePath: fileArg(file),
            delimiterIndex: 1,
            programMode: false,
            saveExtractedTsv: false,
            mainCompName: "Главная",
            titleLayerName: "ТЕМА",
            descLayerName: "ОПИСАНИЕ",
            titleColumnName: "ТЕМА",
            descColumnName: "ОПИСАНИЕ"
        };
        $.evalFile(SESSION_SCRIPT);
    }

    function savePersonPreset(outputDir, graphicType) {
        var fileName = graphicType === "Визитка" ? "content_plan_cards.tsv" : "content_plan_plates.tsv";
        var file = assertPrepared(outputDir, fileName);
        var current = readJsonFile(PERSON_SETTINGS_FILE) || {};
        current.sheetUrl = fileArg(file);
        current.sheetGid = "0";
        current.dataMode = "Таблица";
        current.nameField = "ФИО спикера";
        current.positionField = "Должность";
        current.photoField = "Фото на плашку";
        current.shiftField = "ДЕНЬ";
        current.shiftFilter = "";
        current.graphicType = graphicType;
        current.compPrefix = graphicType;
        current.autoImportPhotos = false;
        current.requirePhotoPrecomp = graphicType === "Визитка";
        current.photoLayer = graphicType === "Визитка" ? "PHOTO" : (current.photoLayer || "Rectangle 3");
        current.photoLayerIndex = graphicType === "Визитка" ? "" : (current.photoLayerIndex || "6");
        writeJsonFile(PERSON_SETTINGS_FILE, current);
    }

    function openPersonPlates(outputDir, graphicType) {
        if (!PERSON_SCRIPT.exists) throw new Error("Не найден скрипт:\n" + PERSON_SCRIPT.fsName);
        if (graphicType === "Визитка") {
            var report = readImportReport(outputDir);
            if (report && report.cards === 0) {
                throw new Error("Визитки пустые.\n\nВ строгих площадках B/C/D не найдено событий, требующих визитки, или нет фото-данных. Проверь import_report.json и при необходимости заполни фото/создай черновики вручную.");
            }
        }
        savePersonPreset(outputDir, graphicType);
        $.evalFile(PERSON_SCRIPT);
    }

    function addLabeledEdit(parent, label, value, chars) {
        var group = parent.add("group");
        group.orientation = "row";
        group.alignChildren = ["left", "center"];
        group.add("statictext", undefined, label).preferredSize.width = 120;
        var input = group.add("edittext", undefined, value);
        input.characters = chars || 48;
        return input;
    }

    function addFolderEdit(parent, label, value) {
        var group = parent.add("group");
        group.orientation = "row";
        group.alignChildren = ["left", "center"];
        group.add("statictext", undefined, label).preferredSize.width = 120;
        var input = group.add("edittext", undefined, value);
        input.characters = 38;
        var button = group.add("button", undefined, "Выбрать");
        button.onClick = function () {
            var folder = Folder.selectDialog("Выберите папку результата", new Folder(input.text));
            if (folder) input.text = normalizeFolderArg(folder.fsName);
        };
        return input;
    }

    function defaultSettings() {
        return {
            source: DEFAULT_URL,
            outputDir: DEFAULT_OUTPUT_DIR.absoluteURI || DEFAULT_OUTPUT_DIR.fsName,
            day: "",
            lastStatus: ""
        };
    }

    function loadSettings() {
        var defaults = defaultSettings();
        var saved = readJsonFile(SETTINGS_FILE) || {};
        for (var key in defaults) {
            if (!saved.hasOwnProperty(key) || trimText(saved[key]) === "") saved[key] = defaults[key];
        }
        if (hasBrokenPath(saved.outputDir)) saved.outputDir = defaults.outputDir;
        return saved;
    }

    function saveSettings(settings) {
        writeJsonFile(SETTINGS_FILE, settings);
    }

    function buildUI() {
        var settings = loadSettings();
        var win = new Window("palette", "Контент-план: подготовка и импорт", undefined, { resizeable: true });
        win.orientation = "column";
        win.alignChildren = ["fill", "top"];
        win.margins = 12;

        var sourcePanel = win.add("panel", undefined, "Источник");
        sourcePanel.orientation = "column";
        sourcePanel.alignChildren = ["fill", "top"];
        sourcePanel.margins = 10;

        var sourceInput = addLabeledEdit(sourcePanel, "Google Sheet / TSV", settings.source, 58);
        var outputInput = addFolderEdit(sourcePanel, "Папка TSV", settings.outputDir, 58);
        var dayInput = addLabeledEdit(sourcePanel, "День / дата", settings.day, 20);
        dayInput.helpTip = "Например: ДЕНЬ 3 или 22.07. Если пусто, выгрузятся все дни.";

        var prepareGroup = win.add("group");
        prepareGroup.orientation = "row";
        var prepareButton = prepareGroup.add("button", undefined, "Подготовить TSV");
        var checkChangesButton = prepareGroup.add("button", undefined, "Проверить изменения");
        var statusText = prepareGroup.add("statictext", undefined, settings.lastStatus || "TSV еще не готовились");
        statusText.characters = 48;

        var openPanel = win.add("panel", undefined, "Открыть генератор");
        openPanel.orientation = "row";
        openPanel.alignChildren = ["left", "center"];
        openPanel.margins = 10;
        var topicsButton = openPanel.add("button", undefined, "Темы сессий");
        var platesButton = openPanel.add("button", undefined, "Плашки");
        var cardsButton = openPanel.add("button", undefined, "Визитки");

        function collectSettings(status) {
            return {
                source: sourceInput.text,
                outputDir: outputInput.text,
                day: dayInput.text,
                lastStatus: status || statusText.text
            };
        }

        prepareButton.onClick = function () {
            try {
                saveSettings(collectSettings("Готовлю TSV..."));
                runPrepare(sourceInput.text, outputInput.text, dayInput.text, statusText);
                saveSettings(collectSettings(statusText.text));
            } catch (err) {
                statusText.text = "Ошибка подготовки";
                saveSettings(collectSettings(statusText.text));
                alert(SCRIPT_NAME + "\n\n" + (err.message || err.toString()));
            }
        };

        checkChangesButton.onClick = function () {
            try {
                saveSettings(collectSettings("Проверяю изменения..."));
                checkChanges(sourceInput.text, outputInput.text, dayInput.text, statusText);
                saveSettings(collectSettings(statusText.text));
            } catch (err) {
                statusText.text = "Ошибка проверки изменений";
                saveSettings(collectSettings(statusText.text));
                alert(SCRIPT_NAME + "\n\n" + (err.message || err.toString()));
            }
        };

        topicsButton.onClick = function () {
            try {
                saveSettings(collectSettings());
                openSessionTopics(outputInput.text);
            } catch (err) {
                alert(SCRIPT_NAME + "\n\n" + (err.message || err.toString()));
            }
        };

        platesButton.onClick = function () {
            try {
                saveSettings(collectSettings());
                openPersonPlates(outputInput.text, "Плашка");
            } catch (err) {
                alert(SCRIPT_NAME + "\n\n" + (err.message || err.toString()));
            }
        };

        cardsButton.onClick = function () {
            try {
                saveSettings(collectSettings());
                openPersonPlates(outputInput.text, "Визитка");
            } catch (err) {
                alert(SCRIPT_NAME + "\n\n" + (err.message || err.toString()));
            }
        };

        win.layout.layout(true);
        win.layout.resize();
        win.onResizing = win.onResize = function () { this.layout.resize(); };
        return win;
    }

    var ui = buildUI();
    ui.center();
    ui.show();
})(this);
