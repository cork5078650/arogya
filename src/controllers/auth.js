// src/controllers/auth.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer'); // for Ethereal fallback

// Node 18+ has global fetch; if you're on older Node, ensure node-fetch is installed.
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:4000';
const VERIFY_TTL_MINUTES = parseInt(process.env.VERIFY_TTL_MINUTES || '10', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'changeme';

/* =========================
   Email sender
   ========================= */
async function sendVerificationEmail(toEmail, token) {
  const verifyUrl = `${APP_BASE_URL}/api/users/verify-email?token=${token}`;
  console.log(`🔗 Verification URL for ${toEmail}: ${verifyUrl}`);

  try {
    // Preferred path: Resend API
    if (process.env.EMAIL_PROVIDER === 'resend' && process.env.RESEND_API_KEY) {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.FROM_EMAIL || 'onboarding@resend.dev',
          to: toEmail,
          subject: 'Verify your email for Arogya',
          html: `
            <div style="font-family:sans-serif;max-width:560px;margin:auto;padding:16px">
              <h2>Verify your email</h2>
              <p>Click the button below to verify your email and finish creating your account.</p>
              <p style="margin:20px 0">
                <a href="${verifyUrl}" style="background:#2563eb;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;">Verify Email</a>
              </p>
              <p>If the button doesn't work, copy & paste this link:</p>
              <p><a href="${verifyUrl}">${verifyUrl}</a></p>
              <p>This link expires in ${VERIFY_TTL_MINUTES} minutes.</p>
            </div>
          `
        })
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        console.error('❌ Resend error:', data);
        throw new Error('Resend API failed');
      }
      console.log('✅ Resend email queued:', data?.id || '(no id)');
      return;
    }

    // Fallback path: Ethereal test inbox (always works for local/dev)
    const testAccount = await nodemailer.createTestAccount();
    const transporter = nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });

    const info = await transporter.sendMail({
      from: 'no-reply@arogya.local',
      to: toEmail,
      subject: 'Verify your email for Arogya',
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:auto;padding:16px">
          <h2>Verify your email</h2>
          <p>Click the button below to verify your email and finish creating your account.</p>
          <p style="margin:20px 0">
            <a href="${verifyUrl}" style="background:#2563eb;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;">Verify Email</a>
          </p>
          <p>If the button doesn't work, copy & paste this link:</p>
          <p><a href="${verifyUrl}">${verifyUrl}</a></p>
          <p>This link expires in ${VERIFY_TTL_MINUTES} minutes.</p>
        </div>
      `,
    });

    console.log('📩 Ethereal preview URL:', nodemailer.getTestMessageUrl(info));
  } catch (err) {
    console.error('❌ sendVerificationEmail failed:', err?.message || err);
  }
}

/* =========================
   Helpers
   ========================= */
function normalizeEmail(e) {
  return String(e || '').trim().toLowerCase();
}

function issueJwtForUser(user) {
  const payload = { uid: user._id, email: user.email };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

async function ensureUserCreated(ver, Users) {
  const email = ver.email;
  const existing = await Users.findOne({ email });

  if (!existing) {
    const newUser = {
      name: ver.name,
      email,
      passwordHash: ver.passwordHash,
      verified: true,
      profile: {},
      createdAt: new Date(),
    };
    await Users.insertOne(newUser);
    console.log(`✅ VERIFY: New user inserted: ${email}`);
  } else if (!existing.verified) {
    await Users.updateOne({ _id: existing._id }, { $set: { verified: true } });
    console.log(`✅ VERIFY: Existing user marked as verified: ${email}`);
  }
}

/* =========================
   Controllers
   ========================= */

// POST /api/users/signup/start
exports.signupStart = async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    const cleanEmail = normalizeEmail(email);

    if (!name || !cleanEmail || !password) {
      return res.status(400).json({ ok: false, message: 'Name, email and password are required.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({ ok: false, message: 'Please enter a valid email address.' });
    }

    const db = mongoose.connection.db;
    const Users = db.collection('users');
    const Verifs = db.collection('email_verifications');

    const existing = await Users.findOne({ email: cleanEmail });
    if (existing && existing.verified) {
      return res.status(409).json({ ok: false, message: 'Email already in use.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const token = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + VERIFY_TTL_MINUTES * 60 * 1000);

    await Verifs.updateOne(
      { email: cleanEmail },
      {
        $set: {
          email: cleanEmail,
          name,
          passwordHash,
          token,
          status: 'pending',
          createdAt: now,
          expiresAt,
          consumedAt: null,
        }
      },
      { upsert: true }
    );

    // fire-and-forget (with a soft timeout guard)
    (async () => {
      try {
        const p = sendVerificationEmail(cleanEmail, token);
        await Promise.race([
          p,
          new Promise((_, rej) => setTimeout(() => rej(new Error('sendMail timeout (background)')), 15000))
        ]);
      } catch (e) {
        console.warn('⚠️ sendVerificationEmail background error:', e?.message || e);
      }
    })();

    return res.json({
      ok: true,
      message: 'Verification email initiated. Please check your inbox.',
      token,
      expiresInMinutes: VERIFY_TTL_MINUTES
    });
  } catch (err) {
    console.error('signup/start error:', err);
    return res.status(500).json({ ok: false, message: 'Failed to start signup.' });
  }
};

// GET /api/users/verify-email?token=...
exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.query || {};
    if (!token) return res.status(400).send('Missing token.');

    const db = mongoose.connection.db;
    const Users = db.collection('users');
    const Verifs = db.collection('email_verifications');
    const now = new Date();

    const verUpdateResult = await Verifs.findOneAndUpdate(
      { token, status: 'pending', expiresAt: { $gt: now } },
      { $set: { status: 'consumed', consumedAt: now } },
      { returnDocument: 'before', upsert: false }
    );

    let ver = verUpdateResult.value;

    if (!ver) {
      const existingVer = await Verifs.findOne({ token });
      if (!existingVer) return res.status(400).send('Invalid token (not found).');
      if (new Date(existingVer.expiresAt) < now) return res.status(400).send('Verification link expired.');
      if (existingVer.status === 'consumed') ver = existingVer;
    }

    if (!ver) return res.status(400).send('Verification failed.');

    await ensureUserCreated(ver, Users);

    res.send(`
      <html>
        <body style="font-family:sans-serif;padding:24px">
          <h2>✅ Email verified!</h2>
          <p>You can return to the app and finish sign up.</p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error('verify-email error:', err);
    res.status(500).send('Server error during verification.');
  }
};

// GET /api/users/signup/status/:token
exports.signupStatus = async (req, res) => {
  try {
    const token = req.params.token;
    if (!token) return res.status(400).json({ ok: false, message: 'Missing token' });

    const Verifs = mongoose.connection.db.collection('email_verifications');
    const ver = await Verifs.findOne({ token });
    if (!ver) return res.json({ ok: true, status: 'expired' });
    if (ver.status === 'consumed') return res.json({ ok: true, status: 'consumed' });
    if (new Date(ver.expiresAt) < new Date()) return res.json({ ok: true, status: 'expired' });
    return res.json({ ok: true, status: 'pending' });
  } catch (err) {
    console.error('signup/status error:', err);
    return res.status(500).json({ ok: false, message: 'Failed to get status' });
  }
};

// POST /api/users/signup/finalize
exports.signupFinalize = async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ ok: false, message: 'Missing token' });

    const db = mongoose.connection.db;
    const Users = db.collection('users');
    const Verifs = db.collection('email_verifications');

    const ver = await Verifs.findOne({ token, status: 'consumed' });
    if (!ver) {
      const pendingVer = await Verifs.findOne({ token });
      if (pendingVer && new Date(pendingVer.expiresAt) < new Date()) {
        return res.json({ ok: false, status: 'expired', message: 'Link expired or never verified.' });
      }
      return res.json({ ok: false, status: 'pending', message: 'Email not verified yet or invalid token.' });
    }

    const user = await Users.findOne({ email: ver.email });
    if (!user) {
      console.error(`FATAL: Consumed token found, but user ${ver.email} is missing!`);
      return res.status(404).json({ ok: false, message: 'User verification data corrupted. Please try signing up again.' });
    }

    const tokenJwt = issueJwtForUser(user);

    return res.json({
      ok: true,
      status: 'ready',
      token: tokenJwt,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        verified: !!user.verified,
        profile: user.profile || {}
      }
    });
  } catch (err) {
    console.error('signup/finalize error:', err);
    return res.status(500).json({ ok: false, message: 'Failed to finalize signup' });
  }
};

// POST /api/users/login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const cleanEmail = normalizeEmail(email);
    if (!cleanEmail || !password) {
      return res.status(400).json({ ok: false, message: 'Email and password are required.' });
    }

    const Users = mongoose.connection.db.collection('users');
    const user = await Users.findOne({ email: cleanEmail });
    if (!user) {
      return res.status(400).json({ ok: false, message: 'Invalid credentials.' });
    }

    if (!user.verified) {
      return res.status(403).json({ ok: false, message: 'Please verify your email first.' });
    }

    const storedHash = user.passwordHash || user.password; // legacy fallback
    if (!storedHash) {
      return res.status(400).json({ ok: false, message: 'Account has no password set.' });
    }

    const match = await bcrypt.compare(password, storedHash);
    if (!match) {
      return res.status(400).json({ ok: false, message: 'Invalid credentials.' });
    }

    const tokenJwt = issueJwtForUser(user);
    return res.json({
      ok: true,
      token: tokenJwt,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        verified: !!user.verified,
        profile: user.profile || {}
      }
    });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ ok: false, message: 'Server error during login.' });
  }
};
