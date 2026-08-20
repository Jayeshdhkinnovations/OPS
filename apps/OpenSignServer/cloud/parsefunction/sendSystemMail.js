import formData from 'form-data';
import Mailgun from 'mailgun.js';
import { appName, smtpenable, smtpsecure, updateMailCount } from '../../Utils.js';
import { createTransport } from 'nodemailer';
async function sendMailProvider(req) {
  const app = appName;
  const extUserId = req.params?.extUserId || '';
  // Points at our own address: this previously sent recipients to
  // complaints@opensignlabs.com, i.e. reported our senders to OpenSign.
  //
  // Appended after the caller's html (below), which for the branded
  // templates in emailTemplates.js means after their closing </body> - so
  // this sits outside anything baseTemplate() itself can style. class="email-bg"
  // reuses that same template's dark-mode override (defined once in its
  // <style> block but matched document-wide by class, regardless of where
  // in the markup this paragraph ends up), so it isn't left as a stray white
  // strip once everything above it correctly goes dark. Callers whose html
  // has no such class/style block just see an inert, unused class - inline
  // background stays the only thing that matters for them.
  //
  // margin:0 + padding (instead of the default UA <p> margin) so the fill
  // itself covers the full box - a margin is transparent by definition, so
  // the default top/bottom margin here left two thin gaps showing whatever
  // sits behind this paragraph (the unstyled canvas outside </body>) rather
  // than this element's own background.
  const reportMsg = `<p class="email-bg" style="background:#FFFFFF;margin:0;padding:16px 0;font-size: 13px; color:grey; text-align: center;">If you think this email is inappropriate or spam, you may report it to <a href="mailto:notification@toowix.com?subject=Spam%20report%20for%20user%20ID%20${extUserId}">notification@toowix.com</a>.</p>`;

  const mailgunApiKey = process.env.MAILGUN_API_KEY;
  let transporterSMTP;
  try {
    let mailgunClient;
    let mailgunDomain;
    if (smtpenable) {
      let transporterConfig = {
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT || 465,
        secure: smtpsecure,
      };

      // ✅ Add auth only if BOTH username & password exist
      const smtpUser = process.env.SMTP_USERNAME;
      const smtpPass = process.env.SMTP_PASS;

      if (smtpUser && smtpPass) {
        transporterConfig.auth = {
          user: process.env.SMTP_USERNAME ? process.env.SMTP_USERNAME : process.env.SMTP_USER_EMAIL,
          pass: smtpPass,
        };
      }
      transporterSMTP = createTransport(transporterConfig);
    } else {
      if (mailgunApiKey) {
        const mailgun = new Mailgun(formData);
        mailgunClient = mailgun.client({ username: 'api', key: mailgunApiKey });
        mailgunDomain = process.env.MAILGUN_DOMAIN;
      }
    }

    const from = req.params.from || '';
    const mailsender = smtpenable ? process.env.SMTP_USER_EMAIL : process.env.MAILGUN_SENDER;
    const replyto = req.params?.replyto || '';
    const messageParams = {
      from: from + ' <' + mailsender + '>',
      to: req.params.recipient,
      subject: req.params.subject,
      text: req.params.text || 'mail',
      html: req.params?.html ? req.params.html + reportMsg : '',
      bcc: req.params.bcc ? req.params.bcc : undefined,
      replyTo: replyto ? replyto : undefined,
    };

    if (transporterSMTP) {
      const res = await transporterSMTP.sendMail(messageParams);
      console.log('smtp transporter res: ', res?.response);
      if (!res.err) {
        if (extUserId) {
          await updateMailCount(extUserId);
        }
        return { status: 'success' };
      }
    } else {
      if (mailgunApiKey) {
        const res = await mailgunClient.messages.create(mailgunDomain, messageParams);
        console.log('mailgun res: ', res?.status);
        if (res.status === 200) {
          if (extUserId) {
            await updateMailCount(extUserId);
          }
          return { status: 'success' };
        }
      } else {
        return { status: 'error' };
      }
    }
  } catch (err) {
    console.log(`sendSystemMail Error: ${err}`);
    if (err) {
      return { status: 'error' };
    }
  } finally {
    if (transporterSMTP) {
      transporterSMTP?.close?.();
    }
  }
}

async function sendSystemMail(req) {
  const nonCustomMail = await sendMailProvider(req);
  return nonCustomMail;
}

export default sendSystemMail;
