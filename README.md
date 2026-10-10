# منصة أ/ إسماعيل عماد التعليمية

منصة تعليمية (من الصف الرابع الابتدائي إلى الثالث الثانوي): إعلانات، دروس YouTube، اختبارات بمحاولة واحدة، منظّم دراسة، مساعد ذكي، ولوحة إدارة.

## المعمارية (بدون Cloudflare وبدون Cloud Functions)

```
المتصفح ──► Firebase Hosting (ملفات ثابتة)
   ├──► Firebase Authentication (الدخول)
   └──► js/backend/*  ──► Cloud Firestore (محمي بـ firestore.rules)
```

- **الطالب** يكتب كودًا من 5 أرقام وكلمة مرور من 6 أرقام. المنصة تحوّل الكود تلقائيًا إلى بريد وهمي `الكود@students.mrismailemad.com` (لا تُرسل له رسائل) وتسجّل الدخول به عبر Firebase Authentication.
- **الأدمن** يدخل ببريده الحقيقي وكلمة مروره، ويلزم وجود مستند `admins/{uid}`.
- حساب دخول الطالب يُنشئه الأدمن مع الكود (صفحة الأكواد أو صفحة رفع الأكواد).
- رقم مستند الكود في `codes` هو **الكود نفسه**، ورقم مستند الطالب في `students` هو **uid** حسابه.
- `firestore.rules` تقفل القاعدة: الطالب لا يرى إلا بياناته، وتعطيل كود يقطع صلاحياته فورًا، والأدمن وحده يرى الأكواد وكلمات المرور.
- مجلد `worker/` هو الـ Worker القديم وغير مستخدم.

## التشغيل لأول مرة (بالترتيب)

1. **Firebase Console ← Authentication ← Sign-in method ←** فعّل **Email/Password**.
2. **Firestore Database:** أنشئ القاعدة (Production mode) إن لم تكن موجودة.
3. انشر (من Google Cloud Shell):
   ```bash
   unzip -o <اسم-الملف>.zip
   cd manasa
   npx firebase-tools login --no-localhost
   npx firebase-tools deploy --only hosting,firestore:rules --project manasty-e422d
   ```
4. افتح `https://mrismailemad.com/setup` فورًا بعد النشر، واكتب بريدك وكلمة مرور قوية، ثم **إنشاء كل الكوليكشنات**. هذا ينشئ حساب الأدمن ويُغلق إنشاء أدمن جديد.
5. **احذف** `setup.html` و`setup.js` من المشروع وأعد النشر.
6. ادخل من `/admin/login`، ثم أنشئ الأكواد (أو ارفعها من `admin/import-codes`).
7. ضع مفتاح الذكاء الاصطناعي في `settings/ai` (حقل `apiKey`).

## ملاحظات مهمة

- **الأكواد الكثيرة:** Firebase قد يوقف إنشاء الحسابات مؤقتًا لكثرة الطلبات. المنصة تُنشئ ما أمكن وتُبلغك، وأعد المحاولة بعد قليل (الأكواد المنشأة لا تتكرر).
- **التصحيح في المتصفح:** إجابات الاختبار داخل مستند الاختبار، فطالب متمرّس يستطيع قراءتها. هذا حد المعمارية بلا خادم.
- **مفتاح الذكاء الاصطناعي** يقرؤه أي طالب مفعّل. استخدم مفتاحًا مقيّدًا بالنطاق وبحصة محدودة من Google.
- لإضافة أدمن ثانٍ لاحقًا: احذف المستند `config/adminLock` من Console مؤقتًا، أو أنشئ مستند `admins/{uid}` يدويًا.
- ملفات JS و CSS تُحدَّث فورًا مع كل نشر (بدون تخزين مؤقت طويل).

## النظام البصري (هوية Editorial Learning)

- **الفكرة:** عالم الطالب المصري اليومي: ورق مربعات، حبر أزرق غامق، قلم المدرس الأحمر، وماركر أصفر.
- **الألوان:** الحبر الأزرق = الهوية والإجراء الأساسي، الأحمر = التصحيح والأخطاء، الأصفر = الإنجاز والعنصر النشط، الأخضر = «صح» والتقدّم فقط.
- **الخطوط:** عناوين بـ Alexandria، ومتن بـ IBM Plex Sans Arabic، وأرقام بـ Inter (تُحمَّل من Google Fonts).
- **الملفات:** `css/tokens.css` (كل القيم) ← `base.css` ← `components.css` (الأزرار والنماذج والبطاقات) ← `layout.css` (الهيدر والتنقل) ← `screens.css` (تصميم الصفحات). كل صفحة تحمّل `screens.css` بعد أنماطها المضمّنة.
- **قاعدة:** أي لون أو حجم جديد يُضاف أولًا كـ token في `tokens.css`، ولا تُكتب قيم ثابتة في الصفحات.

## البيانات

| المجموعة | معرّف المستند | ملاحظات |
|---|---|---|
| `codes` | الكود (5 أرقام) | `password` (6 أرقام)، `status`: unused/active/disabled، `stage`، `studentId`، `expiresAt` |
| `students` | uid الطالب | `fullName`, `stage`, `code`, `status`, `studyHoursTotal` |
| `admins` | uid الأدمن | `email`, `name`, `status` |
| `settings` | `general` / `ai` | إعدادات المنصة ومفتاح المساعد |
| `lessons`, `lessonGroups`, `lessonProgress` | تلقائي / `{uid}_{lessonId}` | |
| `announcements`, `announcementReads`, `announcementReplies` | تلقائي / `{uid}_{id}` | |
| `exams`, `examAttempts` | تلقائي / `{examId}_{uid}` | محاولة واحدة |
| `planner`, `studySessions`, `aiUsage` | `{uid}_{week}` / تلقائي / `{uid}_{day}` | |
| `subscriptionRequests` | تلقائي | يُنشأ من صفحة الاشتراك العامة |
