import { Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port: Number(process.env.MAIL_PORT ?? 587),
    secure: false,
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS,
    },
  });

  private formatRuDateTime(d: Date) {
    const timeZone = process.env.MAIL_TIMEZONE || 'Europe/Moscow';

    const date = new Intl.DateTimeFormat('ru-RU', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);

    const time = new Intl.DateTimeFormat('ru-RU', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);

    return { date, time };
  }

  async sendBookingConfirmation(params: {
    to: string;
    subjectName: string;
    teacherFullName: string;
    startsAt: Date;
    endsAt: Date;
    isOnline: boolean;
    meetingLink?: string | null;
    audienceNumber?: string | null;
  }) {
    const from = process.env.MAIL_FROM || process.env.MAIL_USER;
    if (!from) throw new Error('MAIL_FROM or MAIL_USER is missing');

    const accent = '#941B0C';
    const start = this.formatRuDateTime(params.startsAt);
    const end = this.formatRuDateTime(params.endsAt);

    const mailSubject = `EventPass: вы записаны на консультацию по предмету "${params.subjectName}"`;

    const safeTeacher = params.teacherFullName?.trim() || 'Преподаватель';
    const safeMeetingLink = params.meetingLink?.trim() || '';
    const safeAudienceNumber = params.audienceNumber?.trim() || '';
    const formatLabel = params.isOnline ? 'Онлайн' : 'Очно';

    const placeText = params.isOnline
      ? `Ссылка: ${safeMeetingLink}\n`
      : `Аудитория: ${safeAudienceNumber}\n`;

    const placeHtml = params.isOnline
      ? `
            <div style="margin:0 0 8px 0;">
              <span style="color:#666;">Ссылка:</span>
              <span style="font-weight:700;word-break:break-all;">${safeMeetingLink}</span>
            </div>
        `
      : `
            <div style="margin:0 0 8px 0;">
              <span style="color:#666;">Аудитория:</span>
              <span style="font-weight:700;">${safeAudienceNumber}</span>
            </div>
        `;

    const actionHtml =
      params.isOnline && safeMeetingLink
        ? `
          <div style="margin-top:16px;">
            <a href="${safeMeetingLink}"
               style="display:inline-block;background:${accent};color:#fff;text-decoration:none;padding:12px 16px;border-radius:10px;font-weight:700;">
              Перейти к консультации
            </a>
          </div>
        `
        : '';

    const text =
      `Вы записались на консультацию.\n\n` +
      `Предмет: ${params.subjectName}\n` +
      `Преподаватель: ${safeTeacher}\n` +
      `Дата: ${start.date}\n` +
      `Время: ${start.time} - ${end.time}\n` +
      `Формат: ${formatLabel}\n` +
      placeText;

    const html = `
<!doctype html>
<html lang="ru">
  <body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#111;">
    <div style="max-width:640px;margin:0 auto;padding:24px;">
      <div style="border:1px solid #eee;border-radius:12px;overflow:hidden;">
        <div style="background:${accent};padding:18px 20px;">
          <div style="color:#fff;font-size:18px;font-weight:700;letter-spacing:0.2px;">
            EventPass
          </div>
          <div style="color:#fff;opacity:0.95;font-size:14px;margin-top:6px;">
            Подтверждение записи на консультацию
          </div>
        </div>

        <div style="padding:20px;">
          <div style="font-size:16px;font-weight:700;margin-bottom:10px;">
            Вы успешно записались
          </div>

          <div style="background:#fafafa;border:1px solid #eee;border-radius:12px;padding:14px 14px;">
            <div style="margin:0 0 8px 0;">
              <span style="color:#666;">Предмет:</span>
              <span style="font-weight:700;">${params.subjectName}</span>
            </div>
            <div style="margin:0 0 8px 0;">
              <span style="color:#666;">Преподаватель:</span>
              <span style="font-weight:700;">${safeTeacher}</span>
            </div>
            <div style="margin:0 0 8px 0;">
              <span style="color:#666;">Дата:</span>
              <span style="font-weight:700;">${start.date}</span>
            </div>
            <div style="margin:0 0 8px 0;">
              <span style="color:#666;">Время:</span>
              <span style="font-weight:700;">${start.time} - ${end.time}</span>
            </div>
            <div style="margin:0 0 8px 0;">
              <span style="color:#666;">Формат:</span>
              <span style="font-weight:700;">${formatLabel}</span>
            </div>
            ${placeHtml}
          </div>

          ${actionHtml}

          <div style="margin-top:14px;color:#666;font-size:13px;line-height:1.35;">
            Если вы не записывались на консультацию, просто проигнорируйте это письмо.
          </div>

          <div style="margin-top:18px;border-top:1px solid #eee;padding-top:14px;color:#999;font-size:12px;">
            EventPass - уведомление отправлено автоматически.
          </div>
        </div>
      </div>
    </div>
  </body>
</html>
    `.trim();

    await this.transporter.sendMail({
      from,
      to: params.to,
      subject: mailSubject,
      text,
      html,
    });
  }

  async sendPasswordReset(params: { to: string; resetLink: string }) {
    const from = process.env.MAIL_FROM || process.env.MAIL_USER;
    if (!from) throw new Error('MAIL_FROM or MAIL_USER is missing');

    const accent = '#941B0C';
    const safeResetLink = params.resetLink.trim();

    const subject = 'EventPass: восстановление пароля';

    const text =
      `Вы запросили восстановление пароля.\n\n` +
      `Для установки нового пароля перейдите по ссылке:\n${safeResetLink}\n\n` +
      `Если вы не запрашивали восстановление, просто проигнорируйте это письмо.\n`;

    const html = `
<!doctype html>
<html lang="ru">
  <body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#111;">
    <div style="max-width:640px;margin:0 auto;padding:24px;">
      <div style="border:1px solid #eee;border-radius:12px;overflow:hidden;">
        <div style="background:${accent};padding:18px 20px;">
          <div style="color:#fff;font-size:18px;font-weight:700;">
            EventPass
          </div>
          <div style="color:#fff;opacity:0.95;font-size:14px;margin-top:6px;">
            Восстановление пароля
          </div>
        </div>

        <div style="padding:20px;">
          <div style="font-size:16px;font-weight:700;margin-bottom:10px;">
            Сброс пароля
          </div>

          <div style="color:#333;font-size:14px;line-height:1.5;">
            Вы запросили установку нового пароля для аккаунта EventPass.
          </div>

          <div style="margin-top:16px;">
            <a href="${safeResetLink}"
               style="display:inline-block;background:${accent};color:#fff;text-decoration:none;padding:12px 16px;border-radius:10px;font-weight:700;">
              Сбросить пароль
            </a>
          </div>

          <div style="margin-top:14px;color:#666;font-size:13px;line-height:1.35;word-break:break-all;">
            Если кнопка не работает, откройте ссылку вручную:<br />
            <a href="${safeResetLink}">${safeResetLink}</a>
          </div>

          <div style="margin-top:14px;color:#666;font-size:13px;line-height:1.35;">
            Если вы не запрашивали восстановление пароля, просто проигнорируйте это письмо.
          </div>

          <div style="margin-top:18px;border-top:1px solid #eee;padding-top:14px;color:#999;font-size:12px;">
            EventPass - уведомление отправлено автоматически.
          </div>
        </div>
      </div>
    </div>
  </body>
</html>
    `.trim();

    await this.transporter.sendMail({
      from,
      to: params.to,
      subject,
      text,
      html,
    });
  }
}
