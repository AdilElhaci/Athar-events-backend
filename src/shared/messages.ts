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
  'testimonial.created': 'تمت إضافة الرأي.',
  'testimonial.updated': 'تم حفظ الرأي.',
  'testimonial.deleted': 'تم حذف الرأي.',
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
  'events.already_paid': 'تم دفع هذه المناسبة مسبقاً.',
  'payments.unavailable':
    'تعذّر فتح صفحة الدفع الآن، حاول بعد قليل. لم يُخصم أي مبلغ.',
  'events.admission_window_invalid': 'بداية نافذة الدخول يجب أن تسبق نهايتها.',
  'guest.created': 'تمت إضافة الضيف.',
  'guest.updated': 'تم حفظ بيانات الضيف.',
  'guest.deleted': 'تم حذف الضيف.',
  'guests.phone_duplicate': 'هذا الرقم مضاف مسبقاً لضيف آخر في المناسبة.',
  'guests.allowance_exceeded':
    'اكتمل عدد الضيوف الأساسيين في الباقة، أضفه كضيف احتياطي أو احذف ضيفاً.',
  'guests.reserve_exceeded': 'اكتمل عدد الضيوف الاحتياطيين المسموح في الباقة.',
  'guests.locked_after_allocation':
    'لا يمكن حذف الضيف أو تغيير رقمه بعد تخصيص دعوته.',
  'guests.event_unpaid': 'لا يمكن إدخال الضيوف قبل إتمام دفع المناسبة.',
  'guests.list_locked': 'لا يمكن تعديل القائمة بعد جدولة الإرسال أو بدئه.',
  'guests.ready_requires_guest':
    'أضف ضيفاً أساسياً واحداً على الأقل قبل اعتماد القائمة.',
  'event.list_status_updated': 'تم تحديث حالة القائمة.',
  'imports.previewed': 'تمت قراءة الملف، راجع النتيجة قبل الاعتماد.',
  'imports.applied': 'تمت إضافة الضيوف من الملف.',
  'imports.unreadable': 'تعذّرت قراءة الملف. ارفع ملف Excel بصيغة xlsx.',
  'imports.missing_columns':
    'الملف لا يحتوي على عمودي الاسم والجوال في الصف الأول. استخدم القالب المعتمد.',
  'imports.too_many_rows': 'الملف يحتوي على أكثر من 2,000 صف.',
  'imports.expired': 'انتهت صلاحية المعاينة، ارفع الملف من جديد.',
  'imports.row.name_invalid': 'الاسم مفقود أو قصير جداً أو أطول من 120 حرفاً.',
  'imports.row.phone_missing': 'رقم الجوال مفقود.',
  'imports.row.phone_invalid': 'رقم الجوال ليس رقماً سعودياً صحيحاً.',
  'imports.row.kind_invalid': 'النوع يجب أن يكون «أساسي» أو «احتياطي».',
  'imports.row.note_too_long': 'الملاحظة أطول من 200 حرف.',
  'imports.row.formula': 'الخلية تحتوي على صيغة، أدخل القيمة نصاً.',
  'invitation.version_created':
    'تم حفظ نسخة الدعوة وإرسالها لصاحب المناسبة للاعتماد.',
  'invitation.approved': 'تم اعتماد الدعوة.',
  'invitation.overridden': 'تم اعتماد الدعوة من الإدارة وتسجيل السبب.',
  'invitation.missing': 'لم تُجهَّز الدعوة بعد.',
  'invitation.version_outdated':
    'تغيّرت الدعوة بعد فتح الصفحة. راجع النسخة الأحدث ثم اعتمدها.',
  'invitation.locked':
    'لا يمكن تعديل الدعوة بعد جدولة الإرسال. ألغِ الجدولة أولاً.',
  'invitation.variable_invalid':
    'النص لا يقبل أسطراً جديدة أو مسافات متتالية، ويجب أن يكون بين 2 و120 حرفاً.',
  'campaign.scheduled': 'تمت جدولة الإرسال.',
  'campaign.unscheduled': 'أُلغيت الجدولة.',
  'campaign.not_paid': 'لم تُدفع المناسبة بعد.',
  'campaign.list_not_ready': 'اعتمد قائمة الضيوف أولاً.',
  'campaign.not_approved': 'الدعوة غير معتمدة بعد.',
  'campaign.template_not_approved':
    'قالب الدعوة لم يعتمد من واتساب (Meta) بعد، فلا يمكن الجدولة.',
  'campaign.send_after_event': 'موعد الإرسال يجب أن يسبق موعد المناسبة.',
  'campaign.already_started': 'بدأ الإرسال أو انتهى، فلا يمكن تغيير الجدولة.',
  'campaign.not_scheduled': 'المناسبة غير مجدولة.',
  'campaign.paused': 'أُوقف الإرسال مؤقتاً.',
  'campaign.resumed': 'استُؤنف الإرسال.',
  'campaign.not_sending': 'الإرسال ليس جارياً الآن.',
  'campaign.not_paused': 'الإرسال ليس موقوفاً.',
  'campaign.event_started': 'بدأت المناسبة، فلا يمكن استئناف الإرسال.',
  'messages.not_resolvable': 'هذه الرسالة لا تحتاج إلى معالجة.',
  'messages.resolution_invalid': 'الرسالة فشلت فعلاً؛ يمكن إعادة إرسالها فقط.',
  'messages.event_started': 'بدأت المناسبة، فلا يمكن إعادة الإرسال.',
  'messages.guest_gone': 'الضيف محذوف أو بلا رقم جوال.',
  'messages.guest_replied': 'ردّ الضيف على الدعوة، فلا حاجة لإعادة إرسالها.',
  'messages.guest_not_accepted': 'الضيف لم يقبل الدعوة، فلا يُرسل له رمز دخول.',
  'messages.already_sent': 'لدى الضيف رسالة من النوع نفسه أُرسلت أو في الطريق.',
  'messages.window_closed':
    'مرّ أكثر من 23 ساعة على رد الضيف؛ يُرسل الرمز بقالب معتمد (غير متاح بعد).',
  'messages.kind_unsupported': 'لا يمكن إعادة إرسال هذا النوع من الرسائل.',
  'messages.resolved': 'تمت معالجة الرسالة.',
  'replies.sent': 'أُرسل الرد.',
  'replies.failed': 'لم يُرسل الرد، حاول مرة أخرى.',
  'replies.unknown':
    'لم نتأكد من وصول الرد. لا تُعِد الإرسال قبل التحقق من الضيف.',
  'replies.window_closed':
    'مرّت أكثر من 23 ساعة على آخر رسالة من هذا الضيف، ولا يسمح واتساب بالرد الحر بعدها.',
  'replies.no_phone': 'لا يوجد رقم جوال لهذا الضيف.',
  'replies.not_configured': 'واتساب غير مهيأ على الخادم.',
  'payments.not_pending': 'هذه الدفعة ليست معلّقة، فلا حاجة لمطابقتها.',
  'payments.provider_unavailable':
    'تعذّر الوصول إلى ميسّر الآن، حاول بعد قليل.',
  'payments.reconciled': 'تمت مطابقة الدفعة مع ميسّر.',
  'payments.no_refund_needed': 'هذه الدفعة لا تحتاج إلى استرجاع.',
  'payments.refund_done': 'سُجّل استرجاع المبلغ.',
  'events.not_paid': 'المناسبة غير مدفوعة، فلا يوجد ما يُسترجع.',
  'events.refunded': 'سُجّل الاسترجاع وأُلغيت المناسبة.',
  'users.self': 'لا يمكنك تعليق حسابك أو إعادة تفعيله بنفسك.',
  'users.invited': 'هذا مدير مدعو لم يفعّل حسابه بعد؛ يُدار من الخادم.',
  'users.already_suspended': 'الحساب معلّق مسبقاً.',
  'users.already_active': 'الحساب مفعّل مسبقاً.',
  'users.suspended': 'عُلّق الحساب وأُنهيت جلساته.',
  'users.reactivated': 'أُعيد تفعيل الحساب.',
  'replacements.sent': 'أُرسلت دعوات البدلاء.',
  'replacements.count_or_guests':
    'حدد عدد البدلاء أو اختر الضيوف، وليس الاثنين.',
  'replacements.campaign_not_started':
    'يُرسل البدلاء بعد بدء إرسال الدعوات الأساسية.',
  'replacements.event_started': 'بدأت المناسبة، فلا يمكن إرسال بدلاء.',
  'replacements.margin_exhausted': 'استُنفد عدد الإضافات المسموح في الباقة.',
  'replacements.no_declines_available':
    'لا توجد اعتذارات كافية لم يُرسل بدلها بعد.',
  'replacements.no_reserves': 'لا يوجد ضيوف احتياطيون كافون في القائمة.',
  'replacements.guest_invalid': 'أحد الضيوف المختارين ليس احتياطياً متاحاً.',
  'whatsapp.templates_unavailable':
    'تعذّر جلب قوالب واتساب من Meta الآن، حاول بعد قليل.',
  'whatsapp.not_configured':
    'ربط واتساب غير مكتمل على الخادم (رمز الوصول أو معرّف الحساب).',
  'whatsapp.unreachable': 'تعذّر الوصول إلى Meta الآن، حاول بعد قليل.',
  'whatsapp.template_created': 'أُرسل القالب إلى Meta للمراجعة.',
  'whatsapp.template_deleted': 'تم حذف القالب من Meta.',
  'whatsapp.template_reserved':
    'هذا قالب الدعوة المستخدم في الإرسال، ولا يُنشأ أو يُحذف من لوحة التحكم.',
  'whatsapp.template_variables_invalid':
    'متغيرات نص الرسالة غير صحيحة: رقّمها {{1}} ثم {{2}}… دون تخطٍّ، وأدخل مثالاً لكل متغير، ولا تبدأ النص أو تنهه بمتغير.',
  'whatsapp.template_header_invalid':
    'العنوان والتذييل نص ثابت في سطر واحد دون متغيرات.',
  'whatsapp.template_exists':
    'يوجد في Meta قالب بهذا الاسم وهذه اللغة، أو حُذف قبل أقل من 30 يوماً.',
  'whatsapp.template_create_failed': 'رفضت Meta إنشاء القالب.',
  'whatsapp.template_delete_failed': 'تعذّر حذف القالب من Meta.',
  'user.phone_invalid':
    'رقم الجوال غير صحيح. أدخل رقماً سعودياً مثل 05XXXXXXXX.',
} as const;

export type ErrorCode = keyof typeof MESSAGES;

export const messageFor = (code: string): string =>
  (MESSAGES as Record<string, string>)[code] ?? MESSAGES['common.internal'];
