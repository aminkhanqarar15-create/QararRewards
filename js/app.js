'use strict';

const QR_CONFIG = {
  appName: 'Qarar Rewards',
  currency: 'AFN',
  storagePrefix: 'qarar_rewards_',
  referralReward: 8,
  dailyLoginReward: 2,
  minWithdraw: 500
};

const Storage = {
  get(key, fallback = null) {
    try {
      const value = localStorage.getItem(QR_CONFIG.storagePrefix + key);
      return value === null ? fallback : JSON.parse(value);
    } catch (e) {
      return fallback;
    }
  },

  set(key, value) {
    localStorage.setItem(
      QR_CONFIG.storagePrefix + key,
      JSON.stringify(value)
    );
  },

  remove(key) {
    localStorage.removeItem(QR_CONFIG.storagePrefix + key);
  }
};

const UserDB = {
  getAll() {
    return Storage.get('users', []);
  },

  saveAll(users) {
    Storage.set('users', users);
  },

  findById(id) {
    return this.getAll().find(u => u.id === id) || null;
  },

  findByEmail(email) {
    const value = String(email || '').toLowerCase().trim();

    return this.getAll().find(
      u => String(u.email || '').toLowerCase() === value
    ) || null;
  },

  findByUsername(username) {
    const value = String(username || '').toLowerCase().trim();

    return this.getAll().find(
      u => String(u.username || '').toLowerCase() === value
    ) || null;
  },

  findByReferralCode(code) {
    const value = String(code || '').toUpperCase().trim();

    return this.getAll().find(
      u => String(u.referralCode || '').toUpperCase() === value
    ) || null;
  },

  create(user) {
    const users = this.getAll();
    users.push(user);
    this.saveAll(users);
    return user;
  },

  update(id, changes) {
    const users = this.getAll();
    const index = users.findIndex(u => u.id === id);

    if (index === -1) return null;

    users[index] = {
      ...users[index],
      ...changes
    };

    this.saveAll(users);
    return users[index];
  }
};

function generateId() {
  return 'u_' +
    Date.now().toString(36) +
    '_' +
    Math.random().toString(36).slice(2, 8);
}

function generateReferralCode(username) {
  const base = String(username || 'USER')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 6);

  return base + Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase();
}

const Auth = {
  getCurrentUser() {
    const id = Storage.get('currentUserId', null);

    if (!id) return null;

    return UserDB.findById(id);
  },

  login(user) {
    Storage.set('currentUserId', user.id);
  },

  logout() {
    Storage.remove('currentUserId');
    window.location.href = 'index.html';
  },

  isLoggedIn() {
    return !!this.getCurrentUser();
  },

  requireLogin() {
    if (!this.isLoggedIn()) {
      window.location.href = 'login.html';
      return false;
    }

    return true;
  }
};

function addTransaction(userId, type, amount, note) {
  const transactions = Storage.get('transactions', []);

  transactions.unshift({
    id: 'tx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    userId,
    type,
    amount,
    note,
    createdAt: new Date().toISOString()
  });

  Storage.set('transactions', transactions);
}

function processReferral(referralCode, newUserId) {
  if (!referralCode) return null;

  const referrer = UserDB.findByReferralCode(referralCode);

  if (!referrer) return null;

  if (referrer.id === newUserId) return null;

  const reward = QR_CONFIG.referralReward;

  UserDB.update(referrer.id, {
    balance: Number(referrer.balance || 0) + reward,
    totalEarned: Number(referrer.totalEarned || 0) + reward,
    referrals: Number(referrer.referrals || 0) + 1
  });

  addTransaction(
    referrer.id,
    'referral',
    reward,
    'د نوي غړي د راجستر ریفرل انعام'
  );

  return referrer;
}

function registerUser(data) {
  const fullName = String(data.fullName || '').trim();
  const username = String(data.username || '').trim();
  const email = String(data.email || '').trim().toLowerCase();
  const password = String(data.password || '');
  const confirmPassword = String(data.confirmPassword || password);
  const referralCode = String(data.referralCode || '').trim();

  if (fullName.length < 2) {
    return {
      success: false,
      message: 'مهرباني وکړئ بشپړ نوم ولیکئ.'
    };
  }

  if (username.length < 3) {
    return {
      success: false,
      message: 'کارن نوم باید لږ تر لږه ۳ توري ولري.'
    };
  }

  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
    return {
      success: false,
      message: 'کارن نوم یوازې انګلیسي توري، شمېرې او . _ - کارولی شي.'
    };
  }

  if (!email || !email.includes('@')) {
    return {
      success: false,
      message: 'سم ایمیل ولیکئ.'
    };
  }

  if (password.length < 6) {
    return {
      success: false,
      message: 'پټ نوم باید لږ تر لږه ۶ توري ولري.'
    };
  }

  if (password !== confirmPassword) {
    return {
      success: false,
      message: 'د پټ نوم دواړه برخې یو شان نه دي.'
    };
  }

  if (UserDB.findByUsername(username)) {
    return {
      success: false,
      message: 'دا کارن نوم مخکې ثبت شوی دی.'
    };
  }

  if (UserDB.findByEmail(email)) {
    return {
      success: false,
      message: 'دا ایمیل مخکې ثبت شوی دی.'
    };
  }

  const user = {
    id: generateId(),
    fullName,
    username,
    email,
    password,
    referralCode: generateReferralCode(username),
    referredBy: referralCode || null,
    balance: 0,
    totalEarned: 0,
    totalWithdrawn: 0,
    referrals: 0,
    completedTasks: [],
    status: 'active',
    createdAt: new Date().toISOString(),
    lastLoginReward: null
  };

  UserDB.create(user);

  processReferral(referralCode, user.id);

  Auth.login(user);

  addTransaction(
    user.id,
    'register',
    0,
    'نوی حساب جوړ شو'
  );

  return {
    success: true,
    user: UserDB.findById(user.id)
  };
}

function giveDailyLoginReward(user) {
  if (!user) return 0;

  const today = new Date().toISOString().slice(0, 10);

  if (user.lastLoginReward === today) {
    return 0;
  }

  const reward = QR_CONFIG.dailyLoginReward;

  UserDB.update(user.id, {
    balance: Number(user.balance || 0) + reward,
    totalEarned: Number(user.totalEarned || 0) + reward,
    lastLoginReward: today
  });

  addTransaction(
    user.id,
    'daily_login',
    reward,
    'د ننوتلو ورځنی انعام'
  );

  return reward;
}

function loginUser(identifier, password) {
  const value = String(identifier || '').trim();

  let user = UserDB.findByEmail(value);

  if (!user) {
    user = UserDB.findByUsername(value);
  }

  if (!user) {
    return {
      success: false,
      message: 'اکاونټ پیدا نه شو.'
    };
  }

  if (String(user.password) !== String(password)) {
    return {
      success: false,
      message: 'پټ نوم ناسم دی.'
    };
  }

  if (user.status !== 'active') {
    return {
      success: false,
      message: 'دا اکاونټ غیر فعال شوی دی.'
    };
  }

  Auth.login(user);

  const reward = giveDailyLoginReward(user);

  return {
    success: true,
    user: UserDB.findById(user.id),
    dailyReward: reward
  };
}

function completeTask(taskId, reward, note) {
  const user = Auth.getCurrentUser();

  if (!user) {
    return {
      success: false,
      message: 'لومړی خپل حساب ته ننوتئ.'
    };
  }

  const completed = Array.isArray(user.completedTasks)
    ? user.completedTasks
    : [];

  if (completed.includes(taskId)) {
    return {
      success: false,
      message: 'دا دنده مخکې بشپړه شوې ده.'
    };
  }

  const amount = Number(reward || 0);

  UserDB.update(user.id, {
    balance: Number(user.balance || 0) + amount,
    totalEarned: Number(user.totalEarned || 0) + amount,
    completedTasks: [...completed, taskId]
  });

  addTransaction(
    user.id,
    'task',
    amount,
    note || 'دنده بشپړه شوه'
  );

  return {
    success: true,
    reward: amount,
    user: UserDB.findById(user.id)
  };
}

function getTransactions(userId) {
  return Storage
    .get('transactions', [])
    .filter(t => t.userId === userId);
}

function requestWithdrawal(amount, method, account) {
  const user = Auth.getCurrentUser();
  const value = Number(amount);

  if (!user) {
    return {
      success: false,
      message: 'لومړی خپل حساب ته ننوتئ.'
    };
  }

  if (!value || value < QR_CONFIG.minWithdraw) {
    return {
      success: false,
      message: `د ایستلو لږ تر لږه اندازه ${QR_CONFIG.minWithdraw} AFN ده.`
    };
  }

  if (value > Number(user.balance || 0)) {
    return {
      success: false,
      message: 'ستاسو موجوده بیلانس کافي نه دی.'
    };
  }

  if (!method || !account) {
    return {
      success: false,
      message: 'د پیسو د ترلاسه کولو معلومات بشپړ کړئ.'
    };
  }

  const withdrawals = Storage.get('withdrawals', []);

  const withdrawal = {
    id: 'wd_' + Date.now(),
    userId: user.id,
    amount: value,
    method,
    account,
    status: 'pending',
    createdAt: new Date().toISOString()
  };

  withdrawals.unshift(withdrawal);
  Storage.set('withdrawals', withdrawals);

  UserDB.update(user.id, {
    balance: Number(user.balance || 0) - value,
    totalWithdrawn: Number(user.totalWithdrawn || 0) + value
  });

  addTransaction(
    user.id,
    'withdrawal',
    -value,
    'د پیسو ایستلو غوښتنه'
  );

  return {
    success: true,
    withdrawal
  };
}

function formatMoney(amount) {
  return Number(amount || 0).toLocaleString('en-US') +
    ' ' +
    QR_CONFIG.currency;
}

function formatDate(date) {
  if (!date) return '-';

  return new Date(date).toLocaleDateString('ps-AF', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

function showAlert(message, type = 'info') {
  alert(message);
}

function setText(id, value) {
  const el = document.getElementById(id);

  if (el) {
    el.textContent = value;
  }
}

function getInitials(name) {
  return String(name || 'م')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(x => x[0])
    .join('')
    .toUpperCase();
}

function setupRegisterForm() {
  const form = document.getElementById('registerForm');

  if (!form) return;

  form.addEventListener('submit', function(e) {
    e.preventDefault();

    const result = registerUser({
      fullName: document.getElementById('fullName')?.value,
      username: document.getElementById('username')?.value,
      email: document.getElementById('email')?.value,
      password: document.getElementById('password')?.value,
      confirmPassword: document.getElementById('confirmPassword')?.value,
      referralCode: document.getElementById('referralCode')?.value
    });

    const message = document.getElementById('registerMessage');

    if (!result.success) {
      if (message) {
        message.style.display = 'block';
        message.textContent = result.message;
      } else {
        alert(result.message);
      }

      return;
    }

    if (message) {
      message.style.display = 'block';
      message.textContent = 'حساب مو جوړ شو. Dashboard ته انتقالېږئ...';
    }

    setTimeout(() => {
      window.location.href = 'dashboard.html';
    }, 500);
  });
}

function setupLoginForm() {
  const form = document.getElementById('loginForm');

  if (!form) return;

  form.addEventListener('submit', function(e) {
    e.preventDefault();

    const result = loginUser(
      document.getElementById('loginEmail')?.value,
      document.getElementById('loginPassword')?.value
    );

    const message = document.getElementById('loginMessage');

    if (!result.success) {
      if (message) {
        message.style.display = 'block';
        message.textContent = result.message;
      } else {
        alert(result.message);
      }

      return;
    }

    if (message) {
      message.style.display = 'block';
      message.textContent = 'بریالی ننوتل! Dashboard ته ځئ...';
    }

    setTimeout(() => {
      window.location.href = 'dashboard.html';
    }, 500);
  });
}

function setupLogoutButtons() {
  document.querySelectorAll('[data-logout]').forEach(button => {
    button.addEventListener('click', function(e) {
      e.preventDefault();
      Auth.logout();
    });
  });
}

function updateUserUI() {
  const user = Auth.getCurrentUser();

  document.querySelectorAll('[data-user-name]').forEach(el => {
    el.textContent = user ? user.fullName : 'مېلمه';
  });

  document.querySelectorAll('[data-user-balance]').forEach(el => {
    el.textContent = user
      ? formatMoney(user.balance)
      : formatMoney(0);
  });

  document.querySelectorAll('[data-user-referrals]').forEach(el => {
    el.textContent = user ? user.referrals || 0 : 0;
  });
}

function protectPrivatePages() {
  const privatePages = [
    'dashboard.html',
    'referrals.html',
    'rewards.html'
  ];

  const page = window.location.pathname.split('/').pop();

  if (privatePages.includes(page)) {
    Auth.requireLogin();
  }
}

function setupReferralCopy() {
  document.querySelectorAll('[data-copy-referral]').forEach(button => {
    button.addEventListener('click', async function() {
      const user = Auth.getCurrentUser();

      if (!user) return;

      const link =
        window.location.origin +
        window.location.pathname.replace(/[^/]+$/, '') +
        'register.html?ref=' +
        encodeURIComponent(user.referralCode);

      try {
        await navigator.clipboard.writeText(link);
        alert('د ریفرل لینک کاپي شو.');
      } catch (e) {
        prompt('دا لینک کاپي کړئ:', link);
      }
    });
  });
}

function loadReferralFromURL() {
  const input = document.getElementById('referralCode');

  if (!input) return;

  const params = new URLSearchParams(window.location.search);
  const ref = params.get('ref');

  if (ref) {
    input.value = ref;
  }
}

document.addEventListener('DOMContentLoaded', function() {
  protectPrivatePages();
  setupRegisterForm();
  setupLoginForm();
  setupLogoutButtons();
  setupReferralCopy();
  loadReferralFromURL();
  updateUserUI();
});

window.QararRewards = {
  config: QR_CONFIG,
  Storage,
  UserDB,
  Auth,
  registerUser,
  loginUser,
  completeTask,
  requestWithdrawal,
  getTransactions,
  formatMoney,
  formatDate,
  addTransaction
};
