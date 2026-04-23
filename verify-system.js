const axios = require('axios');
const io = require('socket.io-client');

const API_URL = 'http://localhost:3001/api';
const SOCKET_URL = 'http://localhost:3001';

async function runTest() {
  console.log('🧪 Starting System-Wide Functional Verification...');
  
  let token = '';
  let operatorId = 0;
  let machineId = 0;
  let orderId = 0;
  let allocationId = 0;

  try {
    // 1. Test LOGIN Button
    console.log('\n[Button] Clicking LOGIN (as Admin)...');
    const loginRes = await axios.post(`${API_URL}/auth/login`, {
      badge_number: 'ADMIN001',
      password: 'admin123'
    });
    token = loginRes.data.token;
    console.log('✅ Login Successful. Token received.');

    const authConfig = { headers: { Authorization: `Bearer ${token}` } };

    // 2. Connect WebSockets for real-time verification
    console.log('\n[System] Connecting to WebSocket...');
    const socket = io(SOCKET_URL, { extraHeaders: { Authorization: `Bearer ${token}` } });
    
    socket.on('production:action', (data) => {
      console.log('📡 Real-time Event received: production:action', data);
    });

    socket.on('production:results', (data) => {
      console.log('📡 Real-time Event received: production:results', data);
    });

    // 3. Test Machine/Order retrieval
    console.log('\n[Button] Accessing PLANNER DASHBOARD...');
    const machines = await axios.get(`${API_URL}/machines`, authConfig);
    machineId = machines.data[0].id;
    console.log(`✅ Machines loaded. Using Machine #${machineId}.`);

    const items = await axios.get(`${API_URL}/items`, authConfig);
    console.log(`✅ Items loaded. Total items: ${items.data.length}.`);

    // 4. Test CREATE ORDER Button
    console.log('\n[Button] Clicking CREATE ORDER...');
    const orderRes = await axios.post(`${API_URL}/orders`, {
      orders: [{
        machine_id: machineId,
        product_name: 'Test Product',
        quantity: 100,
        planned_start: new Date().toISOString().replace('T', ' ').substring(0, 19),
        planned_end: new Date(Date.now() + 3600000).toISOString().replace('T', ' ').substring(0, 19)
      }]
    }, authConfig);
    orderId = orderRes.data.created[0].id;
    console.log(`✅ Order #${orderId} created.`);

    // 5. Test ALLOCATE OPERATOR Button
    console.log('\n[Button] Clicking ALLOCATE OPERATOR (to Shift Responsible)...');
    const allocRes = await axios.post(`${API_URL}/production/allocations`, {
      order_id: orderId,
      operator_id: 4, // Ion Constantin (Demo Operator)
      machine_id: machineId,
      start_time: new Date().toISOString().replace('T', ' ').substring(0, 19),
      end_time: new Date(Date.now() + 3600000).toISOString().replace('T', ' ').substring(0, 19),
      phase: 'setup'
    }, authConfig);
    allocationId = allocRes.data.id;
    console.log(`✅ Operator allocated. Allocation ID: ${allocationId}.`);

    // 6. Test START SETUP Button (Operator Dashboard)
    console.log('\n[Button] Clicking START SETUP (as Operator)...');
    await axios.post(`${API_URL}/production/actions`, {
      allocation_id: allocationId,
      action_type: 'setup_start'
    }, authConfig);
    console.log('✅ Setup Started event sent.');

    // 7. Test SUBMIT RESULTS Button (Quality/Inventory)
    console.log('\n[Button] Clicking SUBMIT RESULTS (OK: 50, FAIL: 5)...');
    await axios.post(`${API_URL}/production/results`, {
      order_id: orderId,
      qty_ok: 50,
      qty_fail: 5,
      defects: [{ reason_id: 1, quantity: 5 }]
    }, authConfig);
    console.log('✅ Results submitted. Inventory deduction and Audit log should trigger.');

    // 8. Test OEE ANALYTICS retrieval
    console.log('\n[Button] Accessing OEE ANALYTICS...');
    const oeeRes = await axios.get(`${API_URL}/analytics/oee`, authConfig);
    console.log(`✅ OEE Data retrieved. Global OEE: ${oeeRes.data.overall_oee}%.`);

    // 9. Test AUDIT LOGS Button
    console.log('\n[Button] Accessing AUDIT LOGS (Admin)...');
    const auditRes = await axios.get(`${API_URL}/analytics/audit`, authConfig);
    console.log(`✅ Audit Logs retrieved. Last action: ${auditRes.data[0].action} on ${auditRes.data[0].entity}.`);

    console.log('\n🏁 Verification Complete. System is responding correctly across all layers.');
    socket.disconnect();
    process.exit(0);

  } catch (err) {
    console.error('\n❌ Verification Failed:', err.response?.data || err.message);
    process.exit(1);
  }
}

runTest();
