const DATABASE_NAME = 'quadrant-mapper';
const DATABASE_VERSION = 1;
const WORKSPACE_KEY = 'current';
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const IMAGE_EXTENSIONS = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
]);
const IMAGE_EXTENSION_ALIASES = new Map([
  ['image/jpeg', new Set(['.jpg', '.jpeg'])],
]);

export class StorageValidationError extends Error {}

function validateId(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) {
    throw new StorageValidationError(`${label}は英数字、ハイフン、アンダースコアで1〜64文字にしてください。`);
  }
  return value;
}

function requiredText(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new StorageValidationError(`${label}を入力してください。`);
  }
  return value.trim();
}

function validateImageName(value) {
  if (typeof value !== 'string' || !value || value !== value.trim() || /[\\/]/.test(value) || value === '.' || value === '..') {
    throw new StorageValidationError('画像名が不正です。');
  }
  return value;
}

function validateSetting(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new StorageValidationError('設定はJSONオブジェクトである必要があります。');
  }
  const axis = (key) => {
    const values = data[key];
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      throw new StorageValidationError(`${key}のpositive/negativeを指定してください。`);
    }
    return {
      positive: requiredText(values.positive, `${key} positive`),
      negative: requiredText(values.negative, `${key} negative`),
    };
  };
  return {
    id: validateId(data.id, '設定ID'),
    name: requiredText(data.name, '設定名'),
    axis_x: axis('axis_x'),
    axis_y: axis('axis_y'),
  };
}

function validateCoordinate(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -1 || value > 1) {
    throw new StorageValidationError(`${label}は-1から+1の範囲にしてください。`);
  }
  return value;
}

function validateDataset(data, settingIds, imageNames) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new StorageValidationError('データセットはJSONオブジェクトである必要があります。');
  }
  const setting = validateId(data.setting, '設定ID');
  if (!settingIds.has(setting)) throw new StorageValidationError(`参照先の設定がありません: ${setting}`);
  if (!Array.isArray(data.items)) throw new StorageValidationError('itemsは配列である必要があります。');
  const itemIds = new Set();
  const items = data.items.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new StorageValidationError('各項目はJSONオブジェクトである必要があります。');
    }
    const id = item.id == null || item.id === ''
      ? globalThis.crypto.randomUUID()
      : validateId(item.id, '項目ID');
    if (itemIds.has(id)) throw new StorageValidationError(`項目IDが重複しています: ${id}`);
    itemIds.add(id);
    if (typeof (item.display_name ?? '') !== 'string' || typeof (item.note ?? '') !== 'string') {
      throw new StorageValidationError('表示名とnoteは文字列にしてください。');
    }
    if (!Array.isArray(item.tags) || item.tags.some((tag) => typeof tag !== 'string')) {
      throw new StorageValidationError('tagsは文字列の配列にしてください。');
    }
    const image = item.image ? validateImageName(item.image) : null;
    if (image && !imageNames.has(image)) throw new StorageValidationError(`画像データがありません: ${image}`);
    return {
      id,
      name: requiredText(item.name, '項目名'),
      display_name: (item.display_name ?? '').trim(),
      image,
      x: validateCoordinate(item.x, 'X評価'),
      y: validateCoordinate(item.y, 'Y評価'),
      note: (item.note ?? '').trim(),
      tags: [...new Set(item.tags.map((tag) => tag.trim()).filter(Boolean))],
    };
  });
  return {
    id: validateId(data.id, 'データセットID'),
    name: requiredText(data.name, 'データセット名'),
    setting,
    items,
  };
}

function decodeImage(dataUrl) {
  if (typeof dataUrl !== 'string') throw new StorageValidationError('画像データが不正です。');
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl);
  if (!match) throw new StorageValidationError('画像はPNG、JPG、GIF、WebP形式のBase64データにしてください。');
  let binary;
  try {
    binary = atob(match[2]);
  } catch {
    throw new StorageValidationError('画像データを読み込めません。');
  }
  if (!binary.length || binary.length > 10 * 1024 * 1024) {
    throw new StorageValidationError('画像は10MB以下にしてください。');
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return { type: match[1], blob: new Blob([bytes], { type: match[1] }) };
}

function uniqueById(records, label, validator) {
  if (!Array.isArray(records)) throw new StorageValidationError(`${label}は配列である必要があります。`);
  const ids = new Set();
  return records.map((record) => {
    const valid = validator(record);
    if (ids.has(valid.id)) throw new StorageValidationError(`${label}IDが重複しています: ${valid.id}`);
    ids.add(valid.id);
    return valid;
  });
}

export function validateImportPayload(input, mode, current = { settings: [], datasets: [] }, currentImages = []) {
  let payload = input;
  if (typeof input === 'string') {
    try {
      payload = JSON.parse(input);
    } catch {
      throw new StorageValidationError('JSONファイルを読み込めません。');
    }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new StorageValidationError('インポートデータはJSONオブジェクトである必要があります。');
  }
  if (payload.format !== 'quadrant-mapper' || payload.version !== 1) {
    throw new StorageValidationError('対応していないJSON形式またはバージョンです。');
  }
  if (mode !== 'replace' && mode !== 'merge') throw new StorageValidationError('Import方法を選択してください。');

  const importedSettings = uniqueById(payload.settings, '設定', validateSetting);
  const decodedImages = new Map();
  if (!Array.isArray(payload.images)) throw new StorageValidationError('imagesは配列である必要があります。');
  for (const image of payload.images) {
    const name = validateImageName(image?.name);
    if (decodedImages.has(name)) throw new StorageValidationError(`画像名が重複しています: ${name}`);
    const decoded = decodeImage(image.data);
    const extension = name.slice(name.lastIndexOf('.')).toLowerCase();
    const allowedExtensions = IMAGE_EXTENSION_ALIASES.get(decoded.type) || new Set([IMAGE_EXTENSIONS.get(decoded.type)]);
    if (!allowedExtensions.has(extension)) {
      throw new StorageValidationError(`画像名と形式が一致しません: ${name}`);
    }
    decodedImages.set(name, { name, type: decoded.type, blob: decoded.blob });
  }

  const baseSettings = mode === 'merge' ? current.settings : [];
  const settingsById = new Map(baseSettings.map((setting) => [setting.id, setting]));
  importedSettings.forEach((setting) => settingsById.set(setting.id, setting));
  const settings = [...settingsById.values()];
  const settingIds = new Set(settings.map((setting) => setting.id));
  const baseDatasets = mode === 'merge' ? current.datasets : [];
  const importedDatasets = uniqueById(payload.datasets, 'データセット', (dataset) =>
    validateDataset(dataset, settingIds, new Set([
      ...(mode === 'merge' ? currentImages : []),
      ...decodedImages.keys(),
    ])));
  const datasetsById = new Map(baseDatasets.map((dataset) => [dataset.id, dataset]));
  importedDatasets.forEach((dataset) => datasetsById.set(dataset.id, dataset));
  const datasets = [...datasetsById.values()];
  const finalSettingIds = new Set(settings.map((setting) => setting.id));
  const availableImages = new Set([
    ...(mode === 'merge' ? currentImages : []),
    ...decodedImages.keys(),
  ]);
  datasets.forEach((dataset) => {
    if (!finalSettingIds.has(dataset.setting)) throw new StorageValidationError(`参照先の設定がありません: ${dataset.setting}`);
    dataset.items.forEach((item) => {
      if (item.image && !availableImages.has(item.image)) throw new StorageValidationError(`画像データがありません: ${item.image}`);
    });
  });
  return { settings, datasets, images: [...decodedImages.values()] };
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDBを読み込めません。'));
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error || new Error('データベース処理が中断されました。'));
    transaction.onerror = () => reject(transaction.error || new Error('データベース処理に失敗しました。'));
  });
}

function emptyWorkspace() {
  return { key: WORKSPACE_KEY, settings: [], datasets: [] };
}

function base64FromBlob(blob) {
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  });
}

export class BrowserRepository {
  constructor(indexedDb = globalThis.indexedDB) {
    if (!indexedDb) throw new Error('このブラウザーではIndexedDBを利用できません。');
    this.indexedDb = indexedDb;
    this.databasePromise = null;
  }

  open() {
    if (!this.databasePromise) {
      this.databasePromise = new Promise((resolve, reject) => {
        const request = this.indexedDb.open(DATABASE_NAME, DATABASE_VERSION);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains('workspace')) database.createObjectStore('workspace', { keyPath: 'key' });
          if (!database.objectStoreNames.contains('images')) database.createObjectStore('images', { keyPath: 'name' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('ブラウザー内データベースを開けません。'));
        request.onblocked = () => reject(new Error('別のタブがデータベース更新をブロックしています。'));
      });
    }
    return this.databasePromise;
  }

  async load() {
    const database = await this.open();
    const transaction = database.transaction(['workspace', 'images'], 'readonly');
    const done = transactionComplete(transaction);
    const [storedWorkspace, images] = await Promise.all([
      requestResult(transaction.objectStore('workspace').get(WORKSPACE_KEY)),
      requestResult(transaction.objectStore('images').getAll()),
    ]);
    await done;
    const workspace = storedWorkspace || emptyWorkspace();
    return {
      settings: Array.isArray(workspace.settings) ? workspace.settings : [],
      datasets: Array.isArray(workspace.datasets) ? workspace.datasets : [],
      images: new Map(images.map((image) => [image.name, image.blob])),
      warnings: [],
    };
  }

  async saveSetting(data, { overwrite = false } = {}) {
    const setting = validateSetting(data);
    return this.updateWorkspace((workspace) => {
      const index = workspace.settings.findIndex((entry) => entry.id === setting.id);
      if (index >= 0 && !overwrite) throw new StorageValidationError(`設定IDが重複しています: ${setting.id}`);
      if (index < 0 && overwrite) throw new StorageValidationError('編集する設定が見つかりません。');
      if (index >= 0) workspace.settings[index] = setting;
      else workspace.settings.push(setting);
      return setting;
    });
  }

  async saveDataset(data, { overwrite = false } = {}) {
    const database = await this.open();
    const transaction = database.transaction('images', 'readonly');
    const done = transactionComplete(transaction);
    const imageNames = new Set(await requestResult(transaction.objectStore('images').getAllKeys()));
    await done;
    return this.updateWorkspace((workspace) => {
      const settingIds = new Set(workspace.settings.map((setting) => setting.id));
      const dataset = validateDataset(data, settingIds, imageNames);
      const index = workspace.datasets.findIndex((entry) => entry.id === dataset.id);
      if (index >= 0 && !overwrite) throw new StorageValidationError(`データセットIDが重複しています: ${dataset.id}`);
      if (index < 0 && overwrite) throw new StorageValidationError('編集するデータセットが見つかりません。');
      if (index >= 0) workspace.datasets[index] = dataset;
      else workspace.datasets.push(dataset);
      return dataset;
    });
  }

  async saveImage(file) {
    if (!file || !IMAGE_TYPES.has(file.type)) throw new StorageValidationError('画像はPNG、JPG、GIF、WebP形式にしてください。');
    if (!file.size || file.size > 10 * 1024 * 1024) throw new StorageValidationError('画像は10MB以下にしてください。');
    const extension = IMAGE_EXTENSIONS.get(file.type);
    const name = `${crypto.randomUUID()}${extension}`;
    const database = await this.open();
    const transaction = database.transaction('images', 'readwrite');
    const done = transactionComplete(transaction);
    transaction.objectStore('images').put({ name, type: file.type, blob: file.slice(0, file.size, file.type) });
    await done;
    return name;
  }

  async updateWorkspace(update) {
    const database = await this.open();
    const transaction = database.transaction('workspace', 'readwrite');
    const done = transactionComplete(transaction);
    const store = transaction.objectStore('workspace');
    try {
      const workspace = (await requestResult(store.get(WORKSPACE_KEY))) || emptyWorkspace();
      const result = update(workspace);
      store.put(workspace);
      await done;
      return result;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // The transaction may already have aborted after a failed IndexedDB request.
      }
      await done.catch(() => {});
      throw error;
    }
  }

  async exportData() {
    const snapshot = await this.load();
    const images = await Promise.all([...snapshot.images.entries()].map(async ([name, blob]) => ({
      name,
      data: `data:${blob.type};base64,${await base64FromBlob(blob)}`,
    })));
    return {
      format: 'quadrant-mapper',
      version: 1,
      exported_at: new Date().toISOString(),
      settings: snapshot.settings,
      datasets: snapshot.datasets,
      images,
    };
  }

  async previewImport(input, mode) {
    const snapshot = await this.load();
    const imported = validateImportPayload(input, mode, snapshot, [...snapshot.images.keys()]);
    return {
      settings: imported.settings.length,
      datasets: imported.datasets.length,
      images: imported.images.length,
    };
  }

  async importData(input, mode) {
    const snapshot = await this.load();
    const imported = validateImportPayload(input, mode, snapshot, [...snapshot.images.keys()]);
    const database = await this.open();
    const transaction = database.transaction(['workspace', 'images'], 'readwrite');
    const done = transactionComplete(transaction);
    const workspaceStore = transaction.objectStore('workspace');
    const imageStore = transaction.objectStore('images');
    if (mode === 'replace') imageStore.clear();
    imported.images.forEach((image) => imageStore.put(image));
    workspaceStore.put({ key: WORKSPACE_KEY, settings: imported.settings, datasets: imported.datasets });
    await done;
    return this.load();
  }
}
