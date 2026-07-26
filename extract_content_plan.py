# -*- coding: utf-8 -*-
import argparse
import csv
import hashlib
import io
import json
import os
import re
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import content_quality as quality


DEFAULT_URL = "https://docs.google.com/spreadsheets/d/10C3eoaG146WgOeQeoli90dQCHPruoJ_d4_rqcyoUR8M/edit?gid=213088400#gid=213088400"
DEFAULT_PEOPLE_REF_URL = "https://docs.google.com/spreadsheets/d/1J6nJHM4wXF66LJO7dDNT6QgrxlQ5VPb-3B-4o7Ff0js/edit?gid=1399617264#gid=1399617264"
DEFAULT_OUTPUT_DIR = Path.home() / "Documents" / "ae_plaque_data" / "content_plan"
DEFAULT_PEOPLE_REF_GIDS = ["1399617264", "0", "1878161624"]
TIME_HEADER = "ВРЕМЯ"
COMP_NAME_HEADER = "ИМЯ_КОМПОЗИЦИИ"

DEFAULT_VENUES = [
    {"venue_id": "amphitheater", "source_column": "B", "column_index": 1, "name": "Амфитеатр", "color": "red"},
    {"venue_id": "ural_1", "source_column": "C", "column_index": 2, "name": "Урал 1", "color": "blue"},
    {"venue_id": "ural_2", "source_column": "D", "column_index": 3, "name": "Урал 2", "color": "red"},
]

TOPIC_FIELDS = ["topic_id", "ТЕМА", "ОПИСАНИЕ", "ИСХОДНАЯ_ЯЧЕЙКА"]
VENUE_FIELDS = ["venue_id", "source_column", "ПЛОЩАДКА", "ЦВЕТ"]
SESSION_MODEL_FIELDS = [
    "session_id", "topic_id", "ДЕНЬ", "ДАТА", "ВРЕМЯ", "НАЧАЛО", "КОНЕЦ",
    "venue_id", "ПЛОЩАДКА", "ФОРМАТ", "ТИП_ГРАФИКИ", "ИСХОДНАЯ_ЯЧЕЙКА",
]
SESSION_PEOPLE_FIELDS = [
    "session_id", "person_id", "ФИО спикера", "РОЛЬ", "Должность", "badge_needed",
    "card_needed", "ИСХОДНАЯ_ЯЧЕЙКА",
]
PEOPLE_FIELDS = ["person_id", "ФИО спикера", "normalized_name", "Должность", "Фото на плашку", "ИСХОДНЫЕ_ЯЧЕЙКИ"]
BADGE_FIELDS = ["session_id", "person_id", "ДЕНЬ", "ДАТА", "ВРЕМЯ", "НАЧАЛО", "ПЛОЩАДКА", "ФИО спикера", "Должность", "Фото на плашку"]
CARD_FIELDS = ["person_id", "ФИО спикера", "Должность", "Фото на плашку", "card_status", "card_warning"]
LEGACY_SESSION_FIELDS = ["ДЕНЬ", "ДАТА", "ВРЕМЯ", "ПЛОЩАДКА", "ТЕМА", "ОПИСАНИЕ", "ТИП", COMP_NAME_HEADER, "ИСХОДНАЯ_ЯЧЕЙКА"]
AE_READY_REQUIRED_TABS = {
    "content_plan_sessions": LEGACY_SESSION_FIELDS,
    "content_plan_plates": BADGE_FIELDS,
    "content_plan_cards": CARD_FIELDS,
}
AE_READY_OPTIONAL_TABS = {
    "content_plan_all_people": PEOPLE_FIELDS,
    "content_plan_topics_model": TOPIC_FIELDS,
    "content_plan_sessions_model": SESSION_MODEL_FIELDS,
    "content_plan_session_people": SESSION_PEOPLE_FIELDS,
    "warnings": ["level", "source_cell", "message", "raw_text", "confidence"],
    "source_cells": ["source_cell", "ДЕНЬ", "ДАТА", "ВРЕМЯ", "ПЛОЩАДКА", "raw_text", "parser_topic", "parser_people_count", "llm_applied", "llm_confidence"],
    "import_report": ["key", "value"],
}

ROLE_RE = re.compile(r"(?is)(Эксперты?|Эксперт|Гости|Спикеры?|Спикер|Модератор|Ведущий)\s*:\s*")
NAME_START_RE = re.compile(
    r"(?=(?:^|\s)((?:[А-ЯЁA-Z]\.\s*){1,3}[А-ЯЁ][а-яё-]+|[А-ЯЁ][а-яё-]+\s+[А-ЯЁ][а-яё-]+(?:\s+[А-ЯЁ][а-яё-]+)?(?=\s*,)))"
)
STOP_RE = re.compile(
    r"(?is)(?:^|\s)(?:▶\s*)?(?:Статус|Модератор|Ведущий|СЦЕНАРИЙ(?:\s+ДЛЯ\s+РПГ)?|ЗАЛ|СЕТАП|РАЙДЕР|КОНТЕНТ|ВОЛОНТЕРЫ|Техзапрос|Техзадание|Место)\s*:"
)
SERVICE_RE = re.compile(r"(?i)^(перерыв|обед|ужин|завтрак|зарядка|отъезд|подъ[её]м|рефлексия|креатон(?:\s*-.*)?|\d+)$")
DESCRIPTION_LABELS = [
    "Главная встреча дня",
    "Пленарная сессия",
    "Установочная встреча",
    "Шоу-защита проектов",
    "Презентация проекта",
    "Мастер-класс",
    "Дискуссия",
    "Лекция",
    "Дебаты",
    "Встреча",
]


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


def fetch_first_available_text(urls, error_prefix):
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
    raise UserFacingError("{}: {}".format(error_prefix, errors[-1] if errors else "unknown"))


def local_path_arg(value):
    text = str(value or "").strip()
    if text.startswith("file://"):
        return Path(urllib.parse.unquote(urllib.parse.urlparse(text).path)).expanduser()
    if re.search(r"%[0-9A-Fa-f]{2}", text):
        return Path(urllib.parse.unquote(text)).expanduser()
    return Path(text).expanduser()


def read_source(source):
    if re.match(r"^https?://", source, re.IGNORECASE):
        return fetch_url_text(source)
    path = local_path_arg(source)
    return path.read_bytes().decode("utf-8-sig"), str(path)


def guess_delimiter(text):
    sample = text[:8192]
    try:
        return csv.Sniffer().sniff(sample, delimiters="\t,;").delimiter
    except csv.Error:
        first = sample.splitlines()[0] if sample.splitlines() else ""
        counts = {"\t": first.count("\t"), ",": first.count(","), ";": first.count(";")}
        return max(counts, key=counts.get) if max(counts.values()) else "\t"


def parse_table_rows(text, delimiter="auto"):
    text = str(text or "").replace("\r\n", "\n")
    text = re.sub(r"\r *", " ", text)
    delimiter_map = {"tab": "\t", "comma": ",", "semicolon": ";"}
    actual = guess_delimiter(text) if delimiter == "auto" else delimiter_map.get(delimiter, delimiter)
    try:
        return list(csv.reader(io.StringIO(text, newline=""), delimiter=actual))
    except csv.Error:
        if actual == "\t":
            return [line.split("\t") for line in text.splitlines()]
        raise


def normalize_header(value):
    return normalize_lookup_token(value)


def row_dicts_from_text(text):
    rows = parse_table_rows(text, "auto")
    if not rows:
        return []
    header_index = 0
    for index, row in enumerate(rows[:20]):
        normalized = [normalize_header(cell) for cell in row]
        if "фио" in normalized and "должность" in normalized:
            header_index = index
            break
    headers = [inline_text(cell) for cell in rows[header_index]]
    dict_rows = []
    for row in rows[header_index + 1 :]:
        item = {}
        for index, header in enumerate(headers):
            if header:
                item[header] = row[index] if index < len(row) else ""
        dict_rows.append(item)
    return dict_rows


def get_by_normalized_column(row, names):
    wanted = {normalize_header(name) for name in names}
    for key, value in row.items():
        if normalize_header(key) in wanted:
            return inline_text(value)
    return ""


def google_sheet_id(url):
    parsed = urllib.parse.urlparse(str(url or "").strip())
    match = re.search(r"/spreadsheets/d/([^/]+)", parsed.path)
    return match.group(1) if match else ""


def is_google_sheet_url(value):
    parsed = urllib.parse.urlparse(str(value or "").strip())
    return "docs.google.com" in parsed.netloc and "/spreadsheets/d/" in parsed.path


def google_sheet_tab_urls(url, sheet_name):
    sheet_id = google_sheet_id(url)
    if not sheet_id:
        return [str(url or "").strip()]
    encoded_sheet = urllib.parse.quote(sheet_name, safe="")
    return [
        "https://docs.google.com/spreadsheets/d/{}/gviz/tq?tqx=out:csv&sheet={}".format(sheet_id, encoded_sheet),
        "https://docs.google.com/spreadsheets/d/{}/gviz/tq?sheet={}&tqx=out:csv".format(sheet_id, encoded_sheet),
    ]


def people_reference_sources(value):
    sources = []
    seen = set()
    for raw in re.split(r"[\n\r,;]+", str(value or "")):
        source = raw.strip()
        if not source:
            continue
        sheet_id = google_sheet_id(source)
        candidates = [source]
        if sheet_id:
            candidates += [
                "https://docs.google.com/spreadsheets/d/{}/edit?gid={}#gid={}".format(sheet_id, gid, gid)
                for gid in DEFAULT_PEOPLE_REF_GIDS
            ]
        for candidate in candidates:
            key = google_sheet_export_url(candidate)
            if key not in seen:
                seen.add(key)
                sources.append(candidate)
    return sources


def build_people_reference(text):
    lookup = {}
    for row in row_dicts_from_text(text):
        full_name = get_by_normalized_column(row, ["ФИО", "ФИО спикера", "Имя", "Name"])
        position = get_by_normalized_column(row, ["Должность", "Регалии", "Position"])
        clean_name, _reason = quality.validate_person_name(full_name)
        if not clean_name:
            continue
        keys = quality.person_lookup_keys(clean_name)
        for key in keys:
            if key:
                current = lookup.get(key, {})
                lookup[key] = {
                    "name": current.get("name") or clean_name,
                    "position": current.get("position") or quality.clean_position(position),
                }
    return lookup


def build_people_reference_from_sources(sources):
    lookup = {}
    reports = []
    for source in sources:
        try:
            text, resolved = read_source(source)
            chunk = build_people_reference(text)
            for key, record in chunk.items():
                current = lookup.get(key, {})
                lookup[key] = {
                    "name": current.get("name") or record.get("name", ""),
                    "position": current.get("position") or record.get("position", ""),
                }
            reports.append({"source": resolved, "records": len(chunk), "ok": True})
        except Exception as exc:
            reports.append({"source": source, "records": 0, "ok": False, "error": str(exc)})
    return lookup, reports


def clean_text(value):
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[\u00a0\t]+", " ", text)
    lines = [re.sub(r" +", " ", line).strip() for line in text.split("\n")]
    cleaned = []
    previous_blank = False
    for line in lines:
        blank = line == ""
        if blank and previous_blank:
            continue
        cleaned.append(line)
        previous_blank = blank
    return "\n".join(cleaned).strip()


def inline_text(value):
    return re.sub(r"\s+", " ", clean_text(value)).strip()


def normalize_key(value):
    return re.sub(r"[^0-9a-zа-яё]+", "", inline_text(value).lower().replace("ё", "е"))


def normalize_lookup_token(value):
    return re.sub(r"[^0-9a-zа-яё]+", "", inline_text(value).lower().replace("ё", "е"))


def name_word_parts(value):
    text = inline_text(value)
    return [part.strip(" .,-") for part in re.split(r"[\s,;]+", text) if part.strip(" .,-")]


def initials_surname_key(value):
    return quality.initials_surname_key(value)


def has_initials_name(value):
    text = inline_text(value)
    return re.search(r"(?:^|\s)(?:[А-ЯЁA-Z]\.\s*){1,3}[А-ЯЁA-Z]?\.\s*[А-ЯЁA-Z][а-яё-]+", text) is not None


def stable_id(prefix, value):
    key = normalize_key(value)
    return "{}_{}".format(prefix, key[:80] or "unknown")


def title_case_upper_words(value):
    def convert(match):
        token = match.group(0)
        if token.upper() == token and token.lower() != token:
            return token[:1].upper() + token[1:].lower()
        return token

    return re.sub(r"[A-ZА-ЯЁ]{2,}", convert, value)


def clean_venue_header(value):
    text = inline_text(value)
    text = re.sub(r"\(\s*(?:до\s*)?\d+\s*(?:мест[а]?|чел(?:овек)?\.?)\s*\)", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(?:до\s*)?\d+\s*(?:мест[а]?|чел(?:овек)?\.?)\b", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+", " ", text).strip(" -—")
    return title_case_upper_words(text)


def session_comp_name(venue_name, topic_title):
    title = clean_topic(topic_title)
    return title if title else ""


def split_time(value):
    text = inline_text(value)
    match = re.match(r"^(?:до\s*)?(\d{1,2}[:.]\d{2})(?:\s*[–-]\s*(\d{1,2}[:.]\d{2}))?$", text)
    if not match:
        return text, "", ""
    start = match.group(1).replace(".", ":")
    end = (match.group(2) or "").replace(".", ":")
    return text, start, end


def day_filter_keys(values):
    keys = set()
    for value in values or []:
        text = inline_text(value)
        if not text:
            continue
        keys.add(normalize_key(text))
        number_match = re.fullmatch(r"(?:день\s*)?(\d+)", text, flags=re.IGNORECASE)
        if number_match:
            keys.add(normalize_key("ДЕНЬ {}".format(number_match.group(1))))
        date_match = re.fullmatch(r"(\d{1,2})[./-](\d{1,2})", text)
        if date_match:
            keys.add(normalize_key("{}.{}".format(date_match.group(1), date_match.group(2))))
            keys.add(normalize_key("{:02d}.{:02d}".format(int(date_match.group(1)), int(date_match.group(2)))))
    return keys


def parse_day(value):
    text = inline_text(value)
    match = re.search(r"ДЕНЬ\s+(\d+).*?(\d{1,2}\.\d{1,2}|ДД\.ММ)", text, re.IGNORECASE)
    if not match:
        return None
    return {"day": "ДЕНЬ {}".format(match.group(1)), "date": match.group(2)}


def is_time(value):
    text = inline_text(value)
    return re.match(r"^(?:до\s*)?\d{1,2}[:.]\d{2}(?:\s*[–-]\s*\d{1,2}[:.]\d{2})?$", text) is not None


def detect_layout(rows):
    for row_index, row in enumerate(rows[:30]):
        for index, value in enumerate(row):
            if inline_text(value).upper() == TIME_HEADER:
                return {"time_column": index, "header_row": row_index}
    raise UserFacingError("Не найдена строка заголовка с колонкой '{}'. Проверь, что выбран лист программы, а не HTML/пустой экспорт.".format(TIME_HEADER))


def venues_from_rows(rows, layout):
    header_row = rows[layout["header_row"]] if layout["header_row"] < len(rows) else []
    venues = []
    for fallback in DEFAULT_VENUES:
        column_index = fallback["column_index"]
        header = header_row[column_index] if column_index < len(header_row) else ""
        item = dict(fallback)
        item["name"] = clean_venue_header(header) or fallback["name"]
        venues.append(item)
    return venues


def clean_topic(value):
    return quality.clean_topic(value)


def first_sentence(text):
    value = inline_text(text)
    if not value:
        return ""
    parts = re.split(r"(?<=[.!?])\s+", value, maxsplit=1)
    return parts[0].strip(" \"'«»„“”.,;:-–—")


def short_description_label(text):
    value = inline_text(text)
    for label in DESCRIPTION_LABELS:
        pattern = r"^{}\b".format(re.escape(label))
        if re.search(pattern, value, flags=re.IGNORECASE):
            return label
    return ""


def trim_repeated_topic(description, topic):
    desc = inline_text(description)
    top = clean_topic(topic)
    if not desc or not top:
        return desc
    patterns = [
        r'[«"]?\s*{}\s*[»"]?'.format(re.escape(top)),
        r"\b{}\b".format(re.escape(top)),
    ]
    for pattern in patterns:
        desc = re.sub(pattern, " ", desc, flags=re.IGNORECASE)
    return inline_text(desc).strip(" \"'«»„“”.,;:-–—")


def normalize_topic_description(topic, description):
    topic_text = clean_topic(topic)
    description_text = quality.clean_position(description)
    if topic_text and re.search(r"[.!?]\s+", topic_text):
        topic_text = first_sentence(topic_text)
    if description_text:
        description_text = trim_repeated_topic(description_text, topic_text)
        label = short_description_label(description_text)
        sentence = first_sentence(description_text)
        if label and normalize_key(description_text) == normalize_key(label):
            description_text = "" if normalize_key(label) == normalize_key("Встреча") else label
        elif sentence and len(sentence.split()) <= 8:
            description_text = sentence
            if normalize_key(description_text) == normalize_key("Встреча"):
                description_text = ""
        else:
            description_text = ""
    if description_text and normalize_key(description_text) == normalize_key(topic_text):
        description_text = ""
    return topic_text, description_text


def comp_venue_name(value):
    venue = clean_venue_header(value)
    if normalize_key(venue) == normalize_key("АМФИТЕАТР ОСНОВНАЯ / ПЛЕНАРНАЯ"):
        return "АМФИТЕАТР"
    return venue


def strip_file_tokens(text):
    text = re.sub(r"\S+\.(?:docx|doc|pdf|pptx|xlsx)", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"СЦЕНАРИЙ\s+ДЛЯ\s+РПГ\s*:\s*\S+", " ", text, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", text).strip()


def name_start_matches(value):
    matches = []
    last_end = -1
    for match in NAME_START_RE.finditer(inline_text(value)):
        if match.start(1) < last_end:
            continue
        candidate, _reason = quality.validate_person_name(match.group(1))
        if not candidate:
            continue
        matches.append(match)
        last_end = match.end(1)
    return matches


def extract_topic_and_description(cell):
    raw_text = str(cell or "").replace("\r\n", "\n").replace("\r", "\n")
    text = inline_text(raw_text)
    topic_match = re.search(
        r"(?is)(?:^|\s)Тема\s*:\s*(.+?)(?=\s+(?:Эксперты?|Гости|Спикеры?|Эксперт|Модератор|Ведущий|СЦЕНАРИЙ(?:\s+ДЛЯ\s+РПГ)?|ЗАЛ|СЕТАП|РАЙДЕР|КОНТЕНТ)\s*:|$)",
        text,
    )
    if topic_match:
        topic = clean_topic(topic_match.group(1))
        description = strip_file_tokens(text[: topic_match.start()]).strip(" -—")
        return normalize_topic_description(topic, description)

    head_lines = []
    for raw_line in raw_text.splitlines():
        line = inline_text(raw_line)
        if not line:
            continue
        role_match = ROLE_RE.search(line)
        if role_match:
            prefix = inline_text(line[: role_match.start()])
            if prefix:
                head_lines.append(prefix)
            break
        head_lines.append(line)
    if len(head_lines) >= 2:
        return normalize_topic_description(head_lines[0], " ".join(head_lines[1:]))

    first_role = ROLE_RE.search(text)
    head = text[: first_role.start()] if first_role else text
    head = strip_file_tokens(head).strip(" -—")
    quote = re.search(r"«([^»\n]{8,})»", head) or re.search(r"\"([^\"\n]{8,})\"", head)
    if quote:
        return normalize_topic_description(quote.group(1), head)
    if first_role and len(head) > 10 and not SERVICE_RE.match(head):
        head_name_starts = name_start_matches(head)
        if head_name_starts:
            head = head[: head_name_starts[0].start(1)].strip(" -—")
        sentence = first_sentence(head)
        description = head[len(sentence) :].strip(" -—")
        return normalize_topic_description(sentence or head, description or head)
    name_starts = name_start_matches(text)
    if len(name_starts) >= 2:
        head = strip_file_tokens(text[: name_starts[0].start(1)]).strip(" -—")
        topic = clean_topic(head)
        if topic:
            return normalize_topic_description(topic, head)
    return "", ""


def is_content_cell(cell):
    text = inline_text(cell)
    if not text or SERVICE_RE.match(text):
        return False
    if ROLE_RE.search(text) or re.search(r"(?i)(?:^|\s)Тема\s*:", text):
        return True
    if len(name_start_matches(text)) >= 2:
        return True
    return False


def reference_person(people_reference, name):
    if not people_reference:
        return None
    for key in quality.person_lookup_keys(name):
        if key and people_reference.get(key):
            return people_reference[key]
    return None


def split_people_block(block, people_reference=None):
    raw_text = clean_text(block)
    raw_text = STOP_RE.split(raw_text, maxsplit=1)[0]
    raw_text = re.sub(r"\((?:подтвержден[аы]?|уточняется)\)", " ", raw_text, flags=re.IGNORECASE)
    raw_text = re.sub(r"\s+-\s+ПРЕЗЕНТАЦИ[ЯИ].*?(?=(?:[А-ЯЁA-Z]\.)|$)", " ", raw_text)
    raw_lines = [inline_text(line) for line in raw_text.splitlines() if inline_text(line)]
    parsed_lines = []
    for line in raw_lines:
        if parse_person(line):
            parsed_lines.append(line.strip(" ;.-"))
    if len(parsed_lines) >= 2:
        return parsed_lines
    text = inline_text(raw_text)
    matches = []
    for match in name_start_matches(text):
        candidate = match.group(1)
        has_initials = any(quality.is_initials_token(part) for part in quality.name_parts(candidate))
        before = text[max(0, match.start(1) - 24) : match.start(1)]
        if has_initials and re.search(r"\bимени\s*$", before, flags=re.IGNORECASE) and not reference_person(people_reference, candidate):
            continue
        matches.append({"start": match.start(1), "end": match.end(1), "candidate": candidate})
    if len(matches) <= 1:
        return [text.strip(" ;.-")] if text.strip(" ;.-") else []
    accepted = [matches[0]]
    for item in matches[1:]:
        fragment = text[accepted[-1]["end"] : item["start"]]
        stripped = fragment.strip()
        if (
            not stripped
            or ";" in fragment
            or "\n" in fragment
            or re.search(r"(?:^|[\s,;])\d+\)\s*$", fragment)
            or re.search(r"(?:^|[\s,;])[•▶-]\s*$", fragment)
            or re.fullmatch(r"[,/|&]+", stripped)
            or re.fullmatch(r",?\s*(?:и|and|&)\s*", stripped, flags=re.IGNORECASE)
        ):
            accepted.append(item)
    starts = [item["start"] for item in accepted]
    starts.append(len(text))
    return [text[starts[i] : starts[i + 1]].strip(" ;.-") for i in range(len(starts) - 1) if text[starts[i] : starts[i + 1]].strip(" ;.-")]


def normalize_person_name(value):
    text = inline_text(value)
    text = re.sub(r"^[▶\s]+", "", text).strip(" .,-")
    return normalize_key(text)


def person_alias_key(value):
    parts = name_word_parts(value)
    if len(parts) < 2:
        return ""
    surname = ""
    first = ""
    for part in parts:
        clean = part.strip(" .,-")
        if not surname and re.search(r"(ов|ова|ев|ева|ёв|ёва|ин|ина|ын|ына|ский|ская|цкий|цкая|енко|ко|ук|юк|ич|ых|их)$", clean.lower().replace("ё", "е")):
            surname = clean
        elif not first and not quality.is_initials_token(clean):
            first = clean
    if not surname:
        surname = parts[0]
    if not first:
        first = parts[1]
    initial_match = re.search(r"[A-ZА-ЯЁ]", first.upper())
    return normalize_lookup_token("{} {}".format(surname, initial_match.group(0) if initial_match else ""))


def person_name_quality(value):
    parts = name_word_parts(value)
    full_parts = [part for part in parts if not quality.is_initials_token(part)]
    initial_parts = [part for part in parts if quality.is_initials_token(part)]
    return len(full_parts) * 10 - len(initial_parts) + len(inline_text(value))


def parse_person(piece):
    text = inline_text(piece)
    if not text or text in ("[ФИО]", "из команды модераторов"):
        return None
    if "," in text:
        name, position = text.split(",", 1)
    else:
        match = re.match(r"^((?:[А-ЯЁA-Z]\.\s*){1,3}[А-ЯЁ][а-яё-]+|[А-ЯЁ][а-яё-]+\s+[А-ЯЁ][а-яё-]+(?:\s+[А-ЯЁ][а-яё-]+)?)(?:\s+(.+))?$", text)
        if not match:
            return None
        name, position = match.group(1), match.group(2) or ""
    name, _reason = quality.validate_person_name(name)
    position = quality.clean_position(position)
    if not name:
        return None
    key = normalize_person_name(name)
    if len(name) < 3 or key in ("фио", "изкомандымодераторов"):
        return None
    return {"name": name, "position": position, "normalized_name": key}


def enrich_person_from_reference(person, people_reference):
    if not people_reference:
        return person, False
    keys = quality.person_lookup_keys(person["name"])
    for key in keys:
        ref = people_reference.get(key) if key else None
        if not ref:
            continue
        enriched = dict(person)
        if ref.get("name"):
            enriched["name"] = ref["name"]
            enriched["normalized_name"] = normalize_person_name(ref["name"])
        if ref.get("position") and not enriched.get("position"):
            enriched["position"] = ref["position"]
        return enriched, True
    return person, False


def extract_people(cell, people_reference=None):
    raw_text = clean_text(cell)
    text = inline_text(raw_text)
    people = []
    enriched_count = 0
    matches = list(ROLE_RE.finditer(text))
    for index, match in enumerate(matches):
        role = match.group(1)
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        for piece in split_people_block(text[start:end], people_reference):
            person = parse_person(piece)
            if person:
                person, enriched = enrich_person_from_reference(person, people_reference)
                has_initials = any(quality.is_initials_token(part) for part in quality.name_parts(person["name"]))
                if has_initials and people_reference is not None and not enriched:
                    continue
                if enriched:
                    enriched_count += 1
                person["role"] = role
                people.append(person)
    if not matches and len(name_start_matches(raw_text)) >= 2:
        for piece in split_people_block(raw_text, people_reference):
            person = parse_person(piece)
            if person:
                person, enriched = enrich_person_from_reference(person, people_reference)
                has_initials = any(quality.is_initials_token(part) for part in quality.name_parts(person["name"]))
                if has_initials and people_reference is not None and not enriched:
                    continue
                if enriched:
                    enriched_count += 1
                person["role"] = "Спикер"
                people.append(person)
        return people, enriched_count

    prefix_end = matches[0].start() if matches else len(text)
    prefix = text[:prefix_end]
    if len(name_start_matches(prefix)) >= 2:
        for piece in split_people_block(prefix, people_reference):
            person = parse_person(piece)
            if person:
                person, enriched = enrich_person_from_reference(person, people_reference)
                has_initials = any(quality.is_initials_token(part) for part in quality.name_parts(person["name"]))
                if has_initials and people_reference is not None and not enriched:
                    continue
                if enriched:
                    enriched_count += 1
                person["role"] = "Спикер"
                people.append(person)
    return people, enriched_count


def detect_format(cell, description):
    text = inline_text(description) or inline_text(cell)
    text = re.sub(r"\S+\.(?:docx|doc|pdf|pptx|xlsx)", " ", text, flags=re.IGNORECASE)
    text = re.split(r"(?i)(?:^|\s)Тема\s*:", text, maxsplit=1)[0]
    return inline_text(text).strip(" -—")


def graphic_type(cell):
    text = inline_text(cell).lower()
    if "мастер-класс" in text or "программа по выбору" in text:
        return "card"
    return "badge"


def merge_person(people_by_key, people_aliases, person, source_cell):
    alias = person_alias_key(person["name"])
    key = people_aliases.get(alias, person["normalized_name"]) if alias else person["normalized_name"]
    if key not in people_by_key:
        people_by_key[key] = {
            "person_id": stable_id("person", key),
            "ФИО спикера": person["name"],
            "normalized_name": key,
            "positions": [],
            "source_cells": [],
            "Фото на плашку": "",
        }
        if alias:
            people_aliases[alias] = key
    item = people_by_key[key]
    if person_name_quality(person["name"]) > person_name_quality(item["ФИО спикера"]):
        item["ФИО спикера"] = person["name"]
        item["normalized_name"] = normalize_person_name(person["name"])
    if person["position"] and person["position"] not in item["positions"]:
        item["positions"].append(person["position"])
    if source_cell not in item["source_cells"]:
        item["source_cells"].append(source_cell)
    return item


def build_records(rows, days=None, people_reference=None, reference_warning=""):
    layout = detect_layout(rows)
    time_column = layout["time_column"]
    venues = venues_from_rows(rows, layout)
    venue_by_index = {item["column_index"]: item for item in venues}
    allowed_days = day_filter_keys(days)
    current_day = {"day": "", "date": ""}
    found_days = []
    found_time_rows = 0

    topics_by_key = {}
    sessions_by_key = {}
    people_by_key = {}
    people_aliases = {}
    session_people_by_key = {}
    warnings = []
    ignored_content_cells = 0
    duplicate_people_hits = 0
    people_ref_matches = 0

    for row_number, row in enumerate(rows, start=1):
        parsed_day = None
        for value in row:
            parsed_day = parse_day(value)
            if parsed_day:
                current_day = parsed_day
                found_days.append("{} {}".format(parsed_day["day"], parsed_day["date"]))
                break
        if parsed_day:
            continue
        if not current_day["day"]:
            continue
        if allowed_days and normalize_key(current_day["day"]) not in allowed_days and normalize_key(current_day["date"]) not in allowed_days:
            continue

        time_value = inline_text(row[time_column] if time_column < len(row) else "")
        if not is_time(time_value):
            continue
        found_time_rows += 1
        time_label, time_start, time_end = split_time(time_value)

        for column_index, cell in enumerate(row):
            if column_index <= time_column or not is_content_cell(cell):
                continue
            venue = venue_by_index.get(column_index)
            source_cell = "row {}, col {}".format(row_number, chr(ord("A") + column_index))
            if not venue:
                ignored_content_cells += 1
                continue

            topic_title, description = extract_topic_and_description(cell)
            people, enriched_count = extract_people(cell, people_reference)
            people_ref_matches += enriched_count
            if not topic_title and not people:
                continue

            topic_key = normalize_key(topic_title)
            topic_id = stable_id("topic", topic_key)
            if topic_title and topic_key not in topics_by_key:
                topics_by_key[topic_key] = {
                    "topic_id": topic_id,
                    "ТЕМА": topic_title,
                    "ОПИСАНИЕ": description,
                    "ИСХОДНАЯ_ЯЧЕЙКА": source_cell,
                }

            session_key = "|".join([current_day["day"], current_day["date"], time_start, time_end, venue["venue_id"], topic_key])
            session_id = stable_id("session", session_key)
            if session_key not in sessions_by_key:
                sessions_by_key[session_key] = {
                    "session_id": session_id,
                    "topic_id": topic_id if topic_title else "",
                    "ДЕНЬ": current_day["day"],
                    "ДАТА": current_day["date"],
                    "ВРЕМЯ": time_label,
                    "НАЧАЛО": time_start,
                    "КОНЕЦ": time_end,
                    "venue_id": venue["venue_id"],
                    "ПЛОЩАДКА": venue["name"],
                    "ФОРМАТ": detect_format(cell, description),
                    "ТИП_ГРАФИКИ": graphic_type(cell),
                    "ИСХОДНАЯ_ЯЧЕЙКА": source_cell,
                }

            for person in people:
                alias = person_alias_key(person["name"])
                person_key = people_aliases.get(alias, person["normalized_name"]) if alias else person["normalized_name"]
                existed = person_key in people_by_key
                merged_person = merge_person(people_by_key, people_aliases, person, source_cell)
                if existed:
                    duplicate_people_hits += 1
                relation_key = "|".join([session_id, merged_person["person_id"], normalize_key(person["role"])])
                if relation_key in session_people_by_key:
                    continue
                needs_card = sessions_by_key[session_key]["ТИП_ГРАФИКИ"] == "card"
                session_people_by_key[relation_key] = {
                    "session_id": session_id,
                    "person_id": merged_person["person_id"],
                    "ФИО спикера": merged_person["ФИО спикера"],
                    "РОЛЬ": person["role"],
                    "Должность": person["position"],
                    "badge_needed": "1",
                    "card_needed": "1" if needs_card else "0",
                    "ИСХОДНАЯ_ЯЧЕЙКА": source_cell,
                }

    topics = list(topics_by_key.values())
    sessions = list(sessions_by_key.values())
    people = []
    for item in people_by_key.values():
        people.append({
            "person_id": item["person_id"],
            "ФИО спикера": item["ФИО спикера"],
            "normalized_name": item["normalized_name"],
            "Должность": " | ".join(item["positions"]),
            "Фото на плашку": item["Фото на плашку"],
            "ИСХОДНЫЕ_ЯЧЕЙКИ": " | ".join(item["source_cells"]),
        })
    session_people = list(session_people_by_key.values())

    sessions_by_id = {row["session_id"]: row for row in sessions}
    people_by_id = {row["person_id"]: row for row in people_by_key.values()}
    badges_by_key = {}
    for relation in session_people:
        if relation["badge_needed"] != "1":
            continue
        badge_key = "{}|{}".format(relation["session_id"], relation["person_id"])
        if badge_key in badges_by_key:
            continue
        session = sessions_by_id.get(relation["session_id"], {})
        person = people_by_id.get(relation["person_id"], {})
        badges_by_key[badge_key] = {
            "session_id": relation["session_id"],
            "person_id": relation["person_id"],
            "ДЕНЬ": session.get("ДЕНЬ", ""),
            "ДАТА": session.get("ДАТА", ""),
            "ВРЕМЯ": session.get("ВРЕМЯ", ""),
            "НАЧАЛО": session.get("НАЧАЛО", ""),
            "ПЛОЩАДКА": session.get("ПЛОЩАДКА", ""),
            "ФИО спикера": person.get("ФИО спикера", relation["ФИО спикера"]),
            "Должность": relation["Должность"] or " | ".join(person.get("positions", [])),
            "Фото на плашку": person.get("Фото на плашку", ""),
        }
    badges = list(badges_by_key.values())
    cards = []
    card_person_ids = {row["person_id"] for row in session_people if row["card_needed"] == "1"}
    for item in people_by_key.values():
        if item["person_id"] in card_person_ids:
            positions = " | ".join(item["positions"])
            cards.append({
                "person_id": item["person_id"],
                "ФИО спикера": item["ФИО спикера"],
                "Должность": positions,
                "Фото на плашку": item["Фото на плашку"],
                "card_status": "missing_photo" if not item["Фото на плашку"] else "ready",
                "card_warning": "Нет фото: загрузите фото или создайте черновик" if not item["Фото на плашку"] else "",
            })

    duplicate_people = max(0, duplicate_people_hits)
    if ignored_content_cells:
        warnings.append("Игнорированы ячейки вне строгих площадок B/C/D: {}".format(ignored_content_cells))
    if reference_warning:
        warnings.append(reference_warning)
    if people_reference is not None and people_ref_matches == 0:
        warnings.append("Справочник ФИО подключен, но совпадений по инициалам не найдено.")
    if not cards:
        warnings.append("Визитки не найдены или не требуются по строгим площадкам B/C/D.")
    elif any(row["card_status"] == "missing_photo" for row in cards):
        warnings.append("Есть визитки без фото: {}".format(sum(1 for row in cards if row["card_status"] == "missing_photo")))

    report = {
        "sessions_found": len(sessions),
        "topics_found": len(topics),
        "people_found": len(session_people),
        "unique_people": len(people),
        "duplicates_merged": duplicate_people,
        "badges": len(badges),
        "cards": len(cards),
        "cards_ready": sum(1 for row in cards if row["card_status"] == "ready"),
        "cards_missing_photo": sum(1 for row in cards if row["card_status"] == "missing_photo"),
        "venues": len(venues),
        "ignored_non_bcd_cells": ignored_content_cells,
        "time_column": time_column + 1,
        "days": found_days,
        "time_rows": found_time_rows,
        "people_ref_matches": people_ref_matches,
        "warnings": warnings,
    }
    return {
        "venues": [{"venue_id": item["venue_id"], "source_column": item["source_column"], "ПЛОЩАДКА": item["name"], "ЦВЕТ": item["color"]} for item in venues],
        "topics": topics,
        "sessions": sessions,
        "people": people,
        "session_people": session_people,
        "badges": badges,
        "cards": cards,
        "report": report,
    }


def legacy_sessions(records):
    topics_by_id = {row["topic_id"]: row for row in records["topics"]}
    rows = []
    for session in records["sessions"]:
        topic = topics_by_id.get(session["topic_id"], {})
        rows.append({
            "ДЕНЬ": session["ДЕНЬ"],
            "ДАТА": session["ДАТА"],
            "ВРЕМЯ": session["ВРЕМЯ"],
            "ПЛОЩАДКА": session["ПЛОЩАДКА"],
            "ТЕМА": topic.get("ТЕМА", ""),
            "ОПИСАНИЕ": topic.get("ОПИСАНИЕ", ""),
            "ТИП": session["ФОРМАТ"],
            COMP_NAME_HEADER: session_comp_name(session["ПЛОЩАДКА"], topic.get("ТЕМА", "")),
            "ИСХОДНАЯ_ЯЧЕЙКА": session["ИСХОДНАЯ_ЯЧЕЙКА"],
        })
    return rows


def write_tsv(path, fieldnames, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, delimiter="\t", lineterminator="\n", extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def output_file_specs(records):
    return [
        ("content_plan_venues.tsv", VENUE_FIELDS, records["venues"]),
        ("content_plan_topics.tsv", TOPIC_FIELDS, records["topics"]),
        ("content_plan_sessions_model.tsv", SESSION_MODEL_FIELDS, records["sessions"]),
        ("content_plan_session_people.tsv", SESSION_PEOPLE_FIELDS, records["session_people"]),
        ("content_plan_people.tsv", PEOPLE_FIELDS, records["people"]),
        ("content_plan_badges.tsv", BADGE_FIELDS, records["badges"]),
        ("content_plan_cards_model.tsv", CARD_FIELDS, records["cards"]),
        ("content_plan_sessions.tsv", LEGACY_SESSION_FIELDS, records["legacy_sessions"]),
        ("content_plan_plates.tsv", BADGE_FIELDS, records["badges"]),
        ("content_plan_cards.tsv", CARD_FIELDS, records["cards"]),
        ("content_plan_all_people.tsv", PEOPLE_FIELDS, records["people"]),
    ]


def write_records_atomically(output_dir, records, report):
    """Keep the previous export intact until every next file is ready."""
    staging_dir = Path(tempfile.mkdtemp(prefix=".content_plan_stage_", dir=str(output_dir.parent)))
    try:
        for name, fields, rows in output_file_specs(records):
            write_tsv(staging_dir / name, fields, rows)
        write_json(staging_dir / "import_report.json", report)
        for name, _fields, _rows in output_file_specs(records):
            os.replace(staging_dir / name, output_dir / name)
        os.replace(staging_dir / "import_report.json", output_dir / "import_report.json")
    finally:
        shutil.rmtree(staging_dir, ignore_errors=True)


def validate_output_dir(path):
    parent = path.parent
    if not parent.exists():
        raise UserFacingError("Родительская папка для результата не существует: {}".format(parent))
    if path.exists() and not path.is_dir():
        raise UserFacingError("Путь результата уже существует и не является папкой: {}".format(path))


def parse_args(argv):
    parser = argparse.ArgumentParser(description="Забирает готовые AE-ready вкладки из нормализованной Google Sheet и сохраняет совместимые TSV для AE.")
    parser.add_argument("source", nargs="?", default="", help="Ссылка на AE-ready Google Sheet или локальная папка с вкладками content_plan_*.tsv/csv.")
    parser.add_argument("-o", "--output-dir", default=str(DEFAULT_OUTPUT_DIR), help="Папка для результатов.")
    parser.add_argument("--day", action="append", default=[], help="Оставить только день или дату, например 'ДЕНЬ 3', '3' или '22.07'. Можно указать несколько раз.")
    parser.add_argument("--delimiter", choices=["auto", "tab", "comma", "semicolon"], default="auto")
    parser.add_argument("--people-ref-url", default=DEFAULT_PEOPLE_REF_URL, help="Устаревший параметр, сохранен для совместимости.")
    parser.add_argument("--no-people-ref", action="store_true", help="Устаревший параметр, сохранен для совместимости.")
    parser.add_argument("--status-json", default="", help="Служебный JSON-отчет для After Effects, UTF-8.")
    return parser.parse_args(argv)


def status_path_arg(value):
    text = str(value or "").strip()
    return local_path_arg(text) if text else None


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def write_status(path, data):
    if path:
        write_json(path, data)


def stable_records_hash(records):
    payload = {
        "venues": records["venues"],
        "topics": records["topics"],
        "sessions": records["sessions"],
        "people": records["people"],
        "session_people": records["session_people"],
        "badges": records["badges"],
        "cards": records["cards"],
        "legacy_sessions": legacy_sessions(records),
    }
    text = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def filter_rows_by_day(rows, allowed_days):
    if not allowed_days:
        return list(rows)
    filtered = []
    for row in rows:
        day_key = normalize_key(row.get("ДЕНЬ", ""))
        date_key = normalize_key(row.get("ДАТА", ""))
        if day_key in allowed_days or date_key in allowed_days:
            filtered.append(row)
    return filtered


def read_ae_ready_tab_from_sheet(url, sheet_name):
    raw_text, resolved = fetch_first_available_text(
        google_sheet_tab_urls(url, sheet_name),
        "Не удалось скачать вкладку '{}' из AE-ready таблицы".format(sheet_name),
    )
    if "<html" in raw_text[:1000].lower() or "<!doctype html" in raw_text[:1000].lower():
        raise UserFacingError("Вкладка '{}' вернула HTML вместо CSV/TSV.".format(sheet_name))
    return row_dicts_from_text(raw_text), resolved, raw_text


def read_ae_ready_tab_from_directory(directory, sheet_name):
    for suffix in ("tsv", "csv"):
        path = directory / "{}.{}".format(sheet_name, suffix)
        if path.exists():
            raw_text = path.read_text(encoding="utf-8-sig")
            return row_dicts_from_text(raw_text), str(path), raw_text
    return None, "", ""


def load_ae_ready_source(source):
    text = str(source or "").strip()
    if not text:
        raise UserFacingError("Укажи ссылку на AE-ready Google Sheet или папку с выгруженными вкладками.")

    if re.match(r"^https?://", text, re.IGNORECASE):
        if not is_google_sheet_url(text):
            raise UserFacingError("Нужна ссылка именно на AE-ready Google Sheet.")
        tabs = {}
        resolved_sources = {}
        source_texts = {}
        for sheet_name in list(AE_READY_REQUIRED_TABS.keys()) + list(AE_READY_OPTIONAL_TABS.keys()):
            try:
                rows, resolved, raw_text = read_ae_ready_tab_from_sheet(text, sheet_name)
            except UserFacingError:
                if sheet_name in AE_READY_REQUIRED_TABS:
                    raise
                continue
            tabs[sheet_name] = rows
            resolved_sources[sheet_name] = resolved
            source_texts[sheet_name] = raw_text
        return {"tabs": tabs, "resolved_sources": resolved_sources, "source_texts": source_texts}

    directory = local_path_arg(text)
    if not directory.is_dir():
        raise UserFacingError("Теперь источник должен быть AE-ready Google Sheet или папка с файлами content_plan_*.tsv/csv.")
    tabs = {}
    resolved_sources = {}
    source_texts = {}
    for sheet_name in list(AE_READY_REQUIRED_TABS.keys()) + list(AE_READY_OPTIONAL_TABS.keys()):
        rows, resolved, raw_text = read_ae_ready_tab_from_directory(directory, sheet_name)
        if rows is None:
            if sheet_name in AE_READY_REQUIRED_TABS:
                raise UserFacingError(
                    "В папке '{}' не найден обязательный файл '{}.tsv' или '{}.csv'.".format(directory, sheet_name, sheet_name)
                )
            continue
        tabs[sheet_name] = rows
        resolved_sources[sheet_name] = resolved
        source_texts[sheet_name] = raw_text
    return {"tabs": tabs, "resolved_sources": resolved_sources, "source_texts": source_texts}


def derive_topics_from_legacy_sessions(rows):
    topics = []
    seen = set()
    for row in rows:
        topic = inline_text(row.get("ТЕМА", ""))
        key = normalize_key(topic)
        if not topic or key in seen:
            continue
        seen.add(key)
        topics.append({
            "topic_id": stable_id("topic", key),
            "ТЕМА": topic,
            "ОПИСАНИЕ": inline_text(row.get("ОПИСАНИЕ", "")),
            "ИСХОДНАЯ_ЯЧЕЙКА": inline_text(row.get("ИСХОДНАЯ_ЯЧЕЙКА", "")),
        })
    return topics


def derive_sessions_model_from_legacy(rows):
    topics = derive_topics_from_legacy_sessions(rows)
    topic_map = {normalize_key(item["ТЕМА"]): item["topic_id"] for item in topics}
    sessions = []
    for row in rows:
        topic_key = normalize_key(row.get("ТЕМА", ""))
        time_label, time_start, time_end = split_time(row.get("ВРЕМЯ", ""))
        session_key = "|".join([
            inline_text(row.get("ДЕНЬ", "")),
            inline_text(row.get("ДАТА", "")),
            time_start,
            time_end,
            normalize_key(row.get("ПЛОЩАДКА", "")),
            topic_key,
        ])
        sessions.append({
            "session_id": stable_id("session", session_key),
            "topic_id": topic_map.get(topic_key, ""),
            "ДЕНЬ": inline_text(row.get("ДЕНЬ", "")),
            "ДАТА": inline_text(row.get("ДАТА", "")),
            "ВРЕМЯ": time_label,
            "НАЧАЛО": time_start,
            "КОНЕЦ": time_end,
            "venue_id": stable_id("venue", row.get("ПЛОЩАДКА", "")),
            "ПЛОЩАДКА": inline_text(row.get("ПЛОЩАДКА", "")),
            "ФОРМАТ": inline_text(row.get("ТИП", "")),
            "ТИП_ГРАФИКИ": "card" if "мастер-класс" in inline_text(row.get("ТИП", "")).lower() else "badge",
            "ИСХОДНАЯ_ЯЧЕЙКА": inline_text(row.get("ИСХОДНАЯ_ЯЧЕЙКА", "")),
        })
    return sessions


def derive_people_from_badges_and_cards(badges, cards):
    people_by_key = {}
    for row in list(badges) + list(cards):
        name = inline_text(row.get("ФИО спикера", ""))
        if not name:
            continue
        key = normalize_key(name)
        item = people_by_key.get(key)
        if not item:
            item = {
                "person_id": row.get("person_id") or stable_id("person", key),
                "ФИО спикера": name,
                "normalized_name": key,
                "Должность": inline_text(row.get("Должность", "")),
                "Фото на плашку": inline_text(row.get("Фото на плашку", "")),
                "ИСХОДНЫЕ_ЯЧЕЙКИ": "",
            }
            people_by_key[key] = item
        elif not item["Должность"] and inline_text(row.get("Должность", "")):
            item["Должность"] = inline_text(row.get("Должность", ""))
        if not item["Фото на плашку"] and inline_text(row.get("Фото на плашку", "")):
            item["Фото на плашку"] = inline_text(row.get("Фото на плашку", ""))
    return list(people_by_key.values())


def derive_session_people_from_badges(badges, people):
    person_id_by_key = {normalize_key(row.get("ФИО спикера", "")): row.get("person_id", "") for row in people}
    rows = []
    for badge in badges:
        name = inline_text(badge.get("ФИО спикера", ""))
        if not name:
            continue
        rows.append({
            "session_id": badge.get("session_id", ""),
            "person_id": badge.get("person_id") or person_id_by_key.get(normalize_key(name), stable_id("person", name)),
            "ФИО спикера": name,
            "РОЛЬ": "Спикер",
            "Должность": inline_text(badge.get("Должность", "")),
            "badge_needed": "1",
            "card_needed": "0",
            "ИСХОДНАЯ_ЯЧЕЙКА": "",
        })
    return rows


def derive_venues_from_sessions(sessions):
    venues = []
    seen = set()
    for row in sessions:
        venue = inline_text(row.get("ПЛОЩАДКА", ""))
        key = normalize_key(venue)
        if not venue or key in seen:
            continue
        seen.add(key)
        venues.append({
            "venue_id": row.get("venue_id") or stable_id("venue", key),
            "source_column": "",
            "ПЛОЩАДКА": venue,
            "ЦВЕТ": "",
        })
    return venues


def parse_import_report_rows(rows):
    report = {}
    for row in rows:
        key = inline_text(row.get("key", ""))
        value = str(row.get("value", "")).strip()
        if not key:
            continue
        try:
            report[key] = json.loads(value)
        except Exception:
            report[key] = value
    return report


def load_records_from_ae_ready(ae_ready, days):
    tabs = ae_ready["tabs"]
    allowed_days = day_filter_keys(days)
    legacy_sessions = filter_rows_by_day(tabs.get("content_plan_sessions", []), allowed_days)
    for row in legacy_sessions:
        row[COMP_NAME_HEADER] = session_comp_name(row.get("ПЛОЩАДКА", ""), row.get("ТЕМА", ""))
    badges = filter_rows_by_day(tabs.get("content_plan_plates", []), allowed_days)
    cards = filter_rows_by_day(tabs.get("content_plan_cards", []), allowed_days)
    topics = filter_rows_by_day(tabs.get("content_plan_topics_model", []), allowed_days) if tabs.get("content_plan_topics_model") else derive_topics_from_legacy_sessions(legacy_sessions)
    sessions = filter_rows_by_day(tabs.get("content_plan_sessions_model", []), allowed_days) if tabs.get("content_plan_sessions_model") else derive_sessions_model_from_legacy(legacy_sessions)
    people = tabs.get("content_plan_all_people", []) or derive_people_from_badges_and_cards(badges, cards)
    session_people = filter_rows_by_day(tabs.get("content_plan_session_people", []), allowed_days) if tabs.get("content_plan_session_people") else derive_session_people_from_badges(badges, people)
    if tabs.get("content_plan_all_people"):
        allowed_person_ids = {row.get("person_id", "") for row in session_people if row.get("person_id", "")}
        allowed_names = {normalize_key(row.get("ФИО спикера", "")) for row in session_people if normalize_key(row.get("ФИО спикера", ""))}
        people = [
            row for row in people
            if row.get("person_id", "") in allowed_person_ids or normalize_key(row.get("ФИО спикера", "")) in allowed_names
        ] if allowed_person_ids or allowed_names else []
    warnings_rows = tabs.get("warnings", [])
    source_cells = filter_rows_by_day(tabs.get("source_cells", []), allowed_days) if tabs.get("source_cells") else []
    import_report = parse_import_report_rows(tabs.get("import_report", []))
    report_warnings = [inline_text(row.get("message", "")) for row in warnings_rows if inline_text(row.get("message", ""))]
    days_found = []
    for row in legacy_sessions:
        label = "{} {}".format(inline_text(row.get("ДЕНЬ", "")), inline_text(row.get("ДАТА", ""))).strip()
        if label and label not in days_found:
            days_found.append(label)
    report = {
        "sessions_found": len(legacy_sessions),
        "topics_found": len(topics),
        "people_found": len(session_people),
        "unique_people": len(people),
        "duplicates_merged": int(import_report.get("duplicates_merged", 0) or 0),
        "badges": len(badges),
        "cards": len(cards),
        "cards_ready": sum(1 for row in cards if inline_text(row.get("card_status", "")) == "ready"),
        "cards_missing_photo": sum(1 for row in cards if inline_text(row.get("card_status", "")) == "missing_photo"),
        "venues": len(derive_venues_from_sessions(sessions)),
        "ignored_non_bcd_cells": int(import_report.get("ignored_non_bcd_cells", 0) or 0),
        "time_column": import_report.get("time_column", ""),
        "days": days_found,
        "time_rows": int(import_report.get("time_rows", 0) or 0),
        "people_ref_matches": int(import_report.get("people_ref_matches", 0) or 0),
        "warnings": report_warnings,
    }
    return {
        "venues": derive_venues_from_sessions(sessions),
        "topics": topics,
        "sessions": sessions,
        "people": people,
        "session_people": session_people,
        "badges": badges,
        "cards": cards,
        "legacy_sessions": legacy_sessions,
        "report": report,
        "warnings_rows": warnings_rows,
        "source_cells": source_cells,
    }


def main(argv):
    status_path = None
    try:
        args = parse_args(argv)
        status_path = status_path_arg(args.status_json)
        ae_ready = load_ae_ready_source(args.source)
        records = load_records_from_ae_ready(ae_ready, args.day)
        report = records["report"]
        source_hash_payload = "".join(ae_ready["source_texts"].get(name, "") for name in sorted(ae_ready["source_texts"].keys()))
        report["people_ref_sources"] = []
        report["source_hash"] = hashlib.sha256(source_hash_payload.encode("utf-8")).hexdigest()
        report["data_hash"] = stable_records_hash(records)
        if not records["sessions"] and not records["people"] and not records["badges"]:
            day_hint = ", ".join(report["days"][:8]) if report["days"] else "дни не найдены"
            filter_hint = " Фильтр дня: {}.".format(", ".join(args.day)) if args.day else ""
            raise UserFacingError(
                "Не найдено ни одной строки в нормализованной AE-ready таблице. Найденные дни: {}.{} "
                "Проверь ссылку на AE-ready таблицу, названия вкладок и фильтр дня.".format(day_hint, filter_hint)
            )

        output_dir = local_path_arg(args.output_dir)
        validate_output_dir(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        write_records_atomically(output_dir, records, report)

        print("SOURCE: {}".format(args.source))
        print("OUTPUT: {}".format(output_dir))
        print("LAYOUT: ae_ready_tabs={}, time_column={}".format(",".join(sorted(ae_ready["tabs"].keys())), report["time_column"]))
        print(
            "SUCCESS: topics={}, sessions={}, unique_people={}, badges={}, cards={}, duplicates_merged={}".format(
                report["topics_found"], report["sessions_found"], report["unique_people"], report["badges"], report["cards"], report["duplicates_merged"]
            )
        )
        for warning in report["warnings"]:
            print("WARNING: {}".format(warning))

        status = {
            "ok": True,
            "source": args.source,
            "output": str(output_dir),
            "sessions": report["sessions_found"],
            "plates": report["badges"],
            "cards": report["cards"],
            "people_total": report["people_found"],
            "unique_people": report["unique_people"],
            "duplicates_merged": report["duplicates_merged"],
            "cards_missing_photo": report["cards_missing_photo"],
            "people_ref_matches": report["people_ref_matches"],
            "people_ref_sources_ok": 0,
            "people_ref_sources_total": 0,
            "days": report["days"],
            "warnings": report["warnings"],
            "source_hash": report["source_hash"],
            "data_hash": report["data_hash"],
            "message": "Готово: темы {}, сессии {}, уникальные люди {}, плашки {}, визитки {}.".format(
                report["topics_found"], report["sessions_found"], report["unique_people"], report["badges"], report["cards"]
            ),
        }
        write_status(status_path, status)
        return 0
    except UserFacingError as exc:
        print("ERROR: {}".format(exc), file=sys.stderr)
        write_status(status_path, {"ok": False, "error": str(exc)})
        return 1
    except Exception as exc:
        print("ERROR: {}".format(exc), file=sys.stderr)
        write_status(status_path, {"ok": False, "error": str(exc)})
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
