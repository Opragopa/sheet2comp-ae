/*  Session Topics from Sheet / Text
    After Effects ExtendScript (.jsx)

    Делает много композиций из одной главной композиции:
    - берет строки из TSV/CSV/TXT или опубликованной Google Sheet CSV/TSV-ссылки;
    - дублирует главную композицию;
    - находит текстовые слои "ТЕМА" и "ОПИСАНИЕ";
    - меняет Source Text этих слоев;
    - опционально добавляет новые композиции в Render Queue.

    Формат по умолчанию:
    ТЕМА    ОПИСАНИЕ
    Первая тема    Первое описание
    Вторая тема    Второе описание
*/

(function sessionTopicsFromSheet(thisObj) {
    var SCRIPT_NAME = "Session Topics from Sheet";
    var DEFAULT_MAIN_COMP = "Главная";
    var DEFAULT_TITLE_LAYER = "ТЕМА";
    var DEFAULT_DESC_LAYER = "ОПИСАНИЕ";
    var DEFAULT_TSV_FOLDER = "ae_plaque_data";
    var DEFAULT_TSV_FILE = "session_topics_extracted.tsv";
    var DEFAULT_COMP_NAME_COLUMN = "ИМЯ_КОМПОЗИЦИИ";
    var PROGRAM_FIRST_COLUMN_INDEX = 1; // B
    var PROGRAM_LAST_COLUMN_INDEX = 3; // D

    function trimString(value) {
        return String(value).replace(/^\s+|\s+$/g, "");
    }

    function stripBom(value) {
        return String(value).replace(/^\uFEFF/, "");
    }

    function sanitizeName(value) {
        var name = trimString(value || "Без темы");
        name = name.replace(/[\\\/:\*\?"<>\|#%\{\}\[\]]/g, "-");
        name = name.replace(/\s+/g, " ");
        if (name.length > 80) {
            name = name.substring(0, 80);
        }
        return name;
    }

    function sanitizeCompName(value, allowSlash) {
        var name = trimString(value || "Без темы");
        var pattern = allowSlash ? /[\\:\*\?"<>\|#%\{\}\[\]]/g : /[\\\/:\*\?"<>\|#%\{\}\[\]]/g;
        name = name.replace(pattern, "-");
        name = name.replace(/\s+/g, " ");
        if (name.length > 120) {
            name = name.substring(0, 120);
        }
        return name;
    }

    function outputCompNameForRecord(settings, record, number) {
        if (trimString(record.compName) !== "") {
            return sanitizeCompName(record.compName, true);
        }
        return settings.namePrefix + padNumber(number, 2) + " - " + sanitizeName(record.title);
    }

    function padNumber(num, width) {
        var text = String(num);
        while (text.length < width) {
            text = "0" + text;
        }
        return text;
    }

    function alertError(message) {
        alert(SCRIPT_NAME + "\n\n" + message);
    }

    function normalizeText(value) {
        return trimString(String(value || "").replace(/\r\n|\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\n+/g, "\n"));
    }

    function normalizeKey(value) {
        return normalizeText(value).replace(/\s+/g, " ").toLowerCase();
    }

    function titleCaseUpperWords(value) {
        return String(value || "").replace(/[A-ZА-ЯЁ]{2,}/g, function (token) {
            if (token.toUpperCase() === token && token.toLowerCase() !== token) {
                return token.charAt(0).toUpperCase() + token.substring(1).toLowerCase();
            }
            return token;
        });
    }

    function cleanVenueHeader(value) {
        var text = normalizeText(value).replace(/\s+/g, " ");
        text = text.replace(/\(\s*(?:до\s*)?\d+\s*(?:мест[а]?|чел(?:овек)?\.?)\s*\)/ig, " ");
        text = text.replace(/\b(?:до\s*)?\d+\s*(?:мест[а]?|чел(?:овек)?\.?)\b/ig, " ");
        text = text.replace(/\s+/g, " ").replace(/^[\s\-—]+|[\s\-—]+$/g, "");
        return titleCaseUpperWords(text);
    }

    function sessionCompName(venueName, title) {
        var cleanTitle = cleanTopic(title);
        if (cleanTitle === "") return "";
        var cleanVenue = cleanVenueHeader(venueName);
        return cleanVenue !== "" ? cleanVenue + "/" + cleanTitle : cleanTitle;
    }

    function recordKey(record) {
        return normalizeKey(record.sourceKey || record.compName || record.title);
    }

    var SESSION_META_MARKER = "SHEET2COMP_SESSION_META";

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

    function buildSessionMeta(record, compName) {
        return {
            kind: "session-topic",
            version: "1",
            key: recordKey(record),
            expectedCompName: compName,
            title: record.title,
            description: record.description,
            signature: normalizeKey(record.title) + "|" + normalizeKey(record.description),
            updatedAt: (new Date()).toISOString ? (new Date()).toISOString() : String(new Date())
        };
    }

    function readSessionMeta(comp) {
        var comment = String(comp.comment || "");
        var pattern = new RegExp("\\[" + SESSION_META_MARKER + "\\]([\\s\\S]*?)\\[\\/" + SESSION_META_MARKER + "\\]");
        var match = comment.match(pattern);
        return match ? jsonDecodeObject(match[1]) : null;
    }

    function writeSessionMeta(comp, meta) {
        var comment = String(comp.comment || "");
        var pattern = new RegExp("\\n?\\[" + SESSION_META_MARKER + "\\][\\s\\S]*?\\[\\/" + SESSION_META_MARKER + "\\]", "g");
        comment = comment.replace(pattern, "");
        comp.comment = trimString(comment + "\n[" + SESSION_META_MARKER + "]" + jsonEncodeObject(meta) + "[/" + SESSION_META_MARKER + "]");
    }

    function isComp(item) {
        return item && item instanceof CompItem;
    }

    function findCompByName(compName) {
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (isComp(item) && item.name === compName) {
                return item;
            }
        }
        return null;
    }

    function getSourceTextProperty(layer) {
        var textProps = layer.property("ADBE Text Properties");
        if (!textProps) return null;
        return textProps.property("ADBE Text Document");
    }

    function findTextLayer(comp, layerName) {
        for (var i = 1; i <= comp.numLayers; i++) {
            var layer = comp.layer(i);
            if (layer.name === layerName && getSourceTextProperty(layer) !== null) {
                return layer;
            }
        }
        return null;
    }

    function setTextLayer(comp, layerName, value) {
        var layer = findTextLayer(comp, layerName);
        if (!layer) {
            throw new Error("В композиции \"" + comp.name + "\" не найден текстовый слой \"" + layerName + "\".");
        }

        var sourceText = getSourceTextProperty(layer);
        var currentDoc = sourceText.value;
        var nextDoc = new TextDocument(String(value || ""));

        // Сохраняем базовый стиль исходного слоя, если AE позволяет присваивать эти поля.
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

        sourceText.setValue(nextDoc);
    }

    function getTextLayerValue(comp, layerName) {
        var layer = findTextLayer(comp, layerName);
        if (!layer) return "";
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

    function parseDelimited(text, delimiter) {
        var rows = [];
        var row = [];
        var field = "";
        var inQuotes = false;

        text = stripBom(String(text || ""));

        for (var i = 0; i < text.length; i++) {
            var ch = text.charAt(i);
            var next = i + 1 < text.length ? text.charAt(i + 1) : "";

            if (ch === "\"") {
                if (inQuotes && next === "\"") {
                    field += "\"";
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (ch === delimiter && !inQuotes) {
                row.push(field);
                field = "";
            } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
                if (ch === "\r" && next === "\n") {
                    i++;
                }
                row.push(field);
                rows.push(row);
                row = [];
                field = "";
            } else {
                field += ch;
            }
        }

        row.push(field);
        rows.push(row);
        return rows;
    }

    function guessDelimiter(text) {
        var firstLine = String(text || "").split(/\r\n|\n|\r/)[0];
        var tabs = firstLine.split("\t").length;
        var commas = firstLine.split(",").length;
        var semicolons = firstLine.split(";").length;
        if (tabs >= commas && tabs >= semicolons) return "\t";
        if (semicolons > commas) return ";";
        return ",";
    }

    function rowsToRecords(rows, titleColumnName, descColumnName) {
        var records = [];
        if (!rows || rows.length === 0) return records;

        var header = rows[0];
        var titleIndex = -1;
        var descIndex = -1;
        var compNameIndex = -1;

        for (var i = 0; i < header.length; i++) {
            var name = trimString(stripBom(header[i]));
            if (name === titleColumnName) titleIndex = i;
            if (name === descColumnName) descIndex = i;
            if (name === DEFAULT_COMP_NAME_COLUMN) compNameIndex = i;
        }

        var startRow = 1;
        if (titleIndex < 0) {
            titleIndex = 0;
            startRow = 0;
        }
        if (descIndex < 0 && header.length > 1) {
            descIndex = titleIndex === 0 ? 1 : 0;
        } else if (descIndex < 0) {
            descIndex = -1;
        }

        for (var r = startRow; r < rows.length; r++) {
            var row = rows[r];
            var title = row.length > titleIndex ? trimString(row[titleIndex]) : "";
            var desc = descIndex >= 0 && row.length > descIndex ? trimString(row[descIndex]) : "";
            var compName = compNameIndex >= 0 && row.length > compNameIndex ? trimString(row[compNameIndex]) : "";
            if (title !== "" || desc !== "") {
                records.push({ title: title, description: desc, compName: compName, sourceKey: compName !== "" ? "comp:" + compName : "row:" + r });
            }
        }

        return records;
    }

    function cleanTopic(value) {
        var text = normalizeText(value);
        text = text.replace(/^[«"'“”„]+/, "");
        text = text.replace(/[»"'“”„\]]+$/, "");
        return trimString(text);
    }

    function extractEventDescription(value) {
        var text = normalizeText(value);
        text = text.split(/(?:^|\s)Тема\s*:/i)[0];
        text = text.split(/(?:^|\s)(?:Сценар|Сценарии|Сценарий|Сценарий|Справка)\S*/i)[0];
        text = text.split(/\S+\.docx/i)[0];
        text = text.replace(/\s+/g, " ");
        return trimString(text.replace(/^[\s\-—]+|[\s\-—]+$/g, ""));
    }

    function cleanFallbackTopic(value) {
        var text = normalizeText(value);
        var docxQuoteMatch = text.match(/\.docx\s+[«"]([^»"\n]{8,})[»"]/i);
        if (docxQuoteMatch) {
            return cleanTopic(docxQuoteMatch[1]);
        }

        text = text.replace(/\S+\.docx/ig, " ");
        text = text.replace(/(?:^|\s)СЦЕНАРИЙ\s+ДЛЯ\s+РПГ\s*:.*$/i, " ");
        text = trimString(text.replace(/\s+/g, " ").replace(/^[\s\-—]+|[\s\-—]+$/g, ""));

        var quoteMatch = text.match(/[«"]([^»"\n]{8,})[»"]/);
        if (quoteMatch) {
            return cleanTopic(quoteMatch[1]);
        }
        return cleanTopic(text);
    }

    function firstExpertMarkerIndex(text) {
        var match = normalizeText(text).match(/(?:^|\s)(Эксперты?)\s*:/i);
        return match ? match.index : -1;
    }

    function extractProgramRecord(value) {
        var text = normalizeText(value);
        if (text === "") return null;

        var topicMatch = /(?:^|\s)Тема\s*:\s*(.+?)(?=\s+(?:Эксперты?|Модератор|Ведущий|Гости|Спикеры?)\s*:|$)/i.exec(text);
        if (topicMatch) {
            var topic = cleanTopic(topicMatch[1]);
            var description = extractEventDescription(text.substring(0, topicMatch.index));
            if (topic !== "" && firstExpertMarkerIndex(text.substring(topicMatch.index + topicMatch[0].length)) >= 0) {
                return { title: topic, description: description };
            }
            return null;
        }

        var markerIndex = firstExpertMarkerIndex(text);
        if (markerIndex < 0) return null;

        var beforeMarker = text.substring(0, markerIndex);
        var fallbackTitle = cleanFallbackTopic(beforeMarker);
        var fallbackDescription = extractEventDescription(beforeMarker);
        if (fallbackTitle !== "") {
            return { title: fallbackTitle, description: fallbackDescription };
        }
        return null;
    }

    function rowsToProgramRecords(rows) {
        var records = [];
        var seen = {};
        var venueNames = {};
        var fallbackVenueNames = { 1: "Амфитеатр", 2: "Урал 1", 3: "Урал 2" };

        for (var h = 0; h < rows.length && h < 30; h++) {
            var headerRow = rows[h];
            var hasTimeHeader = false;
            for (var hc = 0; hc < headerRow.length; hc++) {
                if (normalizeKey(headerRow[hc]) === normalizeKey("ВРЕМЯ")) {
                    hasTimeHeader = true;
                    break;
                }
            }
            if (hasTimeHeader) {
                for (var vc = PROGRAM_FIRST_COLUMN_INDEX; vc <= PROGRAM_LAST_COLUMN_INDEX; vc++) {
                    venueNames[vc] = cleanVenueHeader(headerRow.length > vc ? headerRow[vc] : "") || fallbackVenueNames[vc];
                }
                break;
            }
        }
        for (var fc = PROGRAM_FIRST_COLUMN_INDEX; fc <= PROGRAM_LAST_COLUMN_INDEX; fc++) {
            if (!venueNames[fc]) venueNames[fc] = fallbackVenueNames[fc];
        }

        for (var r = 0; r < rows.length; r++) {
            var row = rows[r];
            var lastColumn = Math.min(PROGRAM_LAST_COLUMN_INDEX, row.length - 1);
            for (var c = PROGRAM_FIRST_COLUMN_INDEX; c <= lastColumn; c++) {
                var record = extractProgramRecord(row[c]);
                if (!record) continue;
                record.compName = sessionCompName(venueNames[c], record.title);
                record.sourceKey = "program:" + r + ":" + c;
                var key = recordKey(record);
                if (seen[key]) continue;
                seen[key] = true;
                records.push(record);
            }
        }
        return records;
    }

    function tsvEscape(value) {
        var text = String(value || "");
        if (text.indexOf("\"") >= 0) {
            text = text.replace(/"/g, "\"\"");
        }
        if (text.indexOf("\t") >= 0 || text.indexOf("\n") >= 0 || text.indexOf("\r") >= 0 || text.indexOf("\"") >= 0) {
            text = "\"" + text + "\"";
        }
        return text;
    }

    function defaultExtractedTsvFile() {
        var folder = new Folder(Folder.myDocuments.fsName + "/" + DEFAULT_TSV_FOLDER);
        if (!folder.exists && !folder.create()) {
            throw new Error("Не получилось создать папку для TSV: " + folder.fsName);
        }
        return new File(folder.fsName + "/" + DEFAULT_TSV_FILE);
    }

    function saveRecordsToTsv(records) {
        var file = defaultExtractedTsvFile();
        file.encoding = "UTF-8";
        if (!file.open("w")) {
            throw new Error("Не получилось записать TSV: " + file.fsName);
        }

        file.write(DEFAULT_TITLE_LAYER + "\t" + DEFAULT_DESC_LAYER + "\t" + DEFAULT_COMP_NAME_COLUMN + "\n");
        for (var i = 0; i < records.length; i++) {
            file.write(tsvEscape(records[i].title) + "\t" + tsvEscape(records[i].description) + "\t" + tsvEscape(records[i].compName) + "\n");
        }
        file.close();
        return file.fsName;
    }

    function readLocalFile(file) {
        if (!file || !file.exists) {
            throw new Error("Файл не найден.");
        }

        file.encoding = "UTF-8";
        if (!file.open("r")) {
            throw new Error("Не получилось открыть файл: " + file.fsName);
        }
        var text = file.read();
        file.close();
        return text;
    }

    function shellQuote(value) {
        var text = String(value);
        if ($.os.toLowerCase().indexOf("windows") >= 0) {
            return "\"" + text.replace(/"/g, "\\\"") + "\"";
        }
        return "'" + text.replace(/'/g, "'\\''") + "'";
    }

    function googleSheetExportUrl(url) {
        var text = trimString(url);
        if (text.indexOf("docs.google.com") < 0 || text.indexOf("/spreadsheets/d/") < 0) {
            return text;
        }

        var idMatch = text.match(/\/spreadsheets\/d\/([^\/\?#]+)/);
        if (!idMatch) return text;

        var gidMatch = text.match(/[?#&]gid=([0-9]+)/) || text.match(/#gid=([0-9]+)/);
        var gid = gidMatch ? gidMatch[1] : "0";
        return "https://docs.google.com/spreadsheets/d/" + idMatch[1] + "/export?format=tsv&gid=" + gid;
    }

    function downloadUrl(url) {
        var tempFile = new File(Folder.temp.fsName + "/ae_session_topics_" + new Date().getTime() + ".txt");
        var sourceUrl = googleSheetExportUrl(url);
        var cmd;

        if ($.os.toLowerCase().indexOf("windows") >= 0) {
            cmd = "powershell -NoProfile -ExecutionPolicy Bypass -Command " +
                "\"[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; " +
                "Invoke-WebRequest -UseBasicParsing -Uri " + shellQuote(sourceUrl) +
                " -OutFile " + shellQuote(tempFile.fsName) + "\"";
        } else {
            cmd = "curl -L -s " + shellQuote(sourceUrl) + " -o " + shellQuote(tempFile.fsName);
        }

        system.callSystem(cmd);
        var text = readLocalFile(tempFile);
        try { tempFile.remove(); } catch (e) {}
        return text;
    }

    function existingRecordKeyMap(settings, mainComp) {
        var keys = {};
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (!isComp(item) || item === mainComp) continue;

            keys[normalizeKey(item.name)] = true;
            var title = getTextLayerValue(item, settings.titleLayerName);
            var description = getTextLayerValue(item, settings.descLayerName);
            if (trimString(title) === "" && trimString(description) === "") continue;
            keys[recordKey({ title: title, description: description })] = true;
        }
        return keys;
    }

    function existingCompMaps(settings, mainComp) {
        var byName = {};
        var byTitle = {};
        var byMetaKey = {};
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (!isComp(item) || item === mainComp) continue;

            byName[normalizeKey(item.name)] = item;
            var meta = readSessionMeta(item);
            if (meta && meta.kind === "session-topic" && meta.key) {
                byMetaKey[meta.key] = item;
            }
            var title = getTextLayerValue(item, settings.titleLayerName);
            if (trimString(title) !== "") {
                var titleKey = normalizeKey(title);
                if (!byTitle[titleKey]) byTitle[titleKey] = item;
            }
        }
        return { byName: byName, byTitle: byTitle, byMetaKey: byMetaKey };
    }

    function countCompsWithPrefix(prefix) {
        var count = 0;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (isComp(item) && item.name.indexOf(prefix) === 0) {
                count++;
            }
        }
        return count;
    }

    function makeComps(settings) {
        var text = settings.sourceMode === "url" ? downloadUrl(settings.url) : readLocalFile(settings.file);
        var delimiter = settings.delimiter === "auto" ? guessDelimiter(text) : settings.delimiter;
        var rows = parseDelimited(text, delimiter);
        var records = settings.programMode
            ? rowsToProgramRecords(rows)
            : rowsToRecords(rows, settings.titleColumnName, settings.descColumnName);

        if (records.length === 0) {
            throw new Error("Во входных данных нет строк с темами.");
        }

        var savedTsvPath = "";
        if (settings.saveExtractedTsv && settings.programMode) {
            savedTsvPath = saveRecordsToTsv(records);
        }

        if (!app.project) {
            throw new Error("Открой проект After Effects.");
        }

        var mainComp = findCompByName(settings.mainCompName);
        if (!mainComp) {
            throw new Error("Не найдена главная композиция \"" + settings.mainCompName + "\".");
        }

        var created = [];
        var skipped = [];
        var updated = [];
        var renamed = [];
        var conflicts = [];
        var maps = existingCompMaps(settings, mainComp);
        var nextNumber = countCompsWithPrefix(settings.namePrefix) + 1;

        var planned = [];
        var preview = [];
        var plannedCreates = 0;
        var plannedUpdates = 0;
        try {
            for (var i = 0; i < records.length; i++) {
                var record = records[i];
                var titleKey = normalizeKey(record.title);
                var targetName = outputCompNameForRecord(settings, record, nextNumber);
                var targetKey = normalizeKey(targetName);
                var key = recordKey(record);
                var existingByMeta = maps.byMetaKey[key];
                var existingByName = maps.byName[targetKey];
                var existingByTitle = maps.byTitle[titleKey];
                var existing = existingByMeta || existingByName || existingByTitle;

                if (existing) {
                    var meta = readSessionMeta(existing);
                    var changes = [];
                    var currentTitle = getTextLayerValue(existing, settings.titleLayerName);
                    var currentDescription = getTextLayerValue(existing, settings.descLayerName);
                    if (normalizeKey(currentTitle) !== normalizeKey(record.title)) {
                        changes.push("ТЕМА: \"" + currentTitle + "\" -> \"" + record.title + "\"");
                    }
                    if (normalizeKey(currentDescription) !== normalizeKey(record.description)) {
                        changes.push("ОПИСАНИЕ: \"" + currentDescription + "\" -> \"" + record.description + "\"");
                    }
                    if (existing.name !== targetName && (!meta || existing.name === meta.expectedCompName || existingByTitle === existing)) {
                        if (maps.byName[targetKey] && maps.byName[targetKey] !== existing) {
                            conflicts.push(targetName);
                            continue;
                        }
                        changes.unshift("имя композиции: \"" + existing.name + "\" -> \"" + targetName + "\"");
                    }

                    if (changes.length === 0) {
                        skipped.push(record.title);
                        writeSessionMeta(existing, buildSessionMeta(record, targetName));
                    } else {
                        plannedUpdates++;
                        planned.push({ action: "update", comp: existing, record: record, targetName: targetName, changes: changes });
                        if (preview.length < 12) preview.push(existing.name + "\n  " + changes.join("\n  "));
                    }
                    continue;
                }

                plannedCreates++;
                planned.push({ action: "create", record: record, targetName: targetName, changes: ["создать композицию"] });
                if (preview.length < 12) preview.push(targetName + "\n  создать композицию");
                if (trimString(record.compName) === "") nextNumber++;
            }
        } catch (planErr) {
            throw planErr;
        }

        var confirmMessage = "План обновления тем сессий\n\n" +
            "Создать: " + plannedCreates + "\n" +
            "Обновить: " + plannedUpdates + "\n" +
            "Без изменений: " + skipped.length + "\n" +
            "Конфликты имен: " + conflicts.length + "\n" +
            "Всего найдено уникальных строк: " + records.length + "\n\n" +
            (preview.length > 0 ? "Что изменится:\n" + preview.join("\n\n") + "\n\n" : "") +
            "Применить эти изменения?";
        if (planned.length === 0) {
            return { created: created, updated: updated, skipped: skipped, renamed: renamed, conflicts: conflicts, total: records.length, savedTsvPath: savedTsvPath };
        }
        if (!confirm(confirmMessage)) {
            return { created: created, updated: updated, skipped: skipped, renamed: renamed, conflicts: conflicts, total: records.length, savedTsvPath: savedTsvPath };
        }

        app.beginUndoGroup(SCRIPT_NAME);
        try {
            for (var p = 0; p < planned.length; p++) {
                var item = planned[p];
                var comp;
                if (item.action === "create") {
                    comp = mainComp.duplicate();
                    comp.name = item.targetName;
                    setTextLayer(comp, settings.titleLayerName, item.record.title);
                    setTextLayer(comp, settings.descLayerName, item.record.description);

                    if (settings.addToRenderQueue) {
                        app.project.renderQueue.items.add(comp);
                    }
                    created.push(comp.name);
                } else {
                    comp = item.comp;
                    var oldName = comp.name;
                    if (oldName !== item.targetName) {
                        var currentMeta = readSessionMeta(comp);
                        if (!currentMeta || oldName === currentMeta.expectedCompName) {
                            comp.name = item.targetName;
                            renamed.push(oldName + " -> " + item.targetName);
                        }
                    }
                    setTextLayer(comp, settings.titleLayerName, item.record.title);
                    setTextLayer(comp, settings.descLayerName, item.record.description);
                    updated.push(comp.name);
                }
                writeSessionMeta(comp, buildSessionMeta(item.record, item.targetName));

                maps.byName[normalizeKey(comp.name)] = comp;
                maps.byTitle[normalizeKey(item.record.title)] = comp;
                maps.byMetaKey[recordKey(item.record)] = comp;
            }
        } catch (err) {
            app.endUndoGroup();
            throw err;
        }
        app.endUndoGroup();
        return { created: created, updated: updated, skipped: skipped, renamed: renamed, conflicts: conflicts, total: records.length, savedTsvPath: savedTsvPath };
    }

    function buildUI(thisObj) {
        var win = thisObj instanceof Panel
            ? thisObj
            : new Window("palette", SCRIPT_NAME, undefined, { resizeable: true });

        win.orientation = "column";
        win.alignChildren = ["fill", "top"];
        win.spacing = 8;
        win.margins = 12;

        var sourcePanel = win.add("panel", undefined, "Источник");
        sourcePanel.orientation = "column";
        sourcePanel.alignChildren = ["fill", "top"];
        sourcePanel.margins = 10;

        var modeGroup = sourcePanel.add("group");
        modeGroup.orientation = "row";
        var fileMode = modeGroup.add("radiobutton", undefined, "Файл TSV/CSV/TXT");
        var urlMode = modeGroup.add("radiobutton", undefined, "Google Sheet URL");
        fileMode.value = true;

        var fileGroup = sourcePanel.add("group");
        fileGroup.orientation = "row";
        fileGroup.alignChildren = ["fill", "center"];
        var fileText = fileGroup.add("edittext", undefined, "");
        fileText.characters = 38;
        var browseButton = fileGroup.add("button", undefined, "Выбрать");

        var urlText = sourcePanel.add("edittext", undefined, "");
        urlText.characters = 48;
        urlText.helpTip = "Ссылка должна отдавать CSV/TSV. Например Published to web CSV или export?format=csv.";
        urlText.enabled = false;

        var delimiterGroup = sourcePanel.add("group");
        delimiterGroup.orientation = "row";
        delimiterGroup.add("statictext", undefined, "Разделитель:");
        var delimiterList = delimiterGroup.add("dropdownlist", undefined, ["Авто", "Tab", "Comma", "Semicolon"]);
        delimiterList.selection = 0;

        var programModeCheck = sourcePanel.add("checkbox", undefined, "Программная таблица: ОПИСАНИЕ до сценария, ТЕМА из строки Тема:");
        programModeCheck.value = true;

        var saveExtractedTsvCheck = sourcePanel.add("checkbox", undefined, "Сохранить TSV для ручной правки в Documents/ae_plaque_data");
        saveExtractedTsvCheck.value = true;

        var compPanel = win.add("panel", undefined, "After Effects");
        compPanel.orientation = "column";
        compPanel.alignChildren = ["fill", "top"];
        compPanel.margins = 10;

        function labeledEdit(parent, label, value) {
            var group = parent.add("group");
            group.orientation = "row";
            group.alignChildren = ["left", "center"];
            group.add("statictext", undefined, label).preferredSize.width = 130;
            var input = group.add("edittext", undefined, value);
            input.characters = 30;
            return input;
        }

        var mainCompInput = labeledEdit(compPanel, "Главная композиция", DEFAULT_MAIN_COMP);
        var titleLayerInput = labeledEdit(compPanel, "Слой темы", DEFAULT_TITLE_LAYER);
        var descLayerInput = labeledEdit(compPanel, "Слой описания", DEFAULT_DESC_LAYER);
        var titleColumnInput = labeledEdit(compPanel, "Колонка темы", DEFAULT_TITLE_LAYER);
        var descColumnInput = labeledEdit(compPanel, "Колонка описания", DEFAULT_DESC_LAYER);
        var prefixInput = labeledEdit(compPanel, "Префикс композиций", "Session ");

        var renderQueueCheck = compPanel.add("checkbox", undefined, "Добавить созданные композиции в Render Queue");
        renderQueueCheck.value = false;

        var runGroup = win.add("group");
        runGroup.orientation = "row";
        runGroup.alignment = ["right", "top"];
        var runButton = runGroup.add("button", undefined, "Создать композиции");

        function refreshMode() {
            fileText.enabled = fileMode.value;
            browseButton.enabled = fileMode.value;
            urlText.enabled = urlMode.value;
            titleColumnInput.enabled = !programModeCheck.value;
            descColumnInput.enabled = !programModeCheck.value;
            saveExtractedTsvCheck.enabled = programModeCheck.value;
        }

        fileMode.onClick = refreshMode;
        urlMode.onClick = refreshMode;
        programModeCheck.onClick = refreshMode;
        saveExtractedTsvCheck.onClick = refreshMode;

        browseButton.onClick = function () {
            var file = File.openDialog("Выбери TSV/CSV/TXT с темами", "*.tsv;*.csv;*.txt");
            if (file) fileText.text = file.fsName;
        };

        function applyPreset() {
            var preset = $.global.__sheet2compSessionTopicsPreset;
            if (!preset) return;

            if (preset.sourceMode === "url") {
                urlMode.value = true;
                fileMode.value = false;
                urlText.text = preset.url || "";
            } else {
                fileMode.value = true;
                urlMode.value = false;
                fileText.text = preset.filePath || preset.file || "";
            }

            if (typeof preset.delimiterIndex === "number" && preset.delimiterIndex >= 0 && preset.delimiterIndex < delimiterList.items.length) {
                delimiterList.selection = preset.delimiterIndex;
            }
            if (typeof preset.programMode === "boolean") programModeCheck.value = preset.programMode;
            if (typeof preset.saveExtractedTsv === "boolean") saveExtractedTsvCheck.value = preset.saveExtractedTsv;
            if (preset.mainCompName) mainCompInput.text = preset.mainCompName;
            if (preset.titleLayerName) titleLayerInput.text = preset.titleLayerName;
            if (preset.descLayerName) descLayerInput.text = preset.descLayerName;
            if (preset.titleColumnName) titleColumnInput.text = preset.titleColumnName;
            if (preset.descColumnName) descColumnInput.text = preset.descColumnName;
            if (preset.namePrefix) prefixInput.text = preset.namePrefix;
            if (typeof preset.addToRenderQueue === "boolean") renderQueueCheck.value = preset.addToRenderQueue;
            $.global.__sheet2compSessionTopicsPreset = null;
        }

        runButton.onClick = function () {
            try {
                var delimiterValues = ["auto", "\t", ",", ";"];
                var settings = {
                    sourceMode: fileMode.value ? "file" : "url",
                    file: new File(fileText.text),
                    url: urlText.text,
                    delimiter: delimiterValues[delimiterList.selection.index],
                    mainCompName: mainCompInput.text,
                    titleLayerName: titleLayerInput.text,
                    descLayerName: descLayerInput.text,
                    titleColumnName: titleColumnInput.text,
                    descColumnName: descColumnInput.text,
                    namePrefix: prefixInput.text,
                    addToRenderQueue: renderQueueCheck.value,
                    programMode: programModeCheck.value,
                    saveExtractedTsv: saveExtractedTsvCheck.value
                };

                if (settings.sourceMode === "file" && trimString(fileText.text) === "") {
                    throw new Error("Выбери файл TSV/CSV/TXT.");
                }
                if (settings.sourceMode === "url" && trimString(settings.url) === "") {
                    throw new Error("Вставь URL Google Sheet CSV/TSV.");
                }

                var result = makeComps(settings);
                var message = "Готово.\nСоздано композиций: " + result.created.length +
                    "\nОбновлено изменившихся: " + result.updated.length +
                    "\nПереименовано старых: " + result.renamed.length +
                    "\nУже были, пропущены: " + result.skipped.length +
                    "\nКонфликты имен: " + result.conflicts.length +
                    "\nВсего найдено уникальных строк: " + result.total + ".";
                if (result.savedTsvPath !== "") {
                    message += "\n\nTSV для правки:\n" + result.savedTsvPath;
                }
                alert(message);
            } catch (err) {
                alertError(err.message || err.toString());
            }
        };

        applyPreset();
        refreshMode();
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
