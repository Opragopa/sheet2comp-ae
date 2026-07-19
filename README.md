# Sheets to AE Comp Generator

Набор скриптов After Effects для генерации композиций из табличных данных.

## Требования

- Adobe After Effects 2024+
- Python 3
- Python-пакеты из `requirements.txt`
- Google Sheet должен быть доступен по CSV/export ссылке

## Установка Windows

```bat
install_windows.bat
```

Если AE не найден автоматически:

```bat
install_windows.bat "C:\Program Files\Adobe\Adobe After Effects 2026\Support Files\Scripts"
```

## Установка macOS

```sh
chmod +x install_macos.sh
python3 -m pip install -r requirements.txt
./install_macos.sh
```

Если AE не найден автоматически:

```sh
./install_macos.sh "/Applications/Adobe After Effects 2026/Scripts"
```

## Плашки из Google Sheets

1. Откройте проект After Effects.
2. Выделите композицию-шаблон в Project.
3. Запустите `File > Scripts > Sheets-to-AE-Comp-Generator.jsx`.
4. Вставьте ссылку Google Sheets или CSV export.
5. Укажите названия колонок.
6. Нажмите `Проверить данные`, затем `Создать плашки`.

## Формат таблицы

Минимальные колонки для плашек:

```csv
ФИО спикера,Должность
Иванов Иван Иванович,Директор
```

ФИО автоматически приводится к виду `ИМЯ ФАМИЛИЯ`: отчество всегда отбрасывается, переносы строк внутри ФИО чистятся, а варианты `Фамилия Имя Отчество`, `Фамилия Имя` и `Имя Фамилия` приводятся к одному формату.

Примеры нормализации:

```text
Элла Памфилова -> ЭЛЛА ПАМФИЛОВА
Федоренко Константин Альбертович -> КОНСТАНТИН ФЕДОРЕНКО
Любимова Ольга -> ОЛЬГА ЛЮБИМОВА
Васильев Владимир Абдуалиевич -> ВЛАДИМИР ВАСИЛЬЕВ
```

## Темы сессий из TSV/CSV

Скрипт `session_topics_from_sheet.jsx` создает отдельную композицию на каждую строку таблицы.

Что он делает:

- берет данные из TSV/CSV/TXT файла или Google Sheet URL, который отдает CSV/TSV;
- ищет главную композицию, по умолчанию `Главная`;
- дублирует ее на каждую строку;
- внутри каждой новой композиции находит текстовые слои `ТЕМА` и `ОПИСАНИЕ`;
- меняет им `Source Text`;
- опционально добавляет созданные композиции в Render Queue.

Запуск:

1. Откройте проект After Effects.
2. Подготовьте главную композицию `Главная` с текстовыми слоями `ТЕМА` и `ОПИСАНИЕ`.
3. Запустите `File > Scripts > session_topics_from_sheet.jsx`.
4. Выберите TSV/CSV/TXT файл или вставьте Google Sheet CSV/TSV URL.
5. Нажмите `Создать композиции`.

Пример входного TSV есть в `session_topics_example.tsv`:

```tsv
ТЕМА	ОПИСАНИЕ
Название первой сессии	Описание первой сессии
Название второй сессии	Описание второй сессии
```

## Expressions

Для имени:

```js
thisComp.name.split("_")[1]
```

Для должности:

```js
thisComp.name.split("_")[2]
```

## Файлы

- `Sheets-to-AE-Comp-Generator.jsx` — скрипт After Effects
- `session_topics_from_sheet.jsx` — создание композиций с темами и описаниями сессий
- `session_topics_example.tsv` — пример таблицы для `session_topics_from_sheet.jsx`
- `download_data.py` — загрузка CSV и конвертация в JSON
- `install_windows.bat` — установка Windows
- `install_macos.sh` — установка macOS
