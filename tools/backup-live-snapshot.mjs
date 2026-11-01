import fs from 'node:fs';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

// Read-only API snapshot, encrypted before upload. Private decryption key is NOT in this repository.
const BASE = 'https://sharif-gc4c.onrender.com';
const PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----\nMIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAoHTJ8TGKSbiQDdgYhvNu\n0S+ldvwNRiNlnJ5nxr4hDkVq7AfvFHhAWivkJz+GT9YzvkOYSe/52OFZJGCcIN6g\nF5gfUV2HOGxlPwDukKa5nDzSaIBTxCtYZRB/zSSf0TG4PfZWu48iNyKeWUJICKIG\ntjkD5jh3cvGwLrdBp7+CRhrnCjWzB/KtPT8VQrupkMuRXQWyb/3O2tXY4Aq8US+a\nulTbApxGkyOA2ZNiGiUccs9BPMW/y0938WoNRNa2kIfnlslomxORwuP2xqW6xmdh\nO9jTRnqSzQuOVQgdnbXqXKTqyd+Z4+pEzxCA2f46y2vR1kt+0H6qlojcPytJptR0\n8HWkpuAozEg/v1x0+K1Q6sjhR2YZeZ9dQUxPT0+XXmTZyrvId/Lf+y3T+/8P5lYO\nxniMIrrWLJqdl16rHyVqA8bm25Rb7g5Q2V2vMekf0ZRZcZ3ldhny7FRg51zsHlxN\nL8KrbtrUwMPWtG9E7Ccr4NqqzjJT/1svXt5gZox5rOBRAgMBAAE=\n-----END PUBLIC KEY-----';
const sleep = ms => new Promise(r=>setTimeout(r,ms));
async function get(path, json = true) {
  let problem;
  for(let n=0;n<5;n++){
    try {
      const r=await fetch(BASE+path,{signal:AbortSignal.timeout(55000)});
      if(!r.ok)throw new Error('HTTP '+r.status+' for '+path);
      return json?await r.json():Buffer.from(await r.arrayBuffer());
    } catch(e){problem=e;if(n<4)await sleep((n+1)*4500);}
  }
  throw new Error('Backup unavailable: '+path+': '+problem);
}
function addDays(d,n){const x=new Date(d+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);}
function startOfWeek(d,w){const day=new Date(d+'T00:00:00Z').getUTCDay();return addDays(d,-((day-w+7)%7));}
const [health,current,history,bank,settings,channels,template]=await Promise.all([
  get('/api/health'),get('/api/state'),get('/api/history'),get('/api/bank'),
  get('/api/settings'),get('/api/channels'),get('/api/template')
]);
if(!health?.ok||!Array.isArray(current?.entries)||!Array.isArray(history?.weeks)||!Array.isArray(bank)||!Array.isArray(channels)||!Array.isArray(template))
  throw new Error('Incomplete essential API responses');
const dates=new Set(history.weeks.map(x=>x.week_start));
for(let d=startOfWeek('2026-01-01',settings.weekStartDay);d<current.currentWeekStart;d=addDays(d,7))dates.add(d);
const weeks={};
const ordered=[...dates].filter(d=>d&&d<current.currentWeekStart).sort();
for(let i=0;i<ordered.length;i+=4){
  const group=await Promise.all(ordered.slice(i,i+4).map(async d=>({d,s:await get('/api/state?week='+d)})));
  for(const {d,s} of group){if(s.entries?.length||history.weeks.some(w=>w.week_start===s.weekStart))weeks[s.weekStart]=s;}
}
weeks[current.weekStart]=current;
const urls=new Set(Object.values(weeks).flatMap(w=>w.entries||[]).map(e=>e.thumb_url).filter(Boolean));
const images={};
for(const url of urls){
  if(!/^\/thumbs\/[A-Za-z0-9._-]+$/.test(url))throw new Error('Unexpected thumbnail path');
  const bytes=await get(url,false);
  if(!bytes.length||bytes.length>20*1024*1024)throw new Error('Invalid thumbnail');
  images[url]=bytes.toString('base64');
}
const snapshot={format:'Creator OS logical HTTP backup v1', capturedAt:new Date().toISOString(),url:BASE,
  limitations:['Not a raw SQLite backup; push subscription data and unlimited reset history are inaccessible from the read-only API','Only weeks from January 2026 onward are scanned'],
  health,current,history,bank,settings,channels,template,weeks,thumbnails:images};
const zipped=zlib.gzipSync(Buffer.from(JSON.stringify(snapshot)),{level:9});
const aes=crypto.randomBytes(32),iv=crypto.randomBytes(12);
const cipher=crypto.createCipheriv('aes-256-gcm',aes,iv);
const encrypted=Buffer.concat([cipher.update(zipped),cipher.final()]);
const key=crypto.publicEncrypt({key:PUBLIC_KEY,padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},aes);
const bundle={format:'Sharif-Backup-Encrypted-v1',compression:'gzip',cipher:'aes-256-gcm',keywrap:'rsa-oaep-sha256',
  wrappedKey:key.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),
  ciphertext:encrypted.toString('base64')};
fs.writeFileSync('sharif-live-snapshot.enc.json',JSON.stringify(bundle));
const entries=Object.values(weeks).flatMap(x=>x.entries||[]);
const manifest={capturedAt:snapshot.capturedAt,currentWeek:current.weekStart,weeksWithEntries:Object.keys(weeks).length,
  entries:entries.length,entriesWithScripts:entries.filter(x=>x.script?.trim()).length,
  entriesWithNotes:entries.filter(x=>x.notes?.trim()).length,bankScripts:bank.length,
  thumbnails:urls.size,channels:channels.length,templateTasks:template.length,
  bundleSha256:crypto.createHash('sha256').update(JSON.stringify(bundle)).digest('hex')};
fs.writeFileSync('sharif-live-snapshot-summary.json',JSON.stringify(manifest,null,2));
console.log('ENCRYPTED_BACKUP_VERIFIED '+JSON.stringify(manifest));
