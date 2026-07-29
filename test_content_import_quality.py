# -*- coding: utf-8 -*-
import tempfile
import unittest
from pathlib import Path

import content_quality as quality
import download_person_plate_data as photos
import extract_content_plan as content
import extract_recording_plan as recording
import extract_session_topics as topics


class PersonQualityTests(unittest.TestCase):
    def test_atomic_export_keeps_previous_files_when_staging_fails(self):
        records = {
            "venues": [], "topics": [], "sessions": [], "session_people": [], "people": [],
            "badges": [], "cards": [], "legacy_sessions": [],
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "content_plan"
            output_dir.mkdir()
            previous = output_dir / "content_plan_sessions.tsv"
            previous.write_text("previous export", encoding="utf-8")

            original_write_tsv = content.write_tsv
            calls = {"count": 0}

            def fail_during_staging(path, fields, rows):
                calls["count"] += 1
                if calls["count"] == 2:
                    raise OSError("disk full")
                original_write_tsv(path, fields, rows)

            content.write_tsv = fail_during_staging
            try:
                with self.assertRaisesRegex(OSError, "disk full"):
                    content.write_records_atomically(output_dir, records, {})
            finally:
                content.write_tsv = original_write_tsv

            self.assertEqual("previous export", previous.read_text(encoding="utf-8"))

    def test_rejects_false_composition_names_from_real_import(self):
        bad_values = [
            "Фонда «ВЦИОМ»",
            "директор НИСоцУ",
            "председатель Наблюдательного",
            "при Минтруде",
            "Общественного совета",
            "Олег",
            "ФИО",
            "[ФИО]",
        ]
        for value in bad_values:
            with self.subTest(value=value):
                self.assertEqual("", quality.validate_person_name(value)[0])

    def test_normalizes_name_order_for_after_effects(self):
        expected = {
            "Элла Памфилова": "Памфилова Элла",
            "Артем Жога": "Жога Артем",
            "Нечаев Алексей": "Нечаев Алексей",
            "Федоренко Константин Альбертович": "Федоренко Константин",
            "Любимова Ольга": "Любимова Ольга",
        }
        for source, result in expected.items():
            with self.subTest(source=source):
                self.assertEqual(result, quality.canonical_last_first(source))

    def test_initials_match_full_name_in_either_order(self):
        self.assertTrue(
            set(quality.person_lookup_keys("А.Д. Харичев"))
            & set(quality.person_lookup_keys("Харичев Александр Дмитриевич"))
        )
        self.assertTrue(
            set(quality.person_lookup_keys("М.А. Голубович"))
            & set(quality.person_lookup_keys("Голубович Мария Александровна"))
        )

    def test_short_first_name_is_not_treated_as_initials(self):
        self.assertEqual(
            ("Лантратова Яна Валерьевна", ""),
            quality.validate_person_name("Лантратова Яна Валерьевна"),
        )

    def test_all_caps_surname_is_normalized(self):
        self.assertEqual("Земцов Дмитрий", quality.canonical_last_first("ЗЕМЦОВ Дмитрий Игоревич"))

    def test_ich_surname_is_not_treated_as_patronymic(self):
        self.assertTrue(quality.looks_like_patronymic("Юрьевич"))
        self.assertFalse(quality.looks_like_patronymic("Кастюкевич"))
        self.assertEqual("Кастюкевич Игорь", quality.canonical_last_first("Кастюкевич Игорь Юрьевич"))
        self.assertEqual("Кастюкевич Игорь", quality.canonical_last_first("Игорь Кастюкевич Юрьевич"))

    def test_photo_import_keeps_ich_surname(self):
        self.assertTrue(photos.is_patronymic("Юрьевич"))
        self.assertFalse(photos.is_patronymic("Кастюкевич"))
        self.assertEqual("ИГОРЬ КАСТЮКЕВИЧ", photos.format_first_name_last_name("Кастюкевич Игорь Юрьевич"))
        self.assertEqual("Кастюкевич Игорь", photos.format_last_name_first_name("Кастюкевич Игорь Юрьевич"))


class RecordingImportTests(unittest.TestCase):
    @staticmethod
    def matrix(cell_text):
        rows = [[""] * 39 for _ in range(25)]
        rows[0][21] = "ВИДЕО"
        rows[1][21] = "20.07"
        rows[2][20] = "10:00"
        rows[2][21] = cell_text
        return rows

    def test_filters_position_continuations_and_enriches_missing_position(self):
        reference = recording.build_people_reference(
            "ФИО\tДолжность\n"
            "Алексей Нечаев\tРуководитель фракции\n"
            "Элла Памфилова\tПредседатель ЦИК\n"
        )
        rows = self.matrix(
            "Нечаев Алексей\n"
            "Олег\n"
            "Фонда «ВЦИОМ»\n"
            "директор НИСоцУ\n"
            "председатель Наблюдательного\n"
            "при Минтруде\n"
            "Общественного совета\n"
            "Элла Памфилова"
        )

        records, stats = recording.build_records(rows, reference)

        self.assertEqual(
            ["20.07_10-00_Нечаев Алексей", "20.07_10-00_Памфилова Элла"],
            [row["ИМЯ_КОМПОЗИЦИИ"] for row in records],
        )
        self.assertEqual(["Руководитель фракции", "Председатель ЦИК"], [row["Должность"] for row in records])
        self.assertEqual(6, stats["ignored"])
        self.assertEqual(6, len(stats["ignored_samples"]))

    def test_manual_position_wins_and_blank_position_uses_reference(self):
        reference = recording.build_people_reference(
            "ФИО\tДолжность\nАртем Жога\tПолномочный представитель\n"
        )
        records, stats = recording.build_manual_records(
            "ФИО\tДолжность\nАртем Жога\t\nЖога Артем\tСвоя должность\n",
            reference,
            set(),
        )
        self.assertEqual(1, len(records))
        self.assertEqual("Запись_Жога Артем", records[0]["ИМЯ_КОМПОЗИЦИИ"])
        self.assertEqual("Полномочный представитель", records[0]["Должность"])
        self.assertEqual(1, stats["manual_records"])

    def test_bare_carriage_returns_inside_google_tsv_cells_are_not_rows(self):
        text = (
            "ФИО\tДолжность\r\n"
            "ЗЕМЦОВ\r Дмитрий Игоревич\r\tПроректор НИУ ВШЭ\r\n"
        )
        values = recording.row_values_from_text(text)
        self.assertEqual([("ЗЕМЦОВ Дмитрий Игоревич", "Проректор НИУ ВШЭ")], values)


class ContentPlanTests(unittest.TestCase):
    @staticmethod
    def program_rows(left_cell, right_cell=""):
        return [
            ["ДЕНЬ 1 20.07", "", "", ""],
            ["ВРЕМЯ", "Амфитеатр", "Урал 1", "Урал 2"],
            ["10:00-11:00", left_cell, right_cell, ""],
        ]

    def test_parses_unlabelled_masterclass_people_and_topic(self):
        reference = content.build_people_reference(
            "ФИО\tДолжность\n"
            "Ануфриева Светлана Олеговна\tМинистр молодежной политики\n"
            "Голубович Мария Александровна\tМинистр молодежной политики\n"
        )
        rows = self.program_rows(
            "Мастер-классы министров по выбору\n"
            "С.О. Ануфриева, Министр молодежной политики\n"
            "М.А. Голубович, Министр молодежной политики"
        )
        result = content.build_records(rows, people_reference=reference)

        self.assertEqual("Мастер-классы министров по выбору", result["topics"][0]["ТЕМА"])
        self.assertEqual(2, len(result["badges"]))
        self.assertEqual(
            {"Ануфриева Светлана Олеговна", "Голубович Мария Александровна"},
            {row["ФИО спикера"] for row in result["badges"]},
        )

    def test_keeps_explicit_position_and_fills_only_missing_one(self):
        reference = content.build_people_reference(
            "ФИО\tДолжность\nХаричев Александр Дмитриевич\tДолжность из справочника\n"
        )
        rows = self.program_rows(
            "Тема: Первая тема Эксперт: А.Д. Харичев, Должность из программы",
            "Тема: Вторая тема Эксперт: А.Д. Харичев",
        )
        result = content.build_records(rows, people_reference=reference)
        positions = {row["ПЛОЩАДКА"]: row["Должность"] for row in result["badges"]}
        self.assertEqual("Должность из программы", positions["Амфитеатр"])
        self.assertEqual("Должность из справочника", positions["Урал 1"])

    def test_filters_placeholder_moderator(self):
        rows = self.program_rows("Медиа как инструмент мягкой силы Модератор: [ФИО]")
        result = content.build_records(rows)
        self.assertEqual(1, len(result["topics"]))
        self.assertEqual([], result["badges"])

    def test_standalone_topic_parser_handles_unlabelled_people(self):
        result = topics.extract_session(
            "Мастер-классы министров по выбору\n"
            "С.О. Ануфриева, Министр молодежной политики\n"
            "М.А. Голубович, Министр молодежной политики"
        )
        self.assertEqual("Мастер-классы министров по выбору", result["topic"])

    def test_loads_records_from_ae_ready_tabs(self):
        ae_ready = {
            "tabs": {
                "content_plan_sessions": [{
                    "ДЕНЬ": "ДЕНЬ 1",
                    "ДАТА": "20.07",
                    "ВРЕМЯ": "10:00-11:00",
                    "ПЛОЩАДКА": "Амфитеатр",
                    "ТЕМА": "Тема открытия",
                    "ОПИСАНИЕ": "Описание",
                    "ТИП": "Панельная дискуссия",
                    "ИМЯ_КОМПОЗИЦИИ": "Амфитеатр/Тема открытия",
                    "ИСХОДНАЯ_ЯЧЕЙКА": "row 3, col B",
                }],
                "content_plan_plates": [{
                    "session_id": "session_1",
                    "person_id": "person_1",
                    "ДЕНЬ": "ДЕНЬ 1",
                    "ДАТА": "20.07",
                    "ВРЕМЯ": "10:00-11:00",
                    "НАЧАЛО": "10:00",
                    "ПЛОЩАДКА": "Амфитеатр",
                    "ФИО спикера": "Иванов Иван",
                    "Должность": "Директор",
                    "Фото на плашку": "",
                }],
                "content_plan_cards": [],
            },
            "resolved_sources": {},
            "source_texts": {},
        }

        result = content.load_records_from_ae_ready(ae_ready, [])

        self.assertEqual(1, result["report"]["sessions_found"])
        self.assertEqual("Тема открытия", result["topics"][0]["ТЕМА"])
        self.assertEqual("Иванов Иван", result["people"][0]["ФИО спикера"])
        self.assertEqual("Тема открытия", result["legacy_sessions"][0]["ИМЯ_КОМПОЗИЦИИ"])


if __name__ == "__main__":
    unittest.main()
