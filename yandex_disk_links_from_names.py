# -*- coding: utf-8 -*-
import argparse
import csv
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


API_BASE = "https://cloud-api.yandex.net/v1/disk"
DEFAULT_USER_AGENT = "sheet2comp-ae-yandex-links/1.0"


class UserFacingError(Exception):
    pass


def normalize_text(value):
    text = str(value or "").lower().replace("ё", "е")
    return re.sub(r"[^0-9a-zа-я]+", "", text)


def display_name(value):
    text = re.sub(r"\s+", " ", str(value or "").replace("\r", " ").replace("\n", " ")).strip()
    return text


def resource_name_key(resource):
    stem = Path(str(resource.get("name") or "")).stem
    return normalize_text(stem)


def request_json(url, token, method="GET", timeout=60):
    request = urllib.request.Request(
        url,
        method=method,
        headers={
            "Authorization": "OAuth {}".format(token),
            "Accept": "application/json",
            "User-Agent": DEFAULT_USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read()
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8", "replace")
        raise UserFacingError("Яндекс.Диск вернул HTTP {}: {}".format(exc.code, error_body))
    except urllib.error.URLError as exc:
        raise UserFacingError("Не удалось подключиться к Яндекс.Диску: {}".format(exc))

    if not body:
        return {}
    return json.loads(body.decode("utf-8"))


def api_url(path, params=None):
    params = params or {}
    return API_BASE + path + ("?" + urllib.parse.urlencode(params) if params else "")


def read_names(path, column=None):
    text = Path(path).expanduser().read_text(encoding="utf-8-sig")
    sample = text[:4096]
    delimiter = "\t"
    try:
        delimiter = csv.Sniffer().sniff(sample, delimiters="\t,;").delimiter
    except csv.Error:
        pass

    if column:
        reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
        names = [display_name(row.get(column, "")) for row in reader]
    else:
        names = [display_name(line) for line in text.splitlines()]

    return [name for name in names if name]


def list_resources(token, root_path, recursive=True, limit=1000):
    queue = [root_path]
    resources = []

    while queue:
        path = queue.pop(0)
        offset = 0
        while True:
            data = request_json(
                api_url("/resources", {"path": path, "limit": limit, "offset": offset}),
                token,
            )
            embedded = data.get("_embedded") or {}
            items = embedded.get("items") or []
            for item in items:
                if item.get("type") == "dir":
                    if recursive:
                        queue.append(item.get("path") or "")
                elif item.get("type") == "file":
                    resources.append(item)

            total = int(embedded.get("total") or len(items) or 0)
            offset += len(items)
            if not items or offset >= total:
                break

    return resources


def score_resource(name_key, resource):
    file_key = resource_name_key(resource)
    if not name_key or not file_key:
        return None
    if file_key == name_key:
        return (0, len(file_key))
    if name_key in file_key:
        return (1, len(file_key))
    if file_key in name_key:
        return (2, len(file_key))
    return None


def find_best_match(name, resources):
    name_key = normalize_text(name)
    matches = []
    for resource in resources:
        score = score_resource(name_key, resource)
        if score is not None:
            matches.append((score, resource))
    if not matches:
        return None
    matches.sort(key=lambda item: item[0])
    return matches[0][1]


def publish_resource(token, resource_path):
    request_json(api_url("/resources/publish", {"path": resource_path}), token, method="PUT")

    # Yandex may need a short moment before public_url appears in metadata.
    for _ in range(5):
        data = request_json(api_url("/resources", {"path": resource_path}), token)
        public_url = data.get("public_url") or ""
        if public_url:
            return public_url
        time.sleep(0.5)
    return ""


def resource_link(token, resource, publish):
    public_url = resource.get("public_url") or ""
    if public_url:
        return public_url
    if publish:
        return publish_resource(token, resource.get("path") or "")
    return ""


def write_output(rows, output_path):
    output = Path(output_path).expanduser()
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=["Имя", "Ссылка", "Файл", "Путь", "Статус"],
            delimiter="\t",
        )
        writer.writeheader()
        writer.writerows(rows)


def build_rows(names, resources, token, publish):
    rows = []
    for name in names:
        match = find_best_match(name, resources)
        if not match:
            rows.append({
                "Имя": name,
                "Ссылка": "",
                "Файл": "",
                "Путь": "",
                "Статус": "не найдено",
            })
            continue

        link = resource_link(token, match, publish)
        status = "ok"
        if not link:
            status = "найдено, но нет публичной ссылки; добавь --publish"

        rows.append({
            "Имя": name,
            "Ссылка": link,
            "Файл": match.get("name") or "",
            "Путь": match.get("path") or "",
            "Статус": status,
        })
    return rows


def parse_args(argv):
    parser = argparse.ArgumentParser(
        description="Найти файлы на Яндекс.Диске по списку имен и сохранить TSV со ссылками."
    )
    parser.add_argument("names", help="TXT/CSV/TSV со строками имен или таблица с колонкой имени")
    parser.add_argument("-o", "--output", default="yandex_disk_links.tsv", help="Куда сохранить TSV")
    parser.add_argument("--column", help="Название колонки с именем, если входной файл CSV/TSV")
    parser.add_argument("--root", default="disk:/", help="Папка поиска на Яндекс.Диске, например disk:/Фото")
    parser.add_argument("--token", help="OAuth-токен Яндекс.Диска. Можно не указывать, если задан YANDEX_DISK_TOKEN")
    parser.add_argument("--publish", action="store_true", help="Опубликовать найденные файлы и вернуть публичные ссылки")
    parser.add_argument("--no-recursive", action="store_true", help="Искать только в указанной папке без подпапок")
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv or sys.argv[1:])
    token = args.token or os.environ.get("YANDEX_DISK_TOKEN")
    if not token:
        raise UserFacingError("Нужен OAuth-токен: передай --token или задай YANDEX_DISK_TOKEN.")

    names = read_names(args.names, args.column)
    if not names:
        raise UserFacingError("Во входном файле нет имен.")

    resources = list_resources(token, args.root, recursive=not args.no_recursive)
    rows = build_rows(names, resources, token, publish=args.publish)
    write_output(rows, args.output)

    found = sum(1 for row in rows if row["Файл"])
    linked = sum(1 for row in rows if row["Ссылка"])
    print("Готово: найдено файлов {}/{}, ссылок {}/{}.".format(found, len(rows), linked, len(rows)))
    print("TSV: {}".format(Path(args.output).expanduser()))


if __name__ == "__main__":
    try:
        main()
    except UserFacingError as exc:
        print("Ошибка: {}".format(exc), file=sys.stderr)
        sys.exit(1)
