// ON LOAD: Verify credentials immediately and fetch mathematical profiles
window.onload = async function() {
    const token = localStorage.getItem('userToken');
    const loadingGuard = document.getElementById('loadingGuard');
    const adminContent = document.getElementById('adminContent');
            
    if(!token) {
        if (loadingGuard) {
            loadingGuard.innerHTML = "Access Denied: Missing Session Token Passport. Please log in from main page.";
            loadingGuard.style.color = "var(--danger)";
        }
        return;
    }

    try {
    // Query our newly verified analytics backend engine route
    const response = await fetch('/admin/analytics', {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
        if (loadingGuard) {
            loadingGuard.innerHTML = `Access Denied: ${data.message || 'Unauthorized Account context.'}`;
            loadingGuard.style.color = "var(--danger)";
        }
        return;
    }

    // Credentials match perfectly! Remove the guard loading screen and display management UI
    if (loadingGuard) loadingGuard.style.display = 'none';
    if (adminContent) adminContent.style.display = 'block';

    // Map data values smoothly to structural HTML containers with safe string structures
    document.getElementById('totalPlayers').innerText = data.summary.totalPlayers;
    document.getElementById('grossDeposits').innerText = `₦${Number(data.summary.grossDepositsVolume).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    document.getElementById('netEarnings').innerText = `₦${Number(data.summary.netHouseEarnings).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

    // Parse the Paystack errors/unresolved ledger receipts array if any exist
    if(data.unresolvedIssues && data.unresolvedIssues.length > 0) {
        const tableBody = document.getElementById('errorLogTable');
        if (tableBody) {
            let htmlBuffer = ''; // THE FIX: Temporary cache buffer prevents repetitive DOM rendering tasks
                
            data.unresolvedIssues.forEach(issue => {
                htmlBuffer += `
                    <tr>
                        <td><strong>${issue.player}</strong></td>
                        <td style="font-family: monospace; color: var(--accent-gold);">${issue.reference}</td>
                        <td>₦${Number(issue.amount).toFixed(2)}</td>
                        <td><span class="badge">${issue.status}</span></td>
                        <td style="color: var(--text-muted);">${new Date(issue.date).toLocaleString()}</td>
                    </tr>
                `;
            });
            tableBody.innerHTML = htmlBuffer; // Single programmatic render pass
        }
    }

    // THE FIX: Clean event handler binding for the Secure Exit button node
    const logoutBtn = document.getElementById('admin-logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('userToken');
            localStorage.removeItem('username');
            window.location.href = 'index.html'; // Kick back to main entry point routing file
        });
    }

    } catch (err) {
        console.error("Dashboard core loop sync breakdown:", err);
        if (loadingGuard) {
            loadingGuard.innerHTML = "System synchronization communication failure. Check backend terminal status logs.";
            loadingGuard.style.color = "var(--danger)";
        }
    }
};