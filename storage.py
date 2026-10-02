"""JSON-backed repository. UI and HTTP handlers do not write files directly."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

from models import ValidationError, prepare_dataset, prepare_setting


class JsonRepository:
    def __init__(self, data_dir: Path | str):
        self.data_dir = Path(data_dir)
        self.settings_dir = self.data_dir / "settings"
        self.datasets_dir = self.data_dir / "datasets"
        self.images_dir = self.data_dir / "images"
        for directory in (self.settings_dir, self.datasets_dir, self.images_dir):
            directory.mkdir(parents=True, exist_ok=True)
        self.warnings: list[str] = []

    @staticmethod
    def _read_json(path: Path) -> Any:
        with path.open("r", encoding="utf-8") as file:
            return json.load(file)

    @staticmethod
    def _write_json(path: Path, data: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                "w", encoding="utf-8", dir=path.parent, suffix=".tmp", delete=False
            ) as file:
                json.dump(data, file, ensure_ascii=False, indent=2, allow_nan=False)
                file.write("\n")
                temporary_path = Path(file.name)
            os.replace(temporary_path, path)
        finally:
            if temporary_path is not None and temporary_path.exists():
                temporary_path.unlink()

    @staticmethod
    def _json_files(directory: Path) -> list[Path]:
        return sorted(directory.glob("*.json"), key=lambda path: path.name.lower())

    def list_settings(self) -> list[dict[str, Any]]:
        self.warnings = []
        settings: list[dict[str, Any]] = []
        for path in self._json_files(self.settings_dir):
            try:
                setting = prepare_setting(self._read_json(path))
                if setting["id"] != path.stem:
                    raise ValidationError("ファイル名と設定IDが一致しません。")
                settings.append(setting)
            except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValidationError) as error:
                self.warnings.append(f"設定 {path.name} を読み込めません: {error}")
        return settings

    def save_setting(self, data: Any, *, overwrite: bool = False) -> dict[str, Any]:
        setting = prepare_setting(data)
        destination = self.settings_dir / f"{setting['id']}.json"
        if destination.exists() and not overwrite:
            raise ValidationError(f"設定IDが重複しています: {setting['id']}")
        self._write_json(destination, setting)
        return setting

    def list_datasets(self) -> list[dict[str, Any]]:
        settings = self.list_settings()
        setting_ids = {setting["id"] for setting in settings}
        warnings = self.warnings.copy()
        datasets: list[dict[str, Any]] = []
        for path in self._json_files(self.datasets_dir):
            try:
                dataset = prepare_dataset(
                    self._read_json(path), setting_ids, self.images_dir,
                    require_setting=False, check_images=False,
                )
                if dataset["id"] != path.stem:
                    raise ValidationError("ファイル名とデータセットIDが一致しません。")
                if dataset["setting"] not in setting_ids:
                    warnings.append(f"データセット {dataset['id']} が存在しない設定を参照しています: {dataset['setting']}")
                for item in dataset["items"]:
                    if item["image"] and not (self.images_dir / item["image"]).is_file():
                        warnings.append(f"項目「{item['name']}」の画像が見つかりません: {item['image']}")
                datasets.append(dataset)
            except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValidationError) as error:
                warnings.append(f"データセット {path.name} を読み込めません: {error}")
        self.warnings = warnings
        return datasets

    def save_dataset(self, data: Any, *, overwrite: bool = False) -> dict[str, Any]:
        setting_ids = {setting["id"] for setting in self.list_settings()}
        dataset = prepare_dataset(data, setting_ids, self.images_dir)
        destination = self.datasets_dir / f"{dataset['id']}.json"
        if destination.exists() and not overwrite:
            raise ValidationError(f"データセットIDが重複しています: {dataset['id']}")
        self._write_json(destination, dataset)
        return dataset

    def save_image(self, filename: str, content: bytes) -> str:
        suffix = Path(filename).suffix.lower()
        if suffix not in {".png", ".jpg", ".jpeg", ".gif", ".webp"}:
            raise ValidationError("画像はPNG、JPG、GIF、WebP形式にしてください。")
        if not content:
            raise ValidationError("画像ファイルが空です。")
        if len(content) > 10 * 1024 * 1024:
            raise ValidationError("画像は10MB以下にしてください。")
        import uuid

        stored_name = f"{uuid.uuid4().hex}{suffix}"
        target = self.images_dir / stored_name
        target.write_bytes(content)
        return stored_name
