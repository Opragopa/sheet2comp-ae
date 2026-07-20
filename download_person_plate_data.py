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
        path = Path(output_path)
        ensure_parent(path)
        path.write_text("", encoding="utf-8")
        path.unlink()
        return path
    except (PermissionError, OSError):
        safe_dir = Path.home() / "Documents" / "ae_plaque_data"
        safe_dir.mkdir(parents=True, exist_ok=True)
        return safe_dir / Path(output_path).name


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


def request_bytes(url, timeout=45):
    req = urllib.request.Request(url, headers={"User-Agent": DEFAULT_USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.read(), response.headers
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403, 404):
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


def find_existing_photo(photos_dir, name_value):
    stem = photo_name_stem(name_value)
    if not stem:
        return ""

    for ext in sorted(IMAGE_EXTENSIONS):
        candidate = Path(photos_dir) / "{}{}".format(stem, ext)
        if candidate.exists():
            return str(candidate)
    return ""


def write_photo_file(photos_dir, name_value, ext, body):
    photo_path = Path(photos_dir) / photo_filename(name_value, ext)
    photo_path.write_bytes(body)
    return str(photo_path)


def download_yandex_public_photo(public_url, photos_dir, row_index, name_value):
    data = request_json(api_url(YANDEX_PUBLIC_API, {
        "public_key": public_url,
        "limit": 100,
        "preview_size": "XXXL"
    }))

    candidates = []
    if data.get("type") == "file" and is_image_resource(data):
        candidates.append(data)

    embedded = data.get("_embedded") or {}
    for item in embedded.get("items") or []:
        if item.get("type") == "file" and is_image_resource(item):
            candidates.append(item)

    if not candidates:
        return "", "В публичной ссылке Яндекс.Диска не найдено изображение"

    name_key = re.sub(r"[^0-9a-zа-яё]+", "", str(name_value or "").lower().replace("ё", "е"))

    def score(item):
        item_key = re.sub(r"[^0-9a-zа-яё]+", "", str(item.get("name") or "").lower().replace("ё", "е"))
        if name_key and (name_key in item_key or item_key in name_key):
            return 0
        return 1

    selected = sorted(candidates, key=score)[0]
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


def download_and_prepare(csv_url, output_json_path, photos_dir, photo_field, name_field):
    csv_text = read_table_text(csv_url)
    delimiter = guess_delimiter(csv_text)
    rows = [clean_row(row) for row in csv.DictReader(io.StringIO(csv_text), delimiter=delimiter)]
    print("DEBUG: Parsed rows: {}".format(len(rows)))

    safe_json_path = get_safe_output_path(output_json_path)
    photos_path = Path(photos_dir)
    photos_path.mkdir(parents=True, exist_ok=True)

    downloaded = 0
    photo_errors = 0
    prepared = []

    for index, row in enumerate(rows, start=1):
        photo_value = get_by_column(row, photo_field)
        name_value = get_by_column(row, name_field)
        formatted_name = format_first_name_last_name(name_value)
        local_photo, photo_error = download_photo(photo_value, photos_path, index, formatted_name or name_value)
        photo_file_name = Path(local_photo).name if local_photo else photo_filename(formatted_name or name_value)
        row["__nameFirstLast"] = formatted_name
        row["__formattedName"] = formatted_name
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
    print("DEBUG: JSON saved: {}".format(safe_json_path))
    print("DEBUG: Photos folder: {}".format(photos_path))
    return True


if __name__ == "__main__":
    if len(sys.argv) < 6:
        print("ERROR: Недостаточно аргументов")
        print("USAGE: python download_person_plate_data.py <sheet_url> <output_json_path> <photos_dir> <photo_field> <name_field>")
        sys.exit(1)

    try:
        ok = download_and_prepare(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
        sys.exit(0 if ok else 1)
    except UserFacingError as exc:
        print("ERROR:{}".format(exc))
        sys.exit(1)
    except Exception as exc:
        print("ERROR:{}".format(exc))
        import traceback
        traceback.print_exc()
        sys.exit(1)
