/**
 * Vorkalkulation in the browser: open the calculator on a quote line, take a
 * price tier, the line gets the price and the calculation link.
 */
const { test, expect } = require('@playwright/test');

const H = { 'X-Requested-With': 'NOVA' };

test('calculate a price on a quote line', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/login');
  await page.locator('#company-input').fill('DEMO');
  await page.locator('#badge-input').fill('ADMIN001');
  await page.locator('#password-input').fill('demo1234');
  await page.locator('button[type=submit]').click();
  await expect(page).not.toHaveURL(/\/login/);

  const api = page.request;
  const j = async (r) => { expect(r.ok(), `${r.url()} ${r.status()} ${await r.text()}`).toBeTruthy(); return r.json(); };
  const area = await j(await api.post('/api/machines/areas', { headers: H, data: { name: 'E2E Halle' } }));
  const machine = await j(await api.post('/api/machines', { headers: H, data: { area_id: area.id, name: 'E2E Fräse' } }));
  await j(await api.put(`/api/machines/${machine.id}`, { headers: H, data: { hourly_rate: 80 } }));
  const item = await j(await api.post('/api/items', { headers: H, data: { item_code: 'E2E-CALC', name: 'Kalkulationsteil', type: 'finished_good', routes: [{ machine_id: machine.id, setup_time_min: 30, process_time_min: 2 }] } }));
  const customer = await j(await api.post('/api/customers', { headers: H, data: { name: 'Calc Kunde', street: 'Weg 1', postal_code: '80331', city: 'München' } }));
  const quote = await j(await api.post('/api/sales', { headers: H, data: { doc_type: 'quote', customer_id: customer.id, lines: [{ item_id: item.id, quantity: 10 }] } }));

  await page.goto(`/sales/documents/${quote.id}`);
  await page.getByRole('button', { name: /Preis kalkulieren|Calculate price|Calculează/ }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('tbody tr').first()).toBeVisible();
  await dialog.getByRole('button', { name: /Übernehmen|Use|Folosește/ }).first().click();
  await expect(dialog).toBeHidden();

  // the line now carries a price > 0; saving stores the calculation link
  const price = page.locator('tbody input[type=number][step="0.01"]').first();
  await expect(price).not.toHaveValue('0');
  await page.getByRole('button', { name: /speichern|save|salvează/i }).first().click();
  await expect.poll(async () => (await j(await api.get(`/api/sales/${quote.id}`))).lines[0].calculation_id).toBeTruthy();
  expect(errors).toEqual([]);
});
