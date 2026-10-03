const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS
    }
  });
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(hash))
    .map(x => x.toString(16).padStart(2, "0"))
    .join("");
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));

  return Array.from(bytes)
    .map(x => x.toString(16).padStart(2, "0"))
    .join("");
}

function randomReferral(username) {
  const base = String(username || "USER")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, 6);

  const random = crypto.randomUUID()
    .replace(/-/g, "")
    .slice(0, 6)
    .toUpperCase();

  return base + random;
}

async function currentUser(request, env) {
  const auth = request.headers.get("Authorization");

  if (!auth || !auth.startsWith("Bearer ")) {
    return null;
  }

  const rawToken = auth.substring(7);
  const tokenHash = await sha256(rawToken);

  return await env.DB.prepare(`
    SELECT
      users.id,
      users.fullName,
      users.username,
      users.email,
      users.phone,
      users.referral_code,
      users.referred_by,
      users.balance,
      users.created_at
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ?
    AND datetime(sessions.expires_at) > datetime('now')
  `)
  .bind(tokenHash)
  .first();
}

export default {
  async fetch(request, env) {

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: CORS
      });
    }

    const url = new URL(request.url);

    // TEST
    if (url.pathname === "/api/test") {
      try {
        await env.DB.prepare("SELECT 1").first();

        return json({
          success: true,
          api: "Qarar Rewards API",
          database: true
        });

      } catch (error) {
        return json({
          success: false,
          database: false,
          error: error.message
        }, 500);
      }
    }

    // REGISTER
    if (url.pathname === "/api/register" && request.method === "POST") {
      try {

        const data = await request.json();

        const fullName = String(data.fullName || "").trim();
        const username = String(data.username || "").trim();
        const email = String(data.email || "").trim().toLowerCase();
        const password = String(data.password || "");
        const referralCode = String(data.referralCode || "").trim();

        if (!fullName || !username || !email || !password) {
          return json({
            success: false,
            message: "ټول اړین معلومات بشپړ کړئ."
          }, 400);
        }

        if (username.length < 3) {
          return json({
            success: false,
            message: "Username باید لږ تر لږه ۳ توري ولري."
          }, 400);
        }

        if (password.length < 6) {
          return json({
            success: false,
            message: "Password باید لږ تر لږه ۶ توري ولري."
          }, 400);
        }

        const existingUsername = await env.DB
          .prepare(`
            SELECT id
            FROM users
            WHERE lower(username) = lower(?)
          `)
          .bind(username)
          .first();

        if (existingUsername) {
          return json({
            success: false,
            message: "دا کارن نوم مخکې ثبت شوی دی."
          }, 409);
        }

        const existingEmail = await env.DB
          .prepare(`
            SELECT id
            FROM users
            WHERE lower(email) = lower(?)
          `)
          .bind(email)
          .first();

        if (existingEmail) {
          return json({
            success: false,
            message: "دا ایمیل مخکې ثبت شوی دی."
          }, 409);
        }

        let referrer = null;

        if (referralCode) {
          referrer = await env.DB
            .prepare(`
              SELECT id, referral_code
              FROM users
              WHERE upper(referral_code) = upper(?)
            `)
            .bind(referralCode)
            .first();
        }

        const passwordHash = await sha256(password);
        const referral = randomReferral(username);

        const result = await env.DB.prepare(`
          INSERT INTO users
          (
            fullName,
            username,
            email,
            password,
            referral_code,
            referred_by,
            balance
          )
          VALUES (?, ?, ?, ?, ?, ?, 0)
        `)
        .bind(
          fullName,
          username,
          email,
          passwordHash,
          referral,
          referrer ? referrer.referral_code : null
        )
        .run();

        const userId = result.meta.last_row_id;

        // Referral reward = 8 AFN
        if (referrer) {

          const reward = 8;

          await env.DB.batch([

            env.DB.prepare(`
              UPDATE users
              SET balance = balance + ?
              WHERE id = ?
            `)
            .bind(reward, referrer.id),

            env.DB.prepare(`
              INSERT INTO referrals
              (
                referrer_id,
                referred_user_id,
                reward
              )
              VALUES (?, ?, ?)
            `)
            .bind(
              referrer.id,
              userId,
              reward
            ),

            env.DB.prepare(`
              INSERT INTO transactions
              (
                user_id,
                amount,
                type,
                description
              )
              VALUES (?, ?, ?, ?)
            `)
            .bind(
              referrer.id,
              reward,
              "referral",
              "د نوي غړي د راجستر ریفرل انعام"
            )
          ]);
        }

        // Create session automatically
        const rawToken = randomToken();
        const tokenHash = await sha256(rawToken);

        await env.DB.prepare(`
          INSERT INTO sessions
          (
            user_id,
            token_hash,
            expires_at
          )
          VALUES (?, ?, datetime('now', '+30 days'))
        `)
        .bind(
          userId,
          tokenHash
        )
        .run();

        return json({
          success: true,
          message: "حساب په بریالیتوب جوړ شو.",
          token: rawToken,
          user: {
            id: userId,
            fullName,
            username,
            email,
            referralCode: referral,
            balance: 0,
            referrals: 0
          }
        });

      } catch (error) {

        return json({
          success: false,
          message: "Registration failed.",
          error: error.message
        }, 500);
      }
    }

    // LOGIN
    if (url.pathname === "/api/login" && request.method === "POST") {
      try {

        const data = await request.json();

        const identifier = String(data.identifier || "").trim();
        const password = String(data.password || "");

        if (!identifier || !password) {
          return json({
            success: false,
            message: "Username/Email او Password ولیکئ."
          }, 400);
        }

        const passwordHash = await sha256(password);

        const user = await env.DB.prepare(`
          SELECT *
          FROM users
          WHERE
            lower(username) = lower(?)
            OR lower(email) = lower(?)
          LIMIT 1
        `)
        .bind(
          identifier,
          identifier
        )
        .first();

        if (!user) {
          return json({
            success: false,
            message: "اکاونټ پیدا نه شو."
          }, 401);
        }

        if (user.password !== passwordHash) {
          return json({
            success: false,
            message: "Password ناسم دی."
          }, 401);
        }

        const rawToken = randomToken();
        const tokenHash = await sha256(rawToken);

        await env.DB.prepare(`
          INSERT INTO sessions
          (
            user_id,
            token_hash,
            expires_at
          )
          VALUES (?, ?, datetime('now', '+30 days'))
        `)
        .bind(
          user.id,
          tokenHash
        )
        .run();

        // Daily login reward = 2 AFN
        const today = new Date()
          .toISOString()
          .slice(0, 10);

        let dailyReward = 0;

        const already = await env.DB.prepare(`
          SELECT id
          FROM checkins
          WHERE user_id = ?
          AND checkin_date = ?
        `)
        .bind(
          user.id,
          today
        )
        .first();

        if (!already) {

          dailyReward = 2;

          await env.DB.batch([

            env.DB.prepare(`
              INSERT INTO checkins
              (
                user_id,
                checkin_date,
                reward
              )
              VALUES (?, ?, ?)
            `)
            .bind(
              user.id,
              today,
              dailyReward
            ),

            env.DB.prepare(`
              UPDATE users
              SET balance = balance + ?
              WHERE id = ?
            `)
            .bind(
              dailyReward,
              user.id
            ),

            env.DB.prepare(`
              INSERT INTO transactions
              (
                user_id,
                amount,
                type,
                description
              )
              VALUES (?, ?, ?, ?)
            `)
            .bind(
              user.id,
              dailyReward,
              "daily_login",
              "د ننوتلو ورځنی انعام"
            )
          ]);
        }

        const updatedUser = await env.DB.prepare(`
          SELECT
            id,
            fullName,
            username,
            email,
            referral_code,
            balance
          FROM users
          WHERE id = ?
        `)
        .bind(user.id)
        .first();

        return json({
          success: true,
          message: "بریالی Login.",
          token: rawToken,
          dailyReward,
          user: updatedUser
        });

      } catch (error) {

        return json({
          success: false,
          message: "Login failed.",
          error: error.message
        }, 500);
      }
    }

    // ME
    if (url.pathname === "/api/me" && request.method === "GET") {

      const user = await currentUser(request, env);

      if (!user) {
        return json({
          success: false,
          message: "Unauthorized"
        }, 401);
      }

      return json({
        success: true,
        user
      });
    }

    // BALANCE
    if (url.pathname === "/api/balance" && request.method === "GET") {

      const user = await currentUser(request, env);

      if (!user) {
        return json({
          success: false,
          message: "Unauthorized"
        }, 401);
      }

      return json({
        success: true,
        balance: user.balance
      });
    }

    // CHECK-IN
    if (url.pathname === "/api/checkin" && request.method === "POST") {

      try {

        const user = await currentUser(request, env);

        if (!user) {
          return json({
            success: false,
            message: "Unauthorized"
          }, 401);
        }

        const today = new Date()
          .toISOString()
          .slice(0, 10);

        const existing = await env.DB.prepare(`
          SELECT id
          FROM checkins
          WHERE user_id = ?
          AND checkin_date = ?
        `)
        .bind(
          user.id,
          today
        )
        .first();

        if (existing) {
          return json({
            success: false,
            message: "د نن Check-in مخکې شوی دی."
          }, 409);
        }

        const reward = 2;

        await env.DB.batch([

          env.DB.prepare(`
            INSERT INTO checkins
            (
              user_id,
              checkin_date,
              reward
            )
            VALUES (?, ?, ?)
          `)
          .bind(
            user.id,
            today,
            reward
          ),

          env.DB.prepare(`
            UPDATE users
            SET balance = balance + ?
            WHERE id = ?
          `)
          .bind(
            reward,
            user.id
          ),

          env.DB.prepare(`
            INSERT INTO transactions
            (
              user_id,
              amount,
              type,
              description
            )
            VALUES (?, ?, ?, ?)
          `)
          .bind(
            user.id,
            reward,
            "checkin",
            "Daily Check-in"
          )
        ]);

        return json({
          success: true,
          reward,
          message: "Check-in بشپړ شو."
        });

      } catch (error) {

        return json({
          success: false,
          message: "Check-in failed.",
          error: error.message
        }, 500);
      }
    }

    // TRANSACTIONS
    if (
      url.pathname === "/api/transactions" &&
      request.method === "GET"
    ) {

      const user = await currentUser(request, env);

      if (!user) {
        return json({
          success: false,
          message: "Unauthorized"
        }, 401);
      }

      const transactions = await env.DB.prepare(`
        SELECT
          id,
          amount,
          type,
          description,
          created_at
        FROM transactions
        WHERE user_id = ?
        ORDER BY id DESC
      `)
      .bind(user.id)
      .all();

      return json({
        success: true,
        transactions: transactions.results
      });
    }

    // LOGOUT
    if (url.pathname === "/api/logout" && request.method === "POST") {

      const auth = request.headers.get("Authorization");

      if (auth && auth.startsWith("Bearer ")) {

        const tokenHash = await sha256(
          auth.substring(7)
        );

        await env.DB.prepare(`
          DELETE FROM sessions
          WHERE token_hash = ?
        `)
        .bind(tokenHash)
        .run();
      }

      return json({
        success: true,
        message: "Logout successful"
      });
    }

    // WITHDRAW
    if (
      url.pathname === "/api/withdraw" &&
      request.method === "POST"
    ) {

      try {

        const user = await currentUser(request, env);

        if (!user) {
          return json({
            success: false,
            message: "Unauthorized"
          }, 401);
        }

        const data = await request.json();

        const amount = Number(data.amount);
        const method = String(data.method || "").trim();
        const account = String(data.account || "").trim();

        if (!amount || amount < 500) {
          return json({
            success: false,
            message: "لږ تر لږه Withdrawal 500 AFN دی."
          }, 400);
        }

        if (amount > Number(user.balance || 0)) {
          return json({
            success: false,
            message: "ستاسو Balance کافي نه دی."
          }, 400);
        }

        if (!method || !account) {
          return json({
            success: false,
            message: "د ترلاسه کولو معلومات بشپړ کړئ."
          }, 400);
        }

        await env.DB.batch([

          env.DB.prepare(`
            UPDATE users
            SET balance = balance - ?
            WHERE id = ?
          `)
          .bind(
            amount,
            user.id
          ),

          env.DB.prepare(`
            INSERT INTO withdrawals
            (
              user_id,
              amount,
              method,
              account,
              status
            )
            VALUES (?, ?, ?, ?, 'pending')
          `)
          .bind(
            user.id,
            amount,
            method,
            account
          ),

          env.DB.prepare(`
            INSERT INTO transactions
            (
              user_id,
              amount,
              type,
              description
            )
            VALUES (?, ?, ?, ?)
          `)
          .bind(
            user.id,
            -amount,
            "withdrawal",
            "Withdrawal request"
          )
        ]);

        return json({
          success: true,
          message: "Withdrawal request ثبت شو."
        });

      } catch (error) {

        return json({
          success: false,
          message: "Withdrawal failed.",
          error: error.message
        }, 500);
      }
    }

    // STATIC WEBSITE
    return env.ASSETS.fetch(request);
  }
};
