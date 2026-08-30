// DOM Elements
const views = {
    dashboard: document.getElementById('view-dashboard'),
    detail: document.getElementById('view-detail'),
    reports: document.getElementById('view-reports')
};
const navs = {
    dashboard: document.getElementById('nav-dashboard'),
    reports: document.getElementById('nav-reports')
};
let currentSelectedBC = null;

// Init Auth & App
document.addEventListener('DOMContentLoaded', async () => {
    const isLoggedIn = await DB.init();
    if (isLoggedIn) {
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('app-screen').classList.remove('hidden');
        window.dispatchEvent(new Event('db_updated'));
    }
});

// View Navigation Logic
function switchView(viewName) {
    Object.values(views).forEach(v => v.classList.add('hidden'));
    Object.values(navs).forEach(n => n.classList.remove('active'));
    
    views[viewName].classList.remove('hidden');
    if (navs[viewName]) navs[viewName].classList.add('active');
    
    if (viewName === 'reports') renderReports();
    window.scrollTo(0,0);
}

navs.dashboard.addEventListener('click', (e) => { e.preventDefault(); switchView('dashboard'); });
navs.reports.addEventListener('click', (e) => { e.preventDefault(); switchView('reports'); });
document.getElementById('back-btn').addEventListener('click', () => switchView('dashboard'));

// Render Dashboard UI
window.addEventListener('db_updated', () => {
    const bcs = DB.getCalculatedBalances();
    const bcList = document.getElementById('bc-list');
    bcList.innerHTML = '';
    
    bcs.forEach(bc => {
        // Calculate Installments & Dates
        const start = new Date(bc.start_date);
        const end = new Date(start);
        end.setMonth(end.getMonth() + bc.total_months);
        
        const txs = DB.cache.transactions.filter(t => t.bc_id === bc.id && t.type === 'payment');
        const paidCount = txs.length;
        
        const card = document.createElement('div');
        card.className = 'card';
        card.onclick = () => openDetailView(bc.id);
        
        const balanceClass = bc.balance < 0 ? 'negative' : 'positive';
        
        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: start;">
                <h3>${bc.name}</h3>
                <span class="badge">${paidCount} / ${bc.total_months} Paid</span>
            </div>
            <p>Installment: ${Number(bc.monthly_installment).toLocaleString()} PKR</p>
            <p>Start Date: ${bc.start_date}</p>
            <p>End Date: ${end.toISOString().split('T')[0]}</p>
            <hr class="card-divider">
            <div style="display: flex; justify-content: space-between;">
                <span>Running Balance</span>
                <span class="balance ${balanceClass}">${bc.balance.toLocaleString()} PKR</span>
            </div>
        `;
        bcList.appendChild(card);
    });

    // Refresh detail view if it's currently open
    if (currentSelectedBC && !views.detail.classList.contains('hidden')) {
        openDetailView(currentSelectedBC);
    }
});

// Render Detail View
function openDetailView(bcId) {
    currentSelectedBC = bcId;
    const bc = DB.getCalculatedBalances().find(b => b.id === bcId);
    if (!bc) return;

    // Header Info
    const start = new Date(bc.start_date);
    const end = new Date(start);
    end.setMonth(end.getMonth() + bc.total_months);
    
    document.getElementById('detail-title').textContent = bc.name;
    document.getElementById('detail-subtitle').textContent = `${Number(bc.monthly_installment).toLocaleString()} PKR / Month`;
    document.getElementById('detail-balance').textContent = `${bc.balance.toLocaleString()} PKR`;
    document.getElementById('detail-balance').className = `balance ${bc.balance < 0 ? 'negative' : 'positive'}`;
    document.getElementById('detail-end').textContent = end.toISOString().split('T')[0];

    // Transaction Logic
    const allTx = DB.cache.transactions.filter(t => t.bc_id === bcId);
    const payments = allTx.filter(t => t.type === 'payment').sort((a,b) => new Date(a.transaction_date) - new Date(b.transaction_date));
    const hasReceivedPayout = allTx.some(t => t.type === 'payout');
    
    document.getElementById('detail-progress').textContent = `${payments.length} / ${bc.total_months}`;

    // Payout Button Logic
    const payoutBtn = document.getElementById('receive-payout-btn');
    if (hasReceivedPayout) {
        payoutBtn.classList.add('hidden');
    } else {
        payoutBtn.classList.remove('hidden');
        payoutBtn.onclick = () => {
            if(confirm('Log full payout received today?')) {
                const totalPool = bc.monthly_installment * bc.total_months;
                const today = new Date().toISOString().split('T')[0];
                DB.addTransaction(bc.id, 'payout', totalPool, today, 'ہماری بی سی وصول');
            }
        };
    }

    // Build Timeline
    const timeline = document.getElementById('timeline');
    timeline.innerHTML = '';

    for(let i = 0; i < bc.total_months; i++) {
        let expectedDate = new Date(bc.start_date);
        expectedDate.setMonth(expectedDate.getMonth() + i);
        let dateStr = expectedDate.toISOString().split('T')[0];
        
        let item = document.createElement('div');
        
        if (i < payments.length) {
            // ALREADY PAID
            let actualPayDate = payments[i].transaction_date;
            item.className = 'timeline-item paid';
            item.innerHTML = `
                <div class="timeline-info">
                    <h4>Installment ${i + 1} <span style="color:var(--success); font-size:0.8rem; margin-left:10px;">✓ Paid</span></h4>
                    <p>Expected: ${dateStr} | Paid on: ${actualPayDate}</p>
                </div>
                <strong>${Number(payments[i].amount).toLocaleString()}</strong>
            `;
        } else if (i === payments.length) {
            // NEXT DUE
            item.className = 'timeline-item next';
            item.innerHTML = `
                <div class="timeline-info">
                    <h4>Installment ${i + 1} <span style="color:var(--warning); font-size:0.8rem; margin-left:10px;">⏳ Next Due</span></h4>
                    <p>Due Date: ${dateStr}</p>
                </div>
                <button class="primary" onclick="markPaid('${bc.id}', ${bc.monthly_installment}, '${dateStr}')">Mark Paid</button>
            `;
        } else {
            // FUTURE
            item.className = 'timeline-item';
            item.innerHTML = `
                <div class="timeline-info">
                    <h4 style="color:var(--text-secondary)">Installment ${i + 1}</h4>
                    <p>Expected: ${dateStr}</p>
                </div>
                <strong style="color:var(--text-secondary)">${Number(bc.monthly_installment).toLocaleString()}</strong>
            `;
        }
        timeline.appendChild(item);
    }
    
    switchView('detail');
}

// Global function to be called from inline HTML
window.markPaid = function(bcId, amount, expectedDate) {
    const actualDate = new Date().toISOString().split('T')[0]; // Use today's date for record
    DB.addTransaction(bcId, 'payment', amount, actualDate, `Paid for scheduled slot ${expectedDate}`);
};

// Render Reports Table
function renderReports() {
    const reportData = {};
    
    // Group all transactions by YYYY-MM
    DB.cache.transactions.forEach(t => {
        const monthKey = t.transaction_date.substring(0, 7);
        if(!reportData[monthKey]) reportData[monthKey] = { paid: 0, received: 0 };
        
        if(t.type === 'payment') reportData[monthKey].paid += Number(t.amount);
        if(t.type === 'payout') reportData[monthKey].received += Number(t.amount);
    });

    const tbody = document.getElementById('reports-body');
    tbody.innerHTML = '';

    // Sort months chronologically
    const sortedMonths = Object.keys(reportData).sort((a, b) => b.localeCompare(a));

    sortedMonths.forEach(month => {
        const data = reportData[month];
        const netFlow = data.received - data.paid;
        const netClass = netFlow >= 0 ? 'positive' : 'negative';
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${month}</strong></td>
            <td>${data.paid.toLocaleString()}</td>
            <td style="color:var(--success)">${data.received > 0 ? data.received.toLocaleString() : '-'}</td>
            <td class="${netClass}">${netFlow.toLocaleString()}</td>
        `;
        tbody.appendChild(tr);
    });
}

// Auth and Modals remain mostly unchanged...
document.getElementById('logout-btn').addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    DB.user = null;
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('app-screen').classList.add('hidden');
});

document.getElementById('add-bc-btn').addEventListener('click', () => { document.getElementById('bc-modal').classList.remove('hidden'); });
document.getElementById('close-modal').addEventListener('click', () => { document.getElementById('bc-modal').classList.add('hidden'); });

document.getElementById('bc-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    DB.addBC({
        name: document.getElementById('bc-name').value,
        monthly_installment: document.getElementById('bc-installment').value,
        total_months: document.getElementById('bc-months').value,
        start_date: document.getElementById('bc-start').value
    });
    document.getElementById('bc-modal').classList.add('hidden');
    e.target.reset();
});

document.getElementById('login-btn').addEventListener('click', async () => {
    const { error } = await supabaseClient.auth.signInWithPassword({
        email: document.getElementById('email').value, password: document.getElementById('password').value
    });
    if (error) alert(error.message); else if (await DB.init()) location.reload();
});

document.getElementById('signup-btn').addEventListener('click', async () => {
    const { error } = await supabaseClient.auth.signUp({
        email: document.getElementById('email').value, password: document.getElementById('password').value
    });
    if (error) alert(error.message); else location.reload();
});