import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { startScheduler } from './scheduler.js';
import { openDb } from './store.js';
import { seedDefaultWeek } from './seed.js';
import { TursoSnapshots } from './turso-snapshots.js';

// تحميل ملف .env لو موجود (من غير مكتبات خارجية)
try {
  process.loadEnvFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'));
} catch {
  /* مفيش .env — هنكمل بمتغيرات البيئة الحالية */
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const port = Number(process.env.PORT) || 3000;
// محليًا: 127.0.0.1 (مفتوح لجهازك بس). على الاستضافة (Render بيضبط RENDER=true): 0.0.0.0 تلقائيًا.
const host = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');

// Both variables must be configured together. When Turso is selected, refuse
// to start if the token/remote database is unavailable instead of silently
// falling back to an ephemeral local database.
const useTurso = !!(process.env.TURSO_DATABASE_URL || process.env.TURSO_AUTH_TOKEN);
const snapshots = useTurso ? new TursoSnapshots({
  url: process.env.TURSO_DATABASE_URL,
  token: process.env.TURSO_AUTH_TOKEN,
  dataDir,
}) : null;
if (snapshots) {
  const status = await snapshots.init();
  console.log('[turso] Remote storage connected (' + (status.restored ? 'restored revision ' + status.version : 'initial snapshot pending') + ')');
}
const db = openDb(path.join(dataDir, 'app.db'));
if (process.env.SEED_DEMO !== 'false' && seedDefaultWeek(db)) {
  console.log('ℹ️  اتحمّل جدول الموقع القديم: 4 قنوات × 24 مهمة (الجمعة → الأربعاء). عدّله من الإعدادات.');
}

const { app, push } = createApp({ db, env: process.env, dataDir, snapshots });
// Persist seed, database and generated VAPID keys before accepting traffic.
if (snapshots) {
  await snapshots.persistIfChanged(db);
  console.log('[turso] Initial state durable, revision ' + snapshots.version);
}
startScheduler({ db, push, persist: snapshots ? () => snapshots.persistIfChanged(db) : undefined });

if (!process.env.RESET_PASSWORD) console.warn('⚠️  RESET_PASSWORD مش متضبط — بيستخدم كلمة "changeme". غيّرها في ملف .env');
if (host !== '127.0.0.1' && host !== 'localhost' && !process.env.BASIC_AUTH_USER) {
  console.warn('⚠️  السيرفر مفتوح على الشبكة من غير تسجيل دخول. ضيف BASIC_AUTH_USER و BASIC_AUTH_PASS في .env');
}

app.listen(port, host, () => {
  console.log(`✅ مدير إنتاج المحتوى شغال على http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
});
