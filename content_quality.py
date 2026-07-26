# -*- coding: utf-8 -*-
"""Conservative normalization helpers for data sent to After Effects."""

import re


PLACEHOLDER_KEYS = {
    "фио", "фамилияимя", "имя", "уточняется", "нет", "неизвестно",
    "изкомандымодераторов", "коготоиздвиженияпервых", "na", "ref", "value",
    "error", "null",
}

NON_NAME_WORDS = {
    "агентство", "академия", "автономного", "вице", "водитель", "губернатор",
    "департамент", "директор", "заместитель", "институт", "комиссия", "комитет",
    "министерство", "министр", "минтруде", "наблюдательного", "начальник", "общественного",
    "организация", "партия", "платформа", "председатель", "президент", "при", "проректор",
    "ректор", "руководитель", "совет", "совета", "служба", "спикер", "фонд", "фонда",
    "эксперт", "эксперты", "модератор", "ведущий", "ответственный", "гости",
}

FIRST_NAMES = {
    "александр", "алексей", "анатолий", "андрей", "артем", "артём", "артур",
    "василий", "владимир", "геннадий", "дарья", "диана", "дмитрий", "евгений",
    "екатерина", "элла", "константин", "любовь", "марина", "михаил", "олег",
    "ольга", "роман", "сергей", "федор", "фёдор", "юлия",
}


def inline_text(value):
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[\u00a0\t]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def normalize_key(value):
    return re.sub(r"[^0-9a-zа-яё]+", "", inline_text(value).lower().replace("ё", "е"))


def strip_person_annotations(value):
    text = inline_text(value)
    text = re.sub(r"^[▶•\-–—\s]+", "", text)
    text = re.sub(
        r"^(?:эксперты?|спикеры?|гости?|модератор|ведущий|ответственный|запись|видео)\s*[:\-–—]\s*",
        "",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"\((?:не\s*подтвержден[аы]?|подтвержден[аы]?|уточняется|очно|онлайн|без\s*плашк[^)]*)\)",
        " ",
        text,
        flags=re.IGNORECASE,
    )
    return inline_text(text).strip(" .,-–—;:[]")


def name_parts(value):
    return [part.strip(" .,-–—()[]") for part in re.split(r"[\s,;]+", inline_text(value)) if part.strip(" .,-–—()[]")]


def is_initials_token(token):
    text = str(token or "").strip()
    if "." in text:
        letters = re.sub(r"[.\s]", "", text)
        return 1 <= len(letters) <= 3 and letters == letters.upper() and re.fullmatch(r"[A-ZА-ЯЁ]+", letters) is not None
    return len(text) == 1 and text == text.upper() and re.fullmatch(r"[A-ZА-ЯЁ]", text) is not None


def is_name_word(token):
    return re.fullmatch(r"[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё'’-]*", str(token or "")) is not None


def looks_like_surname(token):
    word = str(token or "").lower().replace("ё", "е")
    return re.search(
        r"(?:ов|ова|ев|ева|ин|ина|ын|ына|ский|ская|цкий|цкая|енко|ко|ук|юк|ич|вич|вна|ых|их|ян|дзе|швили)$",
        word,
    ) is not None


def looks_like_patronymic(token):
    return re.search(r"(?:ович|евич|ич|овна|евна|ична)$", str(token or "").lower().replace("ё", "е")) is not None


def validate_person_name(value):
    """Return (clean_name, reason). Empty name means the candidate is unsafe."""
    text = strip_person_annotations(value)
    key = normalize_key(text)
    if not text or key in PLACEHOLDER_KEYS:
        return "", "placeholder"
    if re.search(r"\d|https?://|www\.|@|[=<>]", text, flags=re.IGNORECASE):
        return "", "technical_text"
    if any(char in text for char in ("/", "\\", "_")):
        return "", "technical_text"

    parts = name_parts(text)
    if len(parts) < 2:
        return "", "single_word"
    if len(parts) > 4:
        return "", "too_many_words"
    if any(normalize_key(part) in NON_NAME_WORDS for part in parts):
        return "", "position_or_service_text"
    if not all(is_initials_token(part) or is_name_word(part) for part in parts):
        return "", "invalid_characters"

    initials = [part for part in parts if is_initials_token(part)]
    words = [part for part in parts if not is_initials_token(part)]
    if initials:
        if len(words) != 1 or len(initials) > 2:
            return "", "invalid_initials_name"
    elif len(words) < 2:
        return "", "single_word"
    elif len(words) == 2:
        lowered = [word.lower().replace("ё", "е") for word in words]
        if not any(word in FIRST_NAMES for word in lowered) and not any(looks_like_surname(word) for word in words):
            return "", "ambiguous_two_word_phrase"

    for word in words:
        if word[:1] != word[:1].upper():
            return "", "lowercase_phrase"
    normalized_parts = []
    for part in parts:
        if not is_initials_token(part) and len(part) > 1 and part == part.upper():
            part = part[:1].upper() + part[1:].lower()
        normalized_parts.append(part)
    return " ".join(normalized_parts), ""


def canonical_last_first(value):
    clean, _reason = validate_person_name(value)
    if not clean:
        return ""
    parts = name_parts(clean)
    if any(is_initials_token(part) for part in parts):
        surname = next((part for part in parts if not is_initials_token(part)), "")
        initials = "".join(part for part in parts if is_initials_token(part))
        return inline_text("{} {}".format(surname, initials))

    if len(parts) >= 3:
        if looks_like_patronymic(parts[-1]):
            return "{} {}".format(parts[0], parts[1])
        if looks_like_patronymic(parts[1]):
            return "{} {}".format(parts[-1], parts[0])

    first, second = parts[0], parts[1]
    first_key = first.lower().replace("ё", "е")
    second_key = second.lower().replace("ё", "е")
    if first_key in FIRST_NAMES and second_key not in FIRST_NAMES:
        return "{} {}".format(second, first)
    if second_key in FIRST_NAMES and first_key not in FIRST_NAMES:
        return "{} {}".format(first, second)
    if looks_like_surname(second) and not looks_like_surname(first):
        return "{} {}".format(second, first)
    return "{} {}".format(first, second)


def initials_surname_key(value):
    clean, _reason = validate_person_name(value)
    if not clean:
        return ""
    parts = name_parts(clean)
    initials = []
    words = []
    for part in parts:
        if is_initials_token(part):
            initials.extend(re.sub(r"[^A-ZА-ЯЁ]", "", part.upper()))
        else:
            words.append(part)
    if initials and words:
        return normalize_key("{} {}".format("".join(initials[:2]), words[-1]))

    canonical = canonical_last_first(clean)
    canonical_parts = name_parts(canonical)
    if len(canonical_parts) < 2:
        return ""
    surname = canonical_parts[0]
    first = canonical_parts[1]
    patronymic = ""
    if len(parts) >= 3:
        if looks_like_patronymic(parts[-1]):
            patronymic = parts[-1]
        elif looks_like_patronymic(parts[1]):
            patronymic = parts[1]
    return normalize_key("{} {}{}".format(surname, first[:1], patronymic[:1]))


def person_lookup_keys(value):
    clean, _reason = validate_person_name(value)
    if not clean:
        return []
    parts = name_parts(clean)
    canonical = canonical_last_first(clean)
    keys = {
        normalize_key(clean),
        normalize_key(canonical),
        initials_surname_key(clean),
    }
    canonical_parts = name_parts(canonical)
    if len(canonical_parts) >= 2:
        keys.add(normalize_key("{} {}".format(canonical_parts[0], canonical_parts[1][:1])))
    if len(parts) == 2 and not any(is_initials_token(part) for part in parts):
        keys.add(normalize_key("{} {}".format(parts[1], parts[0])))
    return [key for key in keys if key]


def clean_position(value):
    text = inline_text(value)
    text = re.sub(r"(?:^|[\s(])\d+\)\s*", " ", text)
    text = re.sub(r"^(?:должность|регалии)\s*:\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\((?:не\s*подтвержден[аы]?|подтвержден[аы]?|уточняется)\)", " ", text, flags=re.IGNORECASE)
    text = re.split(
        r"(?i)\s+(?:СЦЕНАРИЙ(?:\s+ДЛЯ\s+РПГ)?|ЗАЛ|СЕТАП|РАЙДЕР|КОНТЕНТ|ВОЛОНТЕРЫ|Техзапрос|Техзадание|БЕЗ\s+ТРАНСЛЯЦИИ|ПРЕЗЕНТАЦИЯ\s+БУДЕТ|НЕТ\s+И\s+НЕ\s+БУДЕТ\s+ПРЕЗЕНТАЦИИ|Кого-то\s+из\s+Движения\s+Первых|приветственное\s+слово|обратную\s+связь)\s*:?",
        text,
        maxsplit=1,
    )[0]
    text = re.split(r"\s+[А-ЯЁ][а-яё-]+\?\s*[-–—]", text, maxsplit=1)[0]
    if re.fullmatch(r"\(\s*от\s+[^)]+\)", text, flags=re.IGNORECASE):
        return ""
    if normalize_key(text) in PLACEHOLDER_KEYS:
        return ""
    return text.strip(" .,-–—;")


def clean_optional_value(value):
    text = inline_text(value)
    return "" if normalize_key(text) in PLACEHOLDER_KEYS else text


def clean_topic(value):
    text = inline_text(value)
    text = re.sub(r"^(?:тема|название|сессия)\s*:\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"(?:^|[\s(])\d+\)\s*", " ", text)
    text = re.sub(r"^[▶•\s]+", "", text)
    text = re.sub(r"\s+(?:▶\s*)?(?:статус|эксперты?|спикеры?|гости?|модератор|ведущий|зал|сетап|райдер|контент|техзадание)\s*:.*$", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+(?:эксперты?|спикеры?|гости?|модератор|ведущий)\s*$", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*[-–—]\s*ПРЕЗЕНТАЦИ[ЯИ]\b.*$", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+", " ", text).strip(" \"'«»„“”.,;:-–—")
    words = text.split()
    for size in range(min(8, len(words) // 2), 1, -1):
        if normalize_key(" ".join(words[:size])) == normalize_key(" ".join(words[size : size * 2])):
            text = " ".join(words[size:])
            break
    key = normalize_key(text)
    if not text or key in PLACEHOLDER_KEYS or len(key) < 4:
        return ""
    return text
