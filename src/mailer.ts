import nodemailer from "nodemailer";

export interface DigestMail {
  subject: string;
  text: string;
  html: string;
}

export async function sendDigestMail(mail: DigestMail): Promise<boolean> {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, MAIL_TO } = process.env;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !MAIL_FROM || !MAIL_TO) {
    console.log("SMTP設定が未完了のため、メール送信をスキップしました。");
    return false;
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT ?? 587),
    secure: Number(SMTP_PORT ?? 587) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  await transporter.sendMail({
    from: MAIL_FROM,
    to: MAIL_TO,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });

  console.log(`メール送信完了: ${MAIL_TO}`);
  return true;
}
