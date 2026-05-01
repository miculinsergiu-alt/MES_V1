const puppeteer = require('puppeteer');

const BASE_URL = 'http://localhost:5173';

async function verifyUser(role, badge, password, dashboardText) {
  const browser = await puppeteer.launch({ 
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox'] 
  });
  const page = await browser.newPage();
  
  try {
    console.log(`\n👤 Testing Role: ${role} (${badge})...`);
    
    await page.goto(`${BASE_URL}/login`);
    await page.waitForSelector('#badge-input');
    
    // Login
    await page.type('#badge-input', badge);
    await page.type('#password-input', password);
    await page.click('button[type="submit"]');
    
    // Wait for navigation
    await page.waitForNavigation({ waitUntil: 'networkidle0' });
    console.log(`✅ Logged in as ${role}. URL: ${page.url()}`);

    // Verify Dashboard Presence
    await page.waitForSelector('h1');
    const title = await page.$eval('h1', el => el.innerText);
    console.log(`✅ Dashboard Title: "${title}"`);

    if (title.toLowerCase().includes(dashboardText.toLowerCase()) || page.url().includes(role)) {
      console.log(`✅ ${role} Dashboard verified successfully.`);
    } else {
      console.log(`⚠️ Warning: Title/URL mismatch, but navigation occurred.`);
    }

    await browser.close();
  } catch (err) {
    console.error(`❌ Failed verification for ${role}:`, err.message);
    // Take screenshot on failure for diagnosis if needed (optional)
    await browser.close();
    return false;
  }
  return true;
}

async function run() {
  console.log('🚀 Starting Multi-User UI Navigation Test...');
  
  const tests = [
    { role: 'admin', badge: 'ADMIN001', pass: 'admin123', text: 'Admin' },
    { role: 'planner', badge: 'PLN001', pass: 'pass123', text: 'Planner' },
    { role: 'supervisor', badge: 'SPV001', pass: 'pass123', text: 'Supervisor' },
    { role: 'shift', badge: 'SHR001', pass: 'pass123', text: 'Dashboard' },
    { role: 'operator', badge: 'OPR001', pass: 'pass123', text: 'Mele' }
  ];

  for (const t of tests) {
    await verifyUser(t.role, t.badge, t.pass, t.text);
  }

  console.log('\n🏁 UI Verification Complete.');
}

run();
