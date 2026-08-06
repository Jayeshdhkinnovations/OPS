import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env') });

const config = {
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_PORT === '465',
  auth: {
    user: process.env.SMTP_USERNAME || process.env.SMTP_USER_EMAIL,
    pass: process.env.SMTP_PASS,
  },
};

console.log('Using SMTP Configuration:', {
  host: config.host,
  port: config.port,
  secure: config.secure,
  user: config.auth.user,
});

const transporter = nodemailer.createTransport(config);

const mailOptions = {
  from: process.env.SMTP_USER_EMAIL,
  to: 'piyush270205@gmail.com',
  subject: 'Test Email from OpenSign SMTP Setup',
  text: 'Hello Piyush! This is a test email confirming that your OpenSign SMTP settings are working perfectly.',
  html: '<p>Hello Piyush!</p><p>This is a test email confirming that your OpenSign SMTP settings are working perfectly.</p>',
};

transporter.sendMail(mailOptions, (error, info) => {
  if (error) {
    console.error('❌ Error sending email:', error);
    process.exit(1);
  } else {
    console.log('✅ Email sent successfully!');
    console.log('Message ID:', info.messageId);
    console.log('Response:', info.response);
    process.exit(0);
  }
});
