# -*- coding: utf-8 -*-
import argparse
import csv
import hashlib
import io
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


DEFAULT_URL = "https://docs.google.com/spreadsheets/d/10C3eoaG146WgOeQeoli90dQCHPruoJ_d4_rqcyoUR8M/edit?gid=213088400#gid=213088400"
DEFAULT_PEOPLE_REF_URL = "https://docs.google.com/spreadsheets/d/1J6nJHM4wXF66LJO7dDNT6QgrxlQ5VPb-3B-4o7Ff0js/edit?gid=1399617264#gid=1399617264"
DEFAULT_OUTPUT_DIR = Path.home() / "Documents" / "ae_plaque_data" / "content_plan"
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

ROLE_RE = re.compile(r"(?is)(Эксперты?|Эксперт|Гости|Спикеры?|Спикер|Модератор|Ведущий)\s*:\s*")
NAME_START_RE = re.compile(
    r"(?=(?:^|\s)((?:[А-ЯЁA-Z]\.\s*){1,3}[А-ЯЁ][а-яё-]+|[А-ЯЁ][а-яё-]+\s+[А-ЯЁ][а-яё-]+\s+[А-ЯЁ][а-яё-]+(?=\s*,)))"
)
STOP_RE = re.compile(
    r"(?is)(?:^|\s)(?:▶\s*)?(?:Статус|Модератор|Ведущий|СЦЕНАРИЙ(?:\s+ДЛЯ\s+РПГ)?|ЗАЛ|СЕТАП|РАЙДЕР|КОНТЕНТ|ВОЛОНТЕРЫ|Техзапрос|Техзадание|Место)\s*:"
)
SERVICE_RE = re.compile(r"(?i)^(перерыв|обед|ужин|завтрак|зарядка|отъезд|подъ[её]м|рефлексия|креатон(?:\s*-.*)?|\d+)$")


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
    return path.read_text(encoding="utf-8-sig"), str(path)


def guess_delimiter(text):
    sample = text[:8192]
    try:
        return csv.Sniffer().sniff(sample, delimiters="\t,;").delimiter
    except csv.Error:
        first = sample.splitlines()[0] if sample.splitlines() else ""
        counts = {"\t": first.count("\t"), ",": first.count(","), ";": first.count(";")}
        return max(counts, key=counts.get) if max(counts.values()) else "\t"


def parse_table_rows(text, delimiter="auto"):
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


def build_people_reference(text):
    lookup = {}
    for row in row_dicts_from_text(text):
        full_name = get_by_normalized_column(row, ["ФИО", "ФИО спикера", "Имя", "Name"])
        position = get_by_normalized_column(row, ["Должность", "Регалии", "Position"])
        if not full_name:
            continue
        keys = {normalize_person_name(full_name), initials_surname_key(full_name)}
        for key in keys:
            if key:
                lookup[key] = {"name": full_name, "position": position}
    return lookup


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
    text = inline_text(value)
    compact_match = re.match(r"^((?:[А-ЯЁA-Z]\.\s*){1,3})([А-ЯЁA-Z][а-яё-]+)$", text)
    if compact_match:
        initials = re.sub(r"[^A-ZА-ЯЁ]", "", compact_match.group(1).upper())
        surname = compact_match.group(2)
        if initials and surname:
            return normalize_lookup_token(initials[:2] + " " + surname)

    parts = name_word_parts(text)
    if not parts:
        return ""

    initials = []
    words = []
    for part in parts:
        letters = re.sub(r"[^A-ZА-ЯЁ]", "", part.upper())
        if re.fullmatch(r"(?:[A-ZА-ЯЁ]\.?){1,3}", part.upper()) and letters:
            initials.extend(list(letters))
        else:
            words.append(part)

    if initials and words:
        return normalize_lookup_token("".join(initials[:2]) + " " + words[-1])

    if len(words) >= 2:
        surname = words[0]
        first = words[1]
        patronymic = words[2] if len(words) >= 3 else ""
        short = first[:1] + patronymic[:1]
        if short:
            return normalize_lookup_token(short + " " + surname)
    return ""


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
    if not title:
        return ""
    venue = clean_venue_header(venue_name)
    return "{}/{}".format(venue, title) if venue else title


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
    text = inline_text(value)
    text = re.sub(r"^[«\"'“”„]+|[»\"'“”„]+$", "", text)
    return text.strip(" -—")


def strip_file_tokens(text):
    text = re.sub(r"\S+\.(?:docx|doc|pdf|pptx|xlsx)", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"СЦЕНАРИЙ\s+ДЛЯ\s+РПГ\s*:\s*\S+", " ", text, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", text).strip()


def extract_topic_and_description(cell):
    text = inline_text(cell)
    topic_match = re.search(
        r"(?is)(?:^|\s)Тема\s*:\s*(.+?)(?=\s+(?:Эксперты?|Гости|Спикеры?|Эксперт|Модератор|Ведущий|СЦЕНАРИЙ(?:\s+ДЛЯ\s+РПГ)?|ЗАЛ|СЕТАП|РАЙДЕР|КОНТЕНТ)\s*:|$)",
        text,
    )
    if topic_match:
        topic = clean_topic(topic_match.group(1))
        description = strip_file_tokens(text[: topic_match.start()]).strip(" -—")
        return topic, description

    first_role = ROLE_RE.search(text)
    head = text[: first_role.start()] if first_role else text
    head = strip_file_tokens(head).strip(" -—")
    quote = re.search(r"«([^»\n]{8,})»", head) or re.search(r"\"([^\"\n]{8,})\"", head)
    if quote:
        return clean_topic(quote.group(1)), head
    if first_role and len(head) > 10 and not SERVICE_RE.match(head):
        return clean_topic(head), head
    return "", ""


def is_content_cell(cell):
    text = inline_text(cell)
    if not text or SERVICE_RE.match(text):
        return False
    if ROLE_RE.search(text) or re.search(r"(?i)(?:^|\s)Тема\s*:", text):
        return True
    return False


def split_people_block(block):
    text = inline_text(block)
    text = STOP_RE.split(text, maxsplit=1)[0]
    text = re.sub(r"\((?:подтвержден[аы]?|уточняется)\)", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+-\s+ПРЕЗЕНТАЦИ[ЯИ].*?(?=(?:[А-ЯЁA-Z]\.)|$)", " ", text)
    starts = [match.start(1) for match in NAME_START_RE.finditer(text)]
    if len(starts) <= 1:
        return [text.strip(" ;.-")] if text.strip(" ;.-") else []
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
        elif not first and not re.fullmatch(r"(?:[A-ZА-ЯЁ]\.?){1,3}", clean.upper()):
            first = clean
    if not surname:
        surname = parts[0]
    if not first:
        first = parts[1]
    initial_match = re.search(r"[A-ZА-ЯЁ]", first.upper())
    return normalize_lookup_token("{} {}".format(surname, initial_match.group(0) if initial_match else ""))


def person_name_quality(value):
    parts = name_word_parts(value)
    full_parts = [part for part in parts if not re.fullmatch(r"(?:[A-ZА-ЯЁ]\.?){1,3}", part.upper())]
    initial_parts = [part for part in parts if re.fullmatch(r"(?:[A-ZА-ЯЁ]\.?){1,3}", part.upper())]
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
    name = re.sub(r"^[▶\s]+", "", inline_text(name)).strip(" .,-")
    position = inline_text(position).strip(" .,-")
    key = normalize_person_name(name)
    if len(name) < 3 or key in ("фио", "изкомандымодераторов"):
        return None
    return {"name": name, "position": position, "normalized_name": key}


def enrich_person_from_reference(person, people_reference):
    if not people_reference:
        return person, False
    keys = [initials_surname_key(person["name"]), person["normalized_name"]]
    for key in keys:
        ref = people_reference.get(key) if key else None
        if not ref:
            continue
        enriched = dict(person)
        if ref.get("name"):
            enriched["name"] = ref["name"]
            enriched["normalized_name"] = normalize_person_name(ref["name"])
        if ref.get("position"):
            enriched["position"] = ref["position"]
        return enriched, True
    return person, False


def extract_people(cell, people_reference=None):
    text = inline_text(cell)
    people = []
    enriched_count = 0
    matches = list(ROLE_RE.finditer(text))
    for index, match in enumerate(matches):
        role = match.group(1)
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        for piece in split_people_block(text[start:end]):
            person = parse_person(piece)
            if person:
                person, enriched = enrich_person_from_reference(person, people_reference)
                if enriched:
                    enriched_count += 1
                person["role"] = role
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


def validate_output_dir(path):
    parent = path.parent
    if not parent.exists():
        raise UserFacingError("Родительская папка для результата не существует: {}".format(parent))
    if path.exists() and not path.is_dir():
        raise UserFacingError("Путь результата уже существует и не является папкой: {}".format(path))


def parse_args(argv):
    parser = argparse.ArgumentParser(description="Достает из программной таблицы модель topics/sessions/people/badges/cards и совместимые TSV для AE.")
    parser.add_argument("source", nargs="?", default=DEFAULT_URL, help="Google Sheet URL, export TSV/CSV URL или локальный TSV/CSV/TXT.")
    parser.add_argument("-o", "--output-dir", default=str(DEFAULT_OUTPUT_DIR), help="Папка для результатов.")
    parser.add_argument("--day", action="append", default=[], help="Оставить только день или дату, например 'ДЕНЬ 3', '3' или '22.07'. Можно указать несколько раз.")
    parser.add_argument("--delimiter", choices=["auto", "tab", "comma", "semicolon"], default="auto")
    parser.add_argument("--people-ref-url", default=DEFAULT_PEOPLE_REF_URL, help="Google Sheet/TSV справочник с колонками ФИО и Должность для расшифровки инициалов.")
    parser.add_argument("--no-people-ref", action="store_true", help="Не использовать справочник ФИО/Должность.")
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


def main(argv):
    status_path = None
    try:
        args = parse_args(argv)
        status_path = status_path_arg(args.status_json)
        text, resolved_source = read_source(args.source)
        if len(text.splitlines()) < 3:
            raise UserFacingError("Источник похож на пустой файл.")
        if "<html" in text[:1000].lower() or "<!doctype html" in text[:1000].lower():
            raise UserFacingError("Google вернул HTML, а не TSV. Проверь доступ к таблице по ссылке.")

        rows = parse_table_rows(text, args.delimiter)
        people_reference = None
        reference_warning = ""
        if not args.no_people_ref and str(args.people_ref_url or "").strip():
            try:
                ref_text, _resolved_ref = read_source(args.people_ref_url)
                people_reference = build_people_reference(ref_text)
                if not people_reference:
                    reference_warning = "Справочник ФИО загружен, но в нем не найдены колонки ФИО/Должность или строки людей."
            except Exception as ref_exc:
                reference_warning = "Не удалось загрузить справочник ФИО/Должность: {}".format(ref_exc)
        records = build_records(rows, args.day, people_reference, reference_warning)
        report = records["report"]
        report["source_hash"] = hashlib.sha256(text.encode("utf-8")).hexdigest()
        report["data_hash"] = stable_records_hash(records)
        if not records["sessions"] and not records["people"] and not records["badges"]:
            day_hint = ", ".join(report["days"][:8]) if report["days"] else "дни не найдены"
            filter_hint = " Фильтр дня: {}.".format(", ".join(args.day)) if args.day else ""
            raise UserFacingError(
                "Не найдено ни одной темы/персоны. Найдено строк времени: {}. Найденные дни: {}.{} "
                "Проверь лист, фильтр дня и наличие блоков 'Тема:', 'Эксперт:', 'Гости:' в колонках B/C/D.".format(
                    report["time_rows"], day_hint, filter_hint
                )
            )

        output_dir = local_path_arg(args.output_dir)
        validate_output_dir(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        write_tsv(output_dir / "content_plan_venues.tsv", VENUE_FIELDS, records["venues"])
        write_tsv(output_dir / "content_plan_topics.tsv", TOPIC_FIELDS, records["topics"])
        write_tsv(output_dir / "content_plan_sessions_model.tsv", SESSION_MODEL_FIELDS, records["sessions"])
        write_tsv(output_dir / "content_plan_session_people.tsv", SESSION_PEOPLE_FIELDS, records["session_people"])
        write_tsv(output_dir / "content_plan_people.tsv", PEOPLE_FIELDS, records["people"])
        write_tsv(output_dir / "content_plan_badges.tsv", BADGE_FIELDS, records["badges"])
        write_tsv(output_dir / "content_plan_cards_model.tsv", CARD_FIELDS, records["cards"])

        write_tsv(output_dir / "content_plan_sessions.tsv", LEGACY_SESSION_FIELDS, legacy_sessions(records))
        write_tsv(output_dir / "content_plan_plates.tsv", BADGE_FIELDS, records["badges"])
        write_tsv(output_dir / "content_plan_cards.tsv", CARD_FIELDS, records["cards"])
        write_tsv(output_dir / "content_plan_all_people.tsv", PEOPLE_FIELDS, records["people"])
        write_json(output_dir / "import_report.json", report)

        print("SOURCE: {}".format(resolved_source))
        print("OUTPUT: {}".format(output_dir))
        print("LAYOUT: strict_venues=B/C/D, time_column={}".format(report["time_column"]))
        print(
            "SUCCESS: topics={}, sessions={}, unique_people={}, badges={}, cards={}, duplicates_merged={}".format(
                report["topics_found"], report["sessions_found"], report["unique_people"], report["badges"], report["cards"], report["duplicates_merged"]
            )
        )
        for warning in report["warnings"]:
            print("WARNING: {}".format(warning))

        status = {
            "ok": True,
            "source": resolved_source,
            "output": str(output_dir),
            "sessions": report["sessions_found"],
            "plates": report["badges"],
            "cards": report["cards"],
            "people_total": report["people_found"],
            "unique_people": report["unique_people"],
            "duplicates_merged": report["duplicates_merged"],
            "cards_missing_photo": report["cards_missing_photo"],
            "people_ref_matches": report["people_ref_matches"],
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
