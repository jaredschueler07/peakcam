import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { createTrackerServer } from './server.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const stateDir = await mkdtemp(path.join(tmpdir(), 'peakcam-tracker-browser-'));
const server = await createTrackerServer({ stateDir });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseURL = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(7000);
page.on('pageerror', error => errors.push(error.message));
const outputDir = path.join(directory, '.local', 'verification');
await mkdir(outputDir, { recursive: true });

try {
  await page.goto(baseURL);
  await expect(page.locator('#nav [data-view="actions"]')).toBeVisible();
  const initial = await (await page.request.get(`${baseURL}/api/data`)).json();
  const actions = initial.datasets.find(dataset => dataset.key === 'actions').rows;
  const openActions = actions.filter(row => !['Done', 'Deferred'].includes(row.tracking.status));
  const expectedHours = openActions.reduce((sum, row) => sum + Number(row.source.Remaining_hours_estimate), 0);
  await expect(page.locator('.metric').filter({ hasText: 'Remaining estimate' })).toContainText(String(expectedHours));
  await page.screenshot({ path: path.join(outputDir, 'overview-desktop.png'), fullPage: true });

  await page.locator('#nav [data-view="actions"]').click();
  await page.locator('[data-edit="actions"][data-id="R01"]').first().click();
  await page.getByRole('dialog').getByRole('combobox', { name: 'Status', exact: true }).selectOption('In progress');
  await page.getByRole('dialog').getByRole('textbox', { name: 'Notes', exact: true }).fill('Browser verification: source review scheduled.');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.reload();
  await page.locator('#nav [data-view="actions"]').click();
  await page.locator('[data-edit="actions"][data-id="R01"]').first().click();
  await expect(page.getByRole('dialog').getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('Browser verification: source review scheduled.');
  await expect(page.getByRole('dialog').getByRole('combobox', { name: 'Status', exact: true })).toHaveValue('In progress');
  await page.keyboard.press('Escape');

  await page.locator('#search').pressSequentially('R01');
  await expect(page.locator('#search')).toHaveValue('R01');
  await expect(page.locator('[data-edit="actions"][data-id="R01"]').first()).toBeVisible();
  await page.locator('#search').fill('');
  await page.locator('#statusFilter').selectOption('In progress');
  assert.ok(await page.locator('tbody tr').count() > 0);

  for (const key of ['prospects', 'cameras', 'resorts', 'experiments', 'risks', 'costs', 'gates']) {
    await page.locator(`#nav [data-view="${key}"]`).click();
    await expect(page.locator('tbody tr').first()).toBeVisible();
  }

  await page.locator('#nav [data-view="costs"]').click();
  await page.locator('[data-edit="costs"]').first().click();
  await page.getByRole('dialog').getByRole('spinbutton', { name: 'Actual paid USD', exact: true }).fill('25.50');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('tbody')).toContainText('25.50');
  await page.locator('#nav [data-view="gates"]').click();
  await page.locator('[data-edit="gates"][data-id="G01"]').first().click();
  await page.getByRole('dialog').getByRole('combobox', { name: 'Status', exact: true }).selectOption('Done');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('#saveState')).toContainText('Add evidence');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  const api = await (await page.request.get(`${baseURL}/api/data`)).json();
  assert.equal(api.datasets.find(dataset => dataset.key === 'actions').rows.find(row => row.id === 'R01').tracking.status, 'In progress');
  assert.equal(api.datasets.find(dataset => dataset.key === 'costs').rows.filter(row => row.source.Actual_paid_USD === '').length, 11);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile page should not overflow horizontally');
  await page.screenshot({ path: path.join(outputDir, 'tracker-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.locator('#nav [data-view="actions"]').click();
  await page.locator('[data-edit="actions"][data-id="R01"]').first().click();
  await expect(page.getByRole('dialog').getByRole('textbox', { name: 'Notes', exact: true })).toHaveValue('Browser verification: source review scheduled.');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.deepEqual(errors, [], 'No browser runtime errors');
  console.log('Browser checks passed: desktop load, edit/save/reload, blank costs, mobile layout, no runtime errors.');
  console.log(`Screenshots: ${outputDir}`);
} catch (error) {
  await page.screenshot({ path: path.join(outputDir, 'failure.png'), fullPage: true });
  console.error(await page.locator('body').innerText());
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  await rm(stateDir, { recursive: true, force: true });
}
