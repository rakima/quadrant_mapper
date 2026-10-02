import { BrowserRepository } from './storage.mjs';

const repository = new BrowserRepository();
const imageUrls = new Map();
const state = {
  settings: [],
  datasets: [],
  images: new Map(),
  dataset: null,
  datasetExists: false,
  settingId: null,
  settingExists: false,
  editingItemId: null,
  selectedMapItemId: null,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const settingForm = $('#setting-form');
const datasetForm = $('#dataset-form');
const itemDialog = $('#item-dialog');
const itemForm = $('#item-form');

function notify(message, isError = false) {
  const notice = $('#notice');
  notice.textContent = message;
  notice.classList.toggle('error', isError);
  notice.hidden = false;
  window.clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => { notice.hidden = true; }, 4200);
}

function setTab(name) {
  $$('.tab').forEach((button) => button.classList.toggle('active', button.dataset.tab === name));
  ['settings', 'data', 'map'].forEach((panel) => {
    $(`#panel-${panel}`).hidden = panel !== name;
  });
  if (name === 'map') renderMap();
}

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function imageUrl(image) {
  if (!image) return '';
  if (!imageUrls.has(image)) {
    const blob = state.images.get(image);
    if (!blob) return '';
    imageUrls.set(image, URL.createObjectURL(blob));
  }
  return imageUrls.get(image);
}

function showWarnings(warnings = []) {
  const container = $('#warnings');
  container.replaceChildren();
  if (!warnings.length) {
    container.hidden = true;
    return;
  }
  const title = document.createElement('strong');
  title.textContent = '一部の保存データに注意があります';
  const list = document.createElement('ul');
  warnings.forEach((warning) => {
    const row = document.createElement('li');
    row.textContent = warning;
    list.append(row);
  });
  container.append(title, list);
  container.hidden = false;
}

function renderSettings() {
  const list = $('#setting-list');
  list.replaceChildren();
  $('#setting-count').textContent = String(state.settings.length);
  $('#setting-empty').hidden = state.settings.length > 0;
  state.settings.forEach((setting) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `select-row${setting.id === state.settingId ? ' active' : ''}`;
    const name = document.createElement('strong');
    name.textContent = setting.name;
    const detail = document.createElement('small');
    detail.textContent = `${setting.axis_x.negative} ↔ ${setting.axis_x.positive}　·　${setting.axis_y.negative} ↔ ${setting.axis_y.positive}`;
    button.append(name, detail);
    button.addEventListener('click', () => editSetting(setting));
    list.append(button);
  });
  renderSettingChoices();
}

function renderSettingChoices() {
  const select = datasetForm.elements.setting;
  const previous = select.value;
  select.replaceChildren(new Option('設定を選択', ''));
  state.settings.forEach((setting) => select.add(new Option(setting.name, setting.id)));
  if (state.settings.some((setting) => setting.id === previous)) select.value = previous;
  else if (state.settings.length === 1) select.value = state.settings[0].id;
}

function clearSettingForm() {
  settingForm.reset();
  state.settingId = null;
  state.settingExists = false;
  settingForm.elements.id.disabled = false;
  $('#setting-form-title').textContent = '新しい設定';
  $('#setting-mode').textContent = '新規作成';
  renderSettings();
}

function editSetting(setting) {
  state.settingId = setting.id;
  state.settingExists = true;
  settingForm.elements.id.value = setting.id;
  settingForm.elements.id.disabled = true;
  settingForm.elements.name.value = setting.name;
  settingForm.elements.x_positive.value = setting.axis_x.positive;
  settingForm.elements.x_negative.value = setting.axis_x.negative;
  settingForm.elements.y_positive.value = setting.axis_y.positive;
  settingForm.elements.y_negative.value = setting.axis_y.negative;
  $('#setting-form-title').textContent = setting.name;
  $('#setting-mode').textContent = '編集中 · IDは変更できません';
  renderSettings();
}

function renderDatasetOptions() {
  const select = $('#dataset-select');
  const mapSelect = $('#map-dataset-select');
  const selected = state.dataset?.id || '';
  const mapSelected = mapSelect.value;
  [select, mapSelect].forEach((element) => {
    element.replaceChildren(new Option('データセットを選択', ''));
    state.datasets.forEach((dataset) => element.add(new Option(dataset.name, dataset.id)));
  });
  select.value = state.datasets.some((dataset) => dataset.id === selected) ? selected : '';
  if (state.datasets.some((dataset) => dataset.id === mapSelected)) mapSelect.value = mapSelected;
  else if (state.datasets.length) mapSelect.value = state.datasets[0].id;
}

function renderDataset() {
  const hasDraft = state.dataset !== null;
  $('#dataset-workspace').hidden = !hasDraft;
  $('#no-dataset').hidden = hasDraft;
  renderDatasetOptions();
  if (!hasDraft) return;

  datasetForm.elements.id.value = state.dataset.id;
  datasetForm.elements.id.disabled = state.datasetExists;
  datasetForm.elements.name.value = state.dataset.name;
  const settingSelect = datasetForm.elements.setting;
  settingSelect.value = state.dataset.setting;
  $('#dataset-mode').textContent = state.datasetExists ? '保存済みデータセット' : '新規データセット · 先に保存してください';
  $('#dataset-save-state').textContent = state.datasetExists ? '設定変更は「データセットを保存」で反映' : 'データセットを保存すると項目を追加できます';

  const itemList = $('#item-list');
  itemList.replaceChildren();
  $('#item-count').textContent = String(state.dataset.items.length);
  $('#items-empty').hidden = state.dataset.items.length > 0;
  $('#new-item').disabled = !state.datasetExists || !state.dataset.setting;
  state.dataset.items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'item-row';
    const thumb = item.image ? document.createElement('img') : document.createElement('span');
    thumb.className = 'item-thumb';
    if (item.image) {
      thumb.src = imageUrl(item.image);
      thumb.alt = '';
    } else {
      thumb.textContent = displayLabel(item).slice(0, 1) || '•';
    }
    const main = document.createElement('div');
    main.className = 'item-row-main';
    const title = document.createElement('strong');
    title.textContent = displayLabel(item);
    const subtitle = document.createElement('small');
    subtitle.textContent = item.tags.length ? item.tags.join(' · ') : item.name;
    main.append(title, subtitle);
    const coordinates = document.createElement('span');
    coordinates.className = 'item-coordinates';
    coordinates.textContent = `${formatCoordinate(item.x)}, ${formatCoordinate(item.y)}`;
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'row-action';
    edit.textContent = '編集';
    edit.addEventListener('click', () => openItemDialog(item));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'row-action delete';
    remove.textContent = '削除';
    remove.addEventListener('click', () => removeItem(item.id));
    row.append(thumb, main, coordinates, edit, remove);
    itemList.append(row);
  });
}

function displayLabel(item) {
  return item.display_name?.trim() || item.name;
}

function formatCoordinate(value) {
  return `${value > 0 ? '+' : ''}${Number(value).toFixed(2)}`;
}

function syncPosition(axis, value) {
  const numeric = Math.max(-1, Math.min(1, Number(value)));
  if (!Number.isFinite(numeric)) return;
  const formatted = numeric.toFixed(2);
  itemForm.elements[axis].value = formatted;
  itemForm.elements[`${axis}_range`].value = formatted;
  $(`#readout-${axis}`).textContent = formatted;
  const left = (Number(itemForm.elements.x.value) + 1) * 50;
  const top = (1 - Number(itemForm.elements.y.value)) * 50;
  $('#mini-marker').style.left = `${left}%`;
  $('#mini-marker').style.top = `${top}%`;
}

function applyAxisLabels() {
  const setting = state.settings.find((entry) => entry.id === state.dataset?.setting);
  const xPositive = setting?.axis_x.positive || 'X positive';
  const xNegative = setting?.axis_x.negative || 'X negative';
  const yPositive = setting?.axis_y.positive || 'Y positive';
  const yNegative = setting?.axis_y.negative || 'Y negative';
  $('#x-range-label').textContent = `${xNegative} (−1)　〜　${xPositive} (＋1)`;
  $('#y-range-label').textContent = `${yNegative} (−1)　〜　${yPositive} (＋1)`;
  $('#mini-left').textContent = xNegative;
  $('#mini-right').textContent = xPositive;
}

function openItemDialog(item = null) {
  if (!state.datasetExists) return;
  state.editingItemId = item?.id || null;
  itemForm.reset();
  itemForm.elements.image.value = item?.image || '';
  $('#item-dialog-title').textContent = item ? '項目を編集' : '項目を追加';
  itemForm.elements.name.value = item?.name || '';
  itemForm.elements.display_name.value = item?.display_name || '';
  itemForm.elements.note.value = item?.note || '';
  itemForm.elements.tags.value = item?.tags.join(', ') || '';
  syncPosition('x', item?.x ?? 0);
  syncPosition('y', item?.y ?? 0);
  applyAxisLabels();
  refreshImagePreview(item?.image || '');
  $('#image-upload').value = '';
  itemDialog.showModal();
}

function refreshImagePreview(image) {
  const preview = $('#image-preview');
  const imageName = $('#image-name');
  const clearButton = $('#clear-image');
  if (!image) {
    preview.hidden = true;
    preview.removeAttribute('src');
    imageName.textContent = '画像なし';
    clearButton.hidden = true;
  } else {
    preview.src = imageUrl(image);
    preview.hidden = false;
    imageName.textContent = image.split('/').at(-1);
    clearButton.hidden = false;
  }
}

async function saveDataset() {
  if (!datasetForm.reportValidity()) return false;
  const id = datasetForm.elements.id.value.trim();
  const dataset = {
    id,
    name: datasetForm.elements.name.value.trim(),
    setting: datasetForm.elements.setting.value,
    items: state.dataset.items,
  };
  try {
    const saved = await repository.saveDataset(dataset, { overwrite: state.datasetExists });
    state.dataset = saved;
    state.datasetExists = true;
    upsert(state.datasets, saved);
    state.selectedMapItemId = null;
    renderDataset();
    renderMap();
    notify('データセットを保存しました。');
    return true;
  } catch (error) {
    notify(error.message, true);
    return false;
  }
}

function upsert(collection, item) {
  const index = collection.findIndex((entry) => entry.id === item.id);
  if (index < 0) collection.push(item);
  else collection[index] = item;
}

async function removeItem(itemId) {
  const item = state.dataset.items.find((entry) => entry.id === itemId);
  if (!item || !window.confirm(`「${displayLabel(item)}」を削除しますか？`)) return;
  const original = state.dataset;
  state.dataset = { ...original, items: original.items.filter((entry) => entry.id !== itemId) };
  try {
    const saved = await repository.saveDataset(state.dataset, { overwrite: true });
    state.dataset = saved;
    upsert(state.datasets, saved);
    renderDataset();
    renderMap();
    notify('項目を削除しました。');
  } catch (error) {
    state.dataset = original;
    notify(error.message, true);
  }
}

function renderMap() {
  const select = $('#map-dataset-select');
  const dataset = state.datasets.find((entry) => entry.id === select.value) || state.datasets[0] || null;
  const available = Boolean(dataset);
  $('#map-workspace').hidden = !available;
  $('#no-map-data').hidden = available;
  if (!available) return;

  select.value = dataset.id;
  const setting = state.settings.find((entry) => entry.id === dataset.setting);
  const xPositive = setting?.axis_x.positive || 'X positive';
  const xNegative = setting?.axis_x.negative || 'X negative';
  const yPositive = setting?.axis_y.positive || 'Y positive';
  const yNegative = setting?.axis_y.negative || 'Y negative';
  $('#axis-top').textContent = yPositive;
  $('#axis-bottom').textContent = yNegative;
  $('#axis-left').textContent = xNegative;
  $('#axis-right').textContent = xPositive;
  $('#label-q1').textContent = `${xNegative} × ${yPositive}`;
  $('#label-q2').textContent = `${xPositive} × ${yPositive}`;
  $('#label-q3').textContent = `${xPositive} × ${yNegative}`;
  $('#label-q4').textContent = `${xNegative} × ${yNegative}`;
  $('#map-subtitle').textContent = `${dataset.name} · ${setting?.name || `設定なし (${dataset.setting})`}`;

  const tagFilter = $('#tag-filter');
  const previousTag = tagFilter.value;
  const tags = [...new Set(dataset.items.flatMap((item) => item.tags))].sort((a, b) => a.localeCompare(b, 'ja'));
  tagFilter.replaceChildren(new Option('すべてのタグ', ''));
  tags.forEach((tag) => tagFilter.add(new Option(tag, tag)));
  if (tags.includes(previousTag)) tagFilter.value = previousTag;
  const visibleItems = dataset.items.filter((item) => !tagFilter.value || item.tags.includes(tagFilter.value));
  $('#map-item-count').textContent = `${visibleItems.length} / ${dataset.items.length}項目を表示`;
  if (!visibleItems.some((item) => item.id === state.selectedMapItemId)) {
    state.selectedMapItemId = visibleItems[0]?.id || null;
  }
  renderMapPoints(visibleItems);
  renderMapItemList(visibleItems);
  renderMapDetail(dataset.items.find((item) => item.id === state.selectedMapItemId));
}

function renderMapPoints(items) {
  const container = $('#map-points');
  container.replaceChildren();
  const groups = new Map();
  items.forEach((item) => {
    const key = `${item.x.toFixed(2)}:${item.y.toFixed(2)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  const spread = [[0, 0], [9, -9], [-9, 9], [9, 9], [-9, -9], [18, 0], [-18, 0], [0, 18], [0, -18]];
  groups.forEach((group) => group.forEach((item, index) => {
    const point = document.createElement('button');
    point.type = 'button';
    point.className = `map-point${item.id === state.selectedMapItemId ? ' selected' : ''}`;
    const [offsetX, offsetY] = spread[index % spread.length];
    point.style.left = `calc(${((item.x + 1) * 50).toFixed(2)}% + ${offsetX}px)`;
    point.style.top = `calc(${((1 - item.y) * 50).toFixed(2)}% + ${offsetY}px)`;
    point.title = `${displayLabel(item)} · X ${formatCoordinate(item.x)}, Y ${formatCoordinate(item.y)}`;
    if (item.image) {
      const image = document.createElement('img');
      image.className = 'point-thumb';
      image.src = imageUrl(item.image);
      image.alt = '';
      point.append(image);
    } else {
      const dot = document.createElement('span');
      dot.className = 'point-dot';
      point.append(dot);
    }
    const label = document.createElement('span');
    label.className = 'point-label';
    label.textContent = displayLabel(item);
    point.append(label);
    point.addEventListener('click', () => selectMapItem(item.id));
    container.append(point);
  }));
}

function renderMapItemList(items) {
  const container = $('#map-item-list');
  container.replaceChildren();
  items.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `map-item-chip${item.id === state.selectedMapItemId ? ' selected' : ''}`;
    if (item.image) {
      const image = document.createElement('img');
      image.src = imageUrl(item.image);
      image.alt = '';
      button.append(image);
    }
    const name = document.createElement('span');
    name.textContent = `${displayLabel(item)} · ${formatCoordinate(item.x)}, ${formatCoordinate(item.y)}`;
    button.append(name);
    button.addEventListener('click', () => selectMapItem(item.id));
    container.append(button);
  });
  if (!items.length) {
    const empty = document.createElement('span');
    empty.className = 'muted-label';
    empty.textContent = 'このタグに一致する項目はありません。';
    container.append(empty);
  }
}

function selectMapItem(itemId) {
  state.selectedMapItemId = itemId;
  renderMap();
}

function renderMapDetail(item) {
  const detail = $('#map-detail');
  detail.replaceChildren();
  if (!item) {
    detail.className = 'map-detail empty-detail';
    const placeholder = document.createElement('span');
    placeholder.className = 'detail-placeholder';
    placeholder.innerHTML = 'マップ上の項目を選ぶと<br>詳細がここに表示されます。';
    detail.append(placeholder);
    return;
  }
  detail.className = 'map-detail';
  if (item.image) {
    const image = document.createElement('img');
    image.className = 'detail-preview';
    image.src = imageUrl(item.image);
    image.alt = displayLabel(item);
    image.onerror = () => { image.hidden = true; };
    detail.append(image);
  } else {
    const noImage = document.createElement('div');
    noImage.className = 'detail-no-image';
    noImage.textContent = displayLabel(item).slice(0, 1) || '•';
    detail.append(noImage);
  }
  const title = document.createElement('h3');
  title.className = 'detail-title';
  title.textContent = displayLabel(item);
  const name = document.createElement('p');
  name.className = 'detail-name';
  name.textContent = item.name;
  const coordinates = document.createElement('div');
  coordinates.className = 'coordinate-chips';
  coordinates.append(makeCoordinateChip('X', item.x), makeCoordinateChip('Y', item.y));
  detail.append(title, name, coordinates);
  const note = document.createElement('div');
  note.className = 'detail-section';
  const noteLabel = document.createElement('label');
  noteLabel.textContent = 'NOTE';
  const noteText = document.createElement('div');
  noteText.className = 'detail-note';
  noteText.textContent = item.note || 'メモはありません。';
  note.append(noteLabel, noteText);
  const tags = document.createElement('div');
  tags.className = 'detail-section';
  const tagsLabel = document.createElement('label');
  tagsLabel.textContent = 'TAGS';
  tags.append(tagsLabel);
  if (item.tags.length) item.tags.forEach((tag) => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.textContent = tag;
    tags.append(chip);
  });
  else {
    const noTags = document.createElement('span');
    noTags.className = 'muted-label';
    noTags.textContent = 'タグなし';
    tags.append(noTags);
  }
  detail.append(note, tags);
}

function makeCoordinateChip(axis, value) {
  const chip = document.createElement('span');
  chip.textContent = `${axis} ${formatCoordinate(value)}`;
  return chip;
}

async function refreshData() {
  applyLoadedData(await repository.load());
}

function applyLoadedData(payload) {
  state.settings = payload.settings;
  state.datasets = payload.datasets;
  state.images = payload.images;
  imageUrls.forEach((url) => URL.revokeObjectURL(url));
  imageUrls.clear();
  if (state.dataset) {
    const updated = state.datasets.find((entry) => entry.id === state.dataset.id);
    if (updated) state.dataset = updated;
    else {
      state.dataset = null;
      state.datasetExists = false;
    }
  }
  showWarnings(payload.warnings);
  renderSettings();
  renderDataset();
  renderMap();
}

$$('.tab').forEach((button) => button.addEventListener('click', () => setTab(button.dataset.tab)));
$('#new-setting').addEventListener('click', clearSettingForm);

settingForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!settingForm.reportValidity()) return;
  const values = formValues(settingForm);
  const setting = {
    id: state.settingExists ? state.settingId : values.id.trim(),
    name: values.name.trim(),
    axis_x: { positive: values.x_positive.trim(), negative: values.x_negative.trim() },
    axis_y: { positive: values.y_positive.trim(), negative: values.y_negative.trim() },
  };
  try {
    const saved = await repository.saveSetting(setting, { overwrite: state.settingExists });
    upsert(state.settings, saved);
    state.settingId = saved.id;
    state.settingExists = true;
    editSetting(saved);
    renderDatasetOptions();
    renderMap();
    notify('設定を保存しました。');
  } catch (error) {
    notify(error.message, true);
  }
});

$('#new-dataset').addEventListener('click', startNewDataset);
$('#empty-new-dataset').addEventListener('click', startNewDataset);
function startNewDataset() {
  if (!state.settings.length) {
    notify('先に「設定」タブで評価軸を作成してください。', true);
    setTab('settings');
    return;
  }
  state.dataset = { id: '', name: '', setting: state.settings[0].id, items: [] };
  state.datasetExists = false;
  renderDataset();
  datasetForm.elements.id.focus();
}

$('#dataset-select').addEventListener('change', (event) => {
  const dataset = state.datasets.find((entry) => entry.id === event.target.value);
  state.dataset = dataset || null;
  state.datasetExists = Boolean(dataset);
  renderDataset();
});
$('#map-dataset-select').addEventListener('change', () => {
  state.selectedMapItemId = null;
  renderMap();
});
$('#tag-filter').addEventListener('change', renderMap);

datasetForm.addEventListener('input', () => {
  if (state.dataset && !state.datasetExists) {
    state.dataset.id = datasetForm.elements.id.value.trim();
    state.dataset.name = datasetForm.elements.name.value.trim();
    state.dataset.setting = datasetForm.elements.setting.value;
  }
});
datasetForm.elements.setting.addEventListener('change', () => {
  if (state.dataset) state.dataset.setting = datasetForm.elements.setting.value;
  renderDatasetOptions();
});
datasetForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await saveDataset();
});
$('#new-item').addEventListener('click', () => openItemDialog());
$('#close-dialog').addEventListener('click', () => itemDialog.close());
$('#cancel-dialog').addEventListener('click', () => itemDialog.close());

itemForm.elements.x_range.addEventListener('input', (event) => syncPosition('x', event.target.value));
itemForm.elements.y_range.addEventListener('input', (event) => syncPosition('y', event.target.value));
itemForm.elements.x.addEventListener('input', (event) => syncPosition('x', event.target.value));
itemForm.elements.y.addEventListener('input', (event) => syncPosition('y', event.target.value));
$('#mini-map').addEventListener('pointerdown', (event) => {
  const rect = event.currentTarget.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  const y = 1 - ((event.clientY - rect.top) / rect.height) * 2;
  syncPosition('x', x);
  syncPosition('y', y);
});
$('#mini-map').addEventListener('keydown', (event) => {
  const increments = { ArrowLeft: [-0.05, 0], ArrowRight: [0.05, 0], ArrowUp: [0, 0.05], ArrowDown: [0, -0.05] };
  const increment = increments[event.key];
  if (!increment) return;
  event.preventDefault();
  syncPosition('x', Number(itemForm.elements.x.value) + increment[0]);
  syncPosition('y', Number(itemForm.elements.y.value) + increment[1]);
});

$('#image-upload').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    notify('画像は10MB以下にしてください。', true);
    event.target.value = '';
    return;
  }
  try {
    const image = await repository.saveImage(file);
    state.images.set(image, file.slice(0, file.size, file.type));
    itemForm.elements.image.value = image;
    refreshImagePreview(image);
    notify('画像をこのブラウザーに保存しました。');
  } catch (error) {
    notify(error.message, true);
  }
});
$('#clear-image').addEventListener('click', () => {
  itemForm.elements.image.value = '';
  $('#image-upload').value = '';
  refreshImagePreview('');
});

itemForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!itemForm.reportValidity()) return;
  const values = formValues(itemForm);
  const item = {
    id: state.editingItemId || crypto.randomUUID(),
    name: values.name.trim(),
    display_name: values.display_name.trim(),
    image: values.image || null,
    x: Number(values.x),
    y: Number(values.y),
    note: values.note.trim(),
    tags: values.tags.split(/[、,]/).map((tag) => tag.trim()).filter(Boolean),
  };
  const original = state.dataset;
  const items = [...state.dataset.items];
  const itemIndex = items.findIndex((entry) => entry.id === state.editingItemId);
  if (itemIndex >= 0) items[itemIndex] = item;
  else items.push(item);
  const updatedDataset = { ...state.dataset, items };
  try {
    const saved = await repository.saveDataset(updatedDataset, { overwrite: true });
    state.dataset = saved;
    upsert(state.datasets, saved);
    state.selectedMapItemId = item.id;
    itemDialog.close();
    renderDataset();
    renderMap();
    notify(itemIndex >= 0 ? '項目を更新しました。' : '項目を追加しました。');
  } catch (error) {
    state.dataset = original;
    notify(error.message, true);
  }
});

$('#empty-go-data').addEventListener('click', () => setTab('data'));

const importDialog = $('#import-dialog');
const importForm = $('#import-form');
let pendingImport = null;

$('#export-data').addEventListener('click', async () => {
  try {
    const exported = await repository.exportData();
    const file = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
    const downloadUrl = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `quadrant-mapper-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    notify('JSONバックアップを作成しました。');
  } catch (error) {
    notify(`Exportできません: ${error.message}`, true);
  }
});

async function refreshImportPreview() {
  const summary = $('#import-summary');
  const confirmButton = $('#confirm-import');
  summary.classList.remove('error');
  confirmButton.disabled = true;
  if (!pendingImport) {
    summary.textContent = 'ファイルを選択してください。';
    return;
  }
  try {
    const counts = await repository.previewImport(pendingImport, $('#import-mode').value);
    summary.textContent = `適用後の合計：設定 ${counts.settings}件、データセット ${counts.datasets}件、画像 ${counts.images}件`;
    confirmButton.disabled = false;
  } catch (error) {
    summary.textContent = error.message;
    summary.classList.add('error');
  }
}

$('#import-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 100 * 1024 * 1024) {
    notify('JSONバックアップは100MB以下にしてください。', true);
    event.target.value = '';
    return;
  }
  try {
    pendingImport = await file.text();
    $('#import-mode').value = 'merge';
    $('#import-description').textContent = '異なるIDの設定・データは保持し、読み込んだ同一IDのデータは置き換えます。';
    await refreshImportPreview();
    importDialog.showModal();
  } catch (error) {
    pendingImport = null;
    notify(`ファイルを読み込めません: ${error.message}`, true);
  }
});

$('#import-mode').addEventListener('change', () => {
  $('#import-description').textContent = $('#import-mode').value === 'replace'
    ? '現在の設定・データセット・画像をすべて削除し、バックアップの内容に置き換えます。'
    : '異なるIDの設定・データは保持し、読み込んだ同一IDのデータは置き換えます。';
  refreshImportPreview();
});

$('#close-import').addEventListener('click', () => importDialog.close());
$('#cancel-import').addEventListener('click', () => importDialog.close());
importDialog.addEventListener('close', () => {
  pendingImport = null;
  $('#import-file').value = '';
});
importForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!pendingImport) return;
  if ($('#import-mode').value === 'replace' && !window.confirm('現在のブラウザー内データをすべて置き換えます。続行しますか？')) return;
  try {
    const imported = await repository.importData(pendingImport, $('#import-mode').value);
    state.dataset = null;
    state.datasetExists = false;
    state.selectedMapItemId = null;
    applyLoadedData(imported);
    importDialog.close();
    notify('データを読み込みました。');
  } catch (error) {
    $('#import-summary').textContent = error.message;
    $('#import-summary').classList.add('error');
    $('#confirm-import').disabled = true;
  }
});

refreshData().catch((error) => notify(`データを読み込めません: ${error.message}`, true));
