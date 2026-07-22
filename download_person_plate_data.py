# -*- coding: utf-8 -*-
import csv
import io
import json
import mimetypes
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


DEFAULT_USER_AGENT = "Mozilla/5.0"
YANDEX_PUBLIC_API = "https://cloud-api.yandex.net/v1/disk/public/resources"
YANDEX_DOWNLOAD_API = "https://cloud-api.yandex.net/v1/disk/public/resources/download"
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp"}
COMMON_FIRST_NAMES = {
    "александр", "александра", "алексей", "алена", "алина", "анастасия", "анатолий",
    "андрей", "анна", "антон", "арина", "артем", "борис", "вадим", "валентин",
    "валентина", "валерий", "валерия", "василий", "вера", "виктор", "виктория",
    "виталий", "владимир", "владислав", "вячеслав", "галина", "георгий", "глеб",
    "дарья", "денис", "дмитрий", "евгений", "евгения", "екатерина", "елена",
    "елизавета", "элла", "иван", "игорь", "илья", "инна", "ирина", "кирилл",
    "константин", "ксения", "лев", "леонид", "любовь", "людмила", "максим",
    "маргарита", "марина", "мария", "михаил", "надежда", "наталья", "никита",
    "николай", "олег", "ольга", "павел", "петр", "полина", "роман", "светлана",
    "семен", "сергей", "софия", "станислав", "степан", "татьяна", "тимофей",
    "федор", "юлия", "юрий", "яна", "ярослав"
}


class UserFacingError(Exception):
    pass


def ensure_parent(path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)


def get_safe_output_path(output_path):
    try:
        path = local_path_arg(output_path)
        ensure_parent(path)
        path.write_text("", encoding="utf-8")
        path.unlink()
        return path
    except (PermissionError, OSError):
        safe_dir = Path.home() / "Documents" / "ae_plaque_data"
        safe_dir.mkdir(parents=True, exist_ok=True)
        return safe_dir / local_path_arg(output_path).name


def local_path_arg(value):
    text = str(value or "").strip()
    if text.startswith("file://"):
        return Path(urllib.parse.unquote(urllib.parse.urlparse(text).path)).expanduser()
    return Path(text).expanduser()


def normalize_google_sheet_url(url):
    text = str(url or "").strip()
    if "docs.google.com/spreadsheets" not in text:
        return text

    match = re.search(r"/d/([a-zA-Z0-9_-]+)", text)
    if not match:
        return text

    gid_match = re.search(r"[?&#]gid=(\d+)", text)
    gid = gid_match.group(1) if gid_match else "0"
    return "https://docs.google.com/spreadsheets/d/{}/gviz/tq?tqx=out:csv&gid={}".format(match.group(1), gid)


def format_time_prefix(value):
    text = re.sub(r"\s+", " ", str(value or "").strip())
    if not text:
        return ""
    match = re.search(r"(\d{1,2})[:.\-–—](\d{2})", text)
    if not match:
        return ""
    return "{:02d}-{}".format(int(match.group(1)), match.group(2))


def split_name_words(value):
    text = re.sub(r"\s+", " ", str(value or "").replace("\r", " ").replace("\n", " ")).strip()
    return [clean_name_token(part) for part in re.split(r"[\s,;]+", text) if clean_name_token(part)]


def person_alias_key(value):
    words = split_name_words(value)
    if len(words) < 2:
        return ""

    surname = ""
    first = ""
    for word in words:
        if not surname and looks_like_surname(word):
            surname = word
        elif not first and not is_patronymic(word):
            first = word
    if not surname:
        surname = words[0]
    if not first:
        first = words[1]

    initial = re.sub(r"[^A-ZА-ЯЁ]", "", first.upper())[:1]
    if not surname or not initial:
        return ""
    return "{}{}".format(compact_name_key(surname), initial.lower())


def name_quality(value):
    words = split_name_words(value)
    full_words = [word for word in words if not is_initial_or_marker(word) and not is_patronymic(word)]
    initials = [word for word in words if is_initial_or_marker(word)]
    return len(full_words) * 10 - len(initials) + len(str(value or ""))


def build_name_alias_map(rows, name_columns):
    best_by_alias = {}
    for row in rows:
        name_value = get_by_columns(row, name_columns)
        alias = person_alias_key(name_value)
        if not alias:
            continue
        current = best_by_alias.get(alias, "")
        if not current or name_quality(name_value) > name_quality(current):
            best_by_alias[alias] = name_value
    return best_by_alias


def request_bytes(url, timeout=45):
    req = urllib.request.Request(url, headers={"User-Agent": DEFAULT_USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.read(), response.headers
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403, 404):
            if "docs.google.com/spreadsheets" in str(url):
                if exc.code == 404:
                    message = (
                        "Google Sheets не нашел CSV для этой ссылки (HTTP 404). "
                        "Проверьте ссылку, gid листа или укажите локальный CSV/TSV файл."
                    )
                else:
                    message = (
                        "Google Sheets не дал доступ к CSV (HTTP {}). "
                        "Откройте доступ к таблице 'Anyone with the link / Viewer', "
                        "опубликуйте лист в CSV или укажите локальный CSV/TSV файл."
                    ).format(exc.code)
            else:
                message = "Ссылка не дала скачать файл (HTTP {}): {}".format(exc.code, url)
            raise UserFacingError(
                message
            )
        raise


def request_json(url, timeout=45):
    body, _headers = request_bytes(url, timeout=timeout)
    return json.loads(body.decode("utf-8"))


def extract_urls(value):
    text = str(value or "").strip()
    if not text:
        return []

    urls = re.findall(r"https?://[^\s\"'<>)\]]+", text)
    if urls:
        return [u.rstrip(".,;") for u in urls]

    # CSV can expose a plain Google Drive file id or a formula-like IMAGE("url") value.
    drive_id = re.search(r"(?:id=|/d/|open\?id=)([a-zA-Z0-9_-]{20,})", text)
    if drive_id:
        return ["https://drive.google.com/uc?export=download&id={}".format(drive_id.group(1))]

    return []


def is_yandex_disk_url(url):
    host = urllib.parse.urlparse(str(url or "")).netloc.lower()
    return host.endswith("disk.yandex.ru") or host.endswith("yadi.sk")


def api_url(base_url, params):
    return base_url + "?" + urllib.parse.urlencode(params)


def is_image_resource(item):
    mime_type = str(item.get("mime_type") or "").lower()
    media_type = str(item.get("media_type") or "").lower()
    suffix = Path(str(item.get("name") or "")).suffix.lower()
    return media_type == "image" or mime_type.startswith("image/") or suffix in IMAGE_EXTENSIONS


def yandex_original_size_url(item):
    for size in item.get("sizes") or []:
        if str(size.get("name") or "").upper() == "ORIGINAL" and size.get("url"):
            return size["url"]
    for size in item.get("sizes") or []:
        if size.get("url"):
            return size["url"]
    return ""


def yandex_public_download_url(public_url, resource_path=""):
    params = {"public_key": public_url}
    if resource_path:
        params["path"] = resource_path
    data = request_json(api_url(YANDEX_DOWNLOAD_API, params))
    return data.get("href", "")


def normalize_name_token(value):
    return str(value or "").strip().lower().replace("ё", "е").rstrip(".")


def is_known_first_name(value):
    return normalize_name_token(value) in COMMON_FIRST_NAMES


def is_patronymic(value):
    return re.search(r"(вич|вна|ич|ична|оглы|кызы)$", normalize_name_token(value)) is not None


def looks_like_surname(value):
    return re.search(r"(ов|ова|ев|ева|ёв|ёва|ин|ина|ын|ына|ский|ская|цкий|цкая|енко|ко|ук|юк|ич|ых|их)$", normalize_name_token(value)) is not None


def clean_name_token(value):
    return re.sub(r"^[,;:()\[\]{}\"']+|[,;:()\[\]{}\"']+$", "", str(value or "").strip().rstrip("."))


def is_initial_or_marker(value):
    text = clean_name_token(value).replace(".", "")
    return re.fullmatch(r"[A-ZА-ЯЁ]{1,2}", text) is not None


def format_first_name_last_name(value):
    text = re.sub(r"\s+", " ", str(value or "").replace("\r", " ").replace("\n", " ").replace("\t", " ")).strip()
    if not text:
        return ""

    raw_parts = re.split(r"[\s,;]+", text)
    parts = []
    for raw_part in raw_parts:
        part = clean_name_token(raw_part)
        if part and not is_patronymic(part) and not is_initial_or_marker(part):
            parts.append(part)

    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0].upper()

    known_name_index = -1
    surname_index = -1
    for idx, part in enumerate(parts):
        if known_name_index < 0 and is_known_first_name(part):
            known_name_index = idx
        if surname_index < 0 and looks_like_surname(part):
            surname_index = idx

    if known_name_index >= 0 and surname_index >= 0 and known_name_index != surname_index:
        return "{} {}".format(parts[known_name_index], parts[surname_index]).strip().upper()

    first = parts[0]
    second = parts[1]
    first_is_name = is_known_first_name(first)
    second_is_name = is_known_first_name(second)
    first_is_surname = looks_like_surname(first)
    second_is_surname = looks_like_surname(second)

    if first_is_name and not second_is_name:
        name, surname = first, second
    elif second_is_name and not first_is_name:
        name, surname = second, first
    elif first_is_surname and not second_is_surname:
        name, surname = second, first
    elif second_is_surname and not first_is_surname:
        name, surname = first, second
    elif len(raw_parts) >= 3:
        name, surname = second, first
    else:
        name, surname = first, second

    return "{} {}".format(name, surname).strip().upper()


def format_name_for_plate(value):
    return format_first_name_last_name(value)


def normalize_initial_token(value):
    letters = re.sub(r"[^A-ZА-ЯЁ]", "", str(value or "").upper())
    if not letters:
        return ""
    return ".".join(list(letters)) + "."


def format_last_name_first_name(value):
    text = re.sub(r"\s+", " ", str(value or "").replace("\r", " ").replace("\n", " ").replace("\t", " ")).strip()
    if not text:
        return ""

    raw_parts = re.split(r"[\s,;]+", text)
    initials = []
    words = []
    for raw_part in raw_parts:
        part = clean_name_token(raw_part)
        if not part:
            continue
        if is_initial_or_marker(part):
            initial = normalize_initial_token(part)
            if initial:
                initials.append(initial)
            continue
        if is_patronymic(part):
            continue
        words.append(part)

    if not words and initials:
        return " ".join(initials)
    if not words:
        return ""

    if len(words) == 1:
        if initials:
            return "{} {}".format(words[0], " ".join(initials)).strip()
        return words[0]

    known_name_index = -1
    surname_index = -1
    for idx, part in enumerate(words):
        if known_name_index < 0 and is_known_first_name(part):
            known_name_index = idx
        if surname_index < 0 and looks_like_surname(part):
            surname_index = idx

    if known_name_index >= 0 and surname_index >= 0 and known_name_index != surname_index:
        first_name = words[known_name_index]
        surname = words[surname_index]
    elif len(raw_parts) >= 3:
        surname = words[0]
        first_name = words[1]
    else:
        first = words[0]
        second = words[1]
        first_is_name = is_known_first_name(first)
        second_is_name = is_known_first_name(second)
        first_is_surname = looks_like_surname(first)
        second_is_surname = looks_like_surname(second)

        if first_is_name and not second_is_name:
            first_name, surname = first, second
        elif second_is_name and not first_is_name:
            first_name, surname = second, first
        elif first_is_surname and not second_is_surname:
            surname, first_name = first, second
        elif second_is_surname and not first_is_surname:
            surname, first_name = second, first
        else:
            surname, first_name = first, second

    return "{} {}".format(surname, first_name).strip()


def photo_name_stem(value):
    name = format_first_name_last_name(value) or str(value or "").strip() or "photo"
    name = re.sub(r'[\\/:*?"<>|#%{}[\]]+', "", name)
    name = re.sub(r"\s+", " ", name).strip()
    if not name:
        name = "photo"
    return name[:120]


def photo_filename(value, ext=".jpg"):
    name = photo_name_stem(value)
    if ext == ".jpeg":
        ext = ".jpg"
    if not ext:
        ext = ".jpg"
    return "{}{}".format(name[:120], ext.lower())


def compact_name_key(value):
    return re.sub(r"[^0-9a-zа-яё]+", "", str(value or "").lower().replace("ё", "е"))


def name_parts_key(value):
    formatted = format_first_name_last_name(value)
    if not formatted:
        formatted = str(value or "")
    parts = [compact_name_key(part) for part in re.split(r"\s+", formatted) if compact_name_key(part)]
    if len(parts) >= 2:
        return parts[:2]
    return parts


def photo_name_keys(value):
    parts = name_parts_key(value)
    keys = set()
    if parts:
        keys.add("".join(parts))
    if len(parts) >= 2:
        keys.add(parts[1] + parts[0])
    raw_key = compact_name_key(value)
    if raw_key:
        keys.add(raw_key)
    return keys


def file_matches_name(path, name_value):
    stem = Path(path).stem
    item_key = compact_name_key(stem)
    if not item_key:
        return False

    keys = photo_name_keys(name_value)
    for key in keys:
        if key and (key == item_key or key in item_key or item_key in key):
            return True

    parts = name_parts_key(name_value)
    if len(parts) >= 2:
        return all(part in item_key for part in parts)
    return False


def canonical_photo_path(photos_dir, name_value, ext):
    return Path(photos_dir) / photo_filename(name_value, ext)


def rename_photo_to_canonical(path, photos_dir, name_value):
    source = Path(path)
    ext = source.suffix.lower()
    if ext == ".jpeg":
        ext = ".jpg"
    if ext not in IMAGE_EXTENSIONS:
        ext = ".jpg"

    target = canonical_photo_path(photos_dir, name_value, ext)
    if source == target:
        return str(source)
    if target.exists():
        return str(target)

    try:
        source.rename(target)
        return str(target)
    except OSError:
        return str(source)


def find_existing_photo(photos_dir, name_value):
    stem = photo_name_stem(name_value)
    if not stem:
        return ""

    for ext in sorted(IMAGE_EXTENSIONS):
        candidate = Path(photos_dir) / "{}{}".format(stem, ext)
        if candidate.exists():
            return str(candidate)

    for candidate in iter_image_files(photos_dir):
        if candidate.is_file() and candidate.suffix.lower() in IMAGE_EXTENSIONS and file_matches_name(candidate, name_value):
            return rename_photo_to_canonical(candidate, photos_dir, name_value)
    return ""


def iter_image_files(photos_dir):
    root = Path(photos_dir)
    try:
        return sorted([path for path in root.rglob("*") if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS])
    except OSError:
        return []


def write_photo_file(photos_dir, name_value, ext, body):
    photo_path = canonical_photo_path(photos_dir, name_value, ext)
    photo_path.write_bytes(body)
    return str(photo_path)


def download_yandex_public_photo(public_url, photos_dir, row_index, name_value):
    data = request_json(api_url(YANDEX_PUBLIC_API, {
        "public_key": public_url,
        "limit": 100,
        "preview_size": "XXXL"
    }))

    candidates = []
    is_single_file = data.get("type") == "file"
    if data.get("type") == "file" and is_image_resource(data):
        candidates.append(data)

    embedded = data.get("_embedded") or {}
    for item in embedded.get("items") or []:
        if item.get("type") == "file" and is_image_resource(item):
            candidates.append(item)

    if not candidates:
        if is_single_file:
            download_url = yandex_public_download_url(public_url, data.get("path") or "")
            if not download_url:
                return "", "Яндекс.Диск не вернул ссылку на скачивание"
            body, headers = request_bytes(download_url)
            if not body:
                return "", "Пустой файл"
            ext = Path(str(data.get("name") or "")).suffix.lower()
            if ext not in IMAGE_EXTENSIONS:
                ext = extension_from(headers, download_url)
            if ext == ".jpeg":
                ext = ".jpg"
            return write_photo_file(photos_dir, name_value, ext, body), ""
        return "", "В публичной ссылке Яндекс.Диска не найдено изображение"

    name_keys = photo_name_keys(name_value)
    name_parts = name_parts_key(name_value)

    def score(item):
        item_key = compact_name_key(item.get("name") or "")
        for name_key in name_keys:
            if name_key and (name_key == item_key or name_key in item_key or item_key in name_key):
                return 0
        if len(name_parts) >= 2 and all(part in item_key for part in name_parts):
            return 0
        return 1

    scored = sorted([(score(item), item) for item in candidates], key=lambda pair: pair[0])
    if not is_single_file and scored[0][0] > 0:
        return "", "В папке Яндекс.Диска не найден файл под имя {}".format(name_value)

    selected = scored[0][1]
    download_url = yandex_original_size_url(selected)
    if not download_url:
        download_url = yandex_public_download_url(public_url, selected.get("path") or "")
    if not download_url:
        return "", "Яндекс.Диск не вернул ссылку на скачивание"

    body, headers = request_bytes(download_url)
    if not body:
        return "", "Пустой файл"

    ext = Path(str(selected.get("name") or "")).suffix.lower()
    if ext not in IMAGE_EXTENSIONS:
        ext = extension_from(headers, download_url)
    if ext == ".jpeg":
        ext = ".jpg"

    return write_photo_file(photos_dir, name_value, ext, body), ""


def normalize_photo_url(url):
    text = str(url or "").strip()
    if not text:
        return text

    drive_match = re.search(r"drive\.google\.com/(?:file/d/|open\?id=|uc\?[^#]*id=)([a-zA-Z0-9_-]+)", text)
    if drive_match:
        return "https://drive.google.com/uc?export=download&id={}".format(drive_match.group(1))

    return text


def extension_from(headers, url):
    content_type = headers.get("Content-Type", "").split(";")[0].strip().lower()
    ext = mimetypes.guess_extension(content_type) if content_type else ""
    if ext in (".jpe", ".jpeg"):
        return ".jpg"
    if ext:
        return ext

    path = urllib.parse.urlparse(url).path
    suffix = Path(path).suffix.lower()
    if suffix in (".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp"):
        return ".jpg" if suffix == ".jpeg" else suffix
    return ".jpg"


def download_photo(photo_value, photos_dir, row_index, name_value):
    existing = find_existing_photo(photos_dir, name_value)
    if existing:
        return existing, ""

    urls = extract_urls(photo_value)
    if not urls:
        return "", ""

    last_error = ""
    for raw_url in urls:
        url = normalize_photo_url(raw_url)
        try:
            if is_yandex_disk_url(url):
                return download_yandex_public_photo(url, photos_dir, row_index, name_value)

            body, headers = request_bytes(url)
            if not body:
                last_error = "Пустой файл"
                continue

            ext = extension_from(headers, url)
            return write_photo_file(photos_dir, name_value, ext, body), ""
        except Exception as exc:
            last_error = str(exc)

    return "", last_error or "Фото не скачано"


def clean_row(row):
    result = {}
    for key, value in row.items():
        clean_key = str(key or "").strip().lstrip("\ufeff")
        result[clean_key] = str(value or "").strip()
    return result


def is_local_table_source(source):
    text = str(source or "").strip()
    if text.startswith("file://"):
        return True
    if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", text):
        return False
    return Path(text).expanduser().suffix.lower() in (".csv", ".tsv", ".txt")


def read_table_text(source):
    text = str(source or "").strip()
    if is_local_table_source(text):
        if text.startswith("file://"):
            path_text = urllib.parse.unquote(urllib.parse.urlparse(text).path)
        else:
            path_text = text
        path = Path(path_text).expanduser()
        if not path.exists():
            raise UserFacingError("Локальный файл таблицы не найден: {}".format(path))
        return path.read_text(encoding="utf-8-sig")

    csv_url = normalize_google_sheet_url(text)
    print("DEBUG: CSV URL: {}...".format(csv_url[:120]))
    csv_bytes, _headers = request_bytes(csv_url)
    return csv_bytes.decode("utf-8-sig")


def guess_delimiter(text):
    first_line = str(text or "").splitlines()[0] if str(text or "").splitlines() else ""
    tabs = first_line.count("\t")
    commas = first_line.count(",")
    semicolons = first_line.count(";")
    if tabs >= commas and tabs >= semicolons and tabs > 0:
        return "\t"
    if semicolons > commas:
        return ";"
    return ","


def normalize_key(value):
    return re.sub(r"\s+", " ", str(value or "").strip().lower().replace("ё", "е"))


def get_by_column(row, column_name):
    if column_name in row:
        return row[column_name]

    wanted = normalize_key(column_name)
    for key, value in row.items():
        if normalize_key(key) == wanted:
            return value
    return ""


def get_by_columns(row, column_names):
    for column_name in column_names:
        value = get_by_column(row, column_name)
        if str(value or "").strip():
            return value
    return ""


def get_photo_value(row, column_names):
    first_text_value = ""
    for column_name in column_names:
        value = get_by_column(row, column_name)
        if not str(value or "").strip():
            continue
        if extract_urls(value):
            return value
        if not first_text_value:
            first_text_value = value
    return first_text_value


def download_and_prepare(csv_url, output_json_path, photos_dir, photo_field, name_field, prepare_photos=True):
    csv_text = read_table_text(csv_url)
    delimiter = guess_delimiter(csv_text)
    rows = [clean_row(row) for row in csv.DictReader(io.StringIO(csv_text), delimiter=delimiter)]
    print("DEBUG: Parsed rows: {}".format(len(rows)))

    safe_json_path = get_safe_output_path(output_json_path)
    photos_path = local_path_arg(photos_dir)
    photos_path.mkdir(parents=True, exist_ok=True)

    downloaded = 0
    photo_errors = 0
    rows_with_photo_value = 0
    prepared = []

    photo_columns = [
        photo_field,
        "Ссылка на плашку",
        "Фото на плашку",
        "ФОТО",
        "Фото",
        "photo",
    ]

    name_columns = [
        name_field,
        "ФИО",
        "ФИО спикера",
        "Имя",
        "ИМЯ",
        "name",
    ]
    name_aliases = build_name_alias_map(rows, name_columns)

    for index, row in enumerate(rows, start=1):
        photo_value = get_photo_value(row, photo_columns)
        if str(photo_value or "").strip():
            rows_with_photo_value += 1
        raw_name_value = get_by_columns(row, name_columns)
        name_value = name_aliases.get(person_alias_key(raw_name_value), raw_name_value)
        formatted_name = format_first_name_last_name(name_value)
        comp_name = format_last_name_first_name(name_value)
        # Recording TSV already contains the full date-and-time prefix, for example
        # "20.07_11-30". Do not replace it with a time-only value while preparing rows.
        source_time_prefix = str(row.get("__compTimePrefix") or "").strip()
        time_prefix = source_time_prefix or format_time_prefix(
            get_by_columns(row, ["НАЧАЛО", "ВРЕМЯ", "Время", "time", "start_time"])
        )
        if prepare_photos:
            local_photo, photo_error = download_photo(photo_value, photos_path, index, formatted_name or name_value)
        else:
            local_photo, photo_error = "", ""
        photo_file_name = Path(local_photo).name if local_photo else photo_filename(formatted_name or name_value)
        row["__nameFirstLast"] = formatted_name
        row["__nameLastFirst"] = comp_name
        row["__formattedName"] = formatted_name
        row["__compTimePrefix"] = time_prefix
        row["__photoFileName"] = photo_file_name
        row["__photoLocalPath"] = local_photo
        row["__photoError"] = photo_error
        if local_photo:
            downloaded += 1
        elif photo_error:
            photo_errors += 1
        prepared.append(row)

    safe_json_path.write_text(json.dumps(prepared, ensure_ascii=False, indent=2), encoding="utf-8")
    print("SUCCESS:{} PHOTO:{} PHOTO_ERRORS:{}".format(len(prepared), downloaded, photo_errors))
    print("DEBUG: Photo column values: {}".format(rows_with_photo_value))
    if prepare_photos:
        print("DEBUG: Image files in photos folder: {}".format(len(iter_image_files(photos_path))))
    else:
        print("DEBUG: Photo import disabled")
    print("DEBUG: JSON saved: {}".format(safe_json_path))
    print("DEBUG: Photos folder: {}".format(photos_path))
    return True


if __name__ == "__main__":
    if len(sys.argv) < 6:
        print("ERROR: Недостаточно аргументов")
        print("USAGE: python download_person_plate_data.py <sheet_url> <output_json_path> <photos_dir> <photo_field> <name_field> [prepare_photos:1|0]")
        sys.exit(1)

    try:
        prepare_photos = len(sys.argv) < 7 or str(sys.argv[6]).strip() not in ("0", "false", "False", "no", "NO")
        ok = download_and_prepare(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], prepare_photos)
        sys.exit(0 if ok else 1)
    except UserFacingError as exc:
        print("ERROR:{}".format(exc))
        sys.exit(1)
    except Exception as exc:
        print("ERROR:{}".format(exc))
        import traceback
        traceback.print_exc()
        sys.exit(1)
