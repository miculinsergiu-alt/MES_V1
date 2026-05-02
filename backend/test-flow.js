const axios = require('axios');

async function test() {
    try {
        // 1. Login
        const loginRes = await axios.post('http://localhost:3001/api/auth/login', {
            badge_number: 'ADMIN001',
            password: 'admin123'
        });
        const token = loginRes.data.token;
        const config = { headers: { Authorization: `Bearer ${token}` } };

        console.log("Logged in.");

        // 2. Create Production Order: 10 units of FG-TEST-01 (needs 20 units of RM)
        // Since stock is 0, it should generate a recommendation for 20 units.
        const orderRes = await axios.post('http://localhost:3001/api/orders', {
            orders: [{
                machine_id: 1, // Any machine
                product_name: 'Test Production Flow',
                item_id: 12, // FG-TEST-01
                bom_id: 3,
                quantity: 10,
                planned_start: '2026-05-02 10:00:00',
                planned_end: '2026-05-02 12:00:00',
                order_type: 'production'
            }]
        }, config);

        const orderId = orderRes.data.created[0].id;
        console.log(`Order created: ${orderId}`);

        // 3. Verify Recommendation
        const recRes = await axios.get('http://localhost:3001/api/procurement/recommendations', config);
        const myRec = recRes.data.find(r => r.triggering_order_id === orderId);
        
        if (myRec) {
            console.log(`Recommendation found! Item: ${myRec.item_name}, Qty: ${myRec.recommended_qty}`);
            
            // 4. Convert Recommendation to PO
            const convertRes = await axios.post(`http://localhost:3001/api/procurement/recommendations/${myRec.id}/convert`, {
                supplier_id: 1,
                expected_date: '2026-05-10'
            }, config);
            console.log(`PO Created: ${convertRes.data.id}`);

            // 5. Final check: verify PO exists
            const poRes = await axios.get('http://localhost:3001/api/procurement/purchase-orders', config);
            const myPO = poRes.data.find(p => p.id === convertRes.data.id);
            if (myPO) {
                console.log(`PO #${myPO.id} is officially ordered from ${myPO.supplier_name}.`);
                console.log("TEST SUCCESSFUL: MRP Automation flow is working correctly.");
            }
        } else {
            console.log("Recommendation NOT found. Check logic.");
        }

    } catch (err) {
        console.error("Test failed:", err.response?.data || err.message);
    }
}

test();
