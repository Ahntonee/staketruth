const nodemailer = require('nodemailer');

let transporter = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
  }
  return transporter;
}

const BRAND = {
  name: 'StakeTruth',
  primary: '#ff6b35',
  bg: '#faf6f2',
  card: '#ffffff',
  text: '#2b2138',
};

function wrapTemplate(title, bodyHtml, ctaText, ctaUrl) {
  return `
  <div style="background:${BRAND.bg};padding:32px 16px;font-family:'Open Sans',Arial,sans-serif;color:${BRAND.text};">
    <div style="max-width:520px;margin:0 auto;background:${BRAND.card};border-radius:14px;overflow:hidden;border:1px solid rgba(27,67,50,0.12);">
      <div style="background:${BRAND.primary};padding:20px 28px;">
        <span style="font-family:'Inter',Arial,sans-serif;font-size:20px;font-weight:800;color:#fff;letter-spacing:0.5px;">STAKETRUTH</span>
      </div>
      <div style="padding:28px;">
        <h1 style="font-size:20px;margin:0 0 16px;">${title}</h1>
        <div style="font-size:15px;line-height:1.6;">${bodyHtml}</div>
        ${ctaText && ctaUrl ? `
        <div style="margin-top:24px;">
          <a href="${ctaUrl}" style="display:inline-block;background:${BRAND.primary};color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">${ctaText}</a>
        </div>` : ''}
      </div>
      <div style="padding:16px 28px;border-top:1px solid rgba(27,67,50,0.1);font-size:12px;color:rgba(26,31,24,0.55);">
        StakeTruth — Data-Driven Picks. Proven Results.<br>
        For entertainment only. Please gamble responsibly.
      </div>
    </div>
  </div>`;
}

async function sendMail({ to, subject, html }) {
  if (!process.env.SMTP_USER || process.env.SMTP_USER === 'noreply@staketruth.com' && !process.env.SMTP_PASS) {
    // No real SMTP configured yet — log instead of throwing, so local dev/testing isn't blocked.
    console.log(`[email] SMTP not configured — would have sent "${subject}" to ${to}`);
    return { skipped: true };
  }
  try {
    return await getTransporter().sendMail({ from: process.env.EMAIL_FROM, to, subject, html });
  } catch (err) {
    console.error(`[email] failed to send "${subject}" to ${to}:`, err.message);
    return { error: err.message };
  }
}

function sendOtpEmail(to, name, otp) {
  const html = wrapTemplate(
    `Verify your email, ${name}`,
    `<p>Your StakeTruth verification code is:</p>
     <p style="font-size:32px;font-weight:800;letter-spacing:6px;color:${BRAND.primary};">${otp}</p>
     <p>This code expires in 15 minutes. If you didn't request this, you can ignore this email.</p>`
  );
  return sendMail({ to, subject: 'Your StakeTruth verification code', html });
}

function sendWelcomeEmail(to, name) {
  const html = wrapTemplate(
    `Welcome to StakeTruth, ${name}!`,
    `<p>Your account is ready. You now have full access to our free daily football predictions and the Banker of the Day.</p>
     <p>Want our highest-confidence VIP picks? Upgrade any time.</p>`,
    'View today\'s predictions',
    `${process.env.SITE_URL}/predictions.html`
  );
  return sendMail({ to, subject: 'Welcome to StakeTruth', html });
}

function sendPasswordResetEmail(to, name, resetUrl) {
  const html = wrapTemplate(
    `Reset your password`,
    `<p>Hi ${name}, click below to reset your StakeTruth password. This link expires in 1 hour.</p>`,
    'Reset password',
    resetUrl
  );
  return sendMail({ to, subject: 'Reset your StakeTruth password', html });
}

function sendExpiryReminderEmail({ email, name, plan, expiresAt }) {
  const html = wrapTemplate(
    `Your VIP access expires soon`,
    `<p>Hi ${name}, your <strong>${plan}</strong> VIP subscription expires on <strong>${new Date(expiresAt).toDateString()}</strong>.</p>
     <p>Renew now to keep uninterrupted access to VIP picks, Banker of the Day, and the VIP Picks of the Day rail.</p>`,
    'Renew Now',
    `${process.env.SITE_URL}/pricing.html`
  );
  return sendMail({ to: email, subject: 'Your StakeTruth VIP access is expiring soon', html });
}

function sendVipWelcomeEmail({ email, name, telegramLink }) {
  const html = wrapTemplate(
    `Welcome to VIP, ${name}!`,
    `<p>Your VIP subscription is active. You now have full access to VIP picks, the VIP Picks of the Day rail, and Banker of the Day.</p>
     ${telegramLink ? `<p>Join our private VIP Telegram channel for real-time updates:</p>` : ''}`,
    telegramLink ? 'Join VIP Telegram' : 'View VIP Picks',
    telegramLink || `${process.env.SITE_URL}/predictions.html`
  );
  return sendMail({ to: email, subject: 'You\'re in — StakeTruth VIP is active', html });
}

module.exports = {
  sendOtpEmail,
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendExpiryReminderEmail,
  sendVipWelcomeEmail,
};
