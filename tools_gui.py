# -*- coding: utf-8 -*-
import os
import subprocess
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_DATA_DIR = Path.home() / "Documents" / "ae_plaque_data"
DEFAULT_SHEET_URL = "https://docs.google.com/spreadsheets/d/1J6nJHM4wXF66LJO7dDNT6QgrxlQ5VPb-3B-4o7Ff0js/edit?gid=0#gid=0"


class TextField:
    def __init__(self, parent, row, label, default="", width=58, browse=None):
        ttk.Label(parent, text=label).grid(row=row, column=0, sticky="w", padx=(0, 8), pady=4)
        self.var = tk.StringVar(value=default)
        entry = ttk.Entry(parent, textvariable=self.var, width=width)
        entry.grid(row=row, column=1, sticky="ew", pady=4)
        self.entry = entry
        if browse:
            ttk.Button(parent, text="Выбрать", command=lambda: self.browse(browse)).grid(row=row, column=2, padx=(8, 0), pady=4)

    def browse(self, mode):
        current = self.var.get().strip()
        if mode == "file":
            value = filedialog.askopenfilename(initialdir=str(Path(current or ".").expanduser().parent))
        elif mode == "save":
            value = filedialog.asksaveasfilename(initialfile=Path(current).name if current else "")
        else:
            value = filedialog.askdirectory(initialdir=current or str(Path.home()))
        if value:
            self.var.set(value)

    def get(self):
        return self.var.get().strip()


class ToolsGui(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Sheet2Comp Tools")
        self.geometry("980x720")
        self.minsize(860, 620)
        self.process = None

        self.columnconfigure(0, weight=1)
        self.rowconfigure(0, weight=1)
        self.rowconfigure(1, weight=0)

        self.tabs = ttk.Notebook(self)
        self.tabs.grid(row=0, column=0, sticky="nsew", padx=12, pady=(12, 8))

        self.build_photo_tab()
        self.build_topics_tab()
        self.build_yandex_tab()
        self.build_service_tab()
        self.build_log()

    def panel(self, title):
        frame = ttk.Frame(self.tabs, padding=12)
        frame.columnconfigure(1, weight=1)
        self.tabs.add(frame, text=title)
        return frame

    def build_photo_tab(self):
        frame = self.panel("Фото плашек")
        self.photo_dir = TextField(frame, 0, "Папка фото", str(DEFAULT_DATA_DIR / "person_plate_photos"), browse="dir")
        self.photo_json = TextField(frame, 1, "JSON для AE", str(DEFAULT_DATA_DIR / "person_plates_data.json"), browse="save")
        ttk.Button(frame, text="Скачать и переименовать фото", command=self.run_photo_prepare).grid(row=2, column=1, sticky="w", pady=(12, 4))

    def build_topics_tab(self):
        frame = self.panel("Темы сессий")
        self.topics_source = TextField(frame, 0, "Источник", "", browse="file")
        self.topics_output = TextField(frame, 1, "TSV результат", str(DEFAULT_DATA_DIR / "session_topics_extracted.tsv"), browse="save")
        self.topics_column = TextField(frame, 2, "Колонка поиска", "")
        ttk.Label(frame, text="Разделитель").grid(row=3, column=0, sticky="w", padx=(0, 8), pady=4)
        self.topics_delimiter = tk.StringVar(value="auto")
        ttk.Combobox(
            frame,
            textvariable=self.topics_delimiter,
            values=("auto", "tab", "comma", "semicolon"),
            state="readonly",
            width=18,
        ).grid(row=3, column=1, sticky="w", pady=4)
        ttk.Button(frame, text="Извлечь темы", command=self.run_topics_extract).grid(row=4, column=1, sticky="w", pady=(12, 4))

    def build_yandex_tab(self):
        frame = self.panel("Яндекс.Диск")
        self.yandex_names = TextField(frame, 0, "Файл с именами", "", browse="file")
        self.yandex_output = TextField(frame, 1, "TSV результат", str(DEFAULT_DATA_DIR / "yandex_disk_links.tsv"), browse="save")
        self.yandex_column = TextField(frame, 2, "Колонка имени", "")
        self.yandex_root = TextField(frame, 3, "Папка на Диске", "disk:/")
        self.yandex_token = TextField(frame, 4, "OAuth токен", os.environ.get("YANDEX_DISK_TOKEN", ""))
        self.yandex_publish = tk.BooleanVar(value=True)
        self.yandex_recursive = tk.BooleanVar(value=True)
        ttk.Checkbutton(frame, text="Опубликовать найденные файлы", variable=self.yandex_publish).grid(row=5, column=1, sticky="w", pady=4)
        ttk.Checkbutton(frame, text="Искать в подпапках", variable=self.yandex_recursive).grid(row=6, column=1, sticky="w", pady=4)
        ttk.Button(frame, text="Найти ссылки", command=self.run_yandex_links).grid(row=7, column=1, sticky="w", pady=(12, 4))

    def build_service_tab(self):
        frame = self.panel("Служебные")
        self.download_source = TextField(frame, 0, "CSV/Google Sheet URL", "")
        self.download_json = TextField(frame, 1, "JSON", str(DEFAULT_DATA_DIR / "data.json"), browse="save")
        ttk.Button(frame, text="Скачать CSV в JSON", command=self.run_download_data).grid(row=2, column=1, sticky="w", pady=(12, 18))

        ttk.Separator(frame).grid(row=3, column=0, columnspan=3, sticky="ew", pady=8)
        self.person_source = TextField(frame, 4, "Справочник URL", DEFAULT_SHEET_URL)
        self.person_json = TextField(frame, 5, "JSON", str(DEFAULT_DATA_DIR / "person_plates_data.json"), browse="save")
        self.person_photos = TextField(frame, 6, "Папка фото", str(DEFAULT_DATA_DIR / "person_plate_photos"), browse="dir")
        self.person_photo_field = TextField(frame, 7, "Колонка фото", "Фото на плашку")
        self.person_name_field = TextField(frame, 8, "Колонка имени", "ФИО спикера")
        ttk.Button(frame, text="Скачать справочник и фото", command=self.run_person_download).grid(row=9, column=1, sticky="w", pady=(12, 4))

    def build_log(self):
        log_frame = ttk.Frame(self, padding=(12, 0, 12, 12))
        log_frame.grid(row=1, column=0, sticky="nsew")
        log_frame.columnconfigure(0, weight=1)
        log_frame.rowconfigure(1, weight=1)

        actions = ttk.Frame(log_frame)
        actions.grid(row=0, column=0, sticky="ew", pady=(0, 6))
        ttk.Button(actions, text="Очистить лог", command=self.clear_log).pack(side="left")

        self.log = tk.Text(log_frame, height=12, wrap="word")
        self.log.grid(row=1, column=0, sticky="nsew")
        scrollbar = ttk.Scrollbar(log_frame, command=self.log.yview)
        scrollbar.grid(row=1, column=1, sticky="ns")
        self.log.configure(yscrollcommand=scrollbar.set)

    def script(self, name):
        path = SCRIPT_DIR / name
        if not path.exists():
            messagebox.showerror("Нет файла", "Не найден скрипт:\n{}".format(path))
            return None
        return str(path)

    def append_log(self, text):
        self.log.insert("end", text)
        self.log.see("end")

    def clear_log(self):
        self.log.delete("1.0", "end")

    def validate_required(self, values):
        missing = [label for label, value in values if not value]
        if missing:
            messagebox.showwarning("Не хватает данных", "Заполни: {}".format(", ".join(missing)))
            return False
        return True

    def run_command(self, title, command, env=None):
        if self.process and self.process.poll() is None:
            messagebox.showwarning("Уже выполняется", "Дождись завершения текущей задачи.")
            return

        self.append_log("\n=== {} ===\n{}\n\n".format(title, " ".join(quote_for_log(part) for part in command)))

        def worker():
            merged_env = os.environ.copy()
            if env:
                merged_env.update(env)
            try:
                self.process = subprocess.Popen(
                    command,
                    cwd=str(SCRIPT_DIR),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    env=merged_env,
                )
                for line in self.process.stdout:
                    self.after(0, self.append_log, line)
                code = self.process.wait()
                self.after(0, self.append_log, "\nГотово, код: {}\n".format(code))
                if code != 0:
                    self.after(0, messagebox.showerror, "Ошибка", "Задача завершилась с кодом {}. Подробности в логе.".format(code))
            except Exception as exc:
                self.after(0, self.append_log, "ERROR: {}\n".format(exc))
                self.after(0, messagebox.showerror, "Ошибка запуска", str(exc))

        threading.Thread(target=worker, daemon=True).start()

    def run_photo_prepare(self):
        script = self.script("prepare_person_plate_photos.py")
        if not script:
            return
        if not self.validate_required((("Папка фото", self.photo_dir.get()), ("JSON для AE", self.photo_json.get()))):
            return
        self.run_command("Фото плашек", [
            sys.executable,
            script,
            "--photos-dir", self.photo_dir.get(),
            "--json-path", self.photo_json.get(),
        ])

    def run_topics_extract(self):
        script = self.script("extract_session_topics.py")
        if not script:
            return
        if not self.validate_required((("Источник", self.topics_source.get()), ("TSV результат", self.topics_output.get()))):
            return
        command = [
            sys.executable,
            script,
            self.topics_source.get(),
            "-o", self.topics_output.get(),
            "--delimiter", self.topics_delimiter.get(),
        ]
        if self.topics_column.get():
            command.extend(["--source-column", self.topics_column.get()])
        self.run_command("Темы сессий", command)

    def run_yandex_links(self):
        script = self.script("yandex_disk_links_from_names.py")
        if not script:
            return
        if not self.validate_required((("Файл с именами", self.yandex_names.get()), ("TSV результат", self.yandex_output.get()), ("Папка на Диске", self.yandex_root.get()))):
            return
        command = [
            sys.executable,
            script,
            self.yandex_names.get(),
            "-o", self.yandex_output.get(),
            "--root", self.yandex_root.get(),
        ]
        env = {}
        if self.yandex_token.get():
            env["YANDEX_DISK_TOKEN"] = self.yandex_token.get()
        if self.yandex_column.get():
            command.extend(["--column", self.yandex_column.get()])
        if self.yandex_publish.get():
            command.append("--publish")
        if not self.yandex_recursive.get():
            command.append("--no-recursive")
        self.run_command("Яндекс.Диск", command, env=env)

    def run_download_data(self):
        script = self.script("download_data.py")
        if not script:
            return
        if not self.validate_required((("CSV/Google Sheet URL", self.download_source.get()), ("JSON", self.download_json.get()))):
            return
        self.run_command("Скачать CSV в JSON", [
            sys.executable,
            script,
            self.download_source.get(),
            self.download_json.get(),
        ])

    def run_person_download(self):
        script = self.script("download_person_plate_data.py")
        if not script:
            return
        required = (
            ("Справочник URL", self.person_source.get()),
            ("JSON", self.person_json.get()),
            ("Папка фото", self.person_photos.get()),
            ("Колонка фото", self.person_photo_field.get()),
            ("Колонка имени", self.person_name_field.get()),
        )
        if not self.validate_required(required):
            return
        self.run_command("Скачать справочник и фото", [
            sys.executable,
            script,
            self.person_source.get(),
            self.person_json.get(),
            self.person_photos.get(),
            self.person_photo_field.get(),
            self.person_name_field.get(),
        ])


def quote_for_log(value):
    text = str(value)
    if not text or re_needs_quote(text):
        return '"{}"'.format(text.replace('"', '\\"'))
    return text


def re_needs_quote(text):
    return any(char.isspace() for char in text)


def main():
    app = ToolsGui()
    app.mainloop()


if __name__ == "__main__":
    main()
