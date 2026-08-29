// DOM Elements
const authScreen = document.getElementById('auth-screen');
const appScreen = document.getElementById('app-screen');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const bcList = document.getElementById('bc-list');
const bcModal = document.getElementById('bc-modal');

// Init Auth & App
document.addEventListener('DOMContentLoaded', async () => {
    const isLoggedIn = await DB.init();
    toggleScreens(isLoggedIn);
});

// Render UI based on DB Cache
window.addEventListener('db_updated', () => {
    bcList.innerHTML = '';
    const bcs = DB.getCalculatedBalances();
    
    bcs.forEach(bc => {
        const card = document.createElement('div');
        card.className = 'card';
        
        const isNegative = bc.balance < 0;
        const balanceClass = isNegative ? 'negative' : 'positive';
        
        card.innerHTML = `
            <h3>${bc.name}</h3>
            <p>Start: ${bc.start_date}</p>
            <p>Installment: ${Number(bc.monthly_installment).toLocaleString()} PKR</p>
            <p>Duration: ${bc.total_months} Months</p>
            <hr style="border-color: #333; margin: 10px 0;">
            <p><strong>Running Balance: <span class="balance ${balanceClass}">${bc.balance.toLocaleString()}</span></strong></p>
        `;
        bcList.appendChild(card);
    });
});

// Auth Listeners
document.getElementById('login-btn').addEventListener('click', async () => {
    const { error } = await supabase.auth.signInWithPassword({
        email: emailInput.value, password: passwordInput.value
    });
    if (error) alert(error.message);
    else if (await DB.init()) toggleScreens(true);
});

document.getElementById('signup-btn').addEventListener('click', async () => {
    const { error } = await supabase.auth.signUp({
        email: emailInput.value, password: passwordInput.value
    });
    if (error) alert(error.message);
    else alert('Check email for confirmation.');
});

document.getElementById('logout-btn').addEventListener('click', async () => {
    await supabase.auth.signOut();
    DB.user = null;
    toggleScreens(false);
});

// Modal Logic
document.getElementById('add-bc-btn').addEventListener('click', () => {
    bcModal.classList.remove('hidden');
});
document.getElementById('close-modal').addEventListener('click', () => {
    bcModal.classList.add('hidden');
});

// Form Submission
document.getElementById('bc-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const bcData = {
        name: document.getElementById('bc-name').value,
        monthly_installment: document.getElementById('bc-installment').value,
        total_months: document.getElementById('bc-months').value,
        start_date: document.getElementById('bc-start').value
    };
    
    // Fire to DB wrapper (Optimistic UI handles closing/rendering instantly)
    DB.addBC(bcData);
    
    bcModal.classList.add('hidden');
    e.target.reset();
});

// Utilities
function toggleScreens(isLoggedIn) {
    if (isLoggedIn) {
        authScreen.classList.add('hidden');
        appScreen.classList.remove('hidden');
        window.dispatchEvent(new Event('db_updated')); // initial render from cache
    } else {
        authScreen.classList.remove('hidden');
        appScreen.classList.add('hidden');
    }
}