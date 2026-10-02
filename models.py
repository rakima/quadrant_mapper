"""Data validation and small domain helpers for the quadrant mapper."""

from __future__ import annotations

import math
import re
import uuid
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any


class ValidationError(ValueError):
    """Raised when user-provided data does not match the JSON model."""


_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")


def validate_id(value: Any, label: str = "ID") -> str:
    if not isinstance(value, str) or not _ID_PATTERN.fullmatch(value):
        raise ValidationError(f"{label}は英数字、ハイフン、アンダースコアで1〜64文字にしてください。")
    return value


def _required_text(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(f"{label}を入力してください。")
    return value.strip()


def prepare_setting(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise ValidationError("設定はJSONオブジェクトである必要があります。")
    setting_id = validate_id(data.get("id"), "設定ID")
    axes: dict[str, dict[str, str]] = {}
    for axis in ("axis_x", "axis_y"):
        values = data.get(axis)
        if not isinstance(values, dict):
            raise ValidationError(f"{axis}のpositive/negativeを指定してください。")
        axes[axis] = {
            "positive": _required_text(values.get("positive"), f"{axis} positive"),
            "negative": _required_text(values.get("negative"), f"{axis} negative"),
        }
    return {
        "id": setting_id,
        "name": _required_text(data.get("name"), "設定名"),
        **axes,
    }


def normalize_image_path(value: Any, images_dir: Path | None = None, check_exists: bool = True) -> str | None:
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise ValidationError("画像パスは文字列またはnullにしてください。")
    normalized = value.strip().replace("\\", "/")
    if normalized.startswith("images/"):
        normalized = normalized[len("images/"):]
    posix = PurePosixPath(normalized)
    windows = PureWindowsPath(normalized)
    if not normalized or posix.is_absolute() or windows.is_absolute() or windows.drive:
        raise ValidationError("画像パスはdata/images内の相対パスにしてください。")
    if any(part in ("", ".", "..") for part in posix.parts):
        raise ValidationError("画像パスに不正なディレクトリ指定があります。")
    if check_exists and images_dir is not None:
        target = (images_dir / Path(*posix.parts)).resolve()
        try:
            target.relative_to(images_dir.resolve())
        except ValueError as error:
            raise ValidationError("画像パスが許可された保存先の外を指しています。") from error
        if not target.is_file():
            raise ValidationError(f"画像ファイルが見つかりません: {normalized}")
    return posix.as_posix()


def validate_coordinate(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValidationError(f"{label}は-1から+1の数値にしてください。")
    coordinate = float(value)
    if not math.isfinite(coordinate) or not -1 <= coordinate <= 1:
        raise ValidationError(f"{label}は-1から+1の範囲にしてください。")
    return coordinate


def _prepare_item(item: Any, images_dir: Path | None, check_images: bool) -> dict[str, Any]:
    if not isinstance(item, dict):
        raise ValidationError("各項目はJSONオブジェクトである必要があります。")
    item_id = item.get("id") or str(uuid.uuid4())
    item_id = validate_id(item_id, "項目ID") if isinstance(item_id, str) and _ID_PATTERN.fullmatch(item_id) else str(item_id)
    name = _required_text(item.get("name"), "項目名")
    display_name = item.get("display_name", "")
    if not isinstance(display_name, str):
        raise ValidationError("表示名は文字列にしてください。")
    note = item.get("note", "")
    if not isinstance(note, str):
        raise ValidationError("noteは文字列にしてください。")
    tags = item.get("tags", [])
    if not isinstance(tags, list) or any(not isinstance(tag, str) for tag in tags):
        raise ValidationError("tagsは文字列の配列にしてください。")
    clean_tags = list(dict.fromkeys(tag.strip() for tag in tags if tag.strip()))
    return {
        "id": item_id,
        "name": name,
        "display_name": display_name.strip(),
        "image": normalize_image_path(item.get("image"), images_dir, check_images),
        "x": validate_coordinate(item.get("x"), "X評価"),
        "y": validate_coordinate(item.get("y"), "Y評価"),
        "note": note.strip(),
        "tags": clean_tags,
    }


def prepare_dataset(
    data: Any,
    setting_ids: set[str] | None = None,
    images_dir: Path | None = None,
    *,
    require_setting: bool = True,
    check_images: bool = True,
) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise ValidationError("データセットはJSONオブジェクトである必要があります。")
    dataset_id = validate_id(data.get("id"), "データセットID")
    setting_id = validate_id(data.get("setting"), "設定ID")
    if require_setting and setting_ids is not None and setting_id not in setting_ids:
        raise ValidationError(f"参照先の設定がありません: {setting_id}")
    items = data.get("items")
    if not isinstance(items, list):
        raise ValidationError("itemsは配列である必要があります。")
    prepared_items = [_prepare_item(item, images_dir, check_images) for item in items]
    item_ids = [item["id"] for item in prepared_items]
    if len(item_ids) != len(set(item_ids)):
        raise ValidationError("項目IDが重複しています。")
    return {
        "id": dataset_id,
        "name": _required_text(data.get("name"), "データセット名"),
        "setting": setting_id,
        "items": prepared_items,
    }


def display_label(item: dict[str, Any]) -> str:
    return item.get("display_name", "").strip() or item["name"]


def add_item(dataset: dict[str, Any], item: dict[str, Any]) -> dict[str, Any]:
    updated = dict(dataset)
    updated["items"] = [*dataset["items"], item]
    return updated


def update_item(dataset: dict[str, Any], item_id: str, item: dict[str, Any]) -> dict[str, Any]:
    if not any(existing["id"] == item_id for existing in dataset["items"]):
        raise ValidationError("編集する項目が見つかりません。")
    updated = dict(dataset)
    updated["items"] = [item if existing["id"] == item_id else existing for existing in dataset["items"]]
    return updated


def delete_item(dataset: dict[str, Any], item_id: str) -> dict[str, Any]:
    if not any(existing["id"] == item_id for existing in dataset["items"]):
        raise ValidationError("削除する項目が見つかりません。")
    updated = dict(dataset)
    updated["items"] = [item for item in dataset["items"] if item["id"] != item_id]
    return updated
