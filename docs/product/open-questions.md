# Open questions

**Status: unresolved unless marked.** An open question is not a licence to choose a business rule during implementation. Each has a recommended default; the default is used for design and estimation only, and the code keeps it easy to change until the answer arrives. When an answer arrives: record it as a decision in [decisions.md](decisions.md), move the row to [Resolved](#resolved), and update the owning spec and the [traceability table](scope-and-acceptance.md#traceability).

Owner = who must answer: **Client** (the business that commissioned the platform) or **Owner** (the developer/owner of this plan).

| ID | Owner | Question | Recommended default | Impact if unanswered | Blocks |
| --- | --- | --- | --- | --- | --- |
| OQ-01 | Client | Replacement rule: where do extra guests come from, and does a replacement guest's decline unlock another? | Owner supplies a reserve list with the main list; any distinct decline unlocks one reserve guest, capped by the margin ([D-16](decisions.md)) | Wrong entitlement or over-sending | P4 replacements |
| OQ-02 | Client | Does "preview" mean the owner must approve before sending? If the owner has not approved at send time, does the campaign wait or may an admin override with a reason? | Explicit approval required; admin override allowed with a recorded reason ([D-15](decisions.md)) | Disputes over wording or dates | P3 scheduling |
| OQ-03 | Client | Does one invitation mean one person, one phone number, or a family? Companions / plus-ones? | One named guest, one phone, one admission; no companions | Capacity, QR ownership, counts | P3 guest model |
| OQ-04 | Client | How does the owner send the guest list to the admin (the owner does not upload)? | Owner downloads the Excel template from the dashboard and sends it by WhatsApp or email to the operations contact, quoting the event number | Lists lost or mismatched | P3 owner instructions |
| OQ-05 | Client | Which Excel format? Arbitrary columns or one template? | One `.xlsx` template: `name`, `phone`, `type` (`initial`/`reserve`), optional `note` | A column-mapping tool is extra scope | P3 import |
| OQ-06 | Client | Hosting location (Saudi Arabia or outside), recurring budget, and who operates the server after support ends | Dedicated VPS + Compose (D-19); location chosen by the client after the PDPL transfer review | Cannot create staging/production | P1 deploy |
| OQ-07 | Client | Does the 30% demo milestone accept a sandbox (test-mode) payment? | Yes, sandbox on staging; production merchant activation is external | Milestone dispute | P2 demo |
| OQ-08 | Client | Is the 12,000 SAR price before VAT? Is the client VAT-registered? | Price excludes VAT; 15% added if applicable (quotation wording) | Invoice dispute | Signing |
| OQ-09 | Client | What does "live" mean for the dashboard? | Updates within 10 s while the page is open (NFR-05) | Subjective acceptance | P4 |
| OQ-10 | Client | Retention: how long are guest lists, phone numbers, message logs and imported files kept after the event? | Guest phones and message logs deleted or anonymised 90 days after the event; imported files deleted after apply | PDPL exposure | P5 |
| OQ-11 | Client | Support window: contact channel, response time, and whether event-day support is expected | Business-hours response within 1 working day; no on-site/event-night duty unless agreed | Unpriced obligations | Launch |
| OQ-12 | Client | The quotation is dated 2026-10-18 and valid 14 days (about 2026-11-01). Signing date and build start date? | Re-issue the quotation if signed after expiry | Price/timeline validity | Signing |
| OQ-14 | Client | WhatsApp: Meta Business verification status, dedicated number, template category assigned by Meta (utility vs marketing) and its cost, approval of the invitation and the fallback QR template | Submit both templates in P0/P1; budget as marketing until Meta assigns a category | Launch blocker; cost estimate | P1 tracer, P3 |
| OQ-15 | Owner + Client | Scanning ([D-08](decisions.md)): may a platform admin also scan for an event? What is the admission window? Is the owner comfortable that door staff use the owner's signed-in session? | Owner only; window = event start − 3 h to event start + 12 h, editable by admin per event; dedicated scan mode | Door process unclear | P4 scanner |
| OQ-16 | Client | What can the owner change after payment, and what happens on cancellation or manual refund (do QR codes stay valid)? | Edits allowed until approval; after scheduling only admin corrections; refund ⇒ event cancelled, QR codes invalid | Disputes | P2, P4 |
| OQ-17 | Client | Gregorian dates only? Venue timezone always Asia/Riyadh? | Gregorian, Asia/Riyadh | Date display/input | P2 |
| OQ-18 | Client | Are non-Saudi guest phone numbers allowed? | Saudi mobiles only (`+9665XXXXXXXX`), matching the Athar phone helper; international numbers rejected at import | Import rejects valid guests | P3 |
| OQ-19 | Client | One platform WhatsApp sender for all events (the client's number)? | Yes, one sender; per-owner senders are out of scope | Onboarding scope | P1 |
| OQ-20 | Client | Email provider for OTP (transactional SMTP service) and sender domain | SMTP via a transactional provider chosen by the client (e.g. AWS SES, Postmark); `no-reply@<domain>` | OTP delivery | P1 |
| OQ-21 | Client | Expected volume: largest event, events per day, events at the same time | Up to 1,000 guests per event; up to 10 events per day | Batch sizing, server size | P3 |
| OQ-22 | Client | RSVP finality: can a guest change their answer? Until when? | Changes allowed until the event starts, except a decline that has funded a replacement ([D-16](decisions.md)) | Counts and QR validity | P3 |
| OQ-23 | Client | QR recovery: a guest lost the message. Who may reissue, and how is the new code delivered? | Admin reissues from the guest row; new QR sent by template; old one revoked | Door delays | P4 |
| OQ-24 | Client | If the WhatsApp send time arrives and the list is not ready or approval is missing, what happens? | Campaign stays unscheduled; admin and owner see a "needs attention" state; no automatic send | Missed invitations | P3 |
| OQ-26 | Client | The owner switched sign-in to passwords ([D-27](decisions.md)); the quotation (section 02) says email code only, no passwords, no "forgot password" page. Does the client accept the change (scope/price unchanged)? | Accept: passwords + email verification + reset | Contract mismatch at acceptance | Launch |
| OQ-27 | Owner | Platform-admin MFA (TOTP) before production — required by the security review | Add TOTP for `PLATFORM_ADMIN` before launch (priced/planned separately) | Admin accounts protected by password only | P5 |
| OQ-28 | Owner | Password minimum length: 12 (chosen) or 15 (Codex/NIST recommendation for single-factor) | Keep 12 with blocklist; revisit with the client | Weaker passwords possible | P5 |

## Resolved

| ID | Question | Answer | Decision | Date |
| --- | --- | --- | --- | --- |
| — | Door-scanner identity (review point P1) | Scanning requires the authenticated event owner | [D-08](decisions.md) | 2026-10-24 |
| OQ-13 | Branding | The client's own brand kit, approved as-is | [D-29](decisions.md) | 2026-10-27 |
| OQ-25 | Admin bootstrap | Server CLI with an emailed invite link; no env allowlist, no public route | [D-28](decisions.md) | 2026-10-24 |

## Client questionnaire (Arabic)

يُرسَل هذا الاستبيان إلى العميل في مرحلة P0. لكل سؤال اقتراحنا الافتراضي؛ يكفي الرد بـ«موافق» أو كتابة البديل.

1. **الدعوات الإضافية (OQ-01):** نقترح أن يرسل صاحب المناسبة قائمة احتياطية مع القائمة الأساسية، وكل اعتذار يتيح إرسال دعوة واحدة من القائمة الاحتياطية، بحد أقصى هامش الباقة. هل توافقون؟ وهل اعتذار ضيف من القائمة الاحتياطية يتيح دعوة أخرى؟
2. **اعتماد نص الدعوة (OQ-02):** نقترح أن يعتمد صاحب المناسبة الدعوة بضغطة زر قبل الجدولة. إن لم يعتمدها، هل ننتظر أم يحق للإدارة الإرسال مع تسجيل السبب؟
3. **الضيف والمرافقون (OQ-03):** هل الدعوة لشخص واحد برقم جوال واحد ودخول واحد؟ هل هناك مرافقون؟
4. **إرسال قائمة الضيوف (OQ-04):** نقترح أن يحمّل صاحب المناسبة نموذج Excel من لوحته ويرسله عبر واتساب أو البريد مع رقم المناسبة. ما القناة المعتمدة؟
5. **نموذج Excel (OQ-05):** نموذج ثابت بالأعمدة: الاسم، رقم الجوال، النوع (أساسي/احتياطي)، ملاحظة. هل يناسبكم؟
6. **الاستضافة (OQ-06):** هل يجب أن تكون البيانات داخل المملكة؟ ما الميزانية الشهرية؟ ومن يتولى تشغيل الخادم بعد فترة الدعم؟
7. **الدفعة الثانية (OQ-07):** هل يُقبل عرض الدفع في البيئة التجريبية (Sandbox) لاستحقاق دفعة العرض التجريبي؟
8. **الضريبة (OQ-08):** هل المبلغ 12,000 ريال قبل ضريبة القيمة المضافة؟ وهل منشأتكم مسجلة في الضريبة؟
9. **التحديث المباشر (OQ-09):** هل يكفي تحديث الأرقام في لوحة صاحب المناسبة خلال 10 ثوانٍ؟
10. **مدة الاحتفاظ بالبيانات (OQ-10):** نقترح حذف أو إخفاء أرقام الضيوف وسجل الرسائل بعد 90 يوماً من المناسبة. هل توافقون؟
11. **الدعم (OQ-11):** ما قناة التواصل لفترة الدعم (14 يوماً)؟ وهل تتوقعون دعماً ليلة المناسبة؟
12. **صلاحية العرض (OQ-12):** العرض صالح حتى 1 نوفمبر 2026 تقريباً. ما تاريخ التوقيع المتوقع؟
13. **الهوية البصرية (OQ-13):** هل المنصة تحت علامة «أثر» وهويتها، أم بهوية خاصة بكم؟ نرجو تزويدنا بالشعار والألوان.
14. **واتساب (OQ-14, OQ-19):** هل حساب Meta Business موثّق؟ ما الرقم المخصص لواتساب الأعمال؟ سنقدّم قالب الدعوة وقالب إرسال رمز QR للاعتماد مبكراً.
15. **المسح عند الدخول (OQ-15):** يتم المسح من حساب صاحب المناسبة بعد تسجيل دخوله على جهاز المسح. هل يحق للإدارة المسح أيضاً؟ ونقترح أن يعمل المسح من قبل المناسبة بـ3 ساعات حتى 12 ساعة بعد بدايتها.
16. **التعديل والإلغاء (OQ-16):** ما الذي يمكن لصاحب المناسبة تعديله بعد الدفع؟ وعند الإلغاء أو الاسترجاع اليدوي هل تُلغى رموز QR؟
17. **التاريخ والتوقيت (OQ-17):** هل نعتمد التاريخ الميلادي وتوقيت الرياض فقط؟
18. **أرقام الجوال (OQ-18):** هل نقبل أرقاماً غير سعودية؟
19. **البريد الإلكتروني (OQ-20):** ما مزود البريد وما النطاق المرسل لرموز التحقق؟
20. **حجم الاستخدام (OQ-21):** ما أكبر عدد ضيوف متوقع لمناسبة واحدة؟ وكم مناسبة في اليوم؟
21. **تغيير الرد (OQ-22):** هل يحق للضيف تغيير رده؟ وحتى متى؟
22. **فقدان رمز QR (OQ-23):** نقترح أن تعيد الإدارة إصدار الرمز ويُلغى القديم. هل توافقون؟
23. **موعد الإرسال (OQ-24):** إذا حان موعد الإرسال والقائمة غير جاهزة أو الدعوة غير معتمدة، نقترح عدم الإرسال وإظهار تنبيه. هل توافقون؟
