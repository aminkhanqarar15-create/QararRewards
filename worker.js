'use strict';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=UTF-8'
    }
  });
}

function corsResponse(response) {
  const headers = new Headers(response.headers);
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    headers.set(key, value);
  });
  return new Response(response.body, {
    status: response.status,
    headers
  });
}

async function hashPassword(password) {
  const data = new TextEncoder().encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);

  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function randomCode(length = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';

  const array = new Uint32Array(length);
  crypto.getRandomValues(array);

  for (let i = 0; i < length; i++) {
    result += chars[array[i] % chars.length];
  }

  return result;
}

async function createReferralCode(db) {
  for (let i = 0; i < 10; i++) {
    const code = 'QR' + randomCode(8);

    const exists = await db
      .prepare('SELECT id FROM users WHERE referral_code = ? LIMIT 1')
      .bind(code)
      .first();

    if (!exists) return code;
  }

  throw new Error('Could not generate referral code');
}

function getToken(request) {
  const auth = request.headers.get('Authorization') || '';

  if (!auth.startsWith('Bearer ')) {
    return null;
  }

  return auth.substring(7).trim();
}

async function getCurrentUser(request, env) {
  const token = getToken(request);

  if (!token) return null;

  const session = await env.DB
    .prepare(`
      SELECT user_id
      FROM sessions
      WHERE token = ?
        AND expires_at > datetime('now')
      LIMIT 1
    `)
    .bind(token)
    .first();

  if (!session) return null;

  const user = await env.DB
    .prepare(`
      SELECT
        id,
        name,
        email,
        username,
        fullName,
        referral_code,
        referred_by,
        balance,
        created_at
      FROM users
      WHERE id = ?
      LIMIT 1
    `)
    .bind(session.user_id)
    .first();

  return user || null;
}

async function createSession(env, userId) {
  const token =
    crypto.randomUUID() +
    '-' +
    crypto.randomUUID();

  await env.DB
    .prepare(`
      INSERT INTO sessions
      (token, user_id, expires_at)
      VALUES (?, ?, datetime('now', '+30 days'))
    `)
    .bind(token, userId)
    .run();

  return token;
}

async function register(request, env) {
  let body;

  try {
    body = await request.json();
  } catch {
    return json({
      success: false,
      message: 'Invalid JSON data'
    }, 400);
  }

  const fullName = String(body.fullName || '').trim();
  const username = String(body.username || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const referralCode = String(body.referralCode || '').trim().toUpperCase();

  if (!fullName || !username || !email || !password) {
    return json({
      success: false,
      message: 'Please fill all required fields'
    }, 400);
  }

  if (fullName.length < 2) {
    return json({
      success: false,
      message: 'Full name is too short'
    }, 400);
  }

  if (username.length < 3) {
    return json({
      success: false,
      message: 'Username must be at least 3 characters'
    }, 400);
  }

  if (password.length < 6) {
    return json({
      success: false,
      message: 'Password must be at least 6 characters'
    }, 400);
  }

  if (!email.includes('@')) {
    return json({
      success: false,
      message: 'Please enter a valid email'
    }, 400);
  }

  try {
    // Check existing email
    const emailExists = await env.DB
      .prepare('SELECT id FROM users WHERE email = ? LIMIT 1')
      .bind(email)
      .first();

    if (emailExists) {
      return json({
        success: false,
        message: 'This email is already registered'
      }, 409);
    }

    // Check existing username
    const usernameExists = await env.DB
      .prepare('SELECT id FROM users WHERE username = ? LIMIT 1')
      .bind(username)
      .first();

    if (usernameExists) {
      return json({
        success: false,
        message: 'This username is already taken'
      }, 409);
    }

    let referrer = null;

    if (referralCode) {
      referrer = await env.DB
        .prepare(`
          SELECT id, referral_code
          FROM users
          WHERE referral_code = ?
          LIMIT 1
        `)
        .bind(referralCode)
        .first();

      if (!referrer) {
        return json({
          success: false,
          message: 'Invalid referral code'
        }, 400);
      }
    }

    const newReferralCode = await createReferralCode(env.DB);
    const passwordHash = await hashPassword(password);

    // Insert user
    const result = await env.DB
      .prepare(`
        INSERT INTO users
        (
          name,
          phone,
          password,
          referral_code,
          referred_by,
          balance,
          email,
          username,
          fullName
        )
        VALUES (?, NULL, ?, ?, ?, 0, ?, ?, ?)
      `)
      .bind(
        fullName,
        passwordHash,
        newReferralCode,
        referrer ? referrer.referral_code : null,
        email,
        username,
        fullName
      )
      .run();

    if (!result.success) {
      return json({
        success: false,
        message: 'Could not create account'
      }, 500);
    }

    const user = await env.DB
      .prepare(`
        SELECT
          id,
          name,
          email,
          username,
          fullName,
          referral_code,
          referred_by,
          balance,
          created_at
        FROM users
        WHERE id = ?
        LIMIT 1
      `)
      .bind(result.meta.last_row_id)
      .first();

    if (!user) {
      return json({
        success: false,
        message: 'Account was created but could not be loaded'
      }, 500);
    }

    // Referral reward
    if (referrer) {
      await env.DB
        .prepare(`
          INSERT INTO referrals
          (referrer_id, referred_user_id, reward, status)
          VALUES (?, ?, 8, 'completed')
        `)
        .bind(
          referrer.id,
          user.id
        )
        .run();

      await env.DB
        .prepare(`
          UPDATE users
          SET balance = balance + 8
          WHERE id = ?
        `)
        .bind(referrer.id)
        .run();

      await env.DB
        .prepare(`
          INSERT INTO transactions
          (user_id, type, amount, description, created_at)
          VALUES (?, 'referral', 8, 'Referral reward', datetime('now'))
        `)
        .bind(referrer.id)
        .run();
    }

    const token = await createSession(env, user.id);

    return json({
      success: true,
      message: 'Registration successful',
      token,
      user
    });

  } catch (error) {
    return json({
      success: false,
      message: 'Registration failed',
      error: error.message
    }, 500);
  }
}

async function login(request, env) {
  let body;

  try {
    body = await request.json();
  } catch {
    return json({
      success: false,
      message: 'Invalid JSON data'
    }, 400);
  }

  const identifier = String(body.identifier || '').trim();
  const password = String(body.password || '');

  if (!identifier || !password) {
    return json({
      success: false,
      message: 'Username/email and password are required'
    }, 400);
  }

  try {
    const passwordHash = await hashPassword(password);

    const user = await env.DB
      .prepare(`
        SELECT
          id,
          name,
          email,
          username,
          fullName,
          referral_code,
          referred_by,
          balance,
          created_at
        FROM users
        WHERE
          (email = ? OR username = ?)
          AND password = ?
        LIMIT 1
      `)
      .bind(
        identifier.toLowerCase(),
        identifier,
        passwordHash
      )
      .first();

    if (!user) {
      return json({
        success: false,
        message: 'Incorrect username/email or password'
      }, 401);
    }

    const token = await createSession(env, user.id);

    return json({
      success: true,
      message: 'Login successful',
      token,
      user
    });

  } catch (error) {
    return json({
      success: false,
      message: 'Login failed',
      error: error.message
    }, 500);
  }
}

async function me(request, env) {
  const user = await getCurrentUser(request, env);

  if (!user) {
    return json({
      success: false,
      message: 'Unauthorized'
    }, 401);
  }

  return json({
    success: true,
    user
  });
}

async function balance(request, env) {
  const user = await getCurrentUser(request, env);

  if (!user) {
    return json({
      success: false,
      message: 'Unauthorized'
    }, 401);
  }

  return json({
    success: true,
    balance: user.balance || 0
  });
}

async function checkin(request, env) {
  const user = await getCurrentUser(request, env);

  if (!user) {
    return json({
      success: false,
      message: 'Unauthorized'
    }, 401);
  }

  // UTC date for now
  const today = new Date().toISOString().slice(0, 10);

  try {
    const already = await env.DB
      .prepare(`
        SELECT id
        FROM checkins
        WHERE user_id = ?
          AND checkin_date = ?
        LIMIT 1
      `)
      .bind(user.id, today)
      .first();

    if (already) {
      return json({
        success: false,
        message: 'Daily check-in already completed'
      }, 409);
    }

    await env.DB
      .prepare(`
        INSERT INTO checkins
        (user_id, checkin_date, reward)
        VALUES (?, ?, 2)
      `)
      .bind(user.id, today)
      .run();

    await env.DB
      .prepare(`
        UPDATE users
        SET balance = balance + 2
        WHERE id = ?
      `)
      .bind(user.id)
      .run();

    await env.DB
      .prepare(`
        INSERT INTO transactions
        (user_id, type, amount, description, created_at)
        VALUES (?, 'checkin', 2, 'Daily check-in reward', datetime('now'))
      `)
      .bind(user.id)
      .run();

    const updated = await env.DB
      .prepare('SELECT balance FROM users WHERE id = ?')
      .bind(user.id)
      .first();

    return json({
      success: true,
      reward: 2,
      balance: updated.balance
    });

  } catch (error) {
    return json({
      success: false,
      message: 'Check-in failed',
      error: error.message
    }, 500);
  }
}

async function transactions(request, env) {
  const user = await getCurrentUser(request, env);

  if (!user) {
    return json({
      success: false,
      message: 'Unauthorized'
    }, 401);
  }

  try {
    const result = await env.DB
      .prepare(`
        SELECT *
        FROM transactions
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT 100
      `)
      .bind(user.id)
      .all();

    return json({
      success: true,
      transactions: result.results || []
    });

  } catch (error) {
    return json({
      success: false,
      message: 'Could not load transactions',
      error: error.message
    }, 500);
  }
}

async function withdraw(request, env) {
  const user = await getCurrentUser(request, env);

  if (!user) {
    return json({
      success: false,
      message: 'Unauthorized'
    }, 401);
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return json({
      success: false,
      message: 'Invalid JSON data'
    }, 400);
  }

  const amount = Number(body.amount || 0);
  const method = String(body.method || '').trim();
  const account = String(body.account || '').trim();

  if (!Number.isInteger(amount) || amount < 500) {
    return json({
      success: false,
      message: 'Minimum withdrawal is 500 AFN'
    }, 400);
  }

  if (!method || !account) {
    return json({
      success: false,
      message: 'Withdrawal method and account are required'
    }, 400);
  }

  if (amount > user.balance) {
    return json({
      success: false,
      message: 'Insufficient balance'
    }, 400);
  }

  try {
    await env.DB
      .prepare(`
        INSERT INTO withdrawals
        (user_id, amount, method, account, status)
        VALUES (?, ?, ?, ?, 'pending')
      `)
      .bind(
        user.id,
        amount,
        method,
        account
      )
      .run();

    await env.DB
      .prepare(`
        UPDATE users
        SET balance = balance - ?
        WHERE id = ?
      `)
      .bind(amount, user.id)
      .run();

    await env.DB
      .prepare(`
        INSERT INTO transactions
        (user_id, type, amount, description, created_at)
        VALUES (?, 'withdrawal', ?, 'Withdrawal request', datetime('now'))
      `)
      .bind(user.id, -amount)
      .run();

    const updated = await env.DB
      .prepare('SELECT balance FROM users WHERE id = ?')
      .bind(user.id)
      .first();

    return json({
      success: true,
      message: 'Withdrawal request submitted',
      balance: updated.balance
    });

  } catch (error) {
    return json({
      success: false,
      message: 'Withdrawal failed',
      error: error.message
    }, 500);
  }
}

async function logout(request, env) {
  const token = getToken(request);

  if (token) {
    await env.DB
      .prepare('DELETE FROM sessions WHERE token = ?')
      .bind(token)
      .run();
  }

  return json({
    success: true,
    message: 'Logged out'
  });
}

export default {
  async fetch(request, env) {

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {

      if (path === '/api/test' && request.method === 'GET') {
        let database = false;

        try {
          await env.DB
            .prepare('SELECT 1 AS ok')
            .first();

          database = true;
        } catch {
          database = false;
        }

        return json({
          success: true,
          api: 'Qarar Rewards API',
          database
        });
      }

      if (path === '/api/register' && request.method === 'POST') {
        return await register(request, env);
      }

      if (path === '/api/login' && request.method === 'POST') {
        return await login(request, env);
      }

      if (path === '/api/me' && request.method === 'GET') {
        return await me(request, env);
      }

      if (path === '/api/balance' && request.method === 'GET') {
        return await balance(request, env);
      }

      if (path === '/api/checkin' && request.method === 'POST') {
        return await checkin(request, env);
      }

      if (path === '/api/transactions' && request.method === 'GET') {
        return await transactions(request, env);
      }

      if (path === '/api/withdraw' && request.method === 'POST') {
        return await withdraw(request, env);
      }

      if (path === '/api/logout' && request.method === 'POST') {
        return await logout(request, env);
      }

      // Static frontend
      if (env.ASSETS) {
        return corsResponse(
          await env.ASSETS.fetch(request)
        );
      }

      return json({
        success: false,
        message: 'Endpoint not found'
      }, 404);

    } catch (error) {
      return json({
        success: false,
        message: 'Server error',
        error: error.message
      }, 500);
    }
  }
};
