# -*- coding: utf-8 -*-
import csv
import json
import urllib.request
import os
import sys
import time
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse


def add_cache_buster(url):
    parsed = urlparse(url)
    if parsed.scheme == "file":
        return url

    separator = "&" if "?" in url else "?"
    return url + separator + "t=" + str(int(time.time()))


def normalize_google_sheets_url(url):
    """
    Converts a regular Google Sheets edit URL to CSV export URL.
    Already-exported CSV/gviz URLs are returned unchanged.
    """
    if "docs.google.com/spreadsheets" not in url or "/d/" not in url:
        return url
    if "format=csv" in url or "tqx=out:csv" in url:
        return url

    parsed = urlparse(url)
    parts = parsed.path.split("/")
    try:
        sheet_id = parts[parts.index("d") + 1]
    except (ValueError, IndexError):
        return url

    query = parse_qs(parsed.query)
    gid = query.get("gid", ["0"])[0]
    export_path = "/spreadsheets/d/{}/export".format(sheet_id)
    export_query = urlencode({"format": "csv", "gid": gid})
    return urlunparse((parsed.scheme, parsed.netloc, export_path, "", export_query, ""))


def download_and_convert(google_csv_url, output_json_path):
    """
    Скачивает CSV по ссылке и конвертирует в JSON
    """
    try:
        google_csv_url = add_cache_buster(normalize_google_sheets_url(google_csv_url))
        print(f"DEBUG: Начинаем загрузку с URL: {google_csv_url[:80]}...")

        # Добавляем User-Agent, чтобы Google не блокировал запрос
        req = urllib.request.Request(
            google_csv_url,
            headers={
                'User-Agent': 'Mozilla/5.0',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        )

        # Скачиваем данные
        with urllib.request.urlopen(req, timeout=30) as response:
            csv_data = response.read().decode('utf-8-sig')
            lines = csv_data.splitlines()

            print("DEBUG: lines =", len(lines))

            for i in range(min(10, len(lines))):
                print("LINE", i, lines[i])
            print(csv_data[:500])
            print(f"DEBUG: Загружено байт: {len(csv_data)}")

        if csv_data.lstrip().lower().startswith("<!doctype html") or csv_data.lstrip().lower().startswith("<html"):
            print("ERROR:Google returned HTML instead of CSV. Check sharing/publication settings.")
            return False

        # Парсим CSV
        reader = csv.DictReader(csv_data.splitlines())
        data_list = list(reader)
        if not reader.fieldnames:
            print("ERROR:CSV header row not found")
            return False

        print(f"DEBUG: Распарсено строк: {len(data_list)}")

        # Сохраняем JSON
        output_dir = os.path.dirname(os.path.abspath(output_json_path))
        if output_dir:
            os.makedirs(output_dir, exist_ok=True)

        with open(output_json_path, 'w', encoding='utf-8') as json_file:
            json.dump(data_list, json_file, ensure_ascii=False, indent=4)

        print(f"SUCCESS:{len(data_list)}")
        print(f"DEBUG: Файл сохранен: {output_json_path}")
        return True

    except urllib.error.HTTPError as e:
        print(f"ERROR:HTTP Error {e.code}: {e.reason}")
        return False
    except urllib.error.URLError as e:
        print(f"ERROR:URL Error: {e.reason}")
        return False
    except Exception as e:
        print(f"ERROR:Unexpected error: {str(e)}")
        return False


if __name__ == "__main__":
    print(f"DEBUG: Python version: {sys.version}")
    print(f"DEBUG: Arguments count: {len(sys.argv)}")

    # Проверяем количество аргументов
    if len(sys.argv) < 3:
        print("ERROR:Недостаточно аргументов")
        print(f"USAGE: python download_data.py <google_sheets_url> <output_json_path>")
        print(f"Received {len(sys.argv)} arguments, expected 3")
        sys.exit(1)

    # Первый аргумент - URL таблицы
    csv_url = sys.argv[1]

    # Второй аргумент - путь к output JSON
    json_path = sys.argv[2]

    print(f"DEBUG: Output path: {json_path}")

    # Запускаем загрузку и конвертацию
    success = download_and_convert(csv_url, json_path)

    # Выход с кодом успеха/ошибки
    sys.exit(0 if success else 1)
