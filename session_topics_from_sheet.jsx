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

        for (var i = 0; i < header.length; i++) {
            var name = trimString(stripBom(header[i]));
            if (name === titleColumnName) titleIndex = i;
            if (name === descColumnName) descIndex = i;
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
            if (title !== "" || desc !== "") {
                records.push({ title: title, description: desc });
            }
        }

        return records;
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

    function downloadUrl(url) {
        var tempFile = new File(Folder.temp.fsName + "/ae_session_topics_" + new Date().getTime() + ".txt");
        var cmd;

        if ($.os.toLowerCase().indexOf("windows") >= 0) {
            cmd = "powershell -NoProfile -ExecutionPolicy Bypass -Command " +
                "\"[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; " +
                "Invoke-WebRequest -UseBasicParsing -Uri " + shellQuote(url) +
                " -OutFile " + shellQuote(tempFile.fsName) + "\"";
        } else {
            cmd = "curl -L -s " + shellQuote(url) + " -o " + shellQuote(tempFile.fsName);
        }

        system.callSystem(cmd);
        var text = readLocalFile(tempFile);
        try { tempFile.remove(); } catch (e) {}
        return text;
    }

    function makeComps(settings) {
        if (!app.project) {
            throw new Error("Открой проект After Effects.");
        }

        var mainComp = findCompByName(settings.mainCompName);
        if (!mainComp) {
            throw new Error("Не найдена главная композиция \"" + settings.mainCompName + "\".");
        }

        var text = settings.sourceMode === "url" ? downloadUrl(settings.url) : readLocalFile(settings.file);
        var delimiter = settings.delimiter === "auto" ? guessDelimiter(text) : settings.delimiter;
        var rows = parseDelimited(text, delimiter);
        var records = rowsToRecords(rows, settings.titleColumnName, settings.descColumnName);

        if (records.length === 0) {
            throw new Error("Во входных данных нет строк с темами.");
        }

        var created = [];
        app.beginUndoGroup(SCRIPT_NAME);
        try {
            for (var i = 0; i < records.length; i++) {
                var record = records[i];
                var comp = mainComp.duplicate();
                comp.name = settings.namePrefix + padNumber(i + 1, 2) + " - " + sanitizeName(record.title);

                setTextLayer(comp, settings.titleLayerName, record.title);
                setTextLayer(comp, settings.descLayerName, record.description);

                if (settings.addToRenderQueue) {
                    app.project.renderQueue.items.add(comp);
                }
                created.push(comp.name);
            }
        } catch (err) {
            app.endUndoGroup();
            throw err;
        }
        app.endUndoGroup();
        return created;
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
        }

        fileMode.onClick = refreshMode;
        urlMode.onClick = refreshMode;

        browseButton.onClick = function () {
            var file = File.openDialog("Выбери TSV/CSV/TXT с темами", "*.tsv;*.csv;*.txt");
            if (file) fileText.text = file.fsName;
        };

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
                    addToRenderQueue: renderQueueCheck.value
                };

                if (settings.sourceMode === "file" && trimString(fileText.text) === "") {
                    throw new Error("Выбери файл TSV/CSV/TXT.");
                }
                if (settings.sourceMode === "url" && trimString(settings.url) === "") {
                    throw new Error("Вставь URL Google Sheet CSV/TSV.");
                }

                var created = makeComps(settings);
                alert("Готово: создано композиций " + created.length + ".");
            } catch (err) {
                alertError(err.message || err.toString());
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
