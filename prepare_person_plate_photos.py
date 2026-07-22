# -*- coding: utf-8 -*-
import argparse
import sys
import re
from pathlib import Path

from download_person_plate_data import download_and_prepare


REFERENCE_SHEET_URL = "https://docs.google.com/spreadsheets/d/1J6nJHM4wXF66LJO7dDNT6QgrxlQ5VPb-3B-4o7Ff0js/edit?gid=0#gid=0"
DEFAULT_DATA_DIR = Path.home() / "Documents" / "ae_plaque_data"
DEFAULT_JSON = DEFAULT_DATA_DIR / "person_plates_data.json"
DEFAULT_PHOTOS_DIR = DEFAULT_DATA_DIR / "person_plate_photos"
PHOTO_FIELD = "Фото на плашку"
NAME_FIELD = "ФИО спикера"


def apply_google_sheet_gid(url, gid):
    text = str(url or "").strip()
    if "docs.google.com/spreadsheets" not in text:
        return text

    clean_gid = re.sub(r"[^\d]", "", str(gid or "").strip()) or "0"
    if re.search(r"[?&#]gid=\d+", text):
        return re.sub(r"([?&#]gid=)\d+", r"\g<1>{}".format(clean_gid), text)
    if "#" in text:
        return "{}&gid={}".format(text, clean_gid)
    return "{}{}gid={}".format(text, "?" if "?" not in text else "&", clean_gid)


def parse_args(argv):
    parser = argparse.ArgumentParser(
        description="Скачать и переименовать фото для плашек/визиток из Google Sheets."
    )
    parser.add_argument(
        "legacy_photos_dir",
        nargs="?",
        help="Папка для фото. Оставлено для короткого запуска без флагов.",
    )
    parser.add_argument(
        "legacy_json_path",
        nargs="?",
        help="Путь к JSON. Оставлено для совместимости.",
    )
    parser.add_argument(
        "-p",
        "--photos-dir",
        help="Папка, куда скачать фото и где искать уже переименованные фото.",
    )
    parser.add_argument(
        "-j",
        "--json-path",
        help="Куда сохранить JSON для After Effects.",
    )
    parser.add_argument(
        "-s",
        "--sheet-url",
        default=REFERENCE_SHEET_URL,
        help="Ссылка на Google Sheet или локальный CSV/TSV/TXT.",
    )
    parser.add_argument(
        "-g",
        "--sheet-gid",
        default="0",
        help="GID листа Google Sheets. Если в ссылке уже есть gid, он будет заменен.",
    )
    parser.add_argument(
        "--no-photos",
        action="store_true",
        help="Не скачивать и не искать фото, только подготовить JSON с текстовыми данными.",
    )
    return parser.parse_args(argv[1:])


def main(argv):
    args = parse_args(argv)
    photos_dir = Path(args.photos_dir or args.legacy_photos_dir or DEFAULT_PHOTOS_DIR).expanduser()
    json_path = Path(args.json_path or args.legacy_json_path or DEFAULT_JSON).expanduser()
    photos_dir.mkdir(parents=True, exist_ok=True)
    json_path.parent.mkdir(parents=True, exist_ok=True)
    sheet_url = apply_google_sheet_gid(args.sheet_url, args.sheet_gid)

    return download_and_prepare(
        sheet_url,
        str(json_path),
        str(photos_dir),
        PHOTO_FIELD,
        NAME_FIELD,
        not args.no_photos,
    )


if __name__ == "__main__":
    try:
        args = parse_args(sys.argv)
        photos_dir = Path(args.photos_dir or args.legacy_photos_dir or DEFAULT_PHOTOS_DIR).expanduser()
        json_path = Path(args.json_path or args.legacy_json_path or DEFAULT_JSON).expanduser()
        ok = main(sys.argv)
        print("PHOTOS_DIR:{}".format(photos_dir))
        print("JSON:{}".format(json_path))
        sys.exit(0 if ok else 1)
    except Exception as exc:
        print("ERROR:{}".format(exc))
        sys.exit(1)
