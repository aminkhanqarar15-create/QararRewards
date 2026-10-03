export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // API test
    if (url.pathname === "/api/test") {
      let dbStatus = false;

      try {
        await env.DB.prepare("SELECT 1").first();
        dbStatus = true;
      } catch (error) {
        dbStatus = false;
      }

      return Response.json({
        success: true,
        api: "QararRewards API",
        database: dbStatus
      });
    }

    // Register
    if (url.pathname === "/api/register" && request.method === "POST") {
      try {
        const data = await request.json();

        const name = data.name?.trim();
        const phone = data.phone?.trim();
        const password = data.password;
        const referralCode = data.referral_code?.trim() || null;

        if (!name || !phone || !password) {
          return Response.json(
            { success: false, message: "Name, phone and password are required" },
            { status: 400 }
          );
        }

        const code =
          "QR" +
          Math.random().toString(36).substring(2, 8).toUpperCase();

        let referredBy = null;

        if (referralCode) {
          const referrer = await env.DB
            .prepare("SELECT id, referral_code FROM users WHERE referral_code = ?")
            .bind(referralCode)
            .first();

          if (referrer) {
            referredBy = referrer.referral_code;
          }
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
            password,
            code,
            referredBy
          )
          .run();

        return Response.json({
          success: true,
          message: "Registration successful",
          user_id: result.meta.last_row_id,
          referral_code: code
        });

      } catch (error) {
        return Response.json(
          {
            success: false,
            message: "Registration failed",
            error: error.message
          },
          { status: 500 }
        );
      }
    }

    // Login
    if (url.pathname === "/api/login" && request.method === "POST") {
      try {
        const data = await request.json();

        const phone = data.phone?.trim();
        const password = data.password;

        if (!phone || !password) {
          return Response.json(
            { success: false, message: "Phone and password are required" },
            { status: 400 }
          );
        }

        const user = await env.DB
          .prepare(`
            SELECT id, name, phone, referral_code, balance
            FROM users
            WHERE phone = ? AND password = ?
          `)
          .bind(phone, password)
          .first();

        if (!user) {
          return Response.json(
            { success: false, message: "Invalid phone or password" },
            { status: 401 }
          );
        }

        return Response.json({
          success: true,
          message: "Login successful",
          user
        });

      } catch (error) {
        return Response.json(
          {
            success: false,
            message: "Login failed",
            error: error.message
          },
          { status: 500 }
        );
      }
    }

    // Get user balance
    if (url.pathname === "/api/balance" && request.method === "GET") {
      const userId = url.searchParams.get("user_id");

      if (!userId) {
        return Response.json(
          { success: false, message: "user_id is required" },
          { status: 400 }
        );
      }

      const user = await env.DB
        .prepare(`
          SELECT id, name, phone, referral_code, balance
          FROM users
          WHERE id = ?
        `)
        .bind(userId)
        .first();

      if (!user) {
        return Response.json(
          { success: false, message: "User not found" },
          { status: 404 }
        );
      }

      return Response.json({
        success: true,
        user
      });
    }

    // Daily check-in
    if (url.pathname === "/api/checkin" && request.method === "POST") {
      try {
        const data = await request.json();
        const userId = Number(data.user_id);

        if (!userId) {
          return Response.json(
            { success: false, message: "user_id is required" },
            { status: 400 }
          );
        }

        const today = new Date().toISOString().slice(0, 10);

        const already = await env.DB
          .prepare(`
            SELECT id
            FROM checkins
            WHERE user_id = ? AND checkin_date = ?
          `)
          .bind(userId, today)
          .first();

        if (already) {
          return Response.json({
            success: false,
            message: "Daily check-in already completed"
          });
        }

        const reward = 2;

        await env.DB.batch([
          env.DB.prepare(`
            INSERT INTO checkins
            (user_id, checkin_date, reward)
            VALUES (?, ?, ?)
          `).bind(userId, today, reward),

          env.DB.prepare(`
            UPDATE users
            SET balance = balance + ?
            WHERE id = ?
          `).bind(reward, userId),

          env.DB.prepare(`
            INSERT INTO transactions
            (user_id, amount, type, description)
            VALUES (?, ?, ?, ?)
          `).bind(
            userId,
            reward,
            "checkin",
            "Daily check-in reward"
          )
        ]);

        return Response.json({
          success: true,
          reward,
          message: "Daily check-in completed"
        });

      } catch (error) {
        return Response.json({
          success: false,
          message: "Check-in failed",
          error: error.message
        });
      }
    }

    // Default: serve website files
    return env.ASSETS.fetch(request);
  }
};
