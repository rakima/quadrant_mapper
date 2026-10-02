import tempfile
import unittest
from pathlib import Path

from models import (
    ValidationError,
    add_item,
    delete_item,
    display_label,
    prepare_dataset,
    prepare_setting,
    update_item,
)


SETTING = {
    "id": "general",
    "name": "汎用分類",
    "axis_x": {"positive": "Positive X", "negative": "Negative X"},
    "axis_y": {"positive": "Positive Y", "negative": "Negative Y"},
}


def item_data(**overrides):
    values = {
        "id": "item-1",
        "name": "項目名",
        "display_name": "",
        "image": None,
        "x": 0,
        "y": 0,
        "note": "",
        "tags": [],
    }
    values.update(overrides)
    return values


class ModelTests(unittest.TestCase):
    def test_setting_json_shape_is_normalized(self):
        self.assertEqual(prepare_setting(SETTING), SETTING)

    def test_setting_requires_all_labels(self):
        invalid = {**SETTING, "axis_y": {"positive": "Up"}}
        with self.assertRaises(ValidationError):
            prepare_setting(invalid)

    def test_coordinate_boundaries_are_valid(self):
        for coordinate in (-1, 0, 1):
            with self.subTest(coordinate=coordinate):
                dataset = {
                    "id": "bounds",
                    "name": "境界値",
                    "setting": "general",
                    "items": [item_data(x=coordinate, y=coordinate)],
                }
                prepared = prepare_dataset(dataset, {"general"})
                self.assertEqual(prepared["items"][0]["x"], float(coordinate))
                self.assertEqual(prepared["items"][0]["y"], float(coordinate))

    def test_out_of_range_non_finite_and_boolean_coordinates_are_rejected(self):
        for coordinate in (-1.01, 1.01, float("inf"), float("nan"), True):
            with self.subTest(coordinate=coordinate):
                dataset = {
                    "id": "invalid",
                    "name": "不正値",
                    "setting": "general",
                    "items": [item_data(x=coordinate)],
                }
                with self.assertRaises(ValidationError):
                    prepare_dataset(dataset, {"general"})

    def test_missing_setting_reference_is_rejected(self):
        dataset = {"id": "no-setting", "name": "参照切れ", "setting": "missing", "items": []}
        with self.assertRaises(ValidationError):
            prepare_dataset(dataset, {"general"})

    def test_display_name_falls_back_to_item_name(self):
        self.assertEqual(display_label(item_data()), "項目名")
        self.assertEqual(display_label(item_data(display_name="表示用")), "表示用")

    def test_tags_are_trimmed_and_deduplicated(self):
        dataset = {
            "id": "tagged",
            "name": "タグ",
            "setting": "general",
            "items": [item_data(tags=[" 音楽 ", "ゲーム", "音楽", "  "])],
        }
        prepared = prepare_dataset(dataset, {"general"})
        self.assertEqual(prepared["items"][0]["tags"], ["音楽", "ゲーム"])

    def test_item_add_edit_delete(self):
        dataset = {"id": "list", "name": "一覧", "setting": "general", "items": [item_data()]}
        second = item_data(id="item-2", name="追加")
        with_second = add_item(dataset, second)
        self.assertEqual(len(with_second["items"]), 2)

        edited = item_data(id="item-1", name="変更後")
        updated = update_item(with_second, "item-1", edited)
        self.assertEqual(updated["items"][0]["name"], "変更後")
        deleted = delete_item(updated, "item-2")
        self.assertEqual([entry["id"] for entry in deleted["items"]], ["item-1"])
        with self.assertRaises(ValidationError):
            delete_item(deleted, "missing")

    def test_image_path_must_exist_and_stay_inside_images_directory(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            images_dir = Path(temporary_directory) / "images"
            images_dir.mkdir()
            (images_dir / "cover.png").write_bytes(b"image")
            valid = {
                "id": "images",
                "name": "画像付き",
                "setting": "general",
                "items": [item_data(image="cover.png")],
            }
            self.assertEqual(prepare_dataset(valid, {"general"}, images_dir)["items"][0]["image"], "cover.png")
            self.assertEqual(prepare_dataset({**valid, "items": [item_data(image="images/cover.png")]}, {"general"}, images_dir)["items"][0]["image"], "cover.png")
            for invalid_path in ("missing.png", "../cover.png", "C:/secret.png"):
                with self.subTest(path=invalid_path):
                    invalid = {**valid, "items": [item_data(image=invalid_path)]}
                    with self.assertRaises(ValidationError):
                        prepare_dataset(invalid, {"general"}, images_dir)


if __name__ == "__main__":
    unittest.main()
