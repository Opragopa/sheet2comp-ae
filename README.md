# Sheets to AE Comp Generator

Набор скриптов для After Effects, которые создают композиции из таблиц, подставляют текст и фото, готовят данные из Google Sheets/TSV/CSV и помогают привести имена файлов в Render Queue к нужному формату.

## Что Запускать

| Задача | Скрипт | Где запускать |
| --- | --- | --- |
| Простые плашки из Google Sheets: имя + регалии в текстовых слоях | `Sheets-to-AE-Comp-Generator.jsx` | After Effects |
| Плашки персон с фото из листа `Справочник` | `person_plates_from_sheet.jsx` | After Effects |
| Добавить выбранные композиции в Render Queue и сократить имена файлов | `shorten_render_queue_names.jsx` | After Effects |
| Композиции с темами сессий из TSV/CSV/Google Sheet | `session_topics_from_sheet.jsx` | After Effects |
| Заранее скачать и переименовать фото для персон | `prepare_person_plate_photos.py` | Терминал |
| Достать темы сессий из большой программной таблицы в TSV | `extract_session_topics.py` | Терминал |
| Найти файлы на Яндекс.Диске по именам и выгрузить ссылки | `yandex_disk_links_from_names.py` | Терминал |
| Общая GUI-панель для Python-утилит | `tools_gui.py` | Python GUI |
| Запустить GUI-панель двойным кликом | `run_tools_gui_macos.command` / `run_tools_gui_windows.bat` | macOS / Windows |
| Скачать CSV и сохранить `data.json` для старого генератора | `download_data.py` | Вызывает `Sheets-to-AE-Comp-Generator.jsx` |
| Скачать CSV, фото и сохранить JSON для фото-плашек | `download_person_plate_data.py` | Вызывает `person_plates_from_sheet.jsx` и `prepare_person_plate_photos.py` |

## Требования

- Adobe After Effects 2024+
- Python 3
- Python-пакеты из `requirements.txt`
- Для Google Sheets: таблица должна быть доступна по ссылке или опубликована/export-доступна в CSV/TSV

Кириллица поддерживается: скрипты читают и пишут UTF-8, JSON сохраняется с русскими символами, а имена файлов чистятся только от запрещенных символов `\ / : * ? " < > |`.

## Установка

### macOS

```sh
chmod +x install_macos.sh
python3 -m pip install -r requirements.txt
./install_macos.sh
```

Если папка Scripts не найдена автоматически:

```sh
./install_macos.sh "/Applications/Adobe After Effects 2026/Scripts"
```

На macOS рабочие данные сохраняются в:

```text
~/Documents/ae_plaque_data
```

Это сделано специально: системная папка `Scripts` у After Effects часто защищена от записи.

### Windows

```bat
install_windows.bat
```

Если папка Scripts не найдена автоматически:

```bat
install_windows.bat "C:\Program Files\Adobe\Adobe After Effects 2026\Support Files\Scripts"
```

Установщики копируют в папку AE Scripts:

- `Sheets-to-AE-Comp-Generator.jsx`
- `person_plates_from_sheet.jsx`
- `shorten_render_queue_names.jsx`
- `session_topics_from_sheet.jsx`
- `session_topics_example.tsv`
- `download_data.py`
- `download_person_plate_data.py`
- `prepare_person_plate_photos.py`
- `extract_session_topics.py`
- `ae_parser_config.json` с путем к найденному Python

## Простые Плашки

Используйте `Sheets-to-AE-Comp-Generator.jsx`, если нужно быстро создать композиции из таблицы, где имя и регалии берутся из колонок и записываются прямо в текстовые слои.

### Таблица

Минимальные колонки:

```csv
ФИО спикера,Должность
Иванов Иван Иванович,Директор
```

ФИО автоматически приводится к виду `ИМЯ ФАМИЛИЯ`: отчество отбрасывается, переносы строк чистятся, варианты `Фамилия Имя Отчество`, `Фамилия Имя` и `Имя Фамилия` приводятся к одному формату.

Примеры:

```text
Элла Памфилова -> ЭЛЛА ПАМФИЛОВА
Федоренко Константин Альбертович -> КОНСТАНТИН ФЕДОРЕНКО
Любимова Ольга -> ОЛЬГА ЛЮБИМОВА
Васильев Владимир Абдуалиевич -> ВЛАДИМИР ВАСИЛЬЕВ
```

### Запуск

1. Откройте проект After Effects.
2. Выделите композицию-шаблон в Project.
3. Запустите `File > Scripts > Sheets-to-AE-Comp-Generator.jsx`.
4. Вставьте ссылку Google Sheets или CSV export.
5. Укажите колонки имени и должности, обычно `ФИО спикера` и `Должность`.
6. Укажите текстовые слои: обычно `ИМЯ` и `РЕГАЛИИ`.
7. Проверьте префикс и разделитель, обычно `Плашка` и `_`.
8. Нажмите `Проверить`, затем `Создать`.

### Результат

Композиции называются так:

```text
Плашка_ИМЯ ФАМИЛИЯ
```

Скрипт записывает `ИМЯ ФАМИЛИЯ` в слой имени обычным Source Text. Для слоя регалий он ставит Source Text expression автоподгонки размера: текст берется из колонки `Должность`, а размер управляется слайдерами `CONTROL`: `Regalia Base Size`, `Regalia Min Size`, `Regalia Chars Per Line`, `Regalia Max Lines`, `Regalia Manual Size`. Старый expression, который читал `thisComp.name.split(...)`, заменяется.

## Плашки С Фото

Используйте `person_plates_from_sheet.jsx`, если нужно создать плашки персон с именем, должностью и фотографией из справочника.

### Что Делает

- берет данные из листа `Справочник` (`gid=0`);
- скачивает фотографии из колонки `Фото на плашку`;
- поддерживает прямые ссылки на изображения, Google Drive file links и публичные ссылки/папки Яндекс.Диска;
- ищет уже скачанные фото в выбранной папке и не скачивает их повторно;
- фильтрует строки по колонке `Смена`, например только `единство`;
- дублирует активную композицию-шаблон;
- записывает `ИМЯ ФАМИЛИЯ` в текстовый слой `ИМЯ`;
- записывает должность в текстовый слой `ДОЛЖНОСТЬ`;
- заменяет фото в слое `Rectangle 3` или fallback-слое N6;
- умеет работать с фото-слоем внутри прекомпозиции;
- опционально добавляет созданные композиции в Render Queue.

### Таблица

Ожидаемые колонки:

```csv
ФИО спикера,Должность,Фото на плашку,Смена
Иванов Иван Иванович,Директор,https://...,единство
```

### Запуск

1. Откройте проект After Effects.
2. Выделите композицию-шаблон с текстовыми слоями `ИМЯ`, `ДОЛЖНОСТЬ` и фото-плейсхолдером.
3. Запустите `File > Scripts > person_plates_from_sheet.jsx`.
4. Во вкладке `Данные` проверьте источник `Справочник (лист gid=0)`.
5. В поле `Папка фото` выберите папку для скачивания и поиска фото.
6. Проверьте колонки `ФИО спикера`, `Должность`, `Фото на плашку`, `Смена`.
7. В поле `Выгрузить смены` укажите нужную смену. Если поле пустое, будут выгружены все строки.
8. Во вкладке `Слои` проверьте имена слоев или fallback-номера.
9. Нажмите `Проверить`, затем `Создать`.

### Имена И Слои

Композиции называются так:

```text
Плашка_001_ИМЯ ФАМИЛИЯ
```

Должность в имя композиции не добавляется, потому что она записывается прямо в текстовый слой `ДОЛЖНОСТЬ`.

По умолчанию используются:

- имя: слой `ИМЯ`, fallback N3;
- должность: слой `ДОЛЖНОСТЬ`, fallback N4;
- фото: слой `Rectangle 3`, fallback N6.

Если в колонке фото написан обычный текст без URL, композиция создается без фото и без ошибки загрузки.

## Подготовка Фото Без AE

Используйте `prepare_person_plate_photos.py`, если нужно заранее скачать фото из справочника до открытия After Effects.

```sh
python3 prepare_person_plate_photos.py --photos-dir "/Users/opragopa/Desktop/person-photos"
```

По умолчанию скрипт сохраняет:

```text
~/Documents/ae_plaque_data/person_plate_photos
~/Documents/ae_plaque_data/person_plates_data.json
```

Файлы фото называются по формату:

```text
ИМЯ ФАМИЛИЯ.jpg
```

## Ссылки С Яндекс.Диска По Именам

Используйте `yandex_disk_links_from_names.py`, если нужно без Apps Script вставить в таблицу список имен и получить рядом ссылки на найденные файлы Яндекс.Диска.

Подготовьте текстовый файл, где в каждой строке одно имя:

```text
Иван Иванов
Мария Петрова
```

Задайте OAuth-токен Яндекс.Диска:

```sh
export YANDEX_DISK_TOKEN="..."
```

Сгенерируйте TSV:

```sh
python3 yandex_disk_links_from_names.py names.txt --root "disk:/Фото" --publish -o links.tsv
```

Результат можно открыть или вставить в Google Sheets/Excel. Колонки:

```text
Имя	Ссылка	Файл	Путь	Статус
```

Если входной файл уже CSV/TSV с заголовком, укажите колонку:

```sh
python3 yandex_disk_links_from_names.py people.tsv --column "ФИО спикера" --root "disk:/Фото" --publish -o links.tsv
```

Флаг `--publish` делает найденный файл доступным по публичной ссылке. Без него скрипт вернет только уже опубликованные ссылки и пометит остальные строки статусом `найдено, но нет публичной ссылки; добавь --publish`.

## Общая GUI-Панель

Используйте `tools_gui.py`, если не хочется запускать Python-утилиты через Терминал.

```sh
python3 tools_gui.py
```

На macOS можно запускать двойным кликом:

```sh
chmod +x run_tools_gui_macos.command
./run_tools_gui_macos.command
```

На Windows:

```bat
run_tools_gui_windows.bat
```

Вкладки GUI:

- `Фото плашек` запускает `prepare_person_plate_photos.py`;
- `Темы сессий` запускает `extract_session_topics.py`;
- `Яндекс.Диск` запускает `yandex_disk_links_from_names.py`;
- `Служебные` запускает `download_data.py` и `download_person_plate_data.py`.

GUI использует стандартный `tkinter`, поэтому отдельные Python-пакеты для окна не нужны.

## Добавление В Render Queue

Используйте `shorten_render_queue_names.jsx`, если нужно добавить выбранные композиции в Render Queue без дублирования композиций в Project.

Скрипт подходит и для старых композиций с именами:

```text
Плашка_Имя Фамилия_Должность
```

Файлы при рендере будут называться без должности:

```text
Плашка_Имя Фамилия.mov
```

Папка экспорта создается рядом с сохраненным `.aep` проектом:

```text
<папка проекта>/EXPORT
```

### Запуск

1. Сохраните проект After Effects.
2. В Project выделите одну или несколько композиций.
3. Запустите `File > Scripts > shorten_render_queue_names.jsx`.
4. Оставьте разделитель `_`, если имена собраны через подчеркивание.
5. Скрипт добавит выбранные композиции в Render Queue и выставит Output Module в папку `EXPORT`.
6. Проверьте примеры в финальном сообщении скрипта.

Скрипт не дублирует и не переименовывает композиции. Он добавляет в очередь именно выбранные `CompItem`.

Кириллица сохраняется. Скрипт не транслитерирует русские буквы и чистит только запрещенные для файлов символы.

## Темы Сессий

Используйте `session_topics_from_sheet.jsx`, если нужно создать отдельную композицию на каждую тему сессии.

### Что Делает

- берет TSV/CSV/TXT файл, Google Sheet export URL или обычную Google Sheet edit-ссылку;
- в режиме `Программная таблица` достает `ТЕМА` из строки `Тема:`;
- в режиме `Программная таблица` берет `ОПИСАНИЕ` из текста перед файлом сценария, например `Главная встреча дня`;
- в режиме `Программная таблица` сканирует только колонки B, C и D;
- считает ячейку темой только если в ней есть `Эксперт:` или `Эксперты:`;
- допускает пустое `ОПИСАНИЕ`;
- ищет главную композицию, по умолчанию `Главная`;
- дублирует ее только для новых уникальных строк;
- меняет Source Text в слоях `ТЕМА` и `ОПИСАНИЕ`;
- при повторном запуске пропускает уже созданные темы;
- сохраняет очищенный TSV для ручной правки;
- опционально добавляет созданные композиции в Render Queue.

### Простой TSV

Пример есть в `session_topics_example.tsv`:

```tsv
ТЕМА	ОПИСАНИЕ
Название первой сессии	Описание первой сессии
Название второй сессии	Описание второй сессии
```

### Запуск В AE

1. Откройте проект After Effects.
2. Подготовьте главную композицию `Главная`.
3. Внутри `Главная` подготовьте текстовые слои `ТЕМА` и `ОПИСАНИЕ`.
4. Запустите `File > Scripts > session_topics_from_sheet.jsx`.
5. Выберите режим `Файл TSV/CSV/TXT` или вставьте Google Sheet URL.
6. Проверьте имена главной композиции и текстовых слоев.
7. Нажмите `Создать композиции`.

### Режим Программной Таблицы

Если исходная программа лежит в большой таблице с ячейками вида `Главная встреча дня`, `Сценарий_...docx`, `Тема: ...`, оставьте включенным режим `Программная таблица`.

Скрипт дополнительно сохраняет редактируемый TSV:

```text
~/Documents/ae_plaque_data/session_topics_extracted.tsv
```

После первого прогона можно открыть этот TSV, удалить лишние строки или поправить `ОПИСАНИЕ`, затем выбрать в AE режим `Файл TSV/CSV/TXT` и указать отредактированный файл.

## Извлечение Тем Без AE

Используйте `extract_session_topics.py`, если нужно подготовить TSV из программной таблицы до запуска After Effects.

```sh
python3 extract_session_topics.py "https://docs.google.com/spreadsheets/d/.../edit?gid=213088400#gid=213088400" -o session_topics_extracted.tsv
```

Если нужно искать только в одной колонке:

```sh
python3 extract_session_topics.py "program.tsv" -o session_topics_extracted.tsv --source-column "Название колонки"
```

Скрипт принимает Google Sheet URL, CSV/TSV export URL или локальный TSV/CSV/TXT файл.

## Служебные Скрипты

### `download_data.py`

Скачивает CSV из Google Sheets и сохраняет `data.json` для `Sheets-to-AE-Comp-Generator.jsx`.

Обычно вручную запускать не нужно: After Effects вызывает его сам.

Ручной запуск:

```sh
python3 download_data.py "https://docs.google.com/spreadsheets/d/.../gviz/tq?tqx=out:csv&gid=0" "/tmp/data.json"
```

### `download_person_plate_data.py`

Скачивает данные для `person_plates_from_sheet.jsx`, нормализует ФИО, скачивает фото и сохраняет JSON.

Обычно вручную запускать не нужно: его вызывают `person_plates_from_sheet.jsx` и `prepare_person_plate_photos.py`.

Ручной запуск:

```sh
python3 download_person_plate_data.py "SHEET_URL" "/tmp/person_plates_data.json" "/tmp/person_photos" "Фото на плашку" "ФИО спикера"
```

## Частые Проблемы

### `HTTP 401 Unauthorized`

Python не имеет доступа к Google Sheets. Откройте доступ к таблице для просмотра по ссылке, опубликуйте лист в CSV/TSV или скачайте таблицу как локальный CSV/TSV.

### AE не видит новые скрипты

Перезапустите After Effects после установки. Скрипты должны лежать в папке `Scripts`, а не `ScriptUI Panels`.

### Не найден текстовый слой

Проверьте имя слоя в AE и настройки во вкладке `Слои`. Для фото-плашек есть fallback по номеру слоя: `ИМЯ` N3, `ДОЛЖНОСТЬ` N4, фото N6.

### Файл рендера все еще с должностью

Выделите композиции в Project и запустите `shorten_render_queue_names.jsx`. Скрипт сам добавляет их в Render Queue и ставит короткое имя файла в `<папка проекта>/EXPORT`.

### В Render Queue вместо кириллицы `????????`

Обновите `shorten_render_queue_names.jsx` в папке AE Scripts через установщик и перезапустите After Effects. Актуальная версия создает файл через ASCII-заглушку в `EXPORT`, затем меняет имя через `File.changePath`, чтобы AE не терял русские буквы при присваивании `outputModule.file`.

## Файлы Проекта

| Файл | Назначение |
| --- | --- |
| `Sheets-to-AE-Comp-Generator.jsx` | Старший генератор простых плашек по Google Sheets |
| `person_plates_from_sheet.jsx` | Генератор персональных плашек с фото, именем, должностью и фильтром смены |
| `shorten_render_queue_names.jsx` | Добавляет выбранные композиции в Render Queue и укорачивает имена файлов |
| `session_topics_from_sheet.jsx` | Генератор композиций с темами и описаниями сессий |
| `session_topics_example.tsv` | Пример TSV для тем сессий |
| `download_data.py` | Скачивает CSV и пишет JSON для простых плашек |
| `download_person_plate_data.py` | Скачивает справочник персон, фото и JSON для фото-плашек |
| `prepare_person_plate_photos.py` | CLI-обертка для предварительной подготовки фото |
| `extract_session_topics.py` | CLI-утилита для извлечения тем сессий в TSV |
| `yandex_disk_links_from_names.py` | CLI-утилита для поиска файлов на Яндекс.Диске по именам и выгрузки ссылок |
| `tools_gui.py` | Общая GUI-панель для запуска Python-утилит проекта |
| `run_tools_gui_macos.command` | macOS-лаунчер GUI-панели |
| `run_tools_gui_windows.bat` | Windows-лаунчер GUI-панели |
| `install_macos.sh` | Установка скриптов в After Effects на macOS |
| `install_windows.bat` | Установка скриптов в After Effects на Windows |
| `requirements.txt` | Python-зависимости |
