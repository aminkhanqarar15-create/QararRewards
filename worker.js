const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS
    }
  });
}

function token() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hash(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);

  return [...new Uint8Array(digest)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getUser(request, env) {
  const auth = request.headers.get("Authorization");

  if (!auth || !auth.startsWith("Bearer ")) {
    return null;
  }

  const rawToken = auth.substring(7);
  const tokenHash = await hash(rawToken);

  const session = await env.DB
    .prepare(`
      SELECT users.*
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ?
      AND datetime(sessions.expires_at) > datetime('now')
    `)
    .bind(tokenHash)
    .first();

  return session || null;
}

export default {
  async fetch(request, env) {

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: CORS_HEADERS
      });
    }

    const url = new URL(request.url);

    // API TEST
    if (url.pathname === "/api/test") {
      try {
        await env.DB.prepare("SELECT 1").first();

        return json({
          success: true,
          api: "QararRewards API",
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

        const name = String(data.name || "").trim();
        const phone = String(data.phone || "").trim();
        const password = String(data.password || "");
        const referralCode = String(
          data.referral_code || ""
        ).trim();

        if (!name || !phone || !password) {
          return json({
            success: false,
            message: "Name, phone and password are required"
          }, 400);
        }

        if (password.length < 6) {
          return json({
            success: false,
            message: "Password must contain at least 6 characters"
          }, 400);
        }

        const existing = await env.DB
          .prepare("SELECT id FROM users WHERE phone = ?")
          .bind(phone)
          .first();

        if (existing) {
          return json({
            success: false,
            message: "This phone number is already registered"
          }, 409);
        }

        const passwordHash = await hash(password);

        const referral =
          "QR" +
          crypto.randomUUID()
            .replace(/-/g, "")
            .substring(0, 8)
            .toUpperCase();

        let referrer = null;

        if (referralCode) {
          referrer = await env.DB
            .prepare(`
              SELECT id, referral_code
              FROM users
              WHERE referral_code = ?
            `)
            .bind(referralCode)
            .first();
        }

        const result = await env.DB
          .prepare(`
            INSERT INTO users
            (name, phone, password, referral_code, referred_by, balance)
            VALUES (?, ?, ?, ?, ?, 0)
          `)
          .bind(
            name,
            phone,
            passwordHash,
            referral,
            referrer ? referrer.referral_code : null
          )
          .run();

        const userId = result.meta.last_row_id;

        // Referral reward
        if (referrer) {

          const referralReward = 8;

          await env.DB.batch([

            env.DB.prepare(`
              UPDATE users
              SET balance = balance + ?
              WHERE id = ?
            `).bind(referralReward, referrer.id),

            env.DB.prepare(`
              INSERT INTO referrals
              (referrer_id, referred_user_id, reward)
              VALUES (?, ?, ?)
            `).bind(
              referrer.id,
              userId,
              referralReward
            ),

            env.DB.prepare(`
              INSERT INTO transactions
              (user_id, amount, type, description)
              VALUES (?, ?, ?, ?)
            `).bind(
              referrer.id,
              referralReward,
              "referral",
              "Verified referral reward"
            )
          ]);
        }

        return json({
          success: true,
          message: "Registration successful",
          user: {
            id: userId,
            name,
            phone,
            referral_code: referral,
            balance: 0
          }
        });

      } catch (error) {

        return json({
          success: false,
          message: "Registration failed",
          error: error.message
        }, 500);
      }
    }

    // LOGIN
    if (url.pathname === "/api/login" && request.method === "POST") {
      try {

        const data = await request.json();

        const phone = String(data.phone || "").trim();
        const password = String(data.password || "");

        if (!phone || !password) {
          return json({
            success: false,
            message: "Phone and password are required"
          }, 400);
        }

        const passwordHash = await hash(password);

        const user = await env.DB
          .prepare(`
            SELECT id, name, phone, referral_code, balance
            FROM users
            WHERE phone = ?
            AND password = ?
          `)
          .bind(phone, passwordHash)
          .first();

        if (!user) {
          return json({
            success: false,
            message: "Invalid phone or password"
          }, 401);
        }

        const rawToken = token();
        const tokenHash = await hash(rawToken);

        await env.DB
          .prepare(`
            INSERT INTO sessions
            (user_id, token_hash, expires_at)
            VALUES (?, ?, datetime('now', '+30 days'))
          `)
          .bind(
            user.id,
            tokenHash
          )
          .run();

        return json({
          success: true,
          message: "Login successful",
          token: rawToken,
          user
        });

      } catch (error) {

        return json({
          success: false,
          message: "Login failed",
          error: error.message
        }, 500);
      }
    }

    // LOGOUT
    if (url.pathname === "/api/logout" && request.method === "POST") {

      const auth = request.headers.get("Authorization");

      if (auth && auth.startsWith("Bearer ")) {

        const tokenHash = await hash(
          auth.substring(7)
        );

        await env.DB
          .prepare(`
            DELETE FROM sessions
            WHERE token_hash = ?
          `)
          .bind(tokenHash)
          .run();
      }

      return json({
        success: true,
        message: "Logged out"
      });
    }

    // CURRENT USER
    if (url.pathname === "/api/me" && request.method === "GET") {

      const user = await getUser(request, env);

      if (!user) {
        return json({
          success: false,
          message: "Unauthorized"
        }, 401);
      }

      return json({
        success: true,
        user: {
          id: user.id,
          name: user.name,
          phone: user.phone,
          referral_code: user.referral_code,
          balance: user.balance
        }
      });
    }

    // BALANCE
    if (url.pathname === "/api/balance" && request.method === "GET") {

      const user = await getUser(request, env);

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

    // DAILY CHECK-IN
    if (url.pathname === "/api/checkin" && request.method === "POST") {

      try {

        const user = await getUser(request, env);

        if (!user) {
          return json({
            success: false,
            message: "Unauthorized"
          }, 401);
        }

        const today = new Date()
          .toISOString()
          .substring(0, 10);

        const existing = await env.DB
          .prepare(`
            SELECT id
            FROM checkins
            WHERE user_id = ?
            AND checkin_date = ?
          `)
          .bind(user.id, today)
          .first();

        if (existing) {
          return json({
            success: false,
            message: "Today's check-in is already completed"
          }, 409);
        }

        const reward = 2;

        await env.DB.batch([

          env.DB.prepare(`
            INSERT INTO checkins
            (user_id, checkin_date, reward)
            VALUES (?, ?, ?)
          `).bind(
            user.id,
            today,
            reward
          ),

          env.DB.prepare(`
            UPDATE users
            SET balance = balance + ?
            WHERE id = ?
          `).bind(
            reward,
            user.id
          ),

          env.DB.prepare(`
            INSERT INTO transactions
            (user_id, amount, type, description)
            VALUES (?, ?, ?, ?)
          `).bind(
            user.id,
            reward,
            "checkin",
            "Daily check-in reward"
          )
        ]);

        return json({
          success: true,
          reward,
          message: "Daily check-in completed"
        });

      } catch (error) {

        return json({
          success: false,
          message: "Check-in failed",
          error: error.message
        }, 500);
      }
    }

    // WITHDRAWAL
    if (url.pathname === "/api/withdraw" && request.method === "POST") {

      try {

        const user = await getUser(request, env);

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

        if (!amount || amount <= 0 || !method || !account) {
          return json({
            success: false,
            message: "Invalid withdrawal information"
          }, 400);
        }

        if (amount > user.balance) {
          return json({
            success: false,
            message: "Insufficient balance"
          }, 400);
        }

        await env.DB.batch([

          env.DB.prepare(`
            UPDATE users
            SET balance = balance - ?
            WHERE id = ?
          `).bind(
            amount,
            user.id
          ),

          env.DB.prepare(`
            INSERT INTO withdrawals
            (user_id, amount, method, account, status)
            VALUES (?, ?, ?, ?, 'pending')
          `).bind(
            user.id,
            amount,
            method,
            account
          ),

          env.DB.prepare(`
            INSERT INTO transactions
            (user_id, amount, type, description)
            VALUES (?, ?, ?, ?)
          `).bind(
            user.id,
            -amount,
            "withdrawal",
            "Withdrawal request"
          )
        ]);

        return json({
          success: true,
          message: "Withdrawal request submitted"
        });

      } catch (error) {

        return json({
          success: false,
          message: "Withdrawal failed",
          error: error.message
        }, 500);
      }
    }

    // WEBSITE
    return env.ASSETS.fetch(request);
  }
};
