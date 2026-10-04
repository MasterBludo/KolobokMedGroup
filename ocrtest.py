import os
import pymupdf
import numpy as np
from PIL import Image
from rapidocr_onnxruntime import RapidOCR
from huggingface_hub import hf_hub_download

os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"


class DocumentOcrEngine:
    def __init__(self):
        print("Загрузка моделей PP-OCRv5...")
        det_path = hf_hub_download(repo_id="monkt/paddleocr-onnx", filename="detection/v5/det.onnx")
        rec_path = hf_hub_download(repo_id="monkt/paddleocr-onnx", filename="languages/eslav/rec.onnx")
        dict_path = hf_hub_download(repo_id="monkt/paddleocr-onnx", filename="languages/eslav/dict.txt")

        self.ocr = RapidOCR(
            det_model_path=det_path,
            rec_model_path=rec_path,
            rec_keys_path=dict_path
        )

        # Сниженные пороги детектора
        self.ocr.text_det.box_thresh = 0.25
        self.ocr.text_det.thresh = 0.20
        self.ocr.text_det.unclip_ratio = 1.6
        print("OCR готов к работе!\n")

    def _cluster_words_into_lines(self, ocr_results: list) -> str:
        """
        Умная группировка слов в строки с учетом колонок и разрывов.
        """
        if not ocr_results:
            return ""

        valid_boxes = []
        for box, text, score in ocr_results:
            text = text.strip()
            if not text:
                continue
            # Игнорируем микромусор
            if len(text) == 1 and score < 0.4:
                continue

            y_center = (box[0][1] + box[2][1]) / 2.0
            height = abs(box[2][1] - box[0][1])
            x_min = min(pt[0] for pt in box)
            x_max = max(pt[0] for pt in box)

            valid_boxes.append({
                "text": text,
                "score": score,
                "x_min": x_min,
                "x_max": x_max,
                "y_center": y_center,
                "height": height
            })

        if not valid_boxes:
            return ""

        # Сортируем все найденные блоки по высоте (Y)
        valid_boxes.sort(key=lambda b: b["y_center"])

        lines = []
        current_line = [valid_boxes[0]]

        for box in valid_boxes[1:]:
            prev_box = current_line[-1]
            tolerance = max(prev_box["height"], box["height"]) * 0.6

            # Если слова на одной высоте
            if abs(box["y_center"] - prev_box["y_center"]) <= tolerance:
                current_line.append(box)
            else:
                # Завершаем текущую строку: сортируем слова слева направо (по X)
                current_line.sort(key=lambda b: b["x_min"])

                # Проверяем на разрыв колонок (если между блоками дыра > 120px)
                line_str = ""
                for i, b in enumerate(current_line):
                    if i > 0:
                        prev = current_line[i - 1]
                        gap = b["x_min"] - prev["x_max"]
                        line_str += "    " if gap > 120 else " "
                    line_str += b["text"]

                lines.append(line_str)
                current_line = [box]

        # Добавляем оставшуюся строку
        if current_line:
            current_line.sort(key=lambda b: b["x_min"])
            line_str = ""
            for i, b in enumerate(current_line):
                if i > 0:
                    gap = b["x_min"] - current_line[i - 1]["x_max"]
                    line_str += "    " if gap > 120 else " "
                line_str += b["text"]
            lines.append(line_str)

        return "\n".join(lines)

    def process_file(self, file_path: str) -> str:
        """
        Принимает путь к PDF или изображению (PNG, JPG)
        и возвращает распознанный текст без сохранения дебаг-файлов.
        """
        doc = pymupdf.open(file_path)
        page = doc[0]

        # Рендерим страницу (300 DPI)
        pix = page.get_pixmap(dpi=300)
        img_pil = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        img_np = np.array(img_pil)

        # Вызываем OCR
        results, _ = self.ocr(img_np)

        # Собираем итоговый связный текст
        full_text = self._cluster_words_into_lines(results)
        doc.close()
        return full_text


if __name__ == "__main__":
    ocr_service = DocumentOcrEngine()
    test_file = r"C:\Users\Азим\Documents\питончек\meditron\img.png"

    if os.path.exists(test_file):
        print(f"Обработка: {test_file}...")
        text = ocr_service.process_file(test_file)
        print("\n" + "=" * 50)
        print("РАСПОЗНАННЫЙ ТЕКСТ:")
        print("=" * 50)
        print(text)
    else:
        print(f"Файл {test_file} не найден!")