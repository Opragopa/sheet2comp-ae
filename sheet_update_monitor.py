#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Background Google Sheets monitor with macOS notifications."""

import argparse
import csv
import datetime as _dt
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


APP_NAME = "Sheet2Comp Monitor"
DEFAULT_DATA_DIR = Path.home() / "Documents" / "ae_plaque_data"
DEFAULT_STATE_PATH = DEFAULT_DATA_DIR / "sheet_update_monitor_state.json"
DEFAULT_INTERVAL_SECONDS = 120
USER_AGENT = "sheet2comp-ae-sheet-monitor/1.0"

DEFAULT_SHEETS = (
    {
        "label": "Контент-план",
        "url": "https://docs.google.com/spreadsheets/d/10C3eoaG146WgOeQeoli90dQCHPruoJ_d4_rqcyoUR8M/edit?gid=213088400#gid=213088400",
    },
    {
        "label": "План записи",
        "url": "https://docs.google.com/spreadsheets/d/1J6nJHM4wXF66LJO7dDNT6QgrxlQ5VPb-3B-4o7Ff0js/edit?gid=1944136331#gid=1944136331",
    },
)


class MonitorError(Exception):
    pass


def now_text():
    return _dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def log(message):
    print("[{}] {}".format(now_text(), message), flush=True)


def apple_script_string(value):
    text = str(value).replace("\\", "\\\\").replace('"', '\\"')
    return '"{}"'.format(text.replace("\r", " ").replace("\n", " "))


def notify(title, message, subtitle="", enabled=True):
    if not enabled:
        return
    if sys.platform != "darwin":
        log("Уведомление: {} - {}".format(title, message))
        return
    parts = [
        "display notification {}".format(apple_script_string(message)),
        "with title {}".format(apple_script_string(title)),
    ]
    if subtitle:
        parts.append("subtitle {}".format(apple_script_string(subtitle)))
    script = " ".join(parts)
    try:
        subprocess.run(["osascript", "-e", script], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError as exc:
        log("Не удалось показать macOS-уведомление: {}".format(exc))


def google_sheet_export_url(url):
    text = str(url).strip()
    parsed = urllib.parse.urlparse(text)
    if "docs.google.com" not in parsed.netloc or "/spreadsheets/d/" not in parsed.path:
        return text
    match = re.search(r"/spreadsheets/d/([^/]+)", parsed.path)
    if not match:
        raise MonitorError("Не удалось найти ID Google Sheet в ссылке: {}".format(text))
    query = urllib.parse.parse_qs(parsed.query)
    gid = ""
    if "gid" in query and query["gid"]:
        gid = query["gid"][0]
    elif parsed.fragment:
        frag_match = re.search(r"(?:^|&)gid=([^&]+)", parsed.fragment)
        if frag_match:
            gid = frag_match.group(1)
    if not gid:
        gid = "0"
    return "https://docs.google.com/spreadsheets/d/{}/export?format=tsv&gid={}".format(match.group(1), gid)


def fetch_sheet(url, timeout):
    export_url = google_sheet_export_url(url)
    request = urllib.request.Request(export_url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = response.read()
            content_type = response.headers.get("Content-Type", "")
    except urllib.error.HTTPError as exc:
        raise MonitorError("HTTP {} при чтении таблицы".format(exc.code))
    except urllib.error.URLError as exc:
        raise MonitorError("не удалось подключиться: {}".format(exc.reason))
    except TimeoutError:
        raise MonitorError("таймаут чтения таблицы")
    if not data:
        raise MonitorError("Google вернул пустой ответ")
    prefix = data[:300].decode("utf-8", errors="replace").lstrip().lower()
    if prefix.startswith("<!doctype html") or prefix.startswith("<html"):
        raise MonitorError("Google вернул HTML вместо TSV; проверь доступ по ссылке")
    text = data.decode("utf-8-sig", errors="replace")
    return {
        "hash": hashlib.sha256(data).hexdigest(),
        "bytes": len(data),
        "rows": count_rows(text),
        "content_type": content_type,
        "export_url": export_url,
    }


def count_rows(text):
    rows = list(csv.reader(text.splitlines(), delimiter="\t"))
    return len([row for row in rows if any(str(cell).strip() for cell in row)])


def load_state(path):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
            return data if isinstance(data, dict) else {}
    except FileNotFoundError:
        return {}
    except (OSError, ValueError):
        return {}


def save_state(path, state):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with open(tmp_path, "w", encoding="utf-8") as handle:
        json.dump(state, handle, ensure_ascii=False, indent=2, sort_keys=True)
    os.replace(str(tmp_path), str(path))


def sheet_key(sheet):
    return google_sheet_export_url(sheet["url"])


def check_sheet(sheet, state, args):
    key = sheet_key(sheet)
    label = sheet["label"]
    previous = state.get(key, {})
    current = fetch_sheet(sheet["url"], args.timeout)
    current.update({
        "label": label,
        "url": sheet["url"],
        "checked_at": now_text(),
        "error": "",
    })

    old_hash = previous.get("hash")
    if old_hash and old_hash != current["hash"]:
        old_rows = previous.get("rows")
        row_text = "строк: {} -> {}".format(old_rows, current["rows"]) if old_rows is not None else "строк: {}".format(current["rows"])
        message = "{}; размер: {} байт".format(row_text, current["bytes"])
        log("Обновление: {} ({})".format(label, message))
        notify("Обновилась Google Sheet", message, subtitle=label, enabled=not args.no_notifications)
    elif not old_hash:
        log("Первый снимок: {} (строк: {}, {} байт)".format(label, current["rows"], current["bytes"]))
        if args.notify_initial:
            notify("Монитор Google Sheets запущен", "Первый снимок сохранен; строк: {}".format(current["rows"]), subtitle=label, enabled=not args.no_notifications)
    elif not args.quiet:
        log("Без изменений: {} (строк: {})".format(label, current["rows"]))

    state[key] = current


def check_all(sheets, state, args):
    changed_state = False
    for sheet in sheets:
        key = sheet_key(sheet)
        previous = state.get(key, {})
        try:
            check_sheet(sheet, state, args)
            changed_state = True
        except MonitorError as exc:
            message = str(exc)
            log("Ошибка: {} - {}".format(sheet["label"], message))
            if previous.get("error") != message:
                notify("Ошибка монитора Google Sheets", message, subtitle=sheet["label"], enabled=not args.no_notifications)
            previous.update({
                "label": sheet["label"],
                "url": sheet["url"],
                "checked_at": now_text(),
                "error": message,
            })
            state[key] = previous
            changed_state = True
    return changed_state


def parse_sheet_arg(value):
    if "=" in value:
        label, url = value.split("=", 1)
        return {"label": label.strip() or url.strip(), "url": url.strip()}
    return {"label": value.strip(), "url": value.strip()}


def build_parser():
    parser = argparse.ArgumentParser(
        description="Фоново проверяет Google Sheets и показывает macOS-уведомления при изменениях."
    )
    parser.add_argument("--interval", type=int, default=DEFAULT_INTERVAL_SECONDS, help="Интервал проверки в секундах. По умолчанию: %(default)s.")
    parser.add_argument("--timeout", type=int, default=30, help="Таймаут загрузки одной таблицы в секундах.")
    parser.add_argument("--state", default=str(DEFAULT_STATE_PATH), help="JSON-файл состояния. По умолчанию: %(default)s.")
    parser.add_argument("--sheet", action="append", default=[], help='Дополнительная/своя таблица: "Название=https://docs.google.com/...". Если задано, дефолтные таблицы заменяются.')
    parser.add_argument("--once", action="store_true", help="Проверить один раз и выйти.")
    parser.add_argument("--notify-initial", action="store_true", help="Показать уведомление при первом сохранении снимка.")
    parser.add_argument("--no-notifications", action="store_true", help="Не показывать системные уведомления, только писать лог.")
    parser.add_argument("--quiet", action="store_true", help="Не писать в лог проверки без изменений.")
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    if args.interval < 15:
        raise SystemExit("Интервал меньше 15 секунд слишком агрессивен для Google Sheets.")
    sheets = [parse_sheet_arg(item) for item in args.sheet] if args.sheet else list(DEFAULT_SHEETS)
    state_path = Path(args.state).expanduser()
    state = load_state(state_path)

    log("Старт монитора: {} таблиц, интервал {} сек.".format(len(sheets), args.interval))
    while True:
        if check_all(sheets, state, args):
            save_state(state_path, state)
        if args.once:
            break
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
