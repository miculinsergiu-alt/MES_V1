const axios = require('axios');

const API_URL = 'http://localhost:3001/api';
const CONCURRENCY = 10;

async function stressTest() {
  console.log('🔥 Starting Stress Test...');

  try {
    const loginRes = await axios.post(`${API_URL}/auth/login`, {
      badge_number: 'ADMIN001',
      password: 'admin123'
    });
    const token = loginRes.data.token;
    const authConfig = { headers: { Authorization: `Bearer ${token}` } };

    // Create a few orders first
    console.log('📦 Creating orders...');
    const orderPromises = [];
    for (let i = 0; i < 5; i++) {
        orderPromises.push(axios.post(`${API_URL}/orders`, {
            orders: [{
                machine_id: 1,
                product_name: `Stress Test Product ${i}`,
                quantity: 100,
                planned_start: new Date(Date.now() + i * 3600000).toISOString().replace('T', ' ').substring(0, 19),
                planned_end: new Date(Date.now() + (i + 1) * 3600000).toISOString().replace('T', ' ').substring(0, 19)
            }]
        }, authConfig));
    }
    const orderResults = await Promise.all(orderPromises);
    const orderIds = orderResults.map(r => r.data.created[0].id);
    console.log(`✅ ${orderIds.length} orders created.`);

    // Simulate concurrent results submission
    console.log(`🚀 Simulating ${CONCURRENCY} concurrent result submissions...`);
    const resultPromises = [];
    for (let i = 0; i < CONCURRENCY; i++) {
        const orderId = orderIds[i % orderIds.length];
        resultPromises.push(
            axios.post(`${API_URL}/production/results`, {
                order_id: orderId,
                qty_ok: 10,
                qty_fail: 1
            }, authConfig)
            .then(res => {
                console.log(`  [${i}] Result submitted for Order #${orderId}: ${res.status}`);
                return res;
            })
            .catch(err => {
                console.error(`  [${i}] FAILED for Order #${orderId}:`, err.response?.data || err.message);
                throw err;
            })
        );
    }

    await Promise.all(resultPromises);
    console.log('✅ All concurrent results submitted successfully.');

    // Simulate concurrent delays
    console.log(`🚀 Simulating ${CONCURRENCY} concurrent delay propagations...`);
    const delayPromises = [];
    for (let i = 0; i < CONCURRENCY; i++) {
        const orderId = orderIds[0]; // All hitting the same first order to trigger propagation
        delayPromises.push(
            axios.post(`${API_URL}/orders/${orderId}/delay`, {
                delay_minutes: 5,
                reason: `Stress delay ${i}`,
                source: 'system'
            }, authConfig)
            .then(res => {
                console.log(`  [${i}] Delay propagated for Order #${orderId}: ${res.status}`);
                return res;
            })
            .catch(err => {
                console.error(`  [${i}] Delay FAILED for Order #${orderId}:`, err.response?.data || err.message);
                throw err;
            })
        );
    }

    await Promise.all(delayPromises);
    console.log('✅ All concurrent delays propagated successfully.');

    console.log('\n🏁 Stress Test Complete. Database handled concurrent load with WAL mode.');
    process.exit(0);

  } catch (err) {
    console.error('\n❌ Stress Test Failed:', err.response?.data || err.message);
    process.exit(1);
  }
}

stressTest();
