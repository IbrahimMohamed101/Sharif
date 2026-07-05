# جدول الإنتاج الأسبوعي - Full Stack

هذا المشروع هو تطبيق متكامل (Full-Stack) لإدارة جدول الإنتاج الأسبوعي، مبني باستخدام Node.js و Express مع قاعدة بيانات PostgreSQL على منصة Neon.

## المتطلبات
- Node.js (v16 أو أحدث)
- حساب على [Neon](https://neon.tech) لإنشاء قاعدة بيانات PostgreSQL

## إعداد المشروع محلياً

1. قم بتثبيت الحزم المطلوبة للـ Backend:
   ```bash
   cd backend
   npm install
   ```

2. قم بإعداد متغيرات البيئة:
   انسخ ملف `.env.example` إلى `.env` وأضف رابط الاتصال بقاعدة البيانات الخاصة بك من Neon:
   ```bash
   cp .env.example .env
   ```
   *محتوى `.env` يجب أن يكون شبيهاً بـ:*
   ```env
   DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
   PORT=3000
   ```

3. تهيئة قاعدة البيانات (Migrations):
   حالياً يمكنك تشغيل ملف `src/db/migrations/001_init.sql` مباشرة في وحدة تحكم SQL الخاصة بـ Neon (أو باستخدام أداة مثل `psql` أو DBeaver) لإنشاء الجداول والبيانات الافتراضية.

4. تشغيل الخادم المحلي:
   ```bash
   npm run dev
   # أو
   node server.js
   ```

5. افتح المتصفح على العنوان `http://localhost:3000` لاستخدام التطبيق.

## النشر على Render أو Railway

1. قم برفع المشروع إلى مستودع GitHub.
2. في Render/Railway، قم بإنشاء خدمة Web جديدة واربطها بالمستودع.
3. الإعدادات المطلوبة للخدمة:
   - **Root Directory**: `backend` (أو اتركه فارغاً مع تعديل أمر البناء)
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
4. أضف متغير البيئة (Environment Variable) في المنصة:
   - `DATABASE_URL`: رابط الاتصال بقاعدة البيانات الخاصة بك على Neon.

**تنبيه أمني:**
- لم يتم وضع أي مفاتيح حقيقية في الكود.
- كلمة المرور `ACTION_PASSWORD` مشفرة ومحفوظة في قاعدة البيانات كـ Hash باستخدام Bcrypt.
- يجب ألا تقوم برفع ملف `.env` إلى GitHub أبداً.
# working
