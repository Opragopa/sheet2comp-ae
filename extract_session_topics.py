# -*- coding: utf-8 -*-
import argparse
import csv
import io
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path


DEFAULT_TOPIC_HEADER = "ТЕМА"
DEFAULT_DESCRIPTION_HEADER = "ОПИСАНИЕ"
DEFAULT_COMP_NAME_HEADER = "ИМЯ_КОМПОЗИЦИИ"
PROGRAM_FIRST_COLUMN_INDEX = 1
PROGRAM_LAST_COLUMN_INDEX = 3
DEFAULT_VENUE_NAMES = {
    1: "Амфитеатр",
    2: "Урал 1",
    3: "Урал 2",
}


def google_sheet_export_url(url):
    parsed = urllib.parse.urlparse(url)
    if "docs.google.com" not in parsed.netloc or "/spreadsheets/d/" not in parsed.path:
        return url

    match = re.search(r"/spreadsheets/d/([^/]+)", parsed.path)
    if not match:
        return url

    query = urllib.parse.parse_qs(parsed.query)
    fragment = urllib.parse.parse_qs(parsed.fragment)
    gid = query.get("gid", fragment.get("gid", ["0"]))[0]
    sheet_id = match.group(1)
    return "https://docs.google.com/spreadsheets/d/{}/export?format=tsv&gid={}".format(sheet_id, gid)


def read_source(source):
    if re.match(r"^https?://", source, re.IGNORECASE):
        url = google_sheet_export_url(source)
        request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(request, timeout=40) as response:
            return response.read().decode("utf-8-sig"), url

    path = Path(source)
    return path.read_text(encoding="utf-8-sig"), str(path)


def guess_delimiter(text):
    sample = text[:8192]
    try:
        return csv.Sniffer().sniff(sample, delimiters="\t,;").delimiter
    except csv.Error:
        first_line = sample.splitlines()[0] if sample.splitlines() else ""
        counts = {"\t": first_line.count("\t"), ",": first_line.count(","), ";": first_line.count(";")}
        return max(counts, key=counts.get) if max(counts.values()) > 0 else "\t"


def read_rows(text, delimiter):
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    return [row for row in reader]


def clean_text(value):
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n")]

    cleaned = []
    previous_blank = False
    for line in lines:
        is_blank = line == ""
        if is_blank and previous_blank:
            continue
        cleaned.append(line)
        previous_blank = is_blank

    return "\n".join(cleaned).strip()


def inline_text(value):
    return re.sub(r"\s+", " ", clean_text(value)).strip()


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


def venue_names_from_rows(rows):
    for row in rows[:30]:
        if any(inline_text(cell).upper() == "ВРЕМЯ" for cell in row):
            names = {}
            for column_index, fallback in DEFAULT_VENUE_NAMES.items():
                raw = row[column_index] if column_index < len(row) else ""
                names[column_index] = clean_venue_header(raw) or fallback
            return names
    return dict(DEFAULT_VENUE_NAMES)


def session_comp_name(venue_name, topic):
    clean_topic_value = clean_topic(topic)
    if not clean_topic_value:
        return ""
    clean_venue = clean_venue_header(venue_name)
    return "{}/{}".format(clean_venue, clean_topic_value) if clean_venue else clean_topic_value


def clean_topic(value):
    text = clean_text(value)
    text = re.sub(r"^[«\"'“”„]+", "", text)
    text = re.sub(r"[»\"'“”„\]]+$", "", text)
    return text.strip()


def first_expert_marker(text):
    marker = re.search(r"(?is)(?:^|\s)(Эксперты?)\s*:", text)
    return marker.start() if marker else None


def extract_event_description(value):
    text = clean_text(value)
    text = re.split(r"(?:^|\s)Тема\s*:", text, maxsplit=1, flags=re.IGNORECASE)[0]
    text = re.split(r"(?:^|\s)(?:Сценар[иіий̆]+|Справка)[^\s]*", text, maxsplit=1, flags=re.IGNORECASE)[0]
    text = re.split(r"\S+\.docx", text, maxsplit=1, flags=re.IGNORECASE)[0]
    text = re.sub(r"\s+", " ", text)
    return text.strip(" -—")


def clean_fallback_topic(value):
    text = clean_text(value)
    docx_quote_match = re.search(r"\.docx\s+[«\"]([^»\"\n]{8,})[»\"]", text, flags=re.IGNORECASE)
    if docx_quote_match:
        return clean_topic(docx_quote_match.group(1))

    text = re.sub(r"\S+\.docx", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"(?:^|\s)СЦЕНАРИЙ\s+ДЛЯ\s+РПГ\s*:.*$", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+", " ", text).strip(" -—")

    quote_match = re.search(r"[«\"]([^»\"\n]{8,})[»\"]", text)
    if quote_match:
        return clean_topic(quote_match.group(1))
    return clean_topic(text)


def extract_session(cell):
    text = clean_text(cell)
    if not text:
        return None

    topic_match = re.search(
        r"(?is)(?:^|\s)Тема\s*:\s*(.+?)(?=\s+(?:Эксперты?|Модератор|Ведущий|Гости|Спикеры?)\s*:|$)",
        text,
    )

    if topic_match:
        topic = clean_topic(topic_match.group(1))
        remainder = text[topic_match.end() :]
        if first_expert_marker(remainder) is None:
            return None
        description = extract_event_description(text[: topic_match.start()])
    else:
        marker_index = first_expert_marker(text)
        if marker_index is None:
            return None

        topic = clean_fallback_topic(text[:marker_index])
        description = extract_event_description(text[:marker_index])

    if not topic:
        return None

    return {"topic": topic, "description": description}


def header_index(rows, column_name):
    if not rows or not column_name:
        return None

    normalized = column_name.strip().lower()
    for index, value in enumerate(rows[0]):
        if clean_text(value).lower() == normalized:
            return index
    raise ValueError("Не найдена колонка: {}".format(column_name))


def iter_source_cells(rows, source_column):
    column_index = header_index(rows, source_column)
    start_row = 1 if column_index is not None else 0
    venue_names = venue_names_from_rows(rows)

    for row_number, row in enumerate(rows[start_row:], start=start_row + 1):
        if column_index is not None:
            if column_index < len(row):
                yield row_number, column_index + 1, row[column_index], venue_names.get(column_index, "")
            continue

        last_column = min(PROGRAM_LAST_COLUMN_INDEX, len(row) - 1)
        for column_index in range(PROGRAM_FIRST_COLUMN_INDEX, last_column + 1):
            yield row_number, column_index + 1, row[column_index], venue_names.get(column_index, "")


def extract_records(rows, source_column):
    records = []
    seen = set()

    for row_number, cell_number, cell, venue_name in iter_source_cells(rows, source_column):
        session = extract_session(cell)
        if not session:
            continue

        key = clean_text(session["topic"]).lower()
        if key in seen:
            continue
        seen.add(key)

        records.append(
            {
                DEFAULT_TOPIC_HEADER: session["topic"],
                DEFAULT_DESCRIPTION_HEADER: session["description"],
                DEFAULT_COMP_NAME_HEADER: session_comp_name(venue_name, session["topic"]),
                "_source": "row {}, cell {}".format(row_number, cell_number),
            }
        )

    return records


def write_tsv(records, output_path):
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[DEFAULT_TOPIC_HEADER, DEFAULT_DESCRIPTION_HEADER, DEFAULT_COMP_NAME_HEADER],
            delimiter="\t",
            lineterminator="\n",
            extrasaction="ignore",
        )
        writer.writeheader()
        writer.writerows(records)


def parse_args(argv):
    parser = argparse.ArgumentParser(
        description="Достает описание события и тему из программной Google Sheet/TSV/CSV и сохраняет TSV для session_topics_from_sheet.jsx."
    )
    parser.add_argument("source", help="Google Sheet URL, export CSV/TSV URL или локальный TSV/CSV/TXT файл.")
    parser.add_argument(
        "-o",
        "--output",
        default="session_topics_extracted.tsv",
        help="Куда сохранить TSV. По умолчанию: session_topics_extracted.tsv",
    )
    parser.add_argument(
        "--source-column",
        default="",
        help="Название колонки, если нужно искать только в одной колонке. По умолчанию сканируются все ячейки.",
    )
    parser.add_argument(
        "--delimiter",
        choices=["auto", "tab", "comma", "semicolon"],
        default="auto",
        help="Разделитель входного файла. По умолчанию определяется автоматически.",
    )
    return parser.parse_args(argv)


def main(argv):
    args = parse_args(argv)
    text, resolved_source = read_source(args.source)
    delimiter_map = {"tab": "\t", "comma": ",", "semicolon": ";"}
    delimiter = guess_delimiter(text) if args.delimiter == "auto" else delimiter_map[args.delimiter]
    rows = read_rows(text, delimiter)
    records = extract_records(rows, args.source_column.strip() or None)

    if not records:
        print("ERROR: Не нашел ячеек с блоками вида 'Тема:', 'Эксперты:', 'Модератор:'.", file=sys.stderr)
        return 1

    write_tsv(records, args.output)
    print("SOURCE: {}".format(resolved_source))
    print("SUCCESS: {} rows -> {}".format(len(records), args.output))
    for index, record in enumerate(records[:5], start=1):
        print("{}. {}".format(index, record[DEFAULT_TOPIC_HEADER] or "(без темы)"))
    if len(records) > 5:
        print("... еще {}".format(len(records) - 5))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
