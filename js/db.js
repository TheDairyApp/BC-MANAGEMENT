// ============================================================
// Date / calc helpers (global, plain <script> — no bundler)
// ============================================================
function pad2(n) { return String(n).padStart(2, "0"); }
function bcAddMonths(monthKey, n) {
    const [y, m] = monthKey.split("-").map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
function bcMonthKeyFromDate(dateStr) { return dateStr.substring(0, 7); }
function bcMonthLabel(monthKey) {
    if (!monthKey) return "—";
    const [y, m] = monthKey.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
function bcFmtMoney(n) {
    const v = Math.round((Number(n) || 0));
    const sign = v < 0 ? "-" : "";
    return sign + Math.abs(v).toLocaleString("en-PK");
}
function bcBuildSchedule(bc) {
    const arr = [];
    for (let i = 0; i < bc.total_months; i++) arr.push(bcAddMonths(bc.start_date.substring(0, 7), i));
    return arr;
}
function bcGetPool(bc) {
    return bc.pool_override != null ? Number(bc.pool_override) : Number(bc.monthly_installment) * Number(bc.total_members || bc.total_months);
}
// Payout = pool minus ONE month's own installment (that installment is netted
// straight out of the payout instead of being paid in cash).
function bcComputePayout(bc) {
    return bcGetPool(bc) - Number(bc.monthly_installment);
}
// Compute the full month-by-month row set for one share.
// Balance = running total paid so far, minus payout received (once opened).
function bcComputeShareRows(bc, share, payments, metaByMonth) {
    const schedule = bcBuildSchedule(bc);
    let cumulativePaid = 0;
    const payout = share.payout_amount != null ? Number(share.payout_amount) : null;
    return schedule.map((monthKey) => {
        const monthPayments = payments.filter(p => p.bc_share_id === share.id && p.month_key === monthKey && p.type === 'payment')
            .sort((a, b) => new Date(a.transaction_date) - new Date(b.transaction_date));
        const paid = monthPayments.reduce((s, p) => s + Number(p.amount), 0);
        cumulativePaid += paid;
        const meta = metaByMonth[monthKey] || { due_date: null, remarks: '', skipped: false };
        const isOpenMonth = share.open_month === monthKey;
        const afterOpen = !!share.open_month && monthKey >= share.open_month;
        const balance = cumulativePaid - (afterOpen && payout != null ? payout : 0);
        return {
            monthKey, due: Number(bc.monthly_installment), paid, cumulativePaid,
            isOpenMonth, afterOpen, balance, meta, payments: monthPayments
        };
    });
}
function bcComputeCombinedRows(bc, shareA, shareB, payments, metaA, metaB) {
    const rowsA = bcComputeShareRows(bc, shareA, payments, metaA);
    const rowsB = bcComputeShareRows(bc, shareB, payments, metaB);
    return rowsA.map((rA, i) => {
        const rB = rowsB[i];
        return {
            monthKey: rA.monthKey,
            due: rA.due + rB.due,
            paid: rA.paid + rB.paid,
            cumulativePaid: rA.cumulativePaid + rB.cumulativePaid,
            balance: rA.balance + rB.balance
        };
    });
}

// ============================================================
// DB — Supabase-backed cache/store
// ============================================================
const DB = {
    cache: {
        bcs: JSON.parse(localStorage.getItem('bc_cache_bcs')) || [],
        shares: JSON.parse(localStorage.getItem('bc_cache_shares')) || [],
        meta: JSON.parse(localStorage.getItem('bc_cache_meta')) || [],
        transactions: JSON.parse(localStorage.getItem('bc_cache_tx')) || []
    },
    user: null,

    _persist() {
        localStorage.setItem('bc_cache_bcs', JSON.stringify(this.cache.bcs));
        localStorage.setItem('bc_cache_shares', JSON.stringify(this.cache.shares));
        localStorage.setItem('bc_cache_meta', JSON.stringify(this.cache.meta));
        localStorage.setItem('bc_cache_tx', JSON.stringify(this.cache.transactions));
    },

    async init() {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) return false;
        this.user = session.user;
        await this.syncFromServer();
        return true;
    },

    async syncFromServer() {
        const [bcsRes, sharesRes, metaRes, txRes] = await Promise.all([
            supabaseClient.from('bcs').select('*').order('created_at', { ascending: false }),
            supabaseClient.from('bc_shares').select('*').order('created_at', { ascending: true }),
            supabaseClient.from('installment_meta').select('*'),
            supabaseClient.from('transactions').select('*').order('transaction_date', { ascending: true })
        ]);
        if (bcsRes.data) this.cache.bcs = bcsRes.data;
        if (sharesRes.data) this.cache.shares = sharesRes.data;
        if (metaRes.data) this.cache.meta = metaRes.data;
        if (txRes.data) this.cache.transactions = txRes.data;
        this._persist();
        window.dispatchEvent(new Event('db_updated'));
    },

    getSharesForBc(bcId) {
        return this.cache.shares.filter(s => s.bc_id === bcId);
    },
    getMetaMap(shareId) {
        const map = {};
        this.cache.meta.filter(m => m.bc_share_id === shareId).forEach(m => { map[m.month_key] = m; });
        return map;
    },

    // ---------- BC (committee) ----------
    async addBC(bcData, shareLabels) {
        const tempId = crypto.randomUUID();
        const newBC = {
            ...bcData, id: tempId, user_id: this.user.id, created_at: new Date().toISOString(),
            pool_override: null, ended: false
        };
        this.cache.bcs.unshift(newBC);
        this._persist();
        window.dispatchEvent(new Event('db_updated'));

        const { data, error } = await supabaseClient.from('bcs').insert([{
            name: newBC.name, monthly_installment: newBC.monthly_installment, total_months: newBC.total_months,
            total_members: newBC.total_members, start_date: newBC.start_date, user_id: newBC.user_id
        }]).select().single();

        if (error) {
            console.error('Failed to save BC:', error);
            this.cache.bcs = this.cache.bcs.filter(b => b.id !== tempId);
            this._persist();
            window.dispatchEvent(new Event('db_updated'));
            alert('Failed to save committee: ' + error.message);
            return null;
        }
        const idx = this.cache.bcs.findIndex(b => b.id === tempId);
        if (idx > -1) this.cache.bcs[idx] = data;

        // Create shares
        const rows = shareLabels.map(label => ({ bc_id: data.id, user_id: this.user.id, label }));
        const { data: shareData, error: shareErr } = await supabaseClient.from('bc_shares').insert(rows).select();
        if (shareErr) { console.error(shareErr); alert('BC saved but shares failed: ' + shareErr.message); }
        else this.cache.shares.push(...shareData);

        this._persist();
        window.dispatchEvent(new Event('db_updated'));
        return data;
    },

    async updateBC(bcId, patch) {
        const idx = this.cache.bcs.findIndex(b => b.id === bcId);
        const prev = idx > -1 ? { ...this.cache.bcs[idx] } : null;
        if (idx > -1) this.cache.bcs[idx] = { ...this.cache.bcs[idx], ...patch };
        this._persist();
        window.dispatchEvent(new Event('db_updated'));

        const { error } = await supabaseClient.from('bcs').update(patch).eq('id', bcId);
        if (error) {
            console.error(error);
            if (prev && idx > -1) this.cache.bcs[idx] = prev;
            this._persist();
            window.dispatchEvent(new Event('db_updated'));
            alert('Failed to update committee: ' + error.message);
        }
    },

    async deleteBC(bcId) {
        const backup = { ...this.cache };
        this.cache.bcs = this.cache.bcs.filter(b => b.id !== bcId);
        this.cache.shares = this.cache.shares.filter(s => s.bc_id !== bcId);
        this.cache.meta = this.cache.meta.filter(m => this.cache.shares.some(s => s.id === m.bc_share_id));
        this.cache.transactions = this.cache.transactions.filter(t => t.bc_id !== bcId);
        this._persist();
        window.dispatchEvent(new Event('db_updated'));

        const { error } = await supabaseClient.from('bcs').delete().eq('id', bcId);
        if (error) {
            console.error(error);
            this.cache = backup;
            this._persist();
            window.dispatchEvent(new Event('db_updated'));
            alert('Failed to delete committee: ' + error.message);
        }
    },

    // ---------- Shares ----------
    async updateShare(shareId, patch) {
        const idx = this.cache.shares.findIndex(s => s.id === shareId);
        const prev = idx > -1 ? { ...this.cache.shares[idx] } : null;
        if (idx > -1) this.cache.shares[idx] = { ...this.cache.shares[idx], ...patch };
        this._persist();
        window.dispatchEvent(new Event('db_updated'));

        const { error } = await supabaseClient.from('bc_shares').update(patch).eq('id', shareId);
        if (error) {
            console.error(error);
            if (prev && idx > -1) this.cache.shares[idx] = prev;
            this._persist();
            window.dispatchEvent(new Event('db_updated'));
            alert('Failed to update share: ' + error.message);
        }
    },

    // Mark a share as opened: sets open_month + payout_amount
    async openShare(shareId, monthKey, payoutAmount) {
        await this.updateShare(shareId, { open_month: monthKey, payout_amount: payoutAmount });
    },
    async clearOpenShare(shareId) {
        await this.updateShare(shareId, { open_month: null, payout_amount: null });
    },

    // ---------- Installment meta (due date / remarks / skip) ----------
    async upsertMeta(shareId, monthKey, patch) {
        const existing = this.cache.meta.find(m => m.bc_share_id === shareId && m.month_key === monthKey);
        const tempId = existing ? existing.id : crypto.randomUUID();
        const newRow = existing ? { ...existing, ...patch } : {
            id: tempId, bc_share_id: shareId, user_id: this.user.id, month_key: monthKey,
            due_date: null, remarks: '', skipped: false, ...patch
        };
        if (existing) {
            const idx = this.cache.meta.findIndex(m => m.id === existing.id);
            this.cache.meta[idx] = newRow;
        } else {
            this.cache.meta.push(newRow);
        }
        this._persist();
        window.dispatchEvent(new Event('db_updated'));

        const { data, error } = await supabaseClient.from('installment_meta')
            .upsert({
                bc_share_id: shareId, user_id: this.user.id, month_key: monthKey,
                due_date: newRow.due_date || null, remarks: newRow.remarks || '', skipped: !!newRow.skipped
            }, { onConflict: 'bc_share_id,month_key' })
            .select().single();

        if (error) {
            console.error(error);
            alert('Failed to save month details: ' + error.message);
        } else if (data) {
            const idx = this.cache.meta.findIndex(m => m.bc_share_id === shareId && m.month_key === monthKey);
            if (idx > -1) this.cache.meta[idx] = data; else this.cache.meta.push(data);
            this._persist();
            window.dispatchEvent(new Event('db_updated'));
        }
    },

    // ---------- Payments (transactions) ----------
    async addPayment(bcId, shareId, monthKey, amount, dateStr, notes = '') {
        const newTx = {
            id: crypto.randomUUID(), bc_id: bcId, bc_share_id: shareId, user_id: this.user.id,
            type: 'payment', amount, transaction_date: dateStr, month_key: monthKey, notes,
            created_at: new Date().toISOString()
        };
        this.cache.transactions.push(newTx);
        this._persist();
        window.dispatchEvent(new Event('db_updated'));

        const { error } = await supabaseClient.from('transactions').insert([{
            bc_id: bcId, bc_share_id: shareId, user_id: this.user.id, type: 'payment',
            amount, transaction_date: dateStr, month_key: monthKey, notes
        }]);
        if (error) {
            console.error(error);
            this.cache.transactions = this.cache.transactions.filter(t => t.id !== newTx.id);
            this._persist();
            window.dispatchEvent(new Event('db_updated'));
            alert('Failed to save payment: ' + error.message);
        }
    },

    async deletePayment(txId) {
        const backup = [...this.cache.transactions];
        this.cache.transactions = this.cache.transactions.filter(t => t.id !== txId);
        this._persist();
        window.dispatchEvent(new Event('db_updated'));

        const { error } = await supabaseClient.from('transactions').delete().eq('id', txId);
        if (error) {
            console.error(error);
            this.cache.transactions = backup;
            this._persist();
            window.dispatchEvent(new Event('db_updated'));
            alert('Failed to remove payment: ' + error.message);
        }
    },

    // Replace all payments for a given share+month in one go (used by the edit modal,
    // so split-payment lines can be added/edited/removed together)
    async setPaymentsForMonth(bcId, shareId, monthKey, paymentLines) {
        const existing = this.cache.transactions.filter(t => t.bc_share_id === shareId && t.month_key === monthKey && t.type === 'payment');
        for (const tx of existing) await this.deletePayment(tx.id);
        for (const line of paymentLines) {
            if (line.amount === '' || isNaN(Number(line.amount))) continue;
            await this.addPayment(bcId, shareId, monthKey, Number(line.amount), line.date || new Date().toISOString().split('T')[0], line.remarks || '');
        }
    }
};
