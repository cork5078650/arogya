const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
// ❌ REMOVE nodemailer import
// const nodemailer = require('nodemailer');
const crypto = require('crypto');

// ✅ ADD Resend
const { Resend } = require('resend');

const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:4000';
const VERIFY_TTL_MINUTES = parseInt(process.env.VERIFY_TTL_MINUTES || '10', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'changeme';
// -------------- Mailer Setup (Handles Gmail/Live SMTP or Ethereal fallback) --------------
let transporterPromise = null;

async function getTransporter() {
  if (transporterPromise) return transporterPromise;

  async function makeEthereal() {
    const testAccount = await nodemailer.createTestAccount();
    const t = nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
    console.log('✉️ Using Ethereal test SMTP. Login:', testAccount.user);
    console.log('🔑 Ethereal password:', testAccount.pass);
    return t;
  }
  
  // Explicit check for Ethereal (usually commented out in production)
  if (process.env.USE_ETHEREAL === '1') {
    transporterPromise = makeEthereal();
    return transporterPromise;
  }

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.warn('⚠️ SMTP env vars missing. Falling back to Ethereal.');
    transporterPromise = makeEthereal();
    return transporterPromise;
  }
  
  // Uses live credentials (e.g., your Gmail App Password)
  transporterPromise = Promise.resolve(
    nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // True for Gmail's 465, false for 587 (STARTTLS)
      auth: { user, pass },
    })
  );
  return transporterPromise;
}

// 📧 NEW: send email using Resend API
async function sendVerificationEmail(toEmail, token) {
  const verifyUrl = `${APP_BASE_URL}/api/users/verify-email?token=${token}`;
  console.log(`🔗 Verification URL sent to ${toEmail}: ${verifyUrl}`);

  try {
    if (process.env.EMAIL_PROVIDER === 'resend') {
      const fetch = (await import('node-fetch')).default;
      const response = await fetch('https://api.resend.com/emails', {
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

      const data = await response.json();
      if (!response.ok) {
        console.error('❌ Resend error:', data);
      } else {
        console.log('✅ Resend email queued:', data.id);
      }
      return;
    }

    // fallback (Ethereal or SMTP)
    const transporter = await getTransporter();
    await transporter.sendMail({
      from: process.env.FROM_EMAIL || 'no-reply@example.com',
      to: toEmail,
      subject: 'Verify your email for Arogya',
      html: `<p>Please verify your email: <a href="${verifyUrl}">${verifyUrl}</a></p>`,
    });
  } catch (err) {
    console.error('❌ sendVerificationEmail failed:', err);
  }
}
// -------------- Helpers --------------
function normalizeEmail(e) { return String(e || '').trim().toLowerCase(); }

function issueJwtForUser(user) {
  // minimal payload
  const payload = { uid: user._id, email: user.email };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

// --- NEW HELPER FUNCTION to handle user creation/update cleanly ---
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
      // If the user existed but wasn't verified (e.g., in a race condition)
      await Users.updateOne({ _id: existing._id }, { $set: { verified: true } });
      console.log(`✅ VERIFY: Existing user marked as verified: ${email}`);
    }
}
// -----------------------------------------------------------------

// -------------- Controllers (Exported Functions) --------------

/**
 * POST /api/users/signup/start
 * Creates verification record, sends email. DOES NOT create user yet.
 */
// --- replace just this function in your controller file ---
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

    // Upsert verification record
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

    // 🔥 Fire-and-forget: DO NOT await, never block the response on SMTP
    (async () => {
      try {
        const p = sendVerificationEmail(cleanEmail, token);
        const withTimeout = Promise.race([
          p,
          new Promise((_, rej) => setTimeout(() => rej(new Error('sendMail timeout (background)')), 15000))
        ]);
        await withTimeout;
      } catch (e) {
        console.warn('⚠️ sendVerificationEmail background error:', e.message || e);
      }
    })();

    // Respond immediately so the frontend can show timer & start polling
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

exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.query || {};
    if (!token) {
        console.log('❌ VERIFY: Missing token.');
        return res.status(400).send('Missing token.');
    }
    console.log(`🔍 VERIFY: Attempting to verify token: ${token.substring(0, 10)}...`);

    const db = mongoose.connection.db;
    const Users = db.collection('users');
    const Verifs = db.collection('email_verifications');
    
    const now = new Date();
    const verUpdateResult = await Verifs.findOneAndUpdate(
        { 
            token: token,
            status: 'pending',
            expiresAt: { $gt: now } // Only process if not expired
        },
        { 
            $set: { 
                status: 'consumed', 
                consumedAt: now 
            } 
        },
        { 
            returnDocument: 'before', 
            upsert: false 
        }
    );

    let ver = verUpdateResult.value;

    if (!ver) {
        // --- Token was NOT successfully atomically updated (race condition, expired, or invalid) ---
        
        // Find the record to determine the exact failure reason
        const existingVer = await Verifs.findOne({ token });
        
        if (!existingVer) {
            console.log('❌ VERIFY: Token not found/invalid.');
            return res.status(400).send('Invalid token (not found).');
        }
        if (new Date(existingVer.expiresAt) < now) {
            console.log('❌ VERIFY: Token expired.');
            return res.status(400).send('Verification link expired.');
        }
        
        // The token is valid and consumed (the race condition happened).
        if (existingVer.status === 'consumed') {
            console.log(`✅ VERIFY: Already consumed for ${existingVer.email}. Ensuring user is created.`);
            ver = existingVer; // Use the existing record's data
            // FALL THROUGH to ensure user is created, and send the success page.
        }
    }
    
    if (!ver) {
         // Should not happen if logic is correct, but handles any final undefined state
         return res.status(400).send('Verification failed.');
    }
    
    // --- CORE STEP: Ensure user is created/updated (runs on new consumption AND race condition success) ---
    await ensureUserCreated(ver, Users);

    // Simple success page for the user's browser (This page is shown after the link click)
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

/**
 * GET /api/users/signup/status/:token
 * Used by the frontend to poll for verification status.
 */
exports.signupStatus = async (req, res) => {
  try {
    const token = req.params.token;
    if (!token) return res.status(400).json({ ok: false, message: 'Missing token' });

    const db = mongoose.connection.db;
    const Verifs = db.collection('email_verifications');

    const ver = await Verifs.findOne({ token });
    if (!ver) {
        console.log(`ℹ️ STATUS: Token ${token.substring(0, 10)}... not found. Returning expired.`);
        return res.json({ ok: true, status: 'expired' }); // Token not found means it's expired
    }

    if (ver.status === 'consumed') {
        console.log(`✅ STATUS: Token ${token.substring(0, 10)}... is consumed. Returning consumed.`);
        return res.json({ ok: true, status: 'consumed' });
    }
    if (new Date(ver.expiresAt) < new Date()) {
        console.log(`❌ STATUS: Token ${token.substring(0, 10)}... is expired. Returning expired.`);
        return res.json({ ok: true, status: 'expired' });
    }

    console.log(`⏳ STATUS: Token ${token.substring(0, 10)}... is pending. Returning pending.`);
    return res.json({ ok: true, status: 'pending' });
  } catch (err) {
    console.error('signup/status error:', err);
    return res.status(500).json({ ok: false, message: 'Failed to get status' });
  }
};

/**
 * POST /api/users/signup/finalize
 * Called by the frontend after polling confirms 'consumed'. Returns the final JWT.
 */
exports.signupFinalize = async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ ok: false, message: 'Missing token' });

    const db = mongoose.connection.db;
    const Users = db.collection('users');
    const Verifs = db.collection('email_verifications');

    // Finalize requires the token to be consumed. 
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
      // This is a safety check: if the token is consumed, the user MUST exist.
      console.error(`FATAL: Consumed token found, but user ${ver.email} is missing!`);
      return res.status(404).json({ ok: false, message: 'User verification data corrupted. Please try signing up again.' });
    }

    // Issue the final JWT for the user to start a session
    const tokenJwt = issueJwtForUser(user);
    
    // Return token and minimal user data
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

/* ------------------------------------------------------------------
 * NEW: POST /api/users/login
 * Body: { email, password }
 * - normalizes email
 * - requires verified user
 * - compares bcrypt hash in `passwordHash` (with legacy fallback)
 * - returns same shape as finalize: { ok, token, user }
 * ------------------------------------------------------------------ */
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const cleanEmail = normalizeEmail(email);
    if (!cleanEmail || !password) {
      return res.status(400).json({ ok: false, message: 'Email and password are required.' });
    }

    const db = mongoose.connection.db;
    const Users = db.collection('users');

    const user = await Users.findOne({ email: cleanEmail });
    if (!user) {
      return res.status(400).json({ ok: false, message: 'Invalid credentials.' });
    }

    // Must be verified
    if (!user.verified) {
      return res.status(403).json({ ok: false, message: 'Please verify your email first.' });
    }

    // Compare against passwordHash (or legacy `password`)
    const storedHash = user.passwordHash || user.password; // legacy fallback
    if (!storedHash) {
      return res.status(400).json({ ok: false, message: 'Account has no password set.' });
    }

    const match = await bcrypt.compare(password, storedHash);
    if (!match) {
      return res.status(400).json({ ok: false, message: 'Invalid credentials.' });
    }

    // Success: issue JWT and return user
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