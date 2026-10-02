import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { StorageValidationError, validateImportPayload } from '../web/static/storage.mjs';

const setting = {
  id: 'general',
  name: '汎用分類',
  axis_x: { positive: '好き', negative: '嫌い' },
  axis_y: { positive: '得意', negative: '苦手' },
};

const dataset = {
  id: 'ideas',
  name: 'アイデア',
  setting: 'general',
  items: [{
    id: 'idea-1',
    name: '項目名',
    display_name: '',
    image: null,
    x: 0,
    y: 0,
    note: '',
    tags: ['仕事'],
  }],
};

const repositoryRoot = new URL('../', import.meta.url);

function bundle(overrides = {}) {
  return {
    format: 'quadrant-mapper',
    version: 1,
    settings: [setting],
    datasets: [dataset],
    images: [],
    ...overrides,
  };
}

test('accepts a valid JSON bundle and normalizes tags and text', () => {
  const result = validateImportPayload(JSON.stringify(bundle({
    datasets: [{ ...dataset, items: [{ ...dataset.items[0], tags: [' 仕事 ', '仕事', ' アイデア '] }] }],
  })), 'replace');
  assert.equal(result.settings[0].id, 'general');
  assert.deepEqual(result.datasets[0].items[0].tags, ['仕事', 'アイデア']);
});

test('rejects malformed JSON and unsupported formats', () => {
  assert.throws(() => validateImportPayload('{bad json', 'replace'), StorageValidationError);
  assert.throws(() => validateImportPayload({ ...bundle(), version: 2 }, 'replace'), /バージョン/);
});

test('rejects duplicate setting and dataset identifiers', () => {
  assert.throws(() => validateImportPayload(bundle({ settings: [setting, setting] }), 'replace'), /設定IDが重複/);
  assert.throws(() => validateImportPayload(bundle({ datasets: [dataset, dataset] }), 'replace'), /データセットIDが重複/);
});

test('rejects references to missing settings', () => {
  assert.throws(() => validateImportPayload(bundle({ datasets: [{ ...dataset, setting: 'missing' }] }), 'replace'), /設定がありません/);
});

test('accepts coordinate boundary values and rejects values outside the range', () => {
  for (const coordinate of [-1, 0, 1]) {
    const result = validateImportPayload(bundle({
      datasets: [{ ...dataset, items: [{ ...dataset.items[0], x: coordinate, y: coordinate }] }],
    }), 'replace');
    assert.equal(result.datasets[0].items[0].x, coordinate);
  }
  for (const coordinate of [-1.01, 1.01, Number.NaN]) {
    assert.throws(() => validateImportPayload(bundle({
      datasets: [{ ...dataset, items: [{ ...dataset.items[0], x: coordinate }] }],
    }), 'replace'), /範囲/);
  }
});

test('assigns an item identifier when importing a JSON item without one', () => {
  const result = validateImportPayload(bundle({
    datasets: [{ ...dataset, items: [{ ...dataset.items[0], id: undefined }] }],
  }), 'replace');
  assert.match(result.datasets[0].items[0].id, /^[0-9a-f-]{36}$/i);
});

test('merge keeps different IDs and imported IDs replace existing records', () => {
  const existing = {
    settings: [{ ...setting, id: 'existing', name: '残す設定' }, setting],
    datasets: [{ ...dataset, id: 'keep', name: '残すデータ' }, { ...dataset, name: '古いデータ' }],
  };
  const result = validateImportPayload(bundle(), 'merge', existing, []);
  assert.deepEqual(result.settings.map((entry) => entry.id), ['existing', 'general']);
  assert.deepEqual(result.datasets.map((entry) => entry.id), ['keep', 'ideas']);
  assert.equal(result.datasets[1].name, 'アイデア');
});

test('replace discards the prior workspace and validates imported references only', () => {
  const existing = {
    settings: [{ ...setting, id: 'existing' }],
    datasets: [{ ...dataset, id: 'old', setting: 'existing' }],
  };
  const result = validateImportPayload(bundle(), 'replace', existing, []);
  assert.deepEqual(result.settings.map((entry) => entry.id), ['general']);
  assert.deepEqual(result.datasets.map((entry) => entry.id), ['ideas']);
});

test('imports image blobs and rejects missing or unsafe image references', () => {
  const name = 'cover.png';
  const images = [{ name, data: 'data:image/png;base64,aW1n' }];
  const withImage = { ...dataset, items: [{ ...dataset.items[0], image: name }] };
  const result = validateImportPayload(bundle({ datasets: [withImage], images }), 'replace');
  assert.equal(result.images[0].name, name);
  assert.equal(result.images[0].blob.type, 'image/png');
  assert.throws(() => validateImportPayload(bundle({ datasets: [withImage] }), 'replace'), /画像データがありません/);
  assert.throws(() => validateImportPayload(bundle({ images: [{ name: '../cover.png', data: images[0].data }] }), 'replace'), /画像名/);
});

test('rejects unsupported image types and mismatched file extensions', () => {
  assert.throws(() => validateImportPayload(bundle({ images: [{ name: 'cover.svg', data: 'data:image/png;base64,aW1n' }] }), 'replace'), /画像名と形式/);
  assert.throws(() => validateImportPayload(bundle({ images: [{ name: 'cover.png', data: 'data:image/svg+xml;base64,aW1n' }] }), 'replace'), /PNG、JPG/);
});

test('GitHub Pages entry point uses relative assets for project-site paths', async () => {
  const html = await readFile(new URL('web/index.html', repositoryRoot), 'utf8');
  assert.match(html, /href="\.\/static\/styles\.css"/);
  assert.match(html, /src="\.\/static\/app\.js"/);
  assert.doesNotMatch(html, /(?:href|src)="\/static\//);
});

test('GitHub Pages workflow deploys the static web directory', async () => {
  const workflow = await readFile(new URL('.github/workflows/pages.yml', repositoryRoot), 'utf8');
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /path: web/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
});
