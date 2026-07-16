let chartInstance = null;

async function main() {
  setStatus('กำลังโหลด...');

  await liff.init({ liffId: LIFF_ID });

  if (!liff.isLoggedIn()) {
    liff.login();
    return;
  }

  const idToken = liff.getIDToken();
  const headers = { Authorization: `Bearer ${idToken}` };
  const month = new Date().toISOString().slice(0, 7);

  const [summaryRes, cashflowRes, txRes] = await Promise.all([
    fetch(`/api/summary?month=${month}`, { headers }),
    fetch('/api/cashflow', { headers }),
    fetch('/api/transactions', { headers }),
  ]);

  if (summaryRes.status === 401 || summaryRes.status === 403) {
    setStatus('');
    document.getElementById('app').innerHTML = '<p class="error">บัญชีนี้ไม่มีสิทธิ์เข้าดูข้อมูล</p>';
    return;
  }

  const summary = await summaryRes.json();
  const cashflow = await cashflowRes.json();
  const txData = await txRes.json();

  renderSummary(summary);
  renderCashflowChart(cashflow);
  renderTransactions(txData);
  setStatus('');
}

function setStatus(text) {
  document.getElementById('status').textContent = text;
}

function renderSummary(summary) {
  const el = document.getElementById('summary-cards');
  const accounts = summary.accounts || [];

  if (accounts.length === 0) {
    el.innerHTML = '<p class="status">ยังไม่มีบัญชีใน Actual — สร้างบัญชีก่อนในหน้า /actual</p>';
    return;
  }

  el.innerHTML = accounts
    .map((a) => {
      const balance = typeof a.balance === 'number' ? a.balance : 0;
      const cls = balance < 0 ? 'negative' : 'positive';
      return `<div class="card">
        <div class="card-label">${escapeHtml(a.name)}</div>
        <div class="card-value ${cls}">${formatBaht(balance)}</div>
      </div>`;
    })
    .join('');
}

function renderCashflowChart(cashflow) {
  const months = cashflow.months || [];
  const ctx = document.getElementById('cashflow-chart');

  if (chartInstance) chartInstance.destroy();

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: months.map((m) => m.month),
      datasets: [
        {
          label: 'หนี้รวม',
          data: months.map((m) => m.totalDebt),
          borderColor: '#D85A30',
          backgroundColor: 'rgba(216, 90, 48, 0.1)',
          tension: 0.3,
          fill: true,
        },
      ],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } },
    },
  });
}

function renderTransactions(txData) {
  const el = document.getElementById('transaction-list');
  const transactions = txData.transactions || [];

  if (transactions.length === 0) {
    el.innerHTML = '<li>ยังไม่มีรายการ</li>';
    return;
  }

  el.innerHTML = transactions
    .map((t) => {
      const cls = t.amount < 0 ? 'negative' : 'positive';
      return `<li>
        <span>${escapeHtml(t.payee || t.notes || '-')}</span>
        <span class="tx-amount ${cls}">${formatBaht(t.amount)}</span>
      </li>`;
    })
    .join('');
}

function formatBaht(cents) {
  const baht = cents / 100;
  return baht.toLocaleString('th-TH', { style: 'currency', currency: 'THB' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

main().catch((err) => {
  console.error(err);
  setStatus('');
  document.getElementById('app').innerHTML = '<p class="error">โหลดข้อมูลไม่สำเร็จ ลองเปิดใหม่อีกครั้ง</p>';
});
