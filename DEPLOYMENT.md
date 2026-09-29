# نشر LVFR EMS باستخدام Google Apps Script

لا يستخدم المشروع Render أو VPS. الواجهة PWA ثابتة على Cloudflare Pages، ويعمل Google Apps Script كواجهة API مشتركة تتصل بجداول Google. رابطا النشر اللذان زودتني بهما:

- Pages: `https://lvfr-ems.pages.dev/`
- Apps Script Web App: `https://script.google.com/macros/s/AKfycbyBdjIEgSN1LZButFPrJA1C9_6w3xClnX370rDRic7fMqkVKsjw5uw0EX8gw4vO-Tav/exec`

Apps Script خدمة Google سحابية؛ هذا التصميم لا يحتاج إلى خادم VPS أو Render، لكنه يحتاج إنترنت حتى تتزامن الأجهزة.

## حالة النقل

نُقلت إلى `apps-script/Code.gs` واجهات Google OAuth، طلب الحساب الجديد وموافقته وإدارة أدوار الحسابات، قراءة roster وملفات الأعضاء، التدريب والاختبارات والنشاط والملاحظات والتواريخ، سجل المناوبات، وبعض عمليات الترقية وتغيير الرتبة. تُكتب سجلات التطبيق والحسابات في الجدول الخاص. صلاحية مستخدمي القيادة لجدول roster تُفحص قبل إرجاع بياناته.

هناك نقاط لم تصل بعد إلى تطابق كامل مع خادم Python السابق: التنبيهات تعيد قائمة فارغة، وبعض تفاصيل سجل المناوبات والترقيات قد تختلف، ولا توجد قناة SSE؛ تحديث roster في الصفحة يتم كل 15 ثانية. لم أتمكن من الاتصال بخدمتي Google أو Cloudflare من بيئة العمل، لذلك لم أتحقق من النشر الحي. لا تعتمد النسخة التشغيلية قبل رفع إصدار Apps Script أدناه وتجربة مسارات الاستخدام في موقع Pages.

## تحديث نشر Apps Script الحالي

لأنك أنشأت المشروع ونشرته بالفعل، لا تنشئ مشروعًا جديدًا:

1. افتح مشروع Apps Script المرتبط برابط `/exec` أعلاه.
2. استبدل محتوى `Code.gs` بالمحتوى الحالي من `apps-script/Code.gs`، وتأكد أن manifest يتضمن الصلاحيات الموجودة في `apps-script/appsscript.json`.
3. من **Deploy → Manage deployments** عدّل نشر Web App، واختر **New version** ثم **Deploy**. أبقِ التنفيذ **Execute as: Me**.
4. أضف في Google Cloud OAuth Authorized JavaScript origins هذا الأصل حرفيًا: `https://lvfr-ems.pages.dev`.
5. تأكد أن خصائص Apps Script ما زالت تحتوي `LVFR_ROSTER_SPREADSHEET_ID` و`LVFR_PRIVATE_SPREADSHEET_ID`، وأن حساب مالك Apps Script يستطيع فتح الجدولين.
6. في الجدول الخاص، احتفظ بتبويب `Accounts`، وأضف العمود M باسم `Google Email` والعمود N باسم `Google Sub`. بريد Google في M يربط الحساب الموجود أو الحساب الجديد. لا تشارك الجدول الخاص مع أعضاء التطبيق.
7. تأكد أن Google Drive API مفعّل في مشروع Cloud المرتبط، وأن القادة المعتمدين لديهم صلاحية **Editor** على جدول roster. أعضاء Watch Command لا يحتاجون إلى مشاركة الجدول معهم.

## تحديث Cloudflare Pages

انشر أحدث ملفات المشروع من مجلد العمل. يجب أن يصل مجلد `functions/` إلى جذر مستودع Pages ليعمل وسيط API، وأن يكون Build command هو `python build_static.py` ومجلد الإخراج `dist`. يرسل وسيط Pages طلبات `/api/*` و`/auth/*` إلى رابط Apps Script أعلاه؛ يمكن ضبط `GAS_WEB_APP_URL` كمتغير Pages لتجاوز الرابط الافتراضي في `functions/[[path]].js`.

## نقاط لازمة قبل الاستخدام

- OAuth Client ID موجود في `static/public-config.js`، وهو معرف عام. لا تضع OAuth Client Secret أو ملف حساب الخدمة في ملفات `static/` أو `dist/`.
- عند طلب حساب جديد، يجب أن يطابق Callsign موجودًا في roster؛ يوافق Commander عليه من إدارة الحسابات.
- رمز Google يبقى في `sessionStorage` حتى تنتهي جلسة المتصفح أو صلاحية الرمز.
- مجلد `dist/` جُدّد من ملفات `static/`. لم أتمكن من تشغيل `python build_static.py` مباشرة لأن Python غير قابل للتشغيل في بيئة العمل الحالية.
