/**
 * End to end in a real browser: login form -> cookie session -> sales and
 * DATEV screens render without errors (incl. content security policy) ->
 * quote -> order -> invoice issued -> PDF and DATEV export downloadable.
 */
const { test, expect } = require('@playwright/test');

const H = { 'X-Requested-With': 'NOVA' };

test('quote to invoice to DATEV, through the browser session', async ({ page }) => {
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('response', (r) => { if (r.status() === 400 || r.status() >= 500) problems.push(`${r.status()} ${r.request().method()} ${r.url()}`); });

  // Login through the form
  await page.goto('/login');
  await page.locator('#company-input').fill('DEMO');
  await page.locator('#badge-input').fill('ADMIN001');
  await page.locator('#password-input').fill('demo1234');
  await page.locator('button[type=submit]').click();
  await expect(page).not.toHaveURL(/\/login/);

  // The token is only in an httpOnly cookie, not readable by page scripts
  const cookies = await page.context().cookies();
  expect(cookies.find((c) => c.name === 'nova_session')?.httpOnly).toBe(true);
  expect(await page.evaluate(() => document.cookie)).not.toContain('nova_session');
  expect(await page.evaluate(() => localStorage.getItem('sf_token'))).toBeNull();

  // Sales flow with the same browser session (cookie + CSRF header)
  const api = page.request;
  const ok = async (res) => { expect(res.ok(), `${res.url()} -> ${res.status()} ${await res.text()}`).toBeTruthy(); return res.json(); };
  await ok(await api.put('/api/settings/company', {
    headers: H,
    data: { legal_name: 'NOVA Demo GmbH', street: 'Industriestraße 5', postal_code: '87435', city: 'Kempten', vat_id: 'DE123456789', iban: 'DE89370400440532013000', datev_consultant_number: 1234567, datev_client_number: 10001 },
  }));
  // Without the CSRF header the cookie session may not change anything
  expect((await api.post('/api/customers', { data: { name: 'Ohne Header' } })).status()).toBe(403);
  const customer = await ok(await api.post('/api/customers', { headers: H, data: { name: 'E2E Kunde GmbH', street: 'Weg 1', postal_code: '80331', city: 'München' } }));

  const lines = [{ description: 'Frästeil 4711', quantity: 10, unit: 'Stk', unit_price: '12.50' }];
  const quote = await ok(await api.post('/api/sales', { headers: H, data: { doc_type: 'quote', customer_id: customer.id, lines } }));
  await ok(await api.post(`/api/sales/${quote.id}/issue`, { headers: H }));
  const order = await ok(await api.post(`/api/sales/${quote.id}/convert`, { headers: H, data: { target: 'order' } }));
  await ok(await api.post(`/api/sales/${order.id}/issue`, { headers: H }));
  const invoice = await ok(await api.post('/api/sales', { headers: H, data: { doc_type: 'invoice', customer_id: customer.id, lines } }));
  const issued = await ok(await api.post(`/api/sales/${invoice.id}/issue`, { headers: H }));
  expect(issued.number).toMatch(/^RE-/);

  const pdf = await api.get(`/api/sales/${invoice.id}/pdf`);
  expect(pdf.ok()).toBeTruthy();
  expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF');

  const day = new Date().toISOString().slice(0, 10);
  const datev = await api.get(`/api/datev/export?from=${day}&to=${day}`);
  expect(datev.ok(), await datev.text()).toBeTruthy();
  expect((await datev.body()).length).toBeGreaterThan(100);

  // The screens show it and render without errors
  await page.goto('/sales/documents');
  await expect(page.getByText(issued.number).first()).toBeVisible();
  await page.goto('/sales/datev');
  await expect(page.locator('main, #root').first()).toBeVisible();
  await page.goto('/account');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // The large screens (split into parts) still open, and their dialogs too
  for (const url of ['/admin', '/planner', '/planner/items', '/quality', '/subcontracting', '/time']) {
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  }
  await page.goto('/planner');
  await page.getByRole('button', { name: /Neuer Auftrag|New order/i }).first().click();
  await expect(page.locator('form, [role=dialog]').first()).toBeVisible();

  const csp = problems.filter((p) => /Content Security Policy|Refused to/i.test(p));
  expect(csp, csp.join('\n')).toEqual([]);
  expect(problems.filter((p) => !/favicon|Failed to load resource: the server responded with a status of 40[13]/.test(p)), problems.join('\n')).toEqual([]);
});
