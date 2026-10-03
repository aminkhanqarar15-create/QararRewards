'use strict';

/* =========================================================
   QARAR REWARDS - FRONTEND APP
   Cloudflare Worker API + D1 Database
   ========================================================= */

const QR_CONFIG = {
  appName: 'Qarar Rewards',
  currency: 'AFN',

  storagePrefix: 'qarar_rewards_',

  referralReward: 8,
  dailyLoginReward: 2,
  offerReward: 10,

  minWithdraw: 500,

  API_URL:
    'https://qararrewards-api.aminkhanqarar15.workers.dev'
};


/* =========================================================
   STORAGE
   ========================================================= */

const Storage = {

  get(key, fallback = null) {
    try {
      const value = localStorage.getItem(
        QR_CONFIG.storagePrefix + key
      );

      if (value === null) {
        return fallback;
      }

      return JSON.parse(value);

    } catch (error) {
      console.error('Storage get error:', error);
      return fallback;
    }
  },


  set(key, value) {
    try {
      localStorage.setItem(
        QR_CONFIG.storagePrefix + key,
        JSON.stringify(value)
      );

      return true;

    } catch (error) {
      console.error('Storage set error:', error);
      return false;
    }
  },


  remove(key) {
    try {
      localStorage.removeItem(
        QR_CONFIG.storagePrefix + key
      );

      return true;

    } catch (error) {
      console.error('Storage remove error:', error);
      return false;
    }
  }
};


/* =========================================================
   API REQUEST
   ========================================================= */

async function apiRequest(endpoint, options = {}) {

  const token = Storage.get('authToken', null);

  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = 'Bearer ' + token;
  }

  try {

    const response = await fetch(
      QR_CONFIG.API_URL + endpoint,
      {
        ...options,
        headers
      }
    );

    let data = {};

    try {
      data = await response.json();
    } catch (error) {
      data = {};
    }

    if (!response.ok) {

      if (response.status === 401) {
        Storage.remove('authToken');
        Storage.remove('currentUser');
      }

      throw new Error(
        data.message ||
        data.error ||
        'د سرور سره د اړیکې پر مهال ستونزه رامنځته شوه.'
      );
    }

    return data;

  } catch (error) {

    console.error('API Error:', error);

    if (
      error instanceof TypeError ||
      String(error.message).includes('Failed to fetch')
    ) {
      throw new Error(
        'له سرور سره اړیکه نشته. انټرنېټ او API لینک وګورئ.'
      );
    }

    throw error;
  }
}


/* =========================================================
   USER CACHE
   ========================================================= */

const UserDB = {

  getCurrent() {
    return Storage.get('currentUser', null);
  },


  save(user) {
    Storage.set('currentUser', user);
    return user;
  },


  clear() {
    Storage.remove('currentUser');
  },


  async refresh() {

    try {

      const result = await apiRequest('/api/me');

      const user =
        result.user ||
        result.data ||
        result;

      if (user) {
        this.save(user);
      }

      return user;

    } catch (error) {

      console.error('Refresh user error:', error);

      return null;
    }
  }
};


/* =========================================================
   AUTHENTICATION
   ========================================================= */

const Auth = {

  getToken() {
    return Storage.get('authToken', null);
  },


  getCurrentUser() {
    return UserDB.getCurrent();
  },


  async refreshUser() {
    return await UserDB.refresh();
  },


  setSession(token, user) {

    if (token) {
      Storage.set('authToken', token);
    }

    if (user) {
      UserDB.save(user);
    }
  },


  async loginSession(result) {

    const token =
      result.token ||
      result.accessToken ||
      result.session ||
      null;

    const user =
      result.user ||
      result.data?.user ||
      null;

    if (token) {
      Storage.set('authToken', token);
    }

    if (user) {
      UserDB.save(user);
    }

    return {
      token,
      user
    };
  },


  async logout() {

    try {

      if (this.getToken()) {
        await apiRequest(
          '/api/logout',
          {
            method: 'POST'
          }
        );
      }

    } catch (error) {

      console.warn(
        'Logout API error:',
        error
      );

    } finally {

      Storage.remove('authToken');
      Storage.remove('currentUser');

      window.location.href = 'index.html';
    }
  },


  isLoggedIn() {
    return !!this.getToken();
  },


  requireLogin() {

    if (!this.isLoggedIn()) {

      window.location.href = 'login.html';

      return false;
    }

    return true;
  }
};


/* =========================================================
   REGISTER
   ========================================================= */

async function registerUser(data) {

  const fullName =
    String(data.fullName || '').trim();

  const username =
    String(data.username || '').trim();

  const email =
    String(data.email || '')
      .trim()
      .toLowerCase();

  const password =
    String(data.password || '');

  const confirmPassword =
    String(
      data.confirmPassword ||
      password
    );

  const referralCode =
    String(data.referralCode || '')
      .trim()
      .toUpperCase();


  /* ---------- VALIDATION ---------- */

  if (fullName.length < 2) {

    return {
      success: false,
      message: 'مهرباني وکړئ بشپړ نوم ولیکئ.'
    };
  }


  if (username.length < 3) {

    return {
      success: false,
      message:
        'کارن نوم باید لږ تر لږه ۳ توري ولري.'
    };
  }


  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {

    return {
      success: false,
      message:
        'کارن نوم یوازې انګلیسي توري، شمېرې او . _ - کارولی شي.'
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
      message:
        'پټ نوم باید لږ تر لږه ۶ توري ولري.'
    };
  }


  if (password !== confirmPassword) {

    return {
      success: false,
      message:
        'د پټ نوم دواړه برخې یو شان نه دي.'
    };
  }


  /* ---------- API REGISTER ---------- */

  try {

    const result = await apiRequest(
      '/api/register',
      {
        method: 'POST',

        body: JSON.stringify({

          fullName,
          username,
          email,
          password,
          referralCode:
            referralCode || null

        })
      }
    );


    /* ---------- SAVE SESSION ---------- */

    await Auth.loginSession(result);


    return {

      success: true,

      user:
        result.user ||
        result.data?.user ||
        null,

      token:
        result.token ||
        result.accessToken ||
        null,

      message:
        result.message ||
        'حساب مو جوړ شو.'

    };


  } catch (error) {

    return {

      success: false,

      message:
        error.message ||
        'د حساب جوړولو پر مهال ستونزه رامنځته شوه.'

    };
  }
}


/* =========================================================
   LOGIN
   ========================================================= */

async function loginUser(
  identifier,
  password
) {

  const value =
    String(identifier || '').trim();

  const pass =
    String(password || '');


  if (!value) {

    return {
      success: false,
      message:
        'ایمیل یا کارن نوم ولیکئ.'
    };
  }


  if (!pass) {

    return {
      success: false,
      message:
        'پټ نوم ولیکئ.'
    };
  }


  try {

    const result = await apiRequest(
      '/api/login',
      {
        method: 'POST',

        body: JSON.stringify({

          identifier: value,
          password: pass

        })
      }
    );


    /* ---------- SAVE LOGIN SESSION ---------- */

    await Auth.loginSession(result);


    /* ---------- DAILY REWARD ---------- */

    const dailyReward =
      Number(
        result.dailyReward ||
        result.reward ||
        0
      );


    return {

      success: true,

      user:
        result.user ||
        result.data?.user ||
        null,

      token:
        result.token ||
        result.accessToken ||
        null,

      dailyReward,

      message:
        result.message ||
        'بریالی ننوتل.'

    };


  } catch (error) {

    return {

      success: false,

      message:
        error.message ||
        'د ننوتلو پر مهال ستونزه رامنځته شوه.'

    };
  }
}


/* =========================================================
   GET CURRENT USER FROM SERVER
   ========================================================= */

async function getCurrentUserFromAPI() {

  if (!Auth.isLoggedIn()) {
    return null;
  }

  try {

    const result =
      await apiRequest('/api/me');

    const user =
      result.user ||
      result.data?.user ||
      result;

    if (user) {
      UserDB.save(user);
    }

    return user;

  } catch (error) {

    console.error(
      'Get current user error:',
      error
    );

    return null;
  }
}


/* =========================================================
   BALANCE
   ========================================================= */

async function getBalance() {

  if (!Auth.isLoggedIn()) {
    return 0;
  }

  try {

    const result =
      await apiRequest('/api/balance');

    const balance =
      Number(
        result.balance ??
        result.data?.balance ??
        result.user?.balance ??
        0
      );

    const user =
      Auth.getCurrentUser();

    if (user) {

      user.balance = balance;

      UserDB.save(user);
    }

    return balance;

  } catch (error) {

    console.error(
      'Balance error:',
      error
    );

    const user =
      Auth.getCurrentUser();

    return Number(
      user?.balance || 0
    );
  }
}


/* =========================================================
   DAILY CHECK-IN
   ========================================================= */

async function dailyCheckin() {

  if (!Auth.isLoggedIn()) {

    return {
      success: false,
      message:
        'لومړی خپل حساب ته ننوتئ.'
    };
  }


  try {

    const result =
      await apiRequest(
        '/api/checkin',
        {
          method: 'POST'
        }
      );


    if (result.user) {
      UserDB.save(result.user);
    }


    const reward =
      Number(
        result.reward ||
        result.dailyReward ||
        0
      );


    return {

      success:
        result.success !== false,

      reward,

      user:
        result.user ||
        null,

      message:
        result.message ||
        (
          reward > 0
            ? `تاسو ${reward} AFN ورځنی انعام ترلاسه کړ.`
            : 'نننی Check-in مخکې ترسره شوی دی.'
        )

    };


  } catch (error) {

    return {

      success: false,

      message:
        error.message ||
        'د Check-in پر مهال ستونزه رامنځته شوه.'

    };
  }
}


/* =========================================================
   COMPLETE TASK / OFFER
   ========================================================= */

async function completeTask(
  taskId,
  reward = QR_CONFIG.offerReward,
  note = 'دنده بشپړه شوه'
) {

  if (!Auth.isLoggedIn()) {

    return {

      success: false,

      message:
        'لومړی خپل حساب ته ننوتئ.'

    };
  }


  /*
    مهم:
    د Offerwall اصلي انعام باید د Worker
    webhook له لارې تایید شي.

    Frontend باید یوازې د server API څخه
    تایید شوی reward واخلي.
  */

  try {

    const result =
      await apiRequest(
        '/api/task/complete',
        {
          method: 'POST',

          body: JSON.stringify({

            taskId,
            reward:
              Number(reward || 0),

            note

          })
        }
      );


    if (result.user) {
      UserDB.save(result.user);
    }


    return {

      success:
        result.success !== false,

      reward:
        Number(result.reward || 0),

      user:
        result.user ||
        null,

      message:
        result.message ||
        'دنده بشپړه شوه.'

    };


  } catch (error) {

    return {

      success: false,

      message:
        error.message ||
        'دنده ونه بشپړېده.'

    };
  }
}


/* =========================================================
   TRANSACTIONS
   ========================================================= */

async function getTransactions(
  userId = null
) {

  if (!Auth.isLoggedIn()) {
    return [];
  }


  try {

    const result =
      await apiRequest(
        '/api/transactions'
      );


    return (
      result.transactions ||
      result.data?.transactions ||
      []
    );

  } catch (error) {

    console.error(
      'Transactions error:',
      error
    );

    return [];
  }
}


/* =========================================================
   WITHDRAWAL
   ========================================================= */

async function requestWithdrawal(
  amount,
  method,
  account
) {

  if (!Auth.isLoggedIn()) {

    return {

      success: false,

      message:
        'لومړی خپل حساب ته ننوتئ.'

    };
  }


  const value =
    Number(amount);


  if (
    !Number.isFinite(value) ||
    value <= 0
  ) {

    return {

      success: false,

      message:
        'د پیسو اندازه سمه ولیکئ.'

    };
  }


  if (value < QR_CONFIG.minWithdraw) {

    return {

      success: false,

      message:
        `د ایستلو لږ تر لږه اندازه ${QR_CONFIG.minWithdraw} AFN ده.`

    };
  }


  if (!method) {

    return {

      success: false,

      message:
        'د پیسو د ترلاسه کولو طریقه وټاکئ.'

    };
  }


  if (!account) {

    return {

      success: false,

      message:
        'د پیسو د ترلاسه کولو معلومات ولیکئ.'

    };
  }


  try {

    const result =
      await apiRequest(
        '/api/withdraw',
        {
          method: 'POST',

          body: JSON.stringify({

            amount: value,

            method:
              String(method).trim(),

            account:
              String(account).trim()

          })
        }
      );


    if (result.user) {
      UserDB.save(result.user);
    }


    return {

      success:
        result.success !== false,

      withdrawal:
        result.withdrawal ||
        result.data?.withdrawal ||
        null,

      user:
        result.user ||
        null,

      message:
        result.message ||
        'د ایستلو غوښتنه ثبت شوه.'

    };


  } catch (error) {

    return {

      success: false,

      message:
        error.message ||
        'د ایستلو غوښتنه ثبت نه شوه.'

    };
  }
}


/* =========================================================
   FORMAT MONEY
   ========================================================= */

function formatMoney(amount) {

  const value =
    Number(amount || 0);

  return (
    value.toLocaleString('en-US') +
    ' ' +
    QR_CONFIG.currency
  );
}


/* =========================================================
   FORMAT DATE
   ========================================================= */

function formatDate(date) {

  if (!date) {
    return '-';
  }


  try {

    return new Date(date)
      .toLocaleDateString(
        'ps-AF',
        {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        }
      );

  } catch (error) {

    return '-';
  }
}


/* =========================================================
   ALERT
   ========================================================= */

function showAlert(
  message,
  type = 'info'
) {

  /*
    که ستا frontend کې custom alert
    موجود وي، وروسته یې دلته وصلولی شو.
  */

  alert(message);
}


/* =========================================================
   SET TEXT
   ========================================================= */

function setText(id, value) {

  const el =
    document.getElementById(id);

  if (el) {
    el.textContent = value;
  }
}


/* =========================================================
   INITIALS
   ========================================================= */

function getInitials(name) {

  const value =
    String(name || 'م').trim();


  if (!value) {
    return 'م';
  }


  return value
    .split(/\s+/)
    .slice(0, 2)
    .map(
      x => x.charAt(0)
    )
    .join('')
    .toUpperCase();
}


/* =========================================================
   REGISTER FORM
   ========================================================= */

function setupRegisterForm() {

  const form =
    document.getElementById(
      'registerForm'
    );

  if (!form) {
    return;
  }


  form.addEventListener(
    'submit',
    async function(e) {

      e.preventDefault();


      const message =
        document.getElementById(
          'registerMessage'
        );


      const submitButton =
        form.querySelector(
          'button[type="submit"]'
        );


      const originalText =
        submitButton
          ? submitButton.textContent
          : '';


      if (submitButton) {

        submitButton.disabled = true;

        submitButton.textContent =
          'مهرباني وکړئ انتظار وکړئ...';
      }


      const result =
        await registerUser({

          fullName:
            document.getElementById(
              'fullName'
            )?.value,

          username:
            document.getElementById(
              'username'
            )?.value,

          email:
            document.getElementById(
              'email'
            )?.value,

          password:
            document.getElementById(
              'password'
            )?.value,

          confirmPassword:
            document.getElementById(
              'confirmPassword'
            )?.value,

          referralCode:
            document.getElementById(
              'referralCode'
            )?.value

        });


      if (submitButton) {

        submitButton.disabled = false;

        submitButton.textContent =
          originalText;
      }


      if (!result.success) {

        if (message) {

          message.style.display =
            'block';

          message.textContent =
            result.message;
        } else {

          alert(result.message);
        }

        return;
      }


      if (message) {

        message.style.display =
          'block';

        message.textContent =
          'حساب مو جوړ شو. Dashboard ته انتقالېږئ...';
      }


      setTimeout(
        function() {

          window.location.href =
            'dashboard.html';

        },
        500
      );

    }
  );
}


/* =========================================================
   LOGIN FORM
   ========================================================= */

function setupLoginForm() {

  const form =
    document.getElementById(
      'loginForm'
    );

  if (!form) {
    return;
  }


  form.addEventListener(
    'submit',
    async function(e) {

      e.preventDefault();


      const message =
        document.getElementById(
          'loginMessage'
        );


      const submitButton =
        form.querySelector(
          'button[type="submit"]'
        );


      const originalText =
        submitButton
          ? submitButton.textContent
          : '';


      if (submitButton) {

        submitButton.disabled = true;

        submitButton.textContent =
          'ننوتل روان دي...';
      }


      const result =
        await loginUser(

          document.getElementById(
            'loginEmail'
          )?.value,

          document.getElementById(
            'loginPassword'
          )?.value

        );


      if (submitButton) {

        submitButton.disabled = false;

        submitButton.textContent =
          originalText;
      }


      if (!result.success) {

        if (message) {

          message.style.display =
            'block';

          message.textContent =
            result.message;

        } else {

          alert(result.message);
        }

        return;
      }


      if (message) {

        message.style.display =
          'block';

        if (
          result.dailyReward &&
          result.dailyReward > 0
        ) {

          message.textContent =
            `بریالی ننوتل! ${result.dailyReward} AFN ورځنی انعام هم ترلاسه شو.`;

        } else {

          message.textContent =
            'بریالی ننوتل! Dashboard ته ځئ...';
        }
      }


      setTimeout(
        function() {

          window.location.href =
            'dashboard.html';

        },
        500
      );

    }
  );
}


/* =========================================================
   LOGOUT BUTTONS
   ========================================================= */

function setupLogoutButtons() {

  document
    .querySelectorAll(
      '[data-logout]'
    )
    .forEach(
      button => {

        button.addEventListener(
          'click',
          function(e) {

            e.preventDefault();

            Auth.logout();

          }
        );

      }
    );
}


/* =========================================================
   UPDATE USER UI
   ========================================================= */

async function updateUserUI() {

  let user =
    Auth.getCurrentUser();


  if (
    Auth.isLoggedIn()
  ) {

    const serverUser =
      await getCurrentUserFromAPI();

    if (serverUser) {
      user = serverUser;
    }
  }


  document
    .querySelectorAll(
      '[data-user-name]'
    )
    .forEach(
      el => {

        el.textContent =
          user
            ? (
                user.fullName ||
                user.name ||
                user.username ||
                'کارن'
              )
            : 'مېلمه';

      }
    );


  document
    .querySelectorAll(
      '[data-user-balance]'
    )
    .forEach(
      el => {

        el.textContent =
          user
            ? formatMoney(
                user.balance
              )
            : formatMoney(0);

      }
    );


  document
    .querySelectorAll(
      '[data-user-referrals]'
    )
    .forEach(
      el => {

        el.textContent =
          user
            ? Number(
                user.referrals || 0
              )
            : 0;

      }
    );


  document
    .querySelectorAll(
      '[data-user-username]'
    )
    .forEach(
      el => {

        el.textContent =
          user
            ? (
                user.username ||
                ''
              )
            : '';

      }
    );


  document
    .querySelectorAll(
      '[data-user-email]'
    )
    .forEach(
      el => {

        el.textContent =
          user
            ? (
                user.email ||
                ''
              )
            : '';

      }
    );


  document
    .querySelectorAll(
      '[data-user-referral-code]'
    )
    .forEach(
      el => {

        el.textContent =
          user
            ? (
                user.referralCode ||
                ''
              )
            : '';

      }
    );


  document
    .querySelectorAll(
      '[data-user-total-earned]'
    )
    .forEach(
      el => {

        el.textContent =
          user
            ? formatMoney(
                user.totalEarned
              )
            : formatMoney(0);

      }
    );


  document
    .querySelectorAll(
      '[data-user-total-withdrawn]'
    )
    .forEach(
      el => {

        el.textContent =
          user
            ? formatMoney(
                user.totalWithdrawn
              )
            : formatMoney(0);

      }
    );
}


/* =========================================================
   PROTECT PRIVATE PAGES
   ========================================================= */

function protectPrivatePages() {

  const privatePages = [

    'dashboard.html',
    'referrals.html',
    'rewards.html',
    'withdraw.html',
    'profile.html',
    'transactions.html'

  ];


  const page =
    window.location.pathname
      .split('/')
      .pop();


  if (
    privatePages.includes(page)
  ) {

    Auth.requireLogin();
  }
}


/* =========================================================
   REFERRAL LINK
   ========================================================= */

function setupReferralCopy() {

  document
    .querySelectorAll(
      '[data-copy-referral]'
    )
    .forEach(
      button => {

        button.addEventListener(
          'click',
          async function() {

            const user =
              Auth.getCurrentUser();


            if (!user) {

              alert(
                'لومړی خپل حساب ته ننوتئ.'
              );

              return;
            }


            if (!user.referralCode) {

              alert(
                'ستاسو Referral Code پیدا نه شو.'
              );

              return;
            }


            const basePath =
              window.location.pathname
                .replace(
                  /[^/]+$/,
                  ''
                );


            const link =
              window.location.origin +
              basePath +
              'register.html?ref=' +
              encodeURIComponent(
                user.referralCode
              );


            try {

              await navigator
                .clipboard
                .writeText(link);


              alert(
                'د ریفرل لینک کاپي شو.'
              );

            } catch (error) {

              prompt(
                'دا لینک کاپي کړئ:',
                link
              );
            }

          }
        );

      }
    );
}


/* =========================================================
   LOAD REFERRAL CODE FROM URL
   ========================================================= */

function loadReferralFromURL() {

  const input =
    document.getElementById(
      'referralCode'
    );


  if (!input) {
    return;
  }


  const params =
    new URLSearchParams(
      window.location.search
    );


  const ref =
    params.get('ref');


  if (ref) {

    input.value =
      ref.toUpperCase();

    input.readOnly = true;
  }
}


/* =========================================================
   AUTO REFRESH USER DATA
   ========================================================= */

async function refreshDashboardData() {

  if (!Auth.isLoggedIn()) {
    return null;
  }


  try {

    const user =
      await getCurrentUserFromAPI();


    if (user) {

      await updateUserUI();
    }


    return user;

  } catch (error) {

    console.error(
      'Dashboard refresh error:',
      error
    );

    return null;
  }
}


/* =========================================================
   CHECK API CONNECTION
   ========================================================= */

async function checkAPI() {

  try {

    const result =
      await fetch(
        QR_CONFIG.API_URL +
        '/api/test'
      );


    if (!result.ok) {
      return false;
    }


    const data =
      await result.json();


    return (
      data.success === true &&
      data.database === true
    );

  } catch (error) {

    console.error(
      'API connection error:',
      error
    );

    return false;
  }
}


/* =========================================================
   INITIALIZATION
   ========================================================= */

document.addEventListener(
  'DOMContentLoaded',
  async function() {

    protectPrivatePages();

    setupRegisterForm();

    setupLoginForm();

    setupLogoutButtons();

    setupReferralCopy();

    loadReferralFromURL();

    await updateUserUI();

  }
);


/* =========================================================
   PUBLIC API
   ========================================================= */

window.QararRewards = {

  config: QR_CONFIG,

  Storage,

  UserDB,

  Auth,

  apiRequest,

  registerUser,

  loginUser,

  getCurrentUserFromAPI,

  getBalance,

  dailyCheckin,

  completeTask,

  getTransactions,

  requestWithdrawal,

  refreshDashboardData,

  checkAPI,

  formatMoney,

  formatDate,

  showAlert,

  setText,

  getInitials

};
