/*  Recording Plates from Sheet
    After Effects ExtendScript (.jsx)

    Готовит TSV для записи из диапазона U1:AM25 и открывает генератор плашек.
*/

(function recordingPlatesFromSheet(thisObj) {
    var SCRIPT_NAME = "Recording Plates from Sheet";
    var SCRIPT_FOLDER = File($.fileName).parent;
    var CONFIG_FILE = new File(SCRIPT_FOLDER.fsName + "/ae_parser_config.json");
    var PYTHON_SCRIPT = new File(SCRIPT_FOLDER.fsName + "/extract_recording_plan.py");
    var PERSON_SCRIPT = new File(SCRIPT_FOLDER.fsName + "/person_plates_from_sheet.jsx");
    var PERSON_SETTINGS_FILE = new File(Folder.myDocuments.fsName + "/ae_person_plate_settings.json");
    var SETTINGS_FILE = new File(Folder.myDocuments.fsName + "/ae_recording_plates_settings.json");
    var DEFAULT_SOURCE = "https://docs.google.com/spreadsheets/d/1J6nJHM4wXF66LJO7dDNT6QgrxlQ5VPb-3B-4o7Ff0js/edit?gid=1944136331#gid=1944136331";
    var DEFAULT_REF = "https://docs.google.com/spreadsheets/d/10C3eoaG146WgOeQeoli90dQCHPruoJ_d4_rqcyoUR8M/edit?gid=213088400#gid=213088400";
    var DEFAULT_OUTPUT_DIR = new Folder(Folder.myDocuments.fsName + "/ae_plaque_data/recording");

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
        return { pythonCmd: config.pythonCmd || (isWindows() ? "python" : "/usr/bin/python3") };
    }

    function ensureFolder(folder) {
        if (!folder.exists && !folder.create()) {
            throw new Error("Не удалось создать папку:\n" + folder.fsName);
        }
    }

    function ensureFolderTree(folder) {
        if (folder.exists) return;
        var parent = folder.parent;
        if (parent && !parent.exists) ensureFolderTree(parent);
        ensureFolder(folder);
    }

    function fileArg(file) {
        return file.absoluteURI || file.fsName;
    }

    function normalizeFolderArg(value) {
        var text = trimText(value);
        if (text === "") return "";
        var folder = new Folder(text);
        return folder.absoluteURI || folder.fsName;
    }

    function statusFileForRun() {
        return new File(Folder.temp.absoluteURI + "/ae_recording_plates_status_" + (new Date().getTime()) + ".json");
    }

    function presetFileForRun(settings) {
        var file = new File(Folder.temp.absoluteURI + "/ae_recording_plates_preset_" + (new Date().getTime()) + ".json");
        writeJsonFile(file, {
            refNameColumn: settings.refNameColumn,
            refPositionColumn: settings.refPositionColumn,
            refPhotoColumn: settings.refPhotoColumn
        });
        return file;
    }

    function buildCommand(settings, statusFile, presetFile) {
        if (!PYTHON_SCRIPT.exists) throw new Error("Не найден Python-скрипт:\n" + PYTHON_SCRIPT.fsName);
        var runtime = loadRuntime();
        var parts = [
            quoteExecutable(runtime.pythonCmd),
            quoteShellArg(PYTHON_SCRIPT.fsName),
            quoteShellArg(settings.source),
            "-o",
            quoteShellArg(settings.outputDir),
            "--people-ref-url",
            quoteShellArg(settings.refUrl),
            "--settings-json",
            quoteShellArg(fileArg(presetFile)),
            "--status-json",
            quoteShellArg(fileArg(statusFile))
        ];
        var inner = parts.join(" ") + " 2>&1";
        if (isWindows()) return "cmd /c " + inner;
        return "/bin/sh -lc " + quoteShellArg(inner);
    }

    function contentFile(outputDir, fileName) {
        var folderPath = normalizeFolderArg(outputDir);
        return new File(new Folder(folderPath).fsName + "/" + fileName);
    }

    function runPrepare(settings, statusText) {
        var outputArg = normalizeFolderArg(settings.outputDir);
        if (trimText(settings.source) === "") throw new Error("Вставь ссылку на таблицу записи.");
        if (trimText(settings.refUrl) === "") throw new Error("Вставь ссылку на дополнительный справочник ФИО/Должность.");
        if (outputArg === "") throw new Error("Выбери папку TSV.");

        var outputFolder = new Folder(outputArg);
        ensureFolderTree(outputFolder);
        settings.outputDir = outputArg;

        var statusFile = statusFileForRun();
        var presetFile = presetFileForRun(settings);
        try { if (statusFile.exists) statusFile.remove(); } catch (removeErr) {}
        var oldTsv = contentFile(outputArg, "recording_plates.tsv");
        try { if (oldTsv.exists) oldTsv.remove(); } catch (removeOld) {}

        statusText.text = "Готовлю запись...";
        var output = system.callSystem(buildCommand(settings, statusFile, presetFile));
        $.sleep(300);

        var status = readJsonFile(statusFile);
        if (!status) throw new Error("Python не создал UTF-8 отчет.\n\n" + output);
        if (status.ok === false) throw new Error(status.error);

        var tsv = contentFile(outputArg, "recording_plates.tsv");
        if (!tsv.exists) throw new Error("TSV записи не создан.\n\n" + output);
        statusText.text = "Запись готова: " + status.records + " плашек";
        alert(
            "Готово.\n\n" +
            "Плашки записи: " + status.records + "\n" +
            "Найдено в справочнике: " + status.ref_matches + "\n" +
            "Справочников проверено: " + (status.ref_sources_ok || 0) + " из " + (status.ref_sources_total || 0) + "\n" +
            "Игнорировано: " + status.ignored + "\n" +
            "Видео-колонок: " + status.video_columns + "\n\n" +
            "TSV:\n" + status.tsv,
            SCRIPT_NAME
        );
        return tsv;
    }

    function savePersonPreset(settings) {
        var tsv = contentFile(settings.outputDir, "recording_plates.tsv");
        if (!tsv.exists) throw new Error("Сначала нажми \"Подготовить TSV\".");

        var current = readJsonFile(PERSON_SETTINGS_FILE) || {};
        current.sheetUrl = fileArg(tsv);
        current.sheetGid = "0";
        current.dataMode = "Таблица";
        current.nameField = "ФИО спикера";
        current.positionField = "Должность";
        current.photoField = "Фото на плашку";
        current.shiftField = "";
        current.shiftFilter = "";
        current.graphicType = "Плашка";
        current.compPrefix = "Запись";
        current.delimiter = "_";
        current.targetFolderName = "Запись";
        current.autoImportPhotos = false;
        current.requirePhotoPrecomp = false;
        current.recreateExistingComps = false;
        writeJsonFile(PERSON_SETTINGS_FILE, current);
    }

    function defaultSettings() {
        return {
            source: DEFAULT_SOURCE,
            refUrl: DEFAULT_REF,
            refNameColumn: "ФИО",
            refPositionColumn: "Должность",
            refPhotoColumn: "Фото на плашку,Ссылка на плашку,Фото,ФОТО",
            outputDir: DEFAULT_OUTPUT_DIR.absoluteURI || DEFAULT_OUTPUT_DIR.fsName,
            lastStatus: ""
        };
    }

    function loadSettings() {
        var defaults = defaultSettings();
        var saved = readJsonFile(SETTINGS_FILE) || {};
        for (var key in defaults) {
            if (!saved.hasOwnProperty(key) || trimText(saved[key]) === "") saved[key] = defaults[key];
        }
        return saved;
    }

    function saveSettings(settings) {
        writeJsonFile(SETTINGS_FILE, settings);
    }

    function addLabeledEdit(parent, label, value, chars) {
        var group = parent.add("group");
        group.orientation = "row";
        group.alignChildren = ["left", "center"];
        group.add("statictext", undefined, label).preferredSize.width = 125;
        var input = group.add("edittext", undefined, value);
        input.characters = chars || 55;
        return input;
    }

    function addFolderEdit(parent, label, value) {
        var group = parent.add("group");
        group.orientation = "row";
        group.alignChildren = ["left", "center"];
        group.add("statictext", undefined, label).preferredSize.width = 125;
        var input = group.add("edittext", undefined, value);
        input.characters = 42;
        var button = group.add("button", undefined, "Выбрать");
        button.onClick = function() {
            var folder = Folder.selectDialog("Выберите папку TSV записи", new Folder(input.text));
            if (folder) input.text = folder.absoluteURI || folder.fsName;
        };
        return input;
    }

    function buildUI() {
        var settings = loadSettings();
        var win = new Window("palette", "Запись: плашки из таблицы", undefined, { resizeable: true });
        win.orientation = "column";
        win.alignChildren = ["fill", "top"];
        win.margins = 12;

        var panel = win.add("panel", undefined, "Источник");
        panel.orientation = "column";
        panel.alignChildren = ["fill", "top"];
        panel.margins = 10;
        var sourceInput = addLabeledEdit(panel, "Таблица записи", settings.source, 64);
        var refInput = addLabeledEdit(panel, "Доп. ФИО/Должность", settings.refUrl, 64);
        var refNameInput = addLabeledEdit(panel, "Колонка ФИО", settings.refNameColumn || "ФИО", 28);
        var refPositionInput = addLabeledEdit(panel, "Колонка должности", settings.refPositionColumn || "Должность", 28);
        var refPhotoInput = addLabeledEdit(panel, "Колонка фото", settings.refPhotoColumn || "Фото на плашку,Ссылка на плашку,Фото,ФОТО", 42);
        var outputInput = addFolderEdit(panel, "Папка TSV", settings.outputDir);

        var buttons = win.add("group");
        buttons.orientation = "row";
        var saveButton = buttons.add("button", undefined, "Сохранить");
        var prepareButton = buttons.add("button", undefined, "Подготовить TSV");
        var openButton = buttons.add("button", undefined, "Открыть плашки");
        var statusText = buttons.add("statictext", undefined, settings.lastStatus || "TSV еще не готовился");
        statusText.characters = 38;

        function collect(status) {
            return {
                source: sourceInput.text,
                refUrl: refInput.text,
                refNameColumn: refNameInput.text,
                refPositionColumn: refPositionInput.text,
                refPhotoColumn: refPhotoInput.text,
                outputDir: outputInput.text,
                lastStatus: status || statusText.text
            };
        }

        saveButton.onClick = function() {
            saveSettings(collect(statusText.text));
            alert("Настройки сохранены.", SCRIPT_NAME);
        };

        prepareButton.onClick = function() {
            try {
                var current = collect("Готовлю запись...");
                saveSettings(current);
                runPrepare(current, statusText);
                outputInput.text = current.outputDir;
                saveSettings(collect(statusText.text));
            } catch (err) {
                statusText.text = "Ошибка";
                saveSettings(collect(statusText.text));
                alert(SCRIPT_NAME + "\n\n" + (err.message || err.toString()));
            }
        };

        openButton.onClick = function() {
            try {
                var current = collect();
                saveSettings(current);
                savePersonPreset(current);
                if (!PERSON_SCRIPT.exists) throw new Error("Не найден скрипт:\n" + PERSON_SCRIPT.fsName);
                $.evalFile(PERSON_SCRIPT);
            } catch (err) {
                alert(SCRIPT_NAME + "\n\n" + (err.message || err.toString()));
            }
        };

        win.layout.layout(true);
        win.layout.resize();
        win.onResizing = win.onResize = function() { this.layout.resize(); };
        return win;
    }

    var ui = buildUI();
    ui.center();
    ui.show();
})(this);
