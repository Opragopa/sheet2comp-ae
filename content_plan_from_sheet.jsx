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
    var RECORDING_SCRIPT = new File(SCRIPT_FOLDER.fsName + "/recording_plates_from_sheet.jsx");
    var PERSON_SETTINGS_FILE = new File(Folder.myDocuments.fsName + "/ae_person_plate_settings.json");
    var SETTINGS_FILE = new File(Folder.myDocuments.fsName + "/ae_content_plan_settings.json");
    var DEFAULT_URL = "";
    var DEFAULT_OUTPUT_DIR = new Folder(Folder.myDocuments.fsName + "/ae_plaque_data/content_plan");
    var PLATES_ROOT_PATH = "!_COMPS/!!!_ПЛАШКИ НА РЕНДЕР";
    var TOPICS_ROOT_PATH = "!_COMPS/02_ЗАСТАВКА С ТЕМОЙ СЕССИИ";
    var PLATES_MASTER_COMP = "MASTER-COMP";
    var PLATES_OUTPUT_MODULE_TEMPLATE = "High Quality with Alpha";
    var TOPICS_OUTPUT_MODULE_TEMPLATE = "DVX 3 no audio";
    var DEFAULT_PLATES_OUTPUT_TEMPLATE = "/Volumes/Macintosh HD/Users/opragopa/Yandex.Disk.localized/Заставки ТС 2026/Трансляция/Динамика/04_ПЛАШКИ/[shift]/[dayTitle]/[compName].[fileExtension]";
    var DEFAULT_TOPICS_OUTPUT_TEMPLATE = "/Volumes/Macintosh HD/Users/opragopa/Yandex.Disk.localized/Оперативная графика ТС 2026/ГРАФИКА/ТЕМЫ СЕССИЙ/[shift]/День [dayNumber]/[compName].[fileExtension]";
    var DEFAULT_PLATES_OUTPUT_TO_PRESET = "";
    var DEFAULT_TOPICS_OUTPUT_TO_PRESET = "";

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
        if (trimText(source) === "") throw new Error("Вставь ссылку на AE-ready Google Sheet или выбери папку с готовыми вкладками.");
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

    function sessionTemplateName(shiftName) {
        return trimText(shiftName || "ЕДИНСТВО") + "_Заставка с темами_альт";
    }

    function shiftFolderPath(rootPath, shiftName) {
        return rootPath + "/" + trimText(shiftName || "ЕДИНСТВО");
    }

    function runSessionTopicsAuto(outputDir, shiftName, outputToTemplate, outputToPreset, planOnly) {
        var file = assertPrepared(outputDir, "content_plan_sessions.tsv");
        if (!SESSION_SCRIPT.exists) throw new Error("Не найден скрипт:\n" + SESSION_SCRIPT.fsName);
        $.global.__sheet2compSessionTopicsPreset = {
            autoRun: true,
            autoConfirm: planOnly === true ? false : true,
            planOnly: planOnly === true,
            sourceMode: "file",
            filePath: fileArg(file),
            delimiterIndex: 1,
            programMode: false,
            saveExtractedTsv: false,
            mainCompName: sessionTemplateName(shiftName),
            mainCompFolderPath: shiftFolderPath(TOPICS_ROOT_PATH, shiftName),
            titleLayerName: "ТЕМА",
            descLayerName: "ОПИСАНИЕ",
            titleColumnName: "ТЕМА",
            descColumnName: "ОПИСАНИЕ",
            addToRenderQueue: true,
            addExistingToRenderQueue: true,
            outputModuleTemplate: TOPICS_OUTPUT_MODULE_TEMPLATE,
            outputToPreset: outputToPreset,
            outputToTemplate: outputToTemplate,
            routeByShiftDay: true,
            topicsRootPath: TOPICS_ROOT_PATH,
            shiftName: shiftName
        };
        $.evalFile(SESSION_SCRIPT);
        return $.global.__sheet2compSessionTopicsLastResult || null;
    }

    function savePersonPreset(outputDir, graphicType, autoMode, outputToTemplate, outputToPreset) {
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
        current.shiftName = "";
        current.dayField = "ДЕНЬ";
        current.graphicType = graphicType;
        current.compPrefix = graphicType;
        current.templateCompName = autoMode === true ? PLATES_MASTER_COMP : current.templateCompName;
        current.templateFolderPath = autoMode === true ? PLATES_ROOT_PATH : current.templateFolderPath;
        current.routeByShiftDay = autoMode === true;
        current.platesRootPath = PLATES_ROOT_PATH;
        current.outputModuleTemplate = autoMode === true ? PLATES_OUTPUT_MODULE_TEMPLATE : current.outputModuleTemplate;
        current.outputToPreset = autoMode === true ? outputToPreset : current.outputToPreset;
        current.outputToTemplate = autoMode === true ? outputToTemplate : current.outputToTemplate;
        current.autoImportPhotos = false;
        current.requirePhotoPrecomp = graphicType === "Визитка";
        current.photoLayer = graphicType === "Визитка" ? "PHOTO" : (current.photoLayer || "Rectangle 3");
        current.photoLayerIndex = graphicType === "Визитка" ? "" : (current.photoLayerIndex || "6");
        current.addToRenderQueue = autoMode === true ? true : current.addToRenderQueue;
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
        savePersonPreset(outputDir, graphicType, false, "", "");
        $.evalFile(PERSON_SCRIPT);
    }

    function runPersonPlatesAuto(outputDir, shiftName, outputToTemplate, outputToPreset, previewOnly) {
        if (!PERSON_SCRIPT.exists) throw new Error("Не найден скрипт:\n" + PERSON_SCRIPT.fsName);
        savePersonPreset(outputDir, "Плашка", true, outputToTemplate, outputToPreset);
        $.global.__sheet2compPersonPlatesPreset = {
            autoRun: true,
            silent: true,
            sheetUrl: fileArg(assertPrepared(outputDir, "content_plan_plates.tsv")),
            sheetGid: "0",
            dataMode: "Таблица",
            nameField: "ФИО спикера",
            positionField: "Должность",
            photoField: "Фото на плашку",
            shiftField: "ДЕНЬ",
            shiftFilter: "",
            shiftName: shiftName,
            dayField: "ДЕНЬ",
            graphicType: "Плашка",
            compPrefix: "Плашка",
            templateCompName: PLATES_MASTER_COMP,
            templateFolderPath: PLATES_ROOT_PATH,
            routeByShiftDay: true,
            platesRootPath: PLATES_ROOT_PATH,
            outputModuleTemplate: PLATES_OUTPUT_MODULE_TEMPLATE,
            outputToPreset: outputToPreset,
            outputToTemplate: outputToTemplate,
            queueLabelIndex: 9,
            autoImportPhotos: false,
            requirePhotoPrecomp: false,
            addToRenderQueue: true,
            autoConfirm: previewOnly === true ? false : true,
            previewOnly: previewOnly === true
        };
        $.evalFile(PERSON_SCRIPT);
        return $.global.__sheet2compPersonPlatesLastResult || null;
    }

    function planSummaryText(topicResult, plateResult) {
        var parts = [];
        parts.push("План импорта\n");
        parts.push("Темы:");
        parts.push("создать " + (topicResult ? (topicResult.plannedCreates || 0) : 0) + ", обновить " + (topicResult ? (topicResult.plannedUpdates || 0) : 0) + ", без изменений " + (topicResult ? topicResult.skipped.length : 0) + ", конфликты " + (topicResult ? topicResult.conflicts.length : 0));
        parts.push("");
        parts.push("Плашки:");
        parts.push("создать " + (plateResult ? plateResult.created : 0) + ", оставить " + (plateResult ? plateResult.skippedExisting : 0) + ", пересоздать " + (plateResult ? plateResult.recreated : 0) + ", конфликты " + (plateResult ? plateResult.conflicts : 0));
        if (topicResult && topicResult.preview && topicResult.preview.length) {
            parts.push("");
            parts.push("Первые действия по темам:");
            parts.push(topicResult.preview.join("\n\n"));
        }
        if (plateResult && plateResult.preview && plateResult.preview.length) {
            parts.push("");
            parts.push("Первые действия по плашкам:");
            parts.push(plateResult.preview.join("\n\n"));
        }
        return parts.join("\n");
    }

    function startRenderQueueIfNeeded(enabled) {
        if (enabled !== true) return false;
        if (!app.project || !app.project.renderQueue || app.project.renderQueue.numItems < 1) {
            throw new Error("Render Queue пустой.");
        }
        app.project.renderQueue.render();
        return true;
    }

    function cleanProjectName(value) {
        var text = trimText(value);
        text = text.replace(/[\\\/:\*\?"<>\|#%\{\}\[\]]/g, "-");
        text = text.replace(/\s+/g, " ");
        return trimText(text);
    }

    function dayNumber(value) {
        var match = trimText(value).match(/(?:день\s*)?0*(\d+)/i);
        if (!match) return "";
        var num = parseInt(match[1], 10);
        return isNaN(num) ? "" : String(num);
    }

    function dayNumber2(value) {
        var number = dayNumber(value);
        if (number === "") return "";
        var num = parseInt(number, 10);
        return num < 10 ? "0" + num : String(num);
    }

    function formatDayFolderName(value) {
        var number = dayNumber2(value);
        return number !== "" ? "день " + number : cleanProjectName(value);
    }

    function outputDayTitle(value) {
        var number = dayNumber2(value);
        return number !== "" ? "День " + number : cleanProjectName(value);
    }

    function extensionFromName(name) {
        var text = String(name || "");
        try {
            text = File.decode(text);
        } catch (e) {}
        var match = text.match(/(\.[^\.\/\\]+)$/);
        return match ? match[1] : "";
    }

    function outputExtension(outputModule, templateName) {
        var ext = outputModule && outputModule.file ? extensionFromName(outputModule.file.name) : "";
        if (ext.indexOf("[") !== -1 || ext.indexOf("]") !== -1 || ext.indexOf("?") !== -1) ext = "";
        if (ext === "" && trimText(templateName).toLowerCase().indexOf("dvx") !== -1) return ".mov";
        return ext || ".mov";
    }

    function replaceAllText(text, token, value) {
        return String(text || "").split(token).join(String(value || ""));
    }

    function renderTemplatePath(templateText, comp, context, extension) {
        var ext = extension || ".mov";
        var extNoDot = ext.charAt(0) === "." ? ext.substring(1) : ext;
        var path = String(templateText || "");
        path = replaceAllText(path, "[compName]", trimText(comp && comp.name ? comp.name : "render"));
        path = replaceAllText(path, "[fileExtension]", extNoDot);
        path = replaceAllText(path, "[shift]", cleanProjectName(context.shift));
        path = replaceAllText(path, "[day]", formatDayFolderName(context.day));
        path = replaceAllText(path, "[dayTitle]", outputDayTitle(context.day));
        path = replaceAllText(path, "[dayNumber]", dayNumber(context.day));
        path = replaceAllText(path, "[dayNumber2]", dayNumber2(context.day));
        return path;
    }

    function ensureDiskFolderTree(folder) {
        if (!folder || folder.exists) return;
        var parent = folder.parent;
        if (parent && !parent.exists) ensureDiskFolderTree(parent);
        folder.create();
    }

    function encodedPathSegment(value) {
        var text = String(value || "");
        if (typeof File !== "undefined" && typeof File.encode === "function") return File.encode(text);
        return encodeURIComponent(text);
    }

    function pathToAbsoluteUri(pathText) {
        var text = String(pathText || "").replace(/\\/g, "/");
        if (/^file:\/\//i.test(text)) return text;
        var prefix = "";
        if (text.indexOf("/") === 0) {
            prefix = "file://";
            text = text.substring(1);
        }
        var parts = text.split("/");
        for (var i = 0; i < parts.length; i++) {
            parts[i] = encodedPathSegment(parts[i]);
        }
        return prefix + "/" + parts.join("/");
    }

    function fileFromUnicodePath(fullPath) {
        var uri = pathToAbsoluteUri(fullPath);
        var splitIndex = uri.lastIndexOf("/");
        if (splitIndex < 0) return new File(uri);
        var folderUri = uri.substring(0, splitIndex);
        var fileNameUri = uri.substring(splitIndex + 1);
        var folder = new Folder(folderUri);
        ensureDiskFolderTree(folder);
        return new File(folderUri + "/" + fileNameUri);
    }

    function applyOutputModuleTemplate(outputModule, templateName) {
        var name = trimText(templateName);
        if (name === "") return;
        try {
            outputModule.applyTemplate(name);
        } catch (templateError) {
            throw new Error("Не найден или не применился Output Module шаблон \"" + name + "\".");
        }
    }

    function applyOutputToPreset(outputModule, presetName) {
        var name = trimText(presetName);
        if (name === "") return false;
        try {
            outputModule.applyTemplate(name);
            return true;
        } catch (presetError) {
            throw new Error("Не найден или не применился Output To preset \"" + name + "\".");
        }
    }

    function applyPendingOutputTo() {
        var pending = $.global.__sheet2compPendingOutputTo || [];
        var changed = 0;
        for (var i = 0; i < pending.length; i++) {
            var entry = pending[i];
            var item = entry.item;
            if (!item) continue;
            for (var j = 1; j <= item.numOutputModules; j++) {
                var outputModule = item.outputModule(j);
                applyOutputModuleTemplate(outputModule, entry.outputModuleTemplate);
            }
            changed++;
        }
        $.global.__sheet2compPendingOutputTo = [];
        $.global.__sheet2compDeferOutputTo = false;
        return changed;
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
            shiftName: "ЕДИНСТВО",
            platesOutputToTemplate: DEFAULT_PLATES_OUTPUT_TEMPLATE,
            topicsOutputToTemplate: DEFAULT_TOPICS_OUTPUT_TEMPLATE,
            platesOutputToPreset: DEFAULT_PLATES_OUTPUT_TO_PRESET,
            topicsOutputToPreset: DEFAULT_TOPICS_OUTPUT_TO_PRESET,
            autoStartRender: false,
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
        if (hasBrokenPath(saved.platesOutputToTemplate)) saved.platesOutputToTemplate = defaults.platesOutputToTemplate;
        if (hasBrokenPath(saved.topicsOutputToTemplate)) saved.topicsOutputToTemplate = defaults.topicsOutputToTemplate;
        return saved;
    }

    function saveSettings(settings) {
        writeJsonFile(SETTINGS_FILE, settings);
    }

    function buildUI(thisObj) {
        var settings = loadSettings();
        var win = thisObj instanceof Panel
            ? thisObj
            : new Window("palette", "Контент-план: подготовка и импорт", undefined, { resizeable: true });
        win.orientation = "column";
        win.alignChildren = ["fill", "top"];
        win.margins = 12;

        var intro = win.add("statictext", undefined, "Порядок работы: подготовь TSV, посмотри план импорта, затем запускай обновление.");
        intro.characters = 82;

        var sourcePanel = win.add("panel", undefined, "Источник");
        sourcePanel.orientation = "column";
        sourcePanel.alignChildren = ["fill", "top"];
        sourcePanel.margins = 10;

        var sourceInput = addLabeledEdit(sourcePanel, "AE-ready Sheet / папка", settings.source, 58);
        sourceInput.helpTip = "Сюда нужна ссылка на нормализованную AE-ready таблицу из бота или папка с файлами content_plan_*.tsv.";
        var outputInput = addFolderEdit(sourcePanel, "Папка TSV", settings.outputDir, 58);
        var dayInput = addLabeledEdit(sourcePanel, "День / дата", settings.day, 20);
        dayInput.helpTip = "Например: ДЕНЬ 3 или 22.07. Если пусто, выгрузятся все дни.";
        var shiftInput = addLabeledEdit(sourcePanel, "Смена", settings.shiftName, 20);
        shiftInput.helpTip = "Например: ЕДИНСТВО, РОДИНА или ПРАВДА. Используется для папок и шаблона темы.";
        var platesOutputInput = addLabeledEdit(sourcePanel, "Output To плашек", settings.platesOutputToTemplate, 58);
        platesOutputInput.helpTip = "Сейчас не применяется автоматически. Output To выставляется вручную в Render Queue.";
        var platesOutputPresetInput = addLabeledEdit(sourcePanel, "Preset плашек", settings.platesOutputToPreset, 32);
        platesOutputPresetInput.helpTip = "Сейчас не применяется автоматически. Output To preset выбирается вручную в Render Queue.";
        var topicsOutputInput = addLabeledEdit(sourcePanel, "Output To тем", settings.topicsOutputToTemplate, 58);
        topicsOutputInput.helpTip = "Сейчас не применяется автоматически. Output To выставляется вручную в Render Queue.";
        var topicsOutputPresetInput = addLabeledEdit(sourcePanel, "Preset тем", settings.topicsOutputToPreset, 32);
        topicsOutputPresetInput.helpTip = "Сейчас не применяется автоматически. Output To preset выбирается вручную в Render Queue.";
        var renderCheck = sourcePanel.add("checkbox", undefined, "Сразу запустить Render Queue после обновления");
        renderCheck.value = settings.autoStartRender === true;

        var prepareGroup = win.add("group");
        prepareGroup.orientation = "row";
        var saveButton = prepareGroup.add("button", undefined, "Запомнить");
        var prepareButton = prepareGroup.add("button", undefined, "Подготовить TSV");
        var checkChangesButton = prepareGroup.add("button", undefined, "Проверить TSV");
        var importPlanButton = prepareGroup.add("button", undefined, "План импорта");
        var statusText = prepareGroup.add("statictext", undefined, settings.lastStatus || "TSV еще не готовились");
        statusText.characters = 48;

        var openPanel = win.add("panel", undefined, "Открыть генератор");
        openPanel.orientation = "row";
        openPanel.alignChildren = ["left", "center"];
        openPanel.margins = 10;
        var autoButton = openPanel.add("button", undefined, "Обновить информацию");
        var topicsButton = openPanel.add("button", undefined, "Темы сессий");
        var platesButton = openPanel.add("button", undefined, "Плашки");
        var cardsButton = openPanel.add("button", undefined, "Визитки");
        var recordingButton = openPanel.add("button", undefined, "Запись");

        function collectSettings(status) {
            return {
                source: sourceInput.text,
                outputDir: outputInput.text,
                day: dayInput.text,
                shiftName: shiftInput.text,
                platesOutputToTemplate: platesOutputInput.text,
                topicsOutputToTemplate: topicsOutputInput.text,
                platesOutputToPreset: platesOutputPresetInput.text,
                topicsOutputToPreset: topicsOutputPresetInput.text,
                autoStartRender: renderCheck.value,
                lastStatus: status || statusText.text
            };
        }

        saveButton.onClick = function () {
            try {
                saveSettings(collectSettings("Настройки сохранены"));
                statusText.text = "Настройки сохранены";
                alert("Настройки сохранены.", SCRIPT_NAME);
            } catch (err) {
                alert(SCRIPT_NAME + "\n\n" + (err.message || err.toString()));
            }
        };

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

        autoButton.onClick = function () {
            try {
                var collected = collectSettings("Обновляю информацию...");
                saveSettings(collected);
                statusText.text = "Готовлю TSV...";
                runPrepare(sourceInput.text, outputInput.text, dayInput.text, statusText, true);
                statusText.text = "Собираю план...";
                var topicPlan = runSessionTopicsAuto(outputInput.text, shiftInput.text, topicsOutputInput.text, topicsOutputPresetInput.text, true);
                var platePlan = runPersonPlatesAuto(outputInput.text, shiftInput.text, platesOutputInput.text, platesOutputPresetInput.text, true);
                if (!confirm(planSummaryText(topicPlan, platePlan) + "\n\nПрименить эти изменения?")) {
                    statusText.text = "Импорт отменен";
                    saveSettings(collectSettings(statusText.text));
                    return;
                }
                $.global.__sheet2compPendingOutputTo = [];
                $.global.__sheet2compDeferOutputTo = true;
                statusText.text = "Создаю темы...";
                var topicResult = runSessionTopicsAuto(outputInput.text, shiftInput.text, topicsOutputInput.text, topicsOutputPresetInput.text, false);
                statusText.text = "Создаю плашки...";
                var plateResult = runPersonPlatesAuto(outputInput.text, shiftInput.text, platesOutputInput.text, platesOutputPresetInput.text, false);
                statusText.text = "Настраиваю Output Module...";
                var outputModuleChanged = applyPendingOutputTo();
                var renderStarted = startRenderQueueIfNeeded(renderCheck.value);
                statusText.text = renderStarted ? "Рендер запущен" : "Готово, очередь подготовлена";
                saveSettings(collectSettings(statusText.text));

                alert(
                    "Обновление готово.\n\n" +
                    "Темы: создано " + (topicResult ? topicResult.created.length : 0) +
                    ", обновлено " + (topicResult ? topicResult.updated.length : 0) +
                    ", без изменений " + (topicResult ? topicResult.skipped.length : 0) +
                    ", в очередь " + (topicResult ? topicResult.created.length + (topicResult.queued ? topicResult.queued.length : 0) : 0) +
                    ", дублей удалено " + (topicResult ? (topicResult.duplicatesRemoved || 0) : 0) + "\n" +
                    "Плашки: создано " + (plateResult ? plateResult.created : 0) +
                    ", уже были " + (plateResult ? plateResult.skippedExisting : 0) +
                    ", пропущено " + (plateResult ? plateResult.skipped : 0) +
                    ", дублей удалено " + (plateResult ? (plateResult.duplicatesRemoved || 0) : 0) + "\n" +
                    "Output Module применен: " + outputModuleChanged + "\n" +
                    "Render Queue: " + (renderStarted ? "запущен" : "подготовлен") + "\n\n" +
                    "Смена: " + shiftInput.text
                );
            } catch (err) {
                $.global.__sheet2compDeferOutputTo = false;
                statusText.text = "Ошибка автообновления";
                saveSettings(collectSettings(statusText.text));
                alert(SCRIPT_NAME + "\n\n" + (err.message || err.toString()));
            }
        };

        importPlanButton.onClick = function () {
            try {
                saveSettings(collectSettings("Собираю план импорта..."));
                runPrepare(sourceInput.text, outputInput.text, dayInput.text, statusText, true);
                var topicPlan = runSessionTopicsAuto(outputInput.text, shiftInput.text, topicsOutputInput.text, topicsOutputPresetInput.text, true);
                var platePlan = runPersonPlatesAuto(outputInput.text, shiftInput.text, platesOutputInput.text, platesOutputPresetInput.text, true);
                statusText.text = "План импорта готов";
                saveSettings(collectSettings(statusText.text));
                alert(planSummaryText(topicPlan, platePlan), SCRIPT_NAME);
            } catch (err) {
                statusText.text = "Ошибка плана импорта";
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

        recordingButton.onClick = function () {
            try {
                saveSettings(collectSettings());
                if (!RECORDING_SCRIPT.exists) throw new Error("Не найден скрипт:\n" + RECORDING_SCRIPT.fsName);
                $.evalFile(RECORDING_SCRIPT);
            } catch (err) {
                alert(SCRIPT_NAME + "\n\n" + (err.message || err.toString()));
            }
        };

        win.layout.layout(true);
        win.layout.resize();
        win.onResizing = win.onResize = function () { this.layout.resize(); };
        return win;
    }

    var ui = buildUI(thisObj);
    if (ui instanceof Window) {
        ui.center();
        ui.show();
    }
})(this);
