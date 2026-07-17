# -*- coding: utf-8 -*-
import csv
import json
import urllib.request
import os
import sys
from pathlib import Path

def get_safe_output_path(output_json_path):
    """
    Проверяем, можно ли записать в указанную папку.
    Если нет — используем папку Documents пользователя.
    """
    try:
        # Пробуем создать файл в указанной папке
        test_path = Path(output_json_path)
        test_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Проверяем права на запись
        with open(output_json_path, 'w', encoding='utf-8') as f:
            f.write('')
        os.remove(output_json_path)  # Удаляем тестовый файл
        
        return output_json_path
    except (PermissionError, OSError):
        # Если нет прав — используем Documents
        home = Path.home()
        documents_path = home / "Documents" / "ae_plaque_data"
        documents_path.mkdir(parents=True, exist_ok=True)
        
        # Сохраняем только имя файла
        filename = Path(output_json_path).name
        safe_path = documents_path / filename
        
        print(f"WARNING: Нет прав на запись в {output_json_path}")
        print(f"INFO: Сохраняем в {safe_path}")
        
        return safe_path

def download_and_convert(google_csv_url, output_json_path):
    """
    Скачивает CSV по ссылке и конвертирует в JSON
    """
    try:
        print(f"DEBUG: Загрузка с URL: {google_csv_url[:80]}...")
        
        # Добавляем User-Agent, чтобы Google не блокировал
        req = urllib.request.Request(google_csv_url, headers={'User-Agent': 'Mozilla/5.0'})
        
        with urllib.request.urlopen(req, timeout=30) as response:
            csv_data = response.read().decode('utf-8')
            print(f"DEBUG: Загружено байт: {len(csv_data)}")
        
        # Правильный парсинг CSV с учётом переносов строк
        import io
        reader = csv.DictReader(io.StringIO(csv_data))
        data_list = list(reader)
        print(f"DEBUG: Распарсено строк: {len(data_list)}")
        
        # Получаем безопасный путь для сохранения
        safe_path = get_safe_output_path(output_json_path)
        
        # Сохраняем JSON
        with open(safe_path, 'w', encoding='utf-8') as json_file:
            json.dump(data_list, json_file, ensure_ascii=False, indent=4)
        
        print(f"SUCCESS:{len(data_list)}")
        print(f"DEBUG: Файл сохранен: {safe_path}")
        return True
        
    except Exception as e:
        print(f"ERROR:{e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    print(f"DEBUG: Python version: {sys.version}")
    print(f"DEBUG: Arguments count: {len(sys.argv)}")
    
    if len(sys.argv) < 3:
        print("ERROR: Недостаточно аргументов")
        print(f"USAGE: python download_data.py <url> <output_json_path>")
        sys.exit(1)
    
    csv_url = sys.argv[1]
    json_path = sys.argv[2]
    
    print(f"DEBUG: Output path: {json_path}")
    
    success = download_and_convert(csv_url, json_path)
    sys.exit(0 if success else 1)