export interface MailMessage {
  kind:
    | 'register_code'
    | 'account_exists'
    | 'password_reset'
    | 'password_changed'
    | 'admin_invite'
    | 'admin_promoted';
  subject: string;
  text: string;
  html: string;
}

const BRAND = 'أثر للمناسبات';

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ] ?? c,
  );

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="ar" dir="rtl"><body style="margin:0;background:#f7f2ea;font-family:Tahoma,Arial,sans-serif;color:#1e2a2c">
<div style="max-width:520px;margin:0 auto;padding:32px 20px">
<p style="font-size:20px;font-weight:bold;color:#1f4d45;margin:0 0 24px">${BRAND}</p>
<div style="background:#fffdf9;border:1px solid #e3dccf;border-radius:16px;padding:24px">
<h1 style="font-size:18px;margin:0 0 16px">${escapeHtml(title)}</h1>${bodyHtml}</div>
<p style="font-size:12px;color:#52615b;margin-top:16px">إذا لم تطلب هذه الرسالة فتجاهلها، ولن يتغير شيء في حسابك.</p>
</div></body></html>`;
}

const button = (href: string, label: string) =>
  `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="background:#1f4d45;color:#fffdf9;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">${escapeHtml(label)}</a></p>
<p style="font-size:12px;color:#52615b;direction:ltr;text-align:left;word-break:break-all">${escapeHtml(href)}</p>`;

export function registerCodeMail(code: string): MailMessage {
  const title = 'رمز تأكيد بريدك الإلكتروني';
  return {
    kind: 'register_code',
    subject: `${code} رمز التأكيد — ${BRAND}`,
    text: `رمز تأكيد بريدك: ${code}\nصالح لمدة 10 دقائق. لا تشاركه مع أحد.`,
    html: layout(
      title,
      `<p>استخدم هذا الرمز لإكمال إنشاء حسابك:</p>
<p style="font-size:32px;font-weight:bold;letter-spacing:8px;direction:ltr;text-align:center;margin:20px 0">${code}</p>
<p style="font-size:14px;color:#52615b">صالح لمدة 10 دقائق. لا تشاركه مع أحد.</p>`,
    ),
  };
}

export function accountExistsMail(
  loginUrl: string,
  resetUrl: string,
): MailMessage {
  const title = 'لديك حساب بهذا البريد';
  return {
    kind: 'account_exists',
    subject: `${title} — ${BRAND}`,
    text: `طلب أحدهم إنشاء حساب بهذا البريد، ولديك حساب بالفعل.\nسجّل الدخول: ${loginUrl}\nأو أعد تعيين كلمة المرور: ${resetUrl}`,
    html: layout(
      title,
      `<p>طلب أحدهم إنشاء حساب جديد بهذا البريد، ولديك حساب بالفعل.</p>${button(loginUrl, 'تسجيل الدخول')}
<p style="font-size:14px">نسيت كلمة المرور؟ <a href="${escapeHtml(resetUrl)}">أعد تعيينها</a>.</p>`,
    ),
  };
}

export function passwordResetMail(link: string): MailMessage {
  const title = 'إعادة تعيين كلمة المرور';
  return {
    kind: 'password_reset',
    subject: `${title} — ${BRAND}`,
    text: `لإعادة تعيين كلمة المرور افتح الرابط التالي خلال 30 دقيقة:\n${link}`,
    html: layout(
      title,
      `<p>اضغط الزر لاختيار كلمة مرور جديدة. الرابط صالح لمدة 30 دقيقة ولمرة واحدة.</p>${button(link, 'اختر كلمة مرور جديدة')}`,
    ),
  };
}

export function passwordChangedMail(resetUrl: string): MailMessage {
  const title = 'تم تغيير كلمة المرور';
  return {
    kind: 'password_changed',
    subject: `${title} — ${BRAND}`,
    text: `تم تغيير كلمة مرور حسابك وتسجيل الخروج من جميع الأجهزة.\nإن لم تكن أنت، أعد تعيينها فوراً: ${resetUrl}`,
    html: layout(
      title,
      `<p>تم تغيير كلمة مرور حسابك وتسجيل الخروج من جميع الأجهزة.</p>
<p style="font-size:14px">إن لم تكن أنت، <a href="${escapeHtml(resetUrl)}">أعد تعيين كلمة المرور فوراً</a>.</p>`,
    ),
  };
}

export function adminInviteMail(link: string): MailMessage {
  const title = 'دعوة لإدارة المنصة';
  return {
    kind: 'admin_invite',
    subject: `${title} — ${BRAND}`,
    text: `أُنشئ لك حساب مدير. اختر كلمة المرور خلال 24 ساعة:\n${link}`,
    html: layout(
      title,
      `<p>أُنشئ لك حساب مدير على المنصة. اختر كلمة المرور خلال 24 ساعة.</p>${button(link, 'تفعيل الحساب')}`,
    ),
  };
}

export function adminPromotedMail(loginUrl: string): MailMessage {
  const title = 'أصبحت مديراً للمنصة';
  return {
    kind: 'admin_promoted',
    subject: `${title} — ${BRAND}`,
    text: `مُنح حسابك صلاحيات المدير، وسُجّل خروجك من جميع الأجهزة. سجّل الدخول مجدداً: ${loginUrl}`,
    html: layout(
      title,
      `<p>مُنح حسابك صلاحيات المدير، وسُجّل خروجك من جميع الأجهزة لتسجيل الدخول من جديد.</p>${button(loginUrl, 'تسجيل الدخول')}`,
    ),
  };
}
