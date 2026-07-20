/*  Shorten Render Queue Names
    After Effects ExtendScript (.jsx)

    Adds selected compositions to Render Queue and names outputs like:
    Плашка_Имя Фамилия_Должность

    output file:
    Плашка_Имя Фамилия

    Export folder:
    <project folder>/EXPORT

    The composition itself is not duplicated or renamed, so expressions that read
    thisComp.name.split("_")[2] keep working.
*/

(function shortenRenderQueueNames() {
    var SCRIPT_NAME = "Add Selected Comps to Render Queue";
    var DEFAULT_DELIMITER = "_";
    var DEFAULT_EXTENSION = ".mov";

    function trimText(value) {
        return String(value || "").replace(/^\s+|\s+$/g, "");
    }

    function sanitizeFileBaseName(value) {
        var text = trimText(value);
        text = text.replace(/[\\\/:\*\?"<>\|]/g, "-");
        text = text.replace(/\s+/g, " ");
        text = text.replace(/^\.+|\.+$/g, "");
        return trimText(text) || "render";
    }

    function shortenCompositionName(compName, delimiter) {
        var text = trimText(compName);
        var delim = delimiter || DEFAULT_DELIMITER;
        var parts = text.split(delim);

        if (parts.length < 3) {
            return sanitizeFileBaseName(text);
        }

        return sanitizeFileBaseName(parts[0] + delim + parts[1]);
    }

    function extensionFromName(name) {
        var text = String(name || "");
        try {
            text = File.decode(text);
        } catch (e) {
            // Keep the original name if this AE build cannot decode it.
        }

        var match = text.match(/(\.[^\.\/\\]+)$/);
        return match ? match[1] : "";
    }

    function fileExtension(fileObj) {
        return fileObj ? extensionFromName(fileObj.name) : "";
    }

    function buildOutputFile(folder, filename) {
        var placeholder = "render_output" + extensionFromName(filename);
        var file;

        if (folder.absoluteURI) {
            file = new File(folder.absoluteURI + "/" + placeholder);
        } else {
            file = new File(folder.fsName + "/" + placeholder);
        }

        if (file.changePath && file.changePath(filename)) {
            return file;
        }

        if (folder.absoluteURI && typeof File.encode === "function") {
            return new File(folder.absoluteURI + "/" + File.encode(filename));
        }

        return new File(folder.fsName + "/" + filename);
    }

    function looksCorruptedByEncoding(value) {
        var text = String(value || "");
        return /\?{3,}/.test(text);
    }

    function selectedComps() {
        var result = [];
        var selection = app.project.selection || [];

        for (var i = 0; i < selection.length; i++) {
            if (selection[i] instanceof CompItem) {
                result.push(selection[i]);
            }
        }

        return result;
    }

    function projectExportFolder() {
        var projectFile = app.project.file;
        if (!projectFile || !projectFile.parent) {
            throw new Error("Сначала сохраните проект After Effects, чтобы я понял, где создать папку EXPORT.");
        }

        var folder;
        if (projectFile.parent.absoluteURI) {
            folder = new Folder(projectFile.parent.absoluteURI + "/EXPORT");
        } else {
            folder = new Folder(projectFile.parent.fsName + "/EXPORT");
        }

        if (!folder.exists && !folder.create()) {
            throw new Error("Не получилось создать папку EXPORT рядом с проектом:\n" + folder.fsName);
        }

        return folder;
    }

    function outputExtension(outputModule) {
        var ext = fileExtension(outputModule.file);
        return ext || DEFAULT_EXTENSION;
    }

    if (!app.project) {
        alert("Открой проект After Effects и выдели композиции в Project.", SCRIPT_NAME);
        return;
    }

    var comps = selectedComps();
    if (comps.length === 0) {
        alert("Выдели одну или несколько композиций в Project. Скрипт добавит их в Render Queue без дублирования.", SCRIPT_NAME);
        return;
    }

    var delimiter = prompt("Разделитель в имени композиции:", DEFAULT_DELIMITER, SCRIPT_NAME);
    if (delimiter === null) return;
    delimiter = delimiter || DEFAULT_DELIMITER;

    app.beginUndoGroup(SCRIPT_NAME);

    try {
        var exportFolder = projectExportFolder();
        var added = 0;
        var report = [];

        for (var i = 0; i < comps.length; i++) {
            var comp = comps[i];

            if (looksCorruptedByEncoding(comp.name)) {
                throw new Error("Имя композиции уже выглядит поврежденным:\n" + comp.name + "\n\nПереименуйте композицию в Project русскими буквами и запустите скрипт заново.");
            }

            var item = app.project.renderQueue.items.add(comp);
            var shortBaseName = shortenCompositionName(comp.name, delimiter);

            for (var j = 1; j <= item.numOutputModules; j++) {
                var outputModule = item.outputModule(j);
                var ext = outputExtension(outputModule);
                var nextFile = buildOutputFile(exportFolder, shortBaseName + ext);
                outputModule.file = nextFile;

                if (report.length < 10) {
                    report.push(comp.name + " -> " + shortBaseName + ext);
                }
            }

            added++;
        }

        alert(
            "Готово.\n\n" +
            "Добавлено в Render Queue: " + added + "\n" +
            "Папка экспорта:\n" + exportFolder.fsName +
            (report.length ? "\n\nПримеры:\n" + report.join("\n") : ""),
            SCRIPT_NAME
        );
    } catch (e) {
        alert("Ошибка:\n" + e.toString() + (e.line ? "\nСтрока: " + e.line : ""), SCRIPT_NAME);
    } finally {
        app.endUndoGroup();
    }
})();
