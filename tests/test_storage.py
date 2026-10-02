import json
import tempfile
import unittest
from pathlib import Path

from models import ValidationError
from storage import JsonRepository


SETTING = {
    "id": "general",
    "name": "汎用分類",
    "axis_x": {"positive": "好き", "negative": "嫌い"},
    "axis_y": {"positive": "得意", "negative": "苦手"},
}
DATASET = {
    "id": "ideas",
    "name": "アイデア",
    "setting": "general",
    "items": [{
        "id": "idea-1",
        "name": "項目名",
        "display_name": "",
        "image": None,
        "x": 0.8,
        "y": -0.3,
        "note": "メモ",
        "tags": ["仕事"],
    }],
}


class JsonRepositoryTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.repository = JsonRepository(Path(self.temporary_directory.name) / "data")

    def tearDown(self):
        self.temporary_directory.cleanup()

    def test_setting_json_can_be_saved_and_loaded(self):
        self.repository.save_setting(SETTING)
        reloaded = JsonRepository(self.repository.data_dir)
        self.assertEqual(reloaded.list_settings(), [SETTING])

    def test_duplicate_setting_id_is_rejected(self):
        self.repository.save_setting(SETTING)
        with self.assertRaises(ValidationError):
            self.repository.save_setting(SETTING)

    def test_dataset_json_can_be_saved_and_loaded(self):
        self.repository.save_setting(SETTING)
        saved = self.repository.save_dataset(DATASET)
        reloaded = JsonRepository(self.repository.data_dir)
        self.assertEqual(reloaded.list_datasets(), [saved])
        self.assertEqual(reloaded.warnings, [])

    def test_dataset_duplicate_id_is_rejected(self):
        self.repository.save_setting(SETTING)
        self.repository.save_dataset(DATASET)
        with self.assertRaises(ValidationError):
            self.repository.save_dataset(DATASET)

    def test_invalid_json_is_reported_without_crashing(self):
        (self.repository.settings_dir / "broken.json").write_text("{bad", encoding="utf-8")
        self.assertEqual(self.repository.list_settings(), [])
        self.assertTrue(any("broken.json" in warning for warning in self.repository.warnings))

    def test_invalid_utf8_json_is_reported_without_crashing(self):
        (self.repository.settings_dir / "invalid-encoding.json").write_bytes(b"\xff\xfe")
        self.assertEqual(self.repository.list_settings(), [])
        self.assertTrue(any("invalid-encoding.json" in warning for warning in self.repository.warnings))

    def test_missing_setting_reference_is_reported_when_loading(self):
        broken_reference = {**DATASET, "setting": "unknown"}
        (self.repository.datasets_dir / "ideas.json").write_text(
            json.dumps(broken_reference), encoding="utf-8"
        )
        self.assertEqual(self.repository.list_datasets()[0]["setting"], "unknown")
        self.assertTrue(any("存在しない設定" in warning for warning in self.repository.warnings))
        with self.assertRaises(ValidationError):
            self.repository.save_dataset(broken_reference, overwrite=True)

    def test_missing_image_is_reported_and_can_be_repaired(self):
        self.repository.save_setting(SETTING)
        dataset = {**DATASET, "items": [{**DATASET["items"][0], "image": "missing.png"}]}
        (self.repository.datasets_dir / "ideas.json").write_text(json.dumps(dataset), encoding="utf-8")
        self.assertEqual(len(self.repository.list_datasets()), 1)
        self.assertTrue(any("画像が見つかりません" in warning for warning in self.repository.warnings))
        (self.repository.images_dir / "missing.png").write_bytes(b"image")
        self.assertEqual(self.repository.save_dataset(dataset, overwrite=True)["items"][0]["image"], "missing.png")

    def test_uploaded_image_is_saved_inside_images_directory(self):
        name = self.repository.save_image("cover.PNG", b"image")
        self.assertTrue((self.repository.images_dir / name).is_file())
        self.assertTrue(name.endswith(".png"))

    def test_unsupported_image_type_is_rejected(self):
        with self.assertRaises(ValidationError):
            self.repository.save_image("script.svg", b"content")


if __name__ == "__main__":
    unittest.main()
