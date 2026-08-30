// DOM Elements
const appScreen = document.getElementById('app-screen');
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
let currentActiveShareId = null;
let currentShowCombined = false;

function updateSidebarToggleButton() {
    const toggleBtn = document.getElementById('sidebar-toggle-btn');
    if (!toggleBtn) return;
    const collapsed = appScreen && appScreen.classList.contains('sidebar-collapsed');
    toggleBtn.textContent = collapsed ? '☰' : '✕';
    toggleBtn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    toggleBtn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
}

function applySidebarState() {
    if (!appScreen) return;
    const stored = localStorage.getItem('bc_sidebar_collapsed');
    const isMobile = window.innerWidth <= 768;
    const shouldCollapse = stored === 'true' || (stored === null && isMobile);
    appScreen.classList.toggle('sidebar-collapsed', shouldCollapse);
    updateSidebarToggleButton();
}

function toggleSidebar() {
    if (!appScreen) return;
    const nextState = !appScreen.classList.contains('sidebar-collapsed');
    appScreen.classList.toggle('sidebar-collapsed', nextState);
    localStorage.setItem('bc_sidebar_collapsed', String(nextState));
    updateSidebarToggleButton();
}

// ---------- Theme ----------
function applyTheme(theme) {
    document.body.classList.toggle('theme-light', theme === 'light');
    document.body.classList.toggle('theme-dark', theme !== 'light');
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) btn.textContent = theme === 'light' ? '🌙' : '☀️';
}
function toggleTheme() {
    const current = localStorage.getItem('bc_theme') || 'dark';
    const next = current === 'light' ? 'dark' : 'light';
    localStorage.setItem('bc_theme', next);
    applyTheme(next);
}
applyTheme(localStorage.getItem('bc_theme') || 'dark');

// Init Auth & App
document.addEventListener('DOMContentLoaded', async () => {
    const isLoggedIn = await DB.init();
    if (isLoggedIn) {
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('app-screen').classList.remove('hidden');
        window.dispatchEvent(new Event('db_updated'));
    }
    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

    const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
    if (sidebarToggleBtn) sidebarToggleBtn.addEventListener('click', toggleSidebar);
    applySidebarState();
    window.addEventListener('resize', applySidebarState);
});

// View Navigation Logic
function switchView(viewName) {
    Object.values(views).forEach(v => v.classList.add('hidden'));
    Object.values(navs).forEach(n => n.classList.remove('active'));
    views[viewName].classList.remove('hidden');
    if (navs[viewName]) navs[viewName].classList.add('active');
    if (viewName === 'reports') renderReports();
    window.scrollTo(0, 0);
}
navs.dashboard.addEventListener('click', (e) => { e.preventDefault(); switchView('dashboard'); });
navs.reports.addEventListener('click', (e) => { e.preventDefault(); switchView('reports'); });
document.getElementById('back-btn').addEventListener('click', () => { currentSelectedBC = null; switchView('dashboard'); });

// ---------- Dashboard ----------
window.addEventListener('db_updated', () => {
    const bcList = document.getElementById('bc-list');
    bcList.innerHTML = '';

    DB.cache.bcs.forEach(bc => {
        const start = new Date(bc.start_date);
        const end = new Date(start);
        end.setMonth(end.getMonth() + bc.total_months);
        const shares = DB.getSharesForBc(bc.id);
        const pool = bcGetPool(bc);

        const totalPaid = shares.reduce((sum, s) => {
            const rows = bcComputeShareRows(bc, s, DB.cache.transactions, DB.getMetaMap(s.id));
            return sum + rows[rows.length - 1].cumulativePaid;
        }, 0);
        const totalBalance = shares.reduce((sum, s) => {
            const rows = bcComputeShareRows(bc, s, DB.cache.transactions, DB.getMetaMap(s.id));
            return sum + rows[rows.length - 1].balance;
        }, 0);

        const card = document.createElement('div');
        card.className = 'card';
        card.onclick = () => openDetailView(bc.id);
        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: start;">
                <h3>${bc.name} ${bc.ended ? '<span class="badge">Ended</span>' : ''}</h3>
                <span class="badge">${shares.length} share${shares.length > 1 ? 's' : ''}</span>
            </div>
            <p>Installment: ${bcFmtMoney(bc.monthly_installment)} PKR / month</p>
            <p>Start: ${bc.start_date} &nbsp;·&nbsp; End: ${end.toISOString().split('T')[0]}</p>
            <p>Pool per opening: ${bcFmtMoney(pool)} PKR</p>
            <hr class="card-divider">
            <div style="display: flex; justify-content: space-between;">
                <span>Total Paid</span><span>${bcFmtMoney(totalPaid)} PKR</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-top:6px;">
                <span>Balance</span>
                <span class="balance ${totalBalance < 0 ? 'negative' : 'positive'}">${bcFmtMoney(totalBalance)} PKR</span>
            </div>
        `;
        bcList.appendChild(card);
    });

    if (currentSelectedBC && !views.detail.classList.contains('hidden')) {
        renderDetailView();
    }
});

// ---------- Detail View ----------
function openDetailView(bcId) {
    currentSelectedBC = bcId;
    const shares = DB.getSharesForBc(bcId);
    currentActiveShareId = shares[0] ? shares[0].id : null;
    currentShowCombined = false;
    renderDetailView();
    switchView('detail');
}

function renderDetailView() {
    const bc = DB.cache.bcs.find(b => b.id === currentSelectedBC);
    if (!bc) return;
    const shares = DB.getSharesForBc(bc.id);
    if (!shares.find(s => s.id === currentActiveShareId)) currentActiveShareId = shares[0] ? shares[0].id : null;

    const start = new Date(bc.start_date);
    const end = new Date(start);
    end.setMonth(end.getMonth() + bc.total_months);

    document.getElementById('detail-title').textContent = bc.name;
    document.getElementById('detail-subtitle').textContent =
        `${bcFmtMoney(bc.monthly_installment)} PKR/Month · ${bc.total_months} months · ${bc.total_members || bc.total_months} members · Pool ${bcFmtMoney(bcGetPool(bc))} PKR`;
    document.getElementById('detail-end').textContent = end.toISOString().split('T')[0];

    // Share tabs
    const tabsWrap = document.getElementById('share-tabs');
    tabsWrap.innerHTML = '';
    if (shares.length > 1) {
        tabsWrap.classList.remove('hidden');
        shares.forEach(s => {
            const tab = document.createElement('button');
            tab.className = 'share-tab' + (!currentShowCombined && currentActiveShareId === s.id ? ' active' : '');
            tab.textContent = s.label + (s.open_month ? ' • opened' : '');
            tab.onclick = () => { currentShowCombined = false; currentActiveShareId = s.id; renderDetailView(); };
            tabsWrap.appendChild(tab);
        });
        const combinedTab = document.createElement('button');
        combinedTab.className = 'share-tab' + (currentShowCombined ? ' active' : '');
        combinedTab.textContent = 'Combined';
        combinedTab.onclick = () => { currentShowCombined = true; renderDetailView(); };
        tabsWrap.appendChild(combinedTab);
    } else {
        tabsWrap.classList.add('hidden');
    }

    const shareActionsEl = document.getElementById('share-actions');
    const timeline = document.getElementById('timeline');
    timeline.innerHTML = '';

    if (currentShowCombined && shares.length === 2) {
        shareActionsEl.innerHTML = '';
        const rows = bcComputeCombinedRows(bc, shares[0], shares[1], DB.cache.transactions, DB.getMetaMap(shares[0].id), DB.getMetaMap(shares[1].id));
        const last = rows[rows.length - 1];
        document.getElementById('detail-balance').textContent = `${bcFmtMoney(last.balance)} PKR`;
        document.getElementById('detail-balance').className = `balance ${last.balance < 0 ? 'negative' : 'positive'}`;
        document.getElementById('detail-progress').textContent = `Combined: ${shares.map(s => s.label).join(' + ')}`;
        renderCombinedTimeline(rows);
        return;
    }

    const share = shares.find(s => s.id === currentActiveShareId);
    if (!share) { timeline.innerHTML = '<p>No share found.</p>'; return; }

    const rows = bcComputeShareRows(bc, share, DB.cache.transactions, DB.getMetaMap(share.id));
    const last = rows[rows.length - 1];
    document.getElementById('detail-balance').textContent = `${bcFmtMoney(last.balance)} PKR`;
    document.getElementById('detail-balance').className = `balance ${last.balance < 0 ? 'negative' : 'positive'}`;
    document.getElementById('detail-progress').textContent = `${rows.filter(r => r.paid > 0).length} / ${bc.total_months} months paid`;

    // Open BC button / status
    shareActionsEl.innerHTML = '';
    if (!share.open_month) {
        const btn = document.createElement('button');
        btn.className = 'success-btn';
        btn.textContent = '🎉 Mark BC as Opened / Received';
        btn.onclick = () => openOpenBcModal(bc, share);
        shareActionsEl.appendChild(btn);
    } else {
        const pill = document.createElement('span');
        pill.className = 'badge success';
        pill.textContent = `Opened ${bcMonthLabel(share.open_month)} · Received ${bcFmtMoney(share.payout_amount)} PKR`;
        const undoBtn = document.createElement('button');
        undoBtn.className = 'secondary';
        undoBtn.style.marginLeft = '10px';
        undoBtn.textContent = 'Undo';
        undoBtn.onclick = () => { if (confirm('Clear the opening for this share?')) DB.clearOpenShare(share.id); };
        shareActionsEl.appendChild(pill);
        shareActionsEl.appendChild(undoBtn);
    }

    renderShareTimeline(bc, share, rows);
}

function renderShareTimeline(bc, share, rows) {
    const timeline = document.getElementById('timeline');
    timeline.innerHTML = `
        <div class="table-container">
        <table>
            <thead><tr>
                <th>Month</th><th>Due</th><th>Due Date</th><th>Paid</th><th>Payments</th><th>Balance</th><th>Remarks</th><th></th>
            </tr></thead>
            <tbody id="timeline-tbody"></tbody>
        </table>
        </div>
    `;
    const tbody = document.getElementById('timeline-tbody');
    rows.forEach(r => {
        const tr = document.createElement('tr');
        if (r.meta.skipped) tr.style.opacity = '0.55';
        if (r.isOpenMonth) tr.style.background = 'var(--surface-hover)';
        const paymentsHtml = r.payments.length === 0 ? '—' : r.payments.map(p => `${bcFmtMoney(p.amount)} on ${p.transaction_date}`).join('<br>');
        tr.innerHTML = `
            <td><strong>${bcMonthLabel(r.monthKey)}</strong>${r.isOpenMonth ? ' <span class="badge success">Opened</span>' : ''}</td>
            <td>${bcFmtMoney(r.due)}</td>
            <td>${r.meta.due_date || '—'}</td>
            <td>${bcFmtMoney(r.paid)}</td>
            <td style="font-size:0.85rem;">${paymentsHtml}</td>
            <td class="${r.balance < 0 ? 'negative' : 'positive'}" style="font-weight:700;">${bcFmtMoney(r.balance)}</td>
            <td style="color:var(--text-secondary); font-size:0.85rem;">${r.meta.remarks || '—'}${r.meta.skipped ? ' (skipped)' : ''}</td>
            <td>
                <button class="secondary" style="padding:5px 10px; font-size:0.8rem;" onclick="openEditInstallmentModal('${bc.id}','${share.id}','${r.monthKey}')">Edit</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    const note = document.createElement('p');
    note.style.cssText = 'color:var(--text-secondary); font-size:0.85rem; margin-top:14px;';
    note.textContent = "Balance = total paid so far minus the payout received (once opened). The opening month's own installment is netted directly out of the payout rather than paid in cash, so balance drops sharply that month, then climbs back toward zero as remaining months are paid.";
    timeline.appendChild(note);
}

function renderCombinedTimeline(rows) {
    const timeline = document.getElementById('timeline');
    const total = rows.reduce((acc, r) => ({ due: acc.due + r.due, paid: acc.paid + r.paid }), { due: 0, paid: 0 });
    timeline.innerHTML = `
        <div class="table-container">
        <table>
            <thead><tr><th>Month</th><th>Due</th><th>Paid</th><th>Cumulative Paid</th><th>Balance</th></tr></thead>
            <tbody>
                ${rows.map(r => `
                    <tr>
                        <td><strong>${bcMonthLabel(r.monthKey)}</strong></td>
                        <td>${bcFmtMoney(r.due)}</td>
                        <td>${bcFmtMoney(r.paid)}</td>
                        <td>${bcFmtMoney(r.cumulativePaid)}</td>
                        <td class="${r.balance < 0 ? 'negative' : 'positive'}" style="font-weight:700;">${bcFmtMoney(r.balance)}</td>
                    </tr>`).join('')}
                <tr style="background:var(--surface-hover); font-weight:700;">
                    <td>Total</td><td>${bcFmtMoney(total.due)}</td><td>${bcFmtMoney(total.paid)}</td><td>—</td>
                    <td class="${rows[rows.length - 1].balance < 0 ? 'negative' : 'positive'}">${bcFmtMoney(rows[rows.length - 1].balance)}</td>
                </tr>
            </tbody>
        </table>
        </div>
    `;
}

// ---------- Edit Installment Modal ----------
function openEditInstallmentModal(bcId, shareId, monthKey) {
    const bc = DB.cache.bcs.find(b => b.id === bcId);
    const share = DB.cache.shares.find(s => s.id === shareId);
    const meta = DB.getMetaMap(shareId)[monthKey] || { due_date: '', remarks: '', skipped: false };
    const payments = DB.cache.transactions.filter(t => t.bc_share_id === shareId && t.month_key === monthKey && t.type === 'payment')
        .sort((a, b) => new Date(a.transaction_date) - new Date(b.transaction_date));

    document.getElementById('inst-modal-title').textContent = `${bcMonthLabel(monthKey)} — ${share.label}`;
    document.getElementById('inst-due-date').value = meta.due_date || '';
    document.getElementById('inst-remarks').value = meta.remarks || '';
    document.getElementById('inst-skipped').checked = !!meta.skipped;

    const linesWrap = document.getElementById('inst-payment-lines');
    linesWrap.innerHTML = '';
    const lines = payments.length ? payments.map(p => ({ amount: p.amount, date: p.transaction_date })) : [{ amount: '', date: new Date().toISOString().split('T')[0] }];
    lines.forEach(line => addPaymentLine(line.amount, line.date));

    document.getElementById('inst-modal').dataset.bcId = bcId;
    document.getElementById('inst-modal').dataset.shareId = shareId;
    document.getElementById('inst-modal').dataset.monthKey = monthKey;
    document.getElementById('inst-modal').classList.remove('hidden');
}

function addPaymentLine(amount = '', date = '') {
    const linesWrap = document.getElementById('inst-payment-lines');
    const row = document.createElement('div');
    row.className = 'payment-line';
    row.innerHTML = `
        <input type="number" placeholder="Amount (Rs)" class="pl-amount" value="${amount}">
        <input type="date" class="pl-date" value="${date || new Date().toISOString().split('T')[0]}">
        <button type="button" class="secondary pl-remove" style="padding:6px 10px;">✕</button>
    `;
    row.querySelector('.pl-remove').onclick = () => row.remove();
    linesWrap.appendChild(row);
}

document.getElementById('inst-add-line-btn').addEventListener('click', () => addPaymentLine());
document.getElementById('inst-cancel-btn').addEventListener('click', () => document.getElementById('inst-modal').classList.add('hidden'));

document.getElementById('inst-save-btn').addEventListener('click', async () => {
    const modal = document.getElementById('inst-modal');
    const bcId = modal.dataset.bcId, shareId = modal.dataset.shareId, monthKey = modal.dataset.monthKey;
    const dueDate = document.getElementById('inst-due-date').value;
    const remarks = document.getElementById('inst-remarks').value;
    const skipped = document.getElementById('inst-skipped').checked;
    const lines = Array.from(document.querySelectorAll('#inst-payment-lines .payment-line')).map(row => ({
        amount: row.querySelector('.pl-amount').value,
        date: row.querySelector('.pl-date').value
    }));

    modal.classList.add('hidden');
    await DB.upsertMeta(shareId, monthKey, { due_date: dueDate || null, remarks, skipped });
    await DB.setPaymentsForMonth(bcId, shareId, monthKey, lines);
});

// ---------- Open BC Modal ----------
function openOpenBcModal(bc, share) {
    const schedule = bcBuildSchedule(bc);
    const select = document.getElementById('open-bc-month');
    select.innerHTML = schedule.map(mk => `<option value="${mk}">${bcMonthLabel(mk)}</option>`).join('');
    const pool = bcGetPool(bc);
    const payout = bcComputePayout(bc);
    document.getElementById('open-bc-pool').textContent = bcFmtMoney(pool) + ' PKR';
    document.getElementById('open-bc-payout').value = payout;
    document.getElementById('open-bc-note').textContent =
        `Auto formula: Pool (${bcFmtMoney(pool)} PKR) − this month's own installment (${bcFmtMoney(bc.monthly_installment)} PKR), netted directly instead of paid in cash.`;

    const modal = document.getElementById('open-bc-modal');
    modal.dataset.shareId = share.id;
    modal.classList.remove('hidden');
}
document.getElementById('open-bc-cancel-btn').addEventListener('click', () => document.getElementById('open-bc-modal').classList.add('hidden'));
document.getElementById('open-bc-confirm-btn').addEventListener('click', async () => {
    const modal = document.getElementById('open-bc-modal');
    const shareId = modal.dataset.shareId;
    const monthKey = document.getElementById('open-bc-month').value;
    const payout = Number(document.getElementById('open-bc-payout').value);
    modal.classList.add('hidden');
    await DB.openShare(shareId, monthKey, payout);
});

// ---------- Edit Committee Modal ----------
document.getElementById('edit-bc-btn').addEventListener('click', () => {
    const bc = DB.cache.bcs.find(b => b.id === currentSelectedBC);
    if (!bc) return;
    document.getElementById('edit-bc-name').value = bc.name;
    document.getElementById('edit-bc-start').value = bc.start_date;
    document.getElementById('edit-bc-months').value = bc.total_months;
    document.getElementById('edit-bc-members').value = bc.total_members || bc.total_months;
    document.getElementById('edit-bc-installment').value = bc.monthly_installment;
    document.getElementById('edit-bc-pool-override').value = bc.pool_override || '';
    document.getElementById('edit-bc-ended').checked = !!bc.ended;
    document.getElementById('edit-bc-modal').classList.remove('hidden');
});
document.getElementById('edit-bc-cancel-btn').addEventListener('click', () => document.getElementById('edit-bc-modal').classList.add('hidden'));
document.getElementById('edit-bc-save-btn').addEventListener('click', async () => {
    document.getElementById('edit-bc-modal').classList.add('hidden');
    const poolVal = document.getElementById('edit-bc-pool-override').value;
    await DB.updateBC(currentSelectedBC, {
        name: document.getElementById('edit-bc-name').value,
        start_date: document.getElementById('edit-bc-start').value,
        total_months: Number(document.getElementById('edit-bc-months').value),
        total_members: Number(document.getElementById('edit-bc-members').value),
        monthly_installment: Number(document.getElementById('edit-bc-installment').value),
        pool_override: poolVal === '' ? null : Number(poolVal),
        ended: document.getElementById('edit-bc-ended').checked
    });
});

// ---------- Delete BC ----------
document.getElementById('delete-bc-btn').addEventListener('click', async () => {
    const bc = DB.cache.bcs.find(b => b.id === currentSelectedBC);
    if (!bc) return;
    if (!confirm(`Delete "${bc.name}" permanently? This removes all its shares and payments and cannot be undone.`)) return;
    const id = currentSelectedBC;
    currentSelectedBC = null;
    switchView('dashboard');
    await DB.deleteBC(id);
});

// ---------- Reports ----------
function renderReports() {
    const bcSelect = document.getElementById('report-bc-select');
    const shareSelect = document.getElementById('report-share-select');
    const fromInput = document.getElementById('report-from-month');
    const toInput = document.getElementById('report-to-month');

    if (bcSelect.options.length === 0 || bcSelect.dataset.stale === '1') {
        bcSelect.innerHTML = DB.cache.bcs.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
        bcSelect.dataset.stale = '0';
    }
    if (!bcSelect.value && DB.cache.bcs[0]) bcSelect.value = DB.cache.bcs[0].id;

    const bc = DB.cache.bcs.find(b => b.id === bcSelect.value);
    const tbody = document.getElementById('reports-body');
    const totalRow = document.getElementById('reports-total-row');
    tbody.innerHTML = '';
    if (!bc) { totalRow.classList.add('hidden'); return; }

    const shares = DB.getSharesForBc(bc.id);
    shareSelect.innerHTML = shares.map((s, i) => `<option value="share${i}">${s.label}</option>`).join('')
        + (shares.length === 2 ? `<option value="combined">Combined (both shares)</option>` : '');

    let rows;
    if (shareSelect.value === 'combined' && shares.length === 2) {
        rows = bcComputeCombinedRows(bc, shares[0], shares[1], DB.cache.transactions, DB.getMetaMap(shares[0].id), DB.getMetaMap(shares[1].id));
    } else {
        const idx = shareSelect.value === 'share1' ? 1 : 0;
        const share = shares[idx] || shares[0];
        if (!share) { totalRow.classList.add('hidden'); return; }
        rows = bcComputeShareRows(bc, share, DB.cache.transactions, DB.getMetaMap(share.id))
            .map(r => ({ monthKey: r.monthKey, due: r.due, paid: r.paid, balance: r.balance }));
    }

    const from = fromInput.value, to = toInput.value;
    const filtered = rows.filter(r => (!from || r.monthKey >= from) && (!to || r.monthKey <= to));

    filtered.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${bcMonthLabel(r.monthKey)}</strong></td>
            <td>${bcFmtMoney(r.due)}</td>
            <td>${bcFmtMoney(r.paid)}</td>
            <td class="${r.balance < 0 ? 'negative' : 'positive'}">${bcFmtMoney(r.balance)}</td>
        `;
        tbody.appendChild(tr);
    });

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-secondary);">No months in this range</td></tr>';
        totalRow.classList.add('hidden');
    } else {
        const totalDue = filtered.reduce((s, r) => s + r.due, 0);
        const totalPaid = filtered.reduce((s, r) => s + r.paid, 0);
        const lastBalance = filtered[filtered.length - 1].balance;
        document.getElementById('report-total-due').textContent = bcFmtMoney(totalDue);
        document.getElementById('report-total-paid').textContent = bcFmtMoney(totalPaid);
        const balCell = document.getElementById('report-total-balance');
        balCell.textContent = bcFmtMoney(lastBalance);
        balCell.className = lastBalance < 0 ? 'negative' : 'positive';
        totalRow.classList.remove('hidden');
    }
}
document.getElementById('report-bc-select').addEventListener('change', renderReports);
document.getElementById('report-share-select').addEventListener('change', renderReports);
document.getElementById('report-from-month').addEventListener('change', renderReports);
document.getElementById('report-to-month').addEventListener('change', renderReports);
document.getElementById('report-clear-filter-btn').addEventListener('click', () => {
    document.getElementById('report-from-month').value = '';
    document.getElementById('report-to-month').value = '';
    renderReports();
});
window.addEventListener('db_updated', () => {
    document.getElementById('report-bc-select').dataset.stale = '1';
    if (!views.reports.classList.contains('hidden')) renderReports();
});

// ---------- Auth ----------
document.getElementById('logout-btn').addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    DB.user = null;
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('app-screen').classList.add('hidden');
});

// ---------- New BC Modal ----------
document.getElementById('add-bc-btn').addEventListener('click', () => { document.getElementById('bc-modal').classList.remove('hidden'); });
document.getElementById('close-modal').addEventListener('click', () => { document.getElementById('bc-modal').classList.add('hidden'); });
document.getElementById('bc-num-shares').addEventListener('change', (e) => {
    document.getElementById('bc-share2-wrap').classList.toggle('hidden', e.target.value !== '2');
});

document.getElementById('bc-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const numShares = document.getElementById('bc-num-shares').value;
    const labels = [document.getElementById('bc-share1-label').value || 'Share 1'];
    if (numShares === '2') labels.push(document.getElementById('bc-share2-label').value || 'Share 2');

    await DB.addBC({
        name: document.getElementById('bc-name').value,
        monthly_installment: Number(document.getElementById('bc-installment').value),
        total_months: Number(document.getElementById('bc-months').value),
        total_members: Number(document.getElementById('bc-members').value),
        start_date: document.getElementById('bc-start').value
    }, labels);

    document.getElementById('bc-modal').classList.add('hidden');
    e.target.reset();
    document.getElementById('bc-share2-wrap').classList.add('hidden');
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
