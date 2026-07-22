# -*- coding: utf-8 -*-
import argparse
import csv
import io
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


DEFAULT_RECORDING_URL = "https://docs.google.com/spreadsheets/d/1J6nJHM4wXF66LJO7dDNT6QgrxlQ5VPb-3B-4o7Ff0js/edit?gid=1944136331#gid=1944136331"
DEFAULT_PEOPLE_REF_URL = "https://docs.google.com/spreadsheets/d/10C3eoaG146WgOeQeoli90dQCHPruoJ_d4_rqcyoUR8M/edit?gid=213088400#gid=213088400"
DEFAULT_OUTPUT_DIR = Path.home() / "Documents" / "ae_plaque_data" / "recording"
DEFAULT_SOURCE_REF_GIDS = ["0", "1399617264", "1878161624"]

COL_U = 20
COL_V = 21
COL_AM = 38
ROW_VIDEO = 0
ROW_DATES = 1
ROW_FIRST_TIME = 2
ROW_LAST_TIME = 24

OUTPUT_FIELDS = [
    "ДАТА",
    "ВРЕМЯ",
    "ФИО спикера",
    "Должность",
    "Фото на плашку",
    "__compTimePrefix",
    "ИМЯ_КОМПОЗИЦИИ",
    "ИСХОДНАЯ_ЯЧЕЙКА",
]

SERVICE_WORDS = {
    "обед",
    "ужин",
    "завтрак",
    "перерыв",
    "кофебрейк",
    "кофе-брейк",
    "технический перерыв",
    "сбор",
    "переезд",
    "трансфер",
    "сон",
    "отбой",
}


class UserFacingError(Exception):
    pass


def google_sheet_export_url(url):
    parsed = urllib.parse.urlparse(str(url or "").strip())
    if "docs.google.com" not in parsed.netloc or "/spreadsheets/d/" not in parsed.path:
        return str(url or "").strip()
    match = re.search(r"/spreadsheets/d/([^/]+)", parsed.path)
    if not match:
        return str(url or "").strip()
    query = urllib.parse.parse_qs(parsed.query)
    fragment = urllib.parse.parse_qs(parsed.fragment)
    gid = query.get("gid", fragment.get("gid", ["0"]))[0]
    return "https://docs.google.com/spreadsheets/d/{}/export?format=tsv&gid={}".format(match.group(1), gid)


def google_sheet_fallback_urls(url):
    text = str(url or "").strip()
    parsed = urllib.parse.urlparse(text)
    if "docs.google.com" not in parsed.netloc or "/spreadsheets/d/" not in parsed.path:
        return [text]
    match = re.search(r"/spreadsheets/d/([^/]+)", parsed.path)
    if not match:
        return [text]
    query = urllib.parse.parse_qs(parsed.query)
    fragment = urllib.parse.parse_qs(parsed.fragment)
    gid = query.get("gid", fragment.get("gid", ["0"]))[0]
    sheet_id = match.group(1)
    return [
        "https://docs.google.com/spreadsheets/d/{}/export?format=tsv&gid={}".format(sheet_id, gid),
        "https://docs.google.com/spreadsheets/d/{}/gviz/tq?tqx=out:csv&gid={}".format(sheet_id, gid),
    ]


def google_sheet_id(url):
    parsed = urllib.parse.urlparse(str(url or "").strip())
    if "docs.google.com" not in parsed.netloc or "/spreadsheets/d/" not in parsed.path:
        return ""
    match = re.search(r"/spreadsheets/d/([^/]+)", parsed.path)
    return match.group(1) if match else ""


def google_sheet_gid(url):
    parsed = urllib.parse.urlparse(str(url or "").strip())
    query = urllib.parse.parse_qs(parsed.query)
    fragment = urllib.parse.parse_qs(parsed.fragment)
    return query.get("gid", fragment.get("gid", ["0"]))[0]


def google_sheet_edit_url(sheet_id, gid):
    return "https://docs.google.com/spreadsheets/d/{}/edit?gid={}#gid={}".format(sheet_id, gid, gid)


def split_reference_urls(value):
    raw = re.split(r"[\n\r,;]+", str(value or ""))
    return [item.strip() for item in raw if item.strip()]


def expand_reference_sources(recording_url, extra_ref_urls):
    sources = []
    seen = set()

    def push(url):
        text = str(url or "").strip()
        if not text:
            return
        key = "{}:{}".format(google_sheet_id(text) or text, google_sheet_gid(text))
        if key in seen:
            return
        seen.add(key)
        sources.append(text)

    source_sheet_id = google_sheet_id(recording_url)
    if source_sheet_id:
        for gid in DEFAULT_SOURCE_REF_GIDS:
            push(google_sheet_edit_url(source_sheet_id, gid))

    for url in split_reference_urls(extra_ref_urls):
        push(url)

    return sources


def fetch_url_text(source):
    urls = google_sheet_fallback_urls(source)
    errors = []
    for url in urls:
        for attempt in range(3):
            request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            try:
                with urllib.request.urlopen(request, timeout=60) as response:
                    return response.read().decode("utf-8-sig"), url
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                errors.append("{}: {}".format(url, exc))
                if attempt < 2:
                    time.sleep(1.5 * (attempt + 1))
    raise UserFacingError(
        "Не удалось скачать таблицу после нескольких попыток. "
        "Проверь интернет/VPN и доступ 'Anyone with the link'. Последняя ошибка: {}".format(errors[-1] if errors else "unknown")
    )


def local_path_arg(value):
    text = str(value or "").strip()
    if text.startswith("file://"):
        return Path(urllib.parse.unquote(urllib.parse.urlparse(text).path)).expanduser()
    if re.search(r"%[0-9A-Fa-f]{2}", text):
        return Path(urllib.parse.unquote(text)).expanduser()
    return Path(text).expanduser()


def read_source(source):
    if re.match(r"^https?://", str(source or ""), re.IGNORECASE):
        return fetch_url_text(source)
    path = local_path_arg(source)
    return path.read_text(encoding="utf-8-sig"), str(path)


def guess_delimiter(text):
    sample = text[:8192]
    try:
        return csv.Sniffer().sniff(sample, delimiters="\t,;").delimiter
    except csv.Error:
        first = sample.splitlines()[0] if sample.splitlines() else ""
        counts = {"\t": first.count("\t"), ",": first.count(","), ";": first.count(";")}
        return max(counts, key=counts.get) if max(counts.values()) else "\t"


def parse_rows(text):
    delimiter = guess_delimiter(text)
    try:
        return list(csv.reader(io.StringIO(text, newline=""), delimiter=delimiter))
    except csv.Error:
        if delimiter == "\t":
            return [line.split("\t") for line in text.splitlines()]
        raise


def cell(rows, row_index, col_index):
    if row_index < 0 or row_index >= len(rows):
        return ""
    row = rows[row_index]
    if col_index < 0 or col_index >= len(row):
        return ""
    return str(row[col_index] or "")


def inline_text(value):
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[\u00a0\t]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def normalize_key(value):
    return re.sub(r"[^0-9a-zа-яё]+", "", inline_text(value).lower().replace("ё", "е"))


def normalize_header(value):
    return normalize_key(value)


def row_dicts_from_text(text, required_headers=None):
    rows = parse_rows(text)
    if not rows:
        return []
    header_index = 0
    required = [normalize_header(item) for item in (required_headers or []) if inline_text(item)]
    for index, row in enumerate(rows[:20]):
        normalized = [normalize_header(item) for item in row]
        if required and any(item in normalized for item in required):
            header_index = index
            break
        if not required and "фио" in normalized and "должность" in normalized:
            header_index = index
            break
    headers = [inline_text(item) for item in rows[header_index]]
    result = []
    for row in rows[header_index + 1 :]:
        item = {}
        for index, header in enumerate(headers):
            if header:
                item[header] = row[index] if index < len(row) else ""
        result.append(item)
    return result


def get_by_columns(row, names):
    wanted = {normalize_header(name) for name in names}
    for key, value in row.items():
        if normalize_header(key) in wanted:
            return inline_text(value)
    return ""


def name_parts(value):
    return [part.strip(" .,-") for part in re.split(r"[\s,;]+", inline_text(value)) if part.strip(" .,-")]


def initials_surname_key(value):
    text = inline_text(value)
    compact = re.match(r"^((?:[А-ЯЁA-Z]\.\s*){1,3})([А-ЯЁA-Z][а-яё-]+)$", text)
    if compact:
        initials = re.sub(r"[^A-ZА-ЯЁ]", "", compact.group(1).upper())
        return normalize_key(initials[:2] + " " + compact.group(2))

    parts = name_parts(text)
    initials = []
    words = []
    for part in parts:
        letters = re.sub(r"[^A-ZА-ЯЁ]", "", part.upper())
        if re.fullmatch(r"(?:[A-ZА-ЯЁ]\.?){1,3}", part.upper()) and letters:
            initials.extend(list(letters))
        else:
            words.append(part)
    if initials and words:
        return normalize_key("".join(initials[:2]) + " " + words[-1])
    if len(words) >= 2:
        surname = words[0]
        first = words[1]
        patronymic = words[2] if len(words) >= 3 else ""
        return normalize_key((first[:1] + patronymic[:1]) + " " + surname)
    return ""


def split_column_names(value):
    parts = re.split(r"[,;\n\r]+", str(value or ""))
    return [inline_text(part) for part in parts if inline_text(part)]


def columns_with_defaults(configured, defaults):
    result = []
    seen = set()
    for item in list(configured or []) + list(defaults or []):
        text = inline_text(item)
        key = normalize_header(text)
        if text and key not in seen:
            seen.add(key)
            result.append(text)
    return result


def merge_people_record(lookup, key, next_record):
    if not key:
        return
    current = lookup.get(key)
    if not current:
        lookup[key] = next_record
        return
    if not current.get("position") and next_record.get("position"):
        current["position"] = next_record["position"]
    if not current.get("photo") and next_record.get("photo"):
        current["photo"] = next_record["photo"]
    if len(name_parts(next_record.get("name", ""))) > len(name_parts(current.get("name", ""))):
        current["name"] = next_record["name"]


def build_people_reference(text, name_columns=None, position_columns=None, photo_columns=None):
    lookup = {}
    name_columns = name_columns or ["ФИО", "ФИО спикера", "Имя", "Name"]
    position_columns = position_columns or ["Должность", "Регалии", "Position"]
    photo_columns = photo_columns or ["Фото на плашку", "Ссылка на плашку", "Фото", "ФОТО"]
    rows = row_dicts_from_text(text, name_columns)
    for row in rows:
        full_name = get_by_columns(row, name_columns)
        position = get_by_columns(row, position_columns)
        photo = get_by_columns(row, photo_columns)
        if not full_name:
            continue
        parts = name_parts(full_name)
        short_name_key = normalize_key("{} {}".format(parts[0], parts[1])) if len(parts) >= 2 else ""
        keys = {normalize_key(full_name), initials_surname_key(full_name), short_name_key}
        record = {"name": full_name, "position": position, "photo": photo}
        for key in keys:
            merge_people_record(lookup, key, record)
    return lookup


def build_people_reference_from_sources(sources, name_columns=None, position_columns=None, photo_columns=None):
    lookup = {}
    reports = []
    for source in sources:
        try:
            text, resolved = read_source(source)
            chunk = build_people_reference(text, name_columns, position_columns, photo_columns)
            for key, record in chunk.items():
                merge_people_record(lookup, key, record)
            reports.append({"source": resolved, "records": len(chunk), "ok": True})
        except Exception as exc:
            reports.append({"source": source, "records": 0, "ok": False, "error": str(exc)})
    return lookup, reports


def is_service_text(value):
    key = normalize_key(value)
    if not key:
        return True
    for word in SERVICE_WORDS:
        if key == normalize_key(word):
            return True
    return False


def split_people_cell(value):
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"\([^)]*(?:не\s*надо|без\s*плашк|обед|перерыв)[^)]*\)", " ", text, flags=re.IGNORECASE)
    raw_parts = re.split(r"[\n;]+|(?:\s{2,})", text)
    parts = []
    for raw in raw_parts:
        item = inline_text(raw).strip(" .,-")
        if not item or is_service_text(item):
            continue
        item = re.sub(r"^(?:запись|видео|спикер|эксперт|гость)\s*[:\-]\s*", "", item, flags=re.IGNORECASE).strip()
        if not item or is_service_text(item):
            continue
        parts.append(item)
    return parts


def last_first_name(value):
    parts = name_parts(value)
    if not parts:
        return ""
    if len(parts) >= 3:
        return "{} {}".format(parts[0], parts[1])
    if len(parts) >= 2:
        return "{} {}".format(parts[0], parts[1])
    return parts[0]


def display_name_from_ref_or_raw(raw_name, people_ref):
    keys = [initials_surname_key(raw_name), normalize_key(raw_name)]
    for key in keys:
        ref = people_ref.get(key) if key else None
        if ref:
            return ref["name"], ref.get("position", ""), ref.get("photo", ""), True
    return raw_name, "", "", False


def normalize_date(value):
    text = inline_text(value)
    match = re.search(r"(\d{1,2})[./-](\d{1,2})", text)
    if not match:
        return text
    return "{:02d}.{:02d}".format(int(match.group(1)), int(match.group(2)))


def normalize_time(value):
    text = inline_text(value)
    match = re.search(r"(\d{1,2})[:.](\d{2})", text)
    if not match:
        return text.replace(":", "-")
    return "{:02d}-{}".format(int(match.group(1)), match.group(2))


def source_cell(row_index, col_index):
    col = ""
    n = col_index + 1
    while n:
        n, rem = divmod(n - 1, 26)
        col = chr(ord("A") + rem) + col
    return "{}{}".format(col, row_index + 1)


def video_columns(rows):
    markers = [inline_text(cell(rows, ROW_VIDEO, col)).upper() for col in range(COL_U, COL_AM + 1)]
    has_video_anywhere = any("ВИДЕО" in marker for marker in markers)
    explicit = [COL_U + index for index, marker in enumerate(markers) if "ВИДЕО" in marker and COL_U + index >= COL_V]
    if explicit:
        return explicit
    if has_video_anywhere:
        return list(range(COL_V, COL_AM + 1))
    raise UserFacingError("В диапазоне U1:AM1 не найден маркер 'ВИДЕО'. Проверь, что выбран лист записи.")


def build_records(recording_rows, people_ref):
    columns = video_columns(recording_rows)
    records = []
    seen = set()
    ref_matches = 0
    ignored = 0
    for col in columns:
        date = normalize_date(cell(recording_rows, ROW_DATES, col))
        if not date:
            continue
        for row_index in range(ROW_FIRST_TIME, ROW_LAST_TIME + 1):
            time_value = normalize_time(cell(recording_rows, row_index, COL_U))
            if not time_value:
                continue
            raw_cell = cell(recording_rows, row_index, col)
            for raw_name in split_people_cell(raw_cell):
                if is_service_text(raw_name):
                    ignored += 1
                    continue
                full_name, position, photo, matched = display_name_from_ref_or_raw(raw_name, people_ref)
                if matched:
                    ref_matches += 1
                comp_person = last_first_name(full_name)
                if not comp_person:
                    ignored += 1
                    continue
                prefix = "{}_{}".format(date, time_value)
                comp_name = "{}_{}".format(prefix, comp_person)
                key = normalize_key(comp_name)
                if key in seen:
                    continue
                seen.add(key)
                records.append({
                    "ДАТА": date,
                    "ВРЕМЯ": time_value,
                    "ФИО спикера": full_name,
                    "Должность": position,
                    "Фото на плашку": photo,
                    "__compTimePrefix": prefix,
                    "ИМЯ_КОМПОЗИЦИИ": comp_name,
                    "ИСХОДНАЯ_ЯЧЕЙКА": source_cell(row_index, col),
                })
    return records, {"ref_matches": ref_matches, "ignored": ignored, "video_columns": len(columns)}


def write_tsv(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=OUTPUT_FIELDS, delimiter="\t", lineterminator="\n", extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def read_json(path):
    if not path:
        return {}
    file_path = local_path_arg(path)
    if not file_path.exists():
        return {}
    return json.loads(file_path.read_text(encoding="utf-8"))


def parse_args(argv):
    parser = argparse.ArgumentParser(description="Достает плашки записи из диапазона U1:AM25.")
    parser.add_argument("source", nargs="?", default=DEFAULT_RECORDING_URL)
    parser.add_argument("-o", "--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument("--people-ref-url", default=DEFAULT_PEOPLE_REF_URL)
    parser.add_argument("--ref-name-column", default="ФИО")
    parser.add_argument("--ref-position-column", default="Должность")
    parser.add_argument("--ref-photo-column", default="Фото на плашку,Ссылка на плашку,Фото,ФОТО")
    parser.add_argument("--settings-json", default="")
    parser.add_argument("--status-json", default="")
    return parser.parse_args(argv)


def main(argv):
    status_path = None
    try:
        args = parse_args(argv)
        status_path = local_path_arg(args.status_json) if args.status_json else None
        recording_text, resolved_source = read_source(args.source)
        recording_rows = parse_rows(recording_text)
        preset = read_json(args.settings_json)
        ref_name_column = preset.get("refNameColumn") or args.ref_name_column
        ref_position_column = preset.get("refPositionColumn") or args.ref_position_column
        ref_photo_column = preset.get("refPhotoColumn") or args.ref_photo_column
        name_columns = columns_with_defaults(
            split_column_names(ref_name_column),
            ["ФИО", "ФИО спикера", "Имя", "Name"]
        )
        position_columns = columns_with_defaults(
            split_column_names(ref_position_column),
            ["Должность", "Регалии", "Position"]
        )
        photo_columns = columns_with_defaults(
            split_column_names(ref_photo_column),
            ["Фото на плашку", "Ссылка на плашку", "Фото", "ФОТО"]
        )
        ref_sources = expand_reference_sources(args.source, args.people_ref_url)
        people_ref, ref_reports = build_people_reference_from_sources(ref_sources, name_columns, position_columns, photo_columns)
        if not people_ref:
            raise UserFacingError(
                "В справочнике не найдены строки по колонкам: ФИО='{}', Должность='{}'. "
                "Проверены листы таблицы записи и доп. справочник. "
                "Проверь названия колонок в окне скрипта и нажми 'Сохранить'. Ошибки: {}".format(
                    ref_name_column,
                    ref_position_column,
                    "; ".join([r.get("error", "") for r in ref_reports if not r.get("ok")]) or "нет"
                )
            )

        records, stats = build_records(recording_rows, people_ref)
        if not records:
            raise UserFacingError("В диапазоне U1:AM25 не найдено людей для записи.")

        output_dir = local_path_arg(args.output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        tsv_path = output_dir / "recording_plates.tsv"
        report_path = output_dir / "recording_report.json"
        report = {
            "ok": True,
            "source": resolved_source,
            "people_ref": ref_sources,
            "people_ref_reports": ref_reports,
            "output": str(output_dir),
            "tsv": str(tsv_path),
            "records": len(records),
            "ref_matches": stats["ref_matches"],
            "ignored": stats["ignored"],
            "video_columns": stats["video_columns"],
            "ref_sources_total": len(ref_reports),
            "ref_sources_ok": len([r for r in ref_reports if r.get("ok")]),
            "ref_name_column": ref_name_column,
            "ref_position_column": ref_position_column,
            "ref_photo_column": ref_photo_column,
        }
        write_tsv(tsv_path, records)
        write_json(report_path, report)
        if status_path:
            write_json(status_path, report)
        print("SOURCE: {}".format(resolved_source))
        print("PEOPLE_REF_SOURCES: {}".format(len(ref_reports)))
        print("OUTPUT: {}".format(output_dir))
        print("SUCCESS: records={}, ref_matches={}, ignored={}".format(len(records), stats["ref_matches"], stats["ignored"]))
        return 0
    except Exception as exc:
        print("ERROR: {}".format(exc), file=sys.stderr)
        if status_path:
            write_json(status_path, {"ok": False, "error": str(exc)})
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
