/**
 * Outgoing e-mail. Uses SMTP when SMTP_HOST is set; otherwise the message is
 * written to the server log (development, or before an SMTP account exists).
 * In tests, messages are kept in memory (see `outbox`).
 */
const config = require('../config');

const outbox = [];
let transport;

function getTransport() {
  if (!config.smtp.host) return null;
  if (!transport) {
    const nodemailer = require('nodemailer');
    transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  }
  return transport;
}

async function sendMail({ to, subject, text }) {
  const msg = { from: config.smtp.from, to, subject, text };
  if (config.isTest) { outbox.push(msg); return; }
  const t = getTransport();
  if (!t) {
    console.log(`[mail] SMTP not configured — message for ${to}:\n  Subject: ${subject}\n  ${text.replace(/\n/g, '\n  ')}`);
    return;
  }
  await t.sendMail(msg);
}

module.exports = { sendMail, outbox, isConfigured: () => !!config.smtp.host };
