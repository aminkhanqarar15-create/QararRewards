'use strict';

const QRTasks = [
  {
    id: 'daily-checkin',
    title: 'ورځنی Check-in',
    description: 'هره ورځ سیستم ته ننوتئ او خپل انعام ترلاسه کړئ.',
    reward: 2
  },

];

function dashboardUser() {
  return window.QararRewards.Auth.getCurrentUser();
}

function updateDashboardStats() {
  const user = dashboardUser();

  if (!user) return;

  const stats = {
    balance: user.balance || 0,
    earned: user.totalEarned || 0,
    referrals: user.referrals || 0,
    tasks: Array.isArray(user.completedTasks)
      ? user.completedTasks.length
      : 0
  };

  const balance = document.getElementById('balance');
  const totalEarned = document.getElementById('totalEarned');
  const referrals = document.getElementById('referrals');
  const completedTasks = document.getElementById('completedTasks');

  if (balance) {
    balance.textContent =
      window.QararRewards.formatMoney(stats.balance);
  }

  if (totalEarned) {
    totalEarned.textContent =
      window.QararRewards.formatMoney(stats.earned);
  }

  if (referrals) {
    referrals.textContent = stats.referrals;
  }

  if (completedTasks) {
    completedTasks.textContent = stats.tasks;
  }

  document.querySelectorAll('[data-balance]').forEach(el => {
    el.textContent =
      window.QararRewards.formatMoney(stats.balance);
  });

  document.querySelectorAll('[data-user-name]').forEach(el => {
    el.textContent = user.fullName;
  });

  document.querySelectorAll('[data-referral-code]').forEach(el => {
    el.textContent = user.referralCode;
  });
}

function renderTasks() {
  const container = document.getElementById('tasksContainer');

  if (!container) return;

  const user = dashboardUser();

  if (!user) return;

  const completed = Array.isArray(user.completedTasks)
    ? user.completedTasks
    : [];

  container.innerHTML = QRTasks.map(task => {
    const done = completed.includes(task.id);

    return `
      <div class="card task-card" style="margin-bottom:15px;padding:18px">
        <div style="display:flex;justify-content:space-between;gap:15px;align-items:center">
          <div>
            <h3 style="margin:0 0 7px">${escapeHTML(task.title)}</h3>
            <p style="margin:0;color:#64748b;font-size:13px">
              ${escapeHTML(task.description)}
            </p>
          </div>

          <div style="text-align:center;min-width:80px">
            <strong style="display:block;color:#4524a6;font-size:18px">
              +${task.reward}
            </strong>
            <small>AFN</small>
          </div>
        </div>

        <button
          onclick="completeDashboardTask('${task.id}',${task.reward})"
          ${done ? 'disabled' : ''}
          style="margin-top:15px"
        >
          ${done ? '✅ بشپړه شوې' : '🎁 انعام ترلاسه کړه'}
        </button>
      </div>
    `;
  }).join('');
}

function completeDashboardTask(taskId, reward) {
  const task = QRTasks.find(t => t.id === taskId);

  const result = window.QararRewards.completeTask(
    taskId,
    reward,
    task ? task.title : 'دنده'
  );

  if (!result.success) {
    alert(result.message);
    return;
  }

  alert('🎉 مبارک! ' + reward + ' AFN انعام مو ترلاسه کړ.');

  updateDashboardStats();
  renderTasks();
  renderTransactions();
}

function renderReferral() {
  const user = dashboardUser();

  if (!user) return;

  const link =
    window.location.origin +
    window.location.pathname.replace(/[^/]+$/, '') +
    'register.html?ref=' +
    encodeURIComponent(user.referralCode);

  const code = document.getElementById('referralCode');
  const referralLink = document.getElementById('referralLink');

  if (code) {
    code.textContent = link;
  }

  if (referralLink) {
    referralLink.value = link;
  }
}

function copyReferralLink() {
  const user = dashboardUser();

  if (!user) return;

  const link =
    window.location.origin +
    window.location.pathname.replace(/[^/]+$/, '') +
    'register.html?ref=' +
    encodeURIComponent(user.referralCode);

  navigator.clipboard.writeText(link)
    .then(() => {
      alert('🔗 د ریفرل لینک کاپي شو.');
    })
    .catch(() => {
      prompt('لینک کاپي کړئ:', link);
    });
}

function renderTransactions() {
  const table = document.getElementById('transactionsTable');

  if (!table) return;

  const user = dashboardUser();

  if (!user) return;

  const transactions =
    window.QararRewards.getTransactions(user.id);

  if (!transactions.length) {
    table.innerHTML = `
      <tr>
        <td colspan="4" style="text-align:center;padding:20px">
          تر اوسه معامله نشته.
        </td>
      </tr>
    `;

    return;
  }

  table.innerHTML = transactions.map(tx => {
    const positive = Number(tx.amount) >= 0;

    return `
      <tr>
        <td>${escapeHTML(tx.note || tx.type)}</td>
        <td style="color:${positive ? '#16a34a' : '#dc2626'};font-weight:bold">
          ${positive ? '+' : ''}${tx.amount} AFN
        </td>
        <td>${window.QararRewards.formatDate(tx.createdAt)}</td>
        <td>${positive ? '✅' : '📤'}</td>
      </tr>
    `;
  }).join('');
}

function setupWithdrawalForm() {
  const form = document.getElementById('withdrawForm');

  if (!form) return;

  form.addEventListener('submit', function(e) {
    e.preventDefault();

    const amount =
      document.getElementById('withdrawAmount')?.value;

    const method =
      document.getElementById('withdrawMethod')?.value;

    const account =
      document.getElementById('withdrawAccount')?.value;

    const result =
      window.QararRewards.requestWithdrawal(
        amount,
        method,
        account
      );

    if (!result.success) {
      alert(result.message);
      return;
    }

    alert(
      '✅ ستاسو د ' +
      amount +
      ' AFN ایستلو غوښتنه ثبت شوه.'
    );

    form.reset();

    updateDashboardStats();
    renderTransactions();
  });
}

function setupProfileForm() {
  const form = document.getElementById('profileForm');

  if (!form) return;

  const user = dashboardUser();

  if (!user) return;

  const fullName = document.getElementById('profileFullName');
  const email = document.getElementById('profileEmail');

  if (fullName) fullName.value = user.fullName || '';
  if (email) email.value = user.email || '';

  form.addEventListener('submit', function(e) {
    e.preventDefault();

    const newName =
      fullName ? fullName.value.trim() : user.fullName;

    const updated =
      window.QararRewards.UserDB.update(
        user.id,
        {
          fullName: newName
        }
      );

    if (updated) {
      alert('✅ پروفایل مو تازه شو.');
      updateDashboardStats();
    }
  });
}

function escapeHTML(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function initializeDashboard() {
  if (!dashboardUser()) return;

  updateDashboardStats();
  renderTasks();
  renderReferral();
  renderTransactions();
  setupWithdrawalForm();
  setupProfileForm();
}

document.addEventListener(
  'DOMContentLoaded',
  initializeDashboard
);

window.QararDashboard = {
  initializeDashboard,
  updateDashboardStats,
  renderTasks,
  renderReferral,
  renderTransactions,
  completeDashboardTask
};

document.addEventListener('DOMContentLoaded', function() {
  const logoutBtn = document.getElementById('logoutBtn');

  if (logoutBtn) {
    logoutBtn.addEventListener('click', function() {
      if (window.QararRewards && window.QararRewards.Auth) {
        window.QararRewards.Auth.logout();
      } else {
        localStorage.removeItem('qarar_rewards_current_user');
        window.location.href = 'login.html';
      }
    });
  }
});
