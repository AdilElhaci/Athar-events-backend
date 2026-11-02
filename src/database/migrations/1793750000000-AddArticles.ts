import { MigrationInterface, QueryRunner } from 'typeorm';

/** The five launch guides, moved here from the web app's static copy (ART-01 to ART-05). */
const ARTICLES = [
  {
    slug: 'guest-list',
    title: 'من أول اسم إلى آخر ضيف: قائمة تُريح بالك',
    excerpt:
      'قائمة الضيوف هي نقطة البداية لكل قرار: حجم القاعة، وعدد الدعوات، وطريقة الاستقبال. القليل من الترتيب المبكر يمنحك صورة أوضح ويخفف التعديلات في اللحظة الأخيرة.',
    category: 'تخطيط المناسبات',
    readingMinutes: 4,
    coverUrl: '/articles/guest-list.png',
    coverAlt: 'دفتر مفتوح وبطاقات أسماء فارغة وقلم على طاولة رخامية',
    sections: [
      {
        heading: 'ابدأ بقائمة واحدة',
        body: 'اجمع الأسماء في ملف موحّد بدل توزيعها بين المحادثات والملاحظات. خصّص أعمدة للاسم ورقم الجوال وفئة الضيف وعدد الأشخاص المشمولين بالدعوة. استخدم طريقة كتابة واحدة للأسماء، وراجع الأرقام مع مفتاح الدولة قبل تسليم القائمة لفريق التشغيل.',
      },
      {
        heading: 'افصل الأساسي عن الاحتياطي',
        body: 'رتّب قائمة أساسية تناسب سعة المناسبة، وأخرى احتياطية يمكن الرجوع إليها عند الاعتذار. لا تعامل عدم الرد باعتباره اعتذارًا. حدّد مع فريق التشغيل موعد المراجعة وكيفية التعامل مع الردود المتأخرة، حتى تبقى القرارات واضحة للجميع.',
      },
      {
        heading: 'راجع قبل الإرسال',
        body: 'اختر عيّنة من الأسماء والأرقام وراجعها، ثم افحص التكرار والخانات الناقصة. اعتمد نسخة نهائية بتاريخ واضح، وأرسل أي تعديل لاحق بوصفه تحديثًا محددًا. هذا التنظيم البسيط يقلل الدعوات المكررة ويجعل متابعة المناسبة أسهل.',
      },
    ],
    takeaway: 'قائمة واحدة، أرقام مراجَعة، ومسؤول واضح عن التحديثات.',
  },
  {
    slug: 'whatsapp-message',
    title: 'رسالة واتساب تشبه مناسبتك وتُجيب عن أسئلة ضيفك',
    excerpt:
      'الدعوة الجميلة تحمل مشاعر المضيف، وتمنح الضيف ما يحتاجه لاتخاذ قراره. اجعل الرسالة دافئة ومباشرة، واجمع التفاصيل الأساسية في موضع واحد يسهل الرجوع إليه.',
    category: 'آداب الدعوة',
    readingMinutes: 3,
    coverUrl: '/articles/message.png',
    coverAlt: 'بطاقة دعوة بيضاء ومغلّف عنابي وغصن ورد مجفف',
    sections: [
      {
        heading: 'ابدأ باسم الضيف',
        body: 'التحية الشخصية تمنح الدعوة اهتمامًا واضحًا. اذكر اسم المناسبة والمضيف، ثم انتقل إلى التفاصيل دون مقدمة طويلة. راجع صيغة المخاطبة والأسماء قبل اعتماد الرسالة، خصوصًا عند إرسالها إلى فئات مختلفة من الضيوف.',
      },
      {
        heading: 'اكتب التفاصيل بوضوح',
        body: 'اذكر اليوم والتاريخ والوقت واسم القاعة والمدينة. وضّح عدد الأشخاص المشمولين بالدعوة وأي ملاحظة مهمة للاستقبال. إذا أضفت رابط موقع، اختبره على الجوال وتأكد أنه يقود إلى المدخل المناسب.',
      },
      {
        heading: 'اطلب ردًا بسيطًا',
        body: 'اجعل تأكيد الحضور أو الاعتذار خطوة واضحة، مع موعد مفضّل للرد. أخبر الضيف بما سيحدث بعد التأكيد، مثل استلام رمز الدخول. جرّب الرسالة من منظور الضيف قبل الإرسال، وتأكد أن معناها يظل كاملًا حتى دون الصورة.',
      },
    ],
    takeaway: 'تحية شخصية، تفاصيل كاملة، وخطوة واحدة واضحة للرد.',
  },
  {
    slug: 'invitation-timing',
    title: 'متى ترسل الدعوة والتذكير؟ رتّب توقيتك بهدوء',
    excerpt:
      'لا يوجد توقيت واحد يناسب كل المناسبات. المسافة، وحجم المناسبة، وسفر الضيوف عوامل تؤثر في موعد الدعوة. الأهم أن تمنح ضيفك وقتًا مناسبًا، وأن تنسّق المتابعة دون إلحاح.',
    category: 'متابعة الحضور',
    readingMinutes: 4,
    coverUrl: '/articles/timing.png',
    coverAlt: 'بطاقة دعوة وشريط عنابي وقلم بجانب ورود في ضوء الغروب',
    sections: [
      {
        heading: 'ابدأ من احتياج ضيوفك',
        body: 'إذا احتاج بعض الضيوف إلى سفر أو ترتيب إجازة، اجعل إبلاغهم مبكرًا ضمن خطتك. اتفق مع فريق التشغيل على موعد الإرسال بعد اعتماد التفاصيل والقائمة. تجنب إرسال دعوة ناقصة ثم تصحيح المكان أو الوقت عبر رسائل متفرقة.',
      },
      {
        heading: 'حدّد موعدًا لمراجعة الردود',
        body: 'اختر نقطة مراجعة قبل المناسبة تتسع لترتيب الضيافة والاستقبال. عندها راجع من أكد، ومن اعتذر، ومن لم يرد بعد. حافظ على تمييز هذه الحالات، ولا تحوّل الضيف تلقائيًا إلى قائمة الاعتذار بسبب تأخر الرد.',
      },
      {
        heading: 'اجعل التذكير مفيدًا',
        body: 'رسالة التذكير الأفضل تحمل فائدة: موعد الاستقبال، رابط الموقع، أو طريقة العثور على بطاقة الدخول. نسّقها مع الفريق، واحترم اعتذارات الضيوف. بعد تغيير أي تفصيل أساسي، تأكد أن المعلومات الجديدة واضحة لدى من أكد حضوره.',
      },
    ],
    takeaway: 'خطط حسب ضيوفك، وراجع الردود، واجعل كل تذكير ذا فائدة.',
  },
  {
    slug: 'qr-at-the-door',
    title: 'رمز QR عند الباب: تفاصيل صغيرة لاستقبال أسلس',
    excerpt:
      'رمز الدخول يساعد فريق الاستقبال على العثور على الدعوة والتحقق من حالتها بسرعة. وتبقى التجربة الناجحة مرتبطة باستعداد الفريق ووضوح الإجراءات، خصوصًا عند وصول عدة ضيوف في وقت واحد.',
    category: 'الاستقبال والدخول',
    readingMinutes: 3,
    coverUrl: '/articles/qr.png',
    coverAlt: 'يد تقدّم بطاقة دخول عند مدخل قاعة مضاءة',
    sections: [
      {
        heading: 'هيّئ نقطة الاستقبال',
        body: 'حدّد مكانًا واضحًا قبل المدخل، وجهّز الأجهزة وشحنها واتصالها. جرّب المسح قبل وصول الضيوف وتأكد أن الفريق اختار المناسبة الصحيحة. وزّع الأدوار بين الترحيب والمسح ومعالجة الحالات التي تحتاج مراجعة.',
      },
      {
        heading: 'ساعد الضيف على الاستعداد',
        body: 'أخبر الضيف أين يجد رمزه، واطلب إبراز البطاقة عند الوصول. اجعل الإرشاد قصيرًا وواضحًا. إذا تعذّر فتح الرمز، يتعامل الفريق مع الحالة وفق إجراء بديل متفق عليه بدل تعطيل الصف أو اتخاذ قرار عشوائي.',
      },
      {
        heading: 'اتفق على الحالات الخاصة',
        body: 'وضّح مسبقًا كيفية التعامل مع رمز مستخدم سابقًا، أو رمز يخص مناسبة أخرى، أو اختلاف الاسم. لا تشارك بطاقة ضيف مع آخر. امنح مسؤولًا محددًا صلاحية معالجة الاستثناءات حتى يحافظ الفريق على الترحيب والتنظيم معًا.',
      },
    ],
    takeaway:
      'جرّب الأجهزة مسبقًا، وحدّد الأدوار، وجهّز إجراءً واضحًا للاستثناءات.',
  },
  {
    slug: 'guest-comfort',
    title: 'من الدعوة إلى الوصول: خمس لمسات تجعل ضيفك مطمئنًا',
    excerpt:
      'يتذكر الضيف شعوره بسهولة التفاصيل، بقدر ما يتذكر جمال المكان. حين يعرف متى يصل، وأين يتجه، وكيف يؤكد حضوره، تبدأ الضيافة قبل دخوله إلى القاعة.',
    category: 'تجربة الضيف',
    readingMinutes: 4,
    coverUrl: '/articles/guest.png',
    coverAlt: 'دلة قهوة وفناجين وتمر على طاولة ضيافة',
    sections: [
      {
        heading: 'قلّل البحث والسؤال',
        body: 'اجمع الموعد والمكان ورابط الوصول وطريقة التأكيد في رسالة واضحة. استخدم أسماء أماكن مألوفة، واختبر الرابط بنفسك. إذا كان للقاعة أكثر من مدخل، اذكر المدخل المقصود في التذكير بدل ترك الضيف يسأل عند الوصول.',
      },
      {
        heading: 'اجعل الرد مرحّبًا',
        body: 'بعد تأكيد الحضور، أرسل رسالة قصيرة تؤكد استلام الرد وتشرح الخطوة التالية. وعند الاعتذار، اشكر الضيف دون تكرار طلب التأكيد. حافظ على نبرة واحدة بين الدعوة والتذكير والاستقبال لتبدو الرحلة مترابطة.',
      },
      {
        heading: 'استعد لليوم نفسه',
        body: 'تأكد أن فريق الاستقبال يعرف تفاصيل المناسبة والحالات الخاصة. اجعل قناة المساعدة سهلة الوصول، ووفّر توجيهًا واضحًا عند المدخل. بعد المناسبة، يمكن إرسال كلمة شكر دافئة بالاتفاق مع المضيف، لتختتم التجربة بنفس العناية التي بدأت بها.',
      },
    ],
    takeaway: 'معلومة واضحة، رد لطيف، وصول سهل، استقبال جاهز، وكلمة شكر.',
  },
];

/** Article management (expand-only: new tables). Newest first keeps the existing homepage order. */
export class AddArticles1793750000000 implements MigrationInterface {
  name = 'AddArticles1793750000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."articles_status_enum" AS ENUM('DRAFT', 'PUBLISHED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "articles" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "slug" character varying(120) NOT NULL, "title" character varying(160) NOT NULL, "excerpt" character varying(600), "category" character varying(60), "reading_minutes" integer, "cover_url" character varying(200), "cover_alt" character varying(200), "sections" jsonb NOT NULL DEFAULT '[]', "takeaway" character varying(400), "status" "public"."articles_status_enum" NOT NULL DEFAULT 'DRAFT', "published_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_articles_slug" UNIQUE ("slug"), CONSTRAINT "CHK_articles_published_complete" CHECK ("status" <> 'PUBLISHED' OR ("published_at" IS NOT NULL AND "excerpt" IS NOT NULL AND "category" IS NOT NULL AND "reading_minutes" IS NOT NULL AND "cover_url" IS NOT NULL AND "cover_alt" IS NOT NULL AND "takeaway" IS NOT NULL AND jsonb_array_length("sections") > 0)), CONSTRAINT "PK_articles" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_articles_status_published_at" ON "articles" ("status", "published_at")`,
    );
    await queryRunner.query(
      `CREATE TABLE "article_images" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "data" bytea NOT NULL, "content_type" character varying(20) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_article_images" PRIMARY KEY ("id"))`,
    );
    for (const [index, article] of ARTICLES.entries()) {
      await queryRunner.query(
        `INSERT INTO "articles" ("slug", "title", "excerpt", "category", "reading_minutes", "cover_url", "cover_alt", "sections", "takeaway", "status", "published_at") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PUBLISHED', now() - make_interval(mins => $10::int))`,
        [
          article.slug,
          article.title,
          article.excerpt,
          article.category,
          article.readingMinutes,
          article.coverUrl,
          article.coverAlt,
          JSON.stringify(article.sections),
          article.takeaway,
          index,
        ],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "article_images"`);
    await queryRunner.query(`DROP TABLE "articles"`);
    await queryRunner.query(`DROP TYPE "public"."articles_status_enum"`);
  }
}
