/**
 * Arabic text for every response code. Clients branch on `code`; `message` is for display.
 * (Arabic-only product, NFR-01; nestjs-i18n can replace this map if a second locale is ever added.)
 */
export const MESSAGES = {
  'common.ok': 'تمت العملية بنجاح.',
  'common.bad_request': 'الطلب غير صالح.',
  'common.validation': 'تحقق من البيانات المدخلة.',
  'common.forbidden': 'ليست لديك صلاحية لهذا الإجراء.',
  'common.not_found': 'لم يتم العثور على المطلوب.',
  'common.conflict': 'تعارض في البيانات.',
  'common.payload_too_large': 'حجم الملف أو الطلب أكبر من الحد المسموح.',
  'common.too_many_requests': 'محاولات كثيرة، يرجى المحاولة لاحقاً.',
  'common.internal': 'حدث خطأ غير متوقع، يرجى المحاولة لاحقاً.',
  'auth.unauthorized': 'يرجى تسجيل الدخول.',
  'auth.refresh_race': 'جارٍ تحديث الجلسة، أعد المحاولة.',
  'auth.session_expired': 'انتهت الجلسة، يرجى تسجيل الدخول مجدداً.',
  'auth.invalid_credentials': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
  'auth.csrf': 'تعذّر التحقق من مصدر الطلب.',
  'auth.registration_started':
    'إذا كان البريد صالحاً لإنشاء حساب فستصلك رسالة خلال دقائق. إن كان لديك حساب، سجّل الدخول أو أعد تعيين كلمة المرور.',
  'auth.code_invalid': 'الرمز غير صحيح أو انتهت صلاحيته.',
  'auth.code_locked': 'تجاوزت عدد المحاولات، اطلب رمزاً جديداً.',
  'auth.registration_token_invalid': 'انتهت صلاحية خطوة التسجيل، ابدأ من جديد.',
  'auth.account_exists':
    'لا يمكن إكمال التسجيل بهذا البريد، جرّب تسجيل الدخول.',
  'auth.registered': 'تم إنشاء حسابك.',
  'auth.logged_in': 'تم تسجيل الدخول.',
  'auth.logged_out': 'تم تسجيل الخروج.',
  'auth.reset_requested':
    'إذا كان البريد مسجلاً لدينا فستصلك رسالة لإعادة تعيين كلمة المرور.',
  'auth.reset_token_invalid': 'رابط إعادة التعيين غير صالح أو انتهت صلاحيته.',
  'auth.password_reset': 'تم تغيير كلمة المرور، سجّل الدخول بها الآن.',
  'auth.invite_invalid': 'رابط الدعوة غير صالح أو انتهت صلاحيته.',
  'auth.invite_accepted': 'تم تفعيل حسابك، سجّل الدخول الآن.',
  'password.too_short': 'كلمة المرور يجب ألا تقل عن 8 أحرف.',
  'password.too_long': 'كلمة المرور يجب ألا تزيد على 128 حرفاً.',
  'contact.sent': 'وصلت رسالتك، وسيتواصل معك فريقنا قريباً.',
  'contact_message.status_updated': 'تم تحديث حالة الطلب.',
  'contact_message.deleted': 'تم حذف الطلب.',
  'auth.profile_updated': 'تم حفظ التغييرات.',
  'auth.password_changed': 'تم تغيير كلمة المرور، سجّل الدخول بها الآن.',
  'auth.current_password_invalid': 'كلمة المرور الحالية غير صحيحة.',
  'package.created': 'تمت إضافة الباقة.',
  'package.updated': 'تم حفظ الباقة.',
  'article.created': 'تم إنشاء المقال.',
  'article.updated': 'تم حفظ المقال.',
  'article.deleted': 'تم حذف المقال.',
  'article.slug_taken': 'هذا الرابط مستخدم في مقال آخر.',
  'article.incomplete': 'أكمل جميع الحقول قبل نشر المقال.',
  'article.cover_invalid': 'صورة الغلاف غير موجودة، ارفعها من جديد.',
  'article.image_invalid': 'ارفع صورة بصيغة JPG أو PNG أو WebP.',
  'article.image_uploaded': 'تم رفع الصورة.',
  'event.created': 'تم إنشاء مناسبتك.',
  'event.updated': 'تم حفظ التغييرات.',
  'event.corrected': 'تم حفظ التصحيح وتسجيله.',
  'events.package_inactive': 'هذه الباقة لم تعد متاحة، اختر باقة أخرى.',
  'events.starts_in_past': 'موعد المناسبة يجب أن يكون في المستقبل.',
  'events.send_after_start': 'موعد الإرسال يجب أن يسبق موعد المناسبة.',
  'events.send_in_past': 'موعد الإرسال يجب أن يكون في المستقبل.',
  'events.locked': 'لا يمكن تعديل المناسبة بعد اعتماد الدعوة أو جدولتها.',
  'events.package_locked': 'لا يمكن تغيير الباقة بعد بدء الدفع.',
  'events.closed': 'لا يمكن تعديل مناسبة ملغاة أو منتهية.',
  'events.admission_window_invalid': 'بداية نافذة الدخول يجب أن تسبق نهايتها.',
  'user.phone_invalid':
    'رقم الجوال غير صحيح. أدخل رقماً سعودياً مثل 05XXXXXXXX.',
} as const;

export type ErrorCode = keyof typeof MESSAGES;

export const messageFor = (code: string): string =>
  (MESSAGES as Record<string, string>)[code] ?? MESSAGES['common.internal'];
