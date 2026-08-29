const DB = {
    cache: {
        bcs: JSON.parse(localStorage.getItem('bc_cache_bcs')) || [],
        transactions: JSON.parse(localStorage.getItem('bc_cache_tx')) || []
    },
    user: null,

    // Sync cache to localStorage for offline persistence
    _persist() {
        localStorage.setItem('bc_cache_bcs', JSON.stringify(this.cache.bcs));
        localStorage.setItem('bc_cache_tx', JSON.stringify(this.cache.transactions));
    },

    // Initialize & fetch from Supabase to true up the cache
    async init() {
  const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) return false;
        
        this.user = session.user;
        await this.syncFromServer();
        return true;
    },

    async syncFromServer() {
        const [bcsRes, txRes] = await Promise.all([
            supabaseClient.from('bcs').select('*').order('created_at', { ascending: false }),
supabaseClient.from('transactions').select('*').order('transaction_date', { ascending: false })
        ]);

        if (bcsRes.data) this.cache.bcs = bcsRes.data;
        if (txRes.data) this.cache.transactions = txRes.data;
        this._persist();
        
        // Trigger UI update
        window.dispatchEvent(new Event('db_updated'));
    },

    // Optimistic Add BC
    async addBC(bcData) {
        const tempId = crypto.randomUUID(); // Temporary ID for optimistic UI
        const newBC = { 
            ...bcData, 
            id: tempId, 
            user_id: this.user.id, 
            created_at: new Date().toISOString() 
        };

        



        // 1. Update local cache immediately
        this.cache.bcs.unshift(newBC);
        this._persist();
        window.dispatchEvent(new Event('db_updated'));

        // 2. Background sync to Supabase
        const { data, error } = await supabaseClient.from('bcs').insert([newBC]).select().single();
        
        if (error) {
            console.error('Failed to sync BC:', error);
            // Revert cache on failure
            this.cache.bcs = this.cache.bcs.filter(b => b.id !== tempId);
            this._persist();
            window.dispatchEvent(new Event('db_updated'));
            alert('Failed to save BC. Reverted.');
        } else {
            // Update temp ID with real DB row (if different)
            const index = this.cache.bcs.findIndex(b => b.id === tempId);
            if(index > -1) this.cache.bcs[index] = data;
            this._persist();
        }
    },

    getCalculatedBalances() {
        // Calculate principal paid and payouts for each BC locally
        return this.cache.bcs.map(bc => {
            const bcTx = this.cache.transactions.filter(tx => tx.bc_id === bc.id);
            const totalPaid = bcTx.filter(t => t.type === 'payment').reduce((sum, t) => sum + Number(t.amount), 0);
            const totalPayout = bcTx.filter(t => t.type === 'payout').reduce((sum, t) => sum + Number(t.amount), 0);
            
            // Running balance logic (positive if saving, negative if payout received early)
            const balance = totalPaid - totalPayout;
            
            return { ...bc, balance, totalPaid };
        });
    }
};