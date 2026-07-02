# Sheets to AE Comp Generator

Генератор композиций After Effects из Google Sheets CSV.

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

## Использование

1. Откройте проект After Effects.
2. Выделите композицию-шаблон в Project.
3. Запустите `File > Scripts > Sheets-to-AE-Comp-Generator.jsx`.
4. Вставьте ссылку Google Sheets или CSV export.
5. Укажите названия колонок.
6. Нажмите `Проверить данные`, затем `Создать плашки`.

## Формат таблицы

Минимальные колонки:

```csv
ФИО спикера,Должность
Иван Иванов,Директор
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
- `download_data.py` — загрузка CSV и конвертация в JSON
- `install_windows.bat` — установка Windows
- `install_macos.sh` — установка macOS
