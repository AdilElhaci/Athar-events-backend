# Guest journey WhatsApp templates (T-P6-02)

Drafts for Meta submission, from the client brief §05–06 ([SP-07](../specs/SP-07-guest-journeys.md)). Language `ar`, category **UTILITY**. Meta does not accept a variable at the very start or end of the body, so some lines are reworded slightly from the brief. The **image header** templates cannot be created from the dashboard yet (D-41 supports text headers only): create them in WhatsApp Manager with any sample image; the platform sends the guest's QR card as the header image.

M03 (apology) is not a template: it is free text sent inside the 24 h window opened by the guest's decline.

## athar_followup (M04, follow-up 1)

- Header: none
- Body:

```
أهلًا بكم

سبق أن تشرفنا بدعوتكم إلى {{1}} بتاريخ {{2}}، ويسعدنا معرفة إمكانية حضوركم لاستكمال ترتيبات الاستقبال.
```

- Examples: `{{1}}` حفل زواج محمد وسارة · `{{2}}` الخميس 31 ديسمبر 2026
- Buttons (quick reply): «تأكيد الحضور» · «الاعتذار»

## athar_followup_final (M05, follow-up 2)

```
تذكير أخير بكل ود

يسعدنا تلقي ردكم على دعوة {{1}} قبل {{2}}، حتى نستكمل ترتيبات استقبال الضيوف.

شاكرين لكم وقتكم وتقديركم.
```

- Examples: `{{1}}` حفل زواج محمد وسارة · `{{2}}` الثلاثاء 29 ديسمبر الساعة 6:00 م
- Buttons (quick reply): «تأكيد الحضور» · «الاعتذار»

## athar_reminder (M06, reminder 1)

- Header: **image**
- Body:

```
اقترب موعد لقائنا بكم

يسرّنا تذكيركم بمناسبة {{1}} يوم {{2}} الساعة {{3}}.

الموقع: {{4}}
رمز الدخول الخاص بكم في الصورة أعلاه.

نتطلع إلى تشريفكم.
```

- Examples: `{{1}}` حفل زواج محمد وسارة · `{{2}}` الخميس 31 ديسمبر 2026 · `{{3}}` 8:00 م · `{{4}}` https://maps.app.goo.gl/example

## athar_reminder_final (M07, final reminder)

- Header: **image**
- Body (`{{1}}` is «اليوم» or «غدًا»):

```
نذكّركم بأن {{1}} موعد لقائنا بكم

يسعدنا استقبالكم في {{2}}، الساعة {{3}}.

الموقع: {{4}}
رمز الدخول الخاص بكم في الصورة أعلاه.

نتشرف بحضوركم، ونتمنى لكم وصولًا ميسرًا.
```

- Examples: `{{1}}` اليوم · `{{2}}` حفل زواج محمد وسارة · `{{3}}` 8:00 م · `{{4}}` https://maps.app.goo.gl/example

## athar_thanks (M08, thank-you)

```
بحضوركم اكتملت فرحتنا، وبمشاركتكم أصبحت لحظاتنا أجمل

شكرًا لتشريفكم ومشاركتنا {{1}}، ونسأل الله أن تدوم الأفراح وتجمعنا بكم دائمًا على خير.
```

- Example: `{{1}}` حفل زواج محمد وسارة
- Meta may reclassify it as MARKETING (higher price).

## athar_confirmation (M02 when the 24 h window has closed)

Used when an admin accepts a late reply (`REVIEW`) or a QR must be re-sent after the window. Inside the window M02 goes as an image with this text as the caption.

- Header: **image**

```
يسعدنا تأكيد حضوركم مناسبة {{1}}

{{2}} | {{3}}
الموقع: {{4}}
رمز الدخول الخاص بكم في الصورة أعلاه.

نتشرف بلقائكم، ونرجو الاحتفاظ بهذه الرسالة لتسهيل الاستقبال.
```

- Examples: `{{1}}` حفل زواج محمد وسارة · `{{2}}` الخميس 31 ديسمبر 2026 · `{{3}}` 8:00 م · `{{4}}` https://maps.app.goo.gl/example

## M03 apology (free text, not submitted)

```
كنا نتمنى مشاركتكم هذه المناسبة الجميلة، ولكن نقدّر ظروفكم ونعذركم بكل ود.

شكرًا لتفاعلكم، ونسأل الله أن تجمعنا بكم مناسبات سعيدة قادمة.
```
