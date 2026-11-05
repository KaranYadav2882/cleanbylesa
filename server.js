// Single-server account, booking, and Zelle request portal. Requires Node 22+.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(process.env.DB_PATH || path.join(DATA_DIR, 'cleanbylesa.sqlite'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL, phone TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'customer',
    password_salt TEXT NOT NULL, password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    service_type TEXT NOT NULL, package_name TEXT NOT NULL, frequency TEXT NOT NULL,
    preferred_date TEXT, preferred_window TEXT NOT NULL,
    add_ons TEXT NOT NULL DEFAULT '[]', address TEXT NOT NULL, city TEXT NOT NULL,
    zip_code TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'not_scheduled',
    quote_amount_cents INTEGER, payment_status TEXT NOT NULL DEFAULT 'not_paid',
    payment_reference TEXT NOT NULL DEFAULT '', payment_submitted_at TEXT,
    zelle_recipient TEXT NOT NULL DEFAULT '', admin_message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS booking_files (
    id TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('booking_photo','payment_proof')),
    stored_name TEXT NOT NULL, original_name TEXT NOT NULL, mime_type TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS bookings_user_idx ON bookings(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS bookings_status_idx ON bookings(status, created_at DESC);
`);
// Collapse the old quote/payment workflow into the simpler two-state deposit flow.
db.exec("UPDATE bookings SET payment_status=CASE WHEN payment_status='confirmed' THEN 'paid' ELSE 'not_paid' END WHERE payment_status NOT IN ('paid','not_paid')");
db.exec("UPDATE bookings SET status=CASE WHEN status IN ('scheduled','completed') THEN 'scheduled' ELSE 'not_scheduled' END WHERE status NOT IN ('scheduled','not_scheduled')");

const secretFile=path.join(DATA_DIR,'.session-secret');
let SESSION_SECRET=process.env.SESSION_SECRET;
if(!SESSION_SECRET){try{SESSION_SECRET=fs.readFileSync(secretFile,'utf8').trim()}catch{SESSION_SECRET=crypto.randomBytes(48).toString('hex');fs.writeFileSync(secretFile,SESSION_SECRET,{mode:0o600})}}
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'cleanbylesa@gmail.com').trim().toLowerCase();
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'};
const allowed = {
  services: ['Residential','Commercial'], packages: ['Standard','Semi-Deep','Deep','Custom'],
  frequencies: ['One-time','Daily','Multiple times weekly','Weekly','Bi-weekly','Monthly'],
  windows: ['Morning (8 AM–12 PM)','Afternoon (12 PM–4 PM)','Flexible','After-hours'],
  addons: ['Interior Refrigerator','Interior Oven','Interior Cabinets','Interior Windows','Baseboards','Wall Washing','Blinds','Linen Change','Pet Hair Removal (heavy shedding)','Steam Cleaning','Disinfection & Sanitizing','Decluttering/Organizing','Reorganization'],
  statuses: ['not_scheduled','scheduled'],
  payments: ['not_paid','paid']
};
function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}
function safeEqual(a,b){const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y)}
function sessionToken(userId){const exp=Date.now()+7*24*60*60*1000;const payload=`${userId}.${exp}`;const sig=crypto.createHmac('sha256',SESSION_SECRET).update(payload).digest('base64url');return `${payload}.${sig}`}
function currentUser(req){
  const raw=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('clean_session='))?.slice('clean_session='.length);
  if(!raw)return null;const [id,exp,sig]=decodeURIComponent(raw).split('.');if(!id||!exp||!sig||Number(exp)<Date.now())return null;
  const expect=crypto.createHmac('sha256',SESSION_SECRET).update(`${id}.${exp}`).digest('base64url');if(!safeEqual(sig,expect))return null;
  return db.prepare('SELECT id,email,name,phone,role FROM users WHERE id=?').get(id)||null;
}
function send(res,status,body,extra={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'same-origin',...extra});res.end(JSON.stringify(body))}
function fail(res,status,message){send(res,status,{error:message})}
function setSession(res,user){res.setHeader('Set-Cookie',`clean_session=${encodeURIComponent(sessionToken(user.id))}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${process.env.NODE_ENV==='production'?'; Secure':''}`)}
function clearSession(res){res.setHeader('Set-Cookie',`clean_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${process.env.NODE_ENV==='production'?'; Secure':''}`)}
function isSameSite(req){const origin=req.headers.origin;if(!origin)return false;try{return new URL(origin).host===req.headers.host&&['http:','https:'].includes(new URL(origin).protocol)}catch{return false}}
async function readJson(req,maxBytes=1024*1024){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>maxBytes)throw Error('Request too large')}return raw?JSON.parse(raw):{}}
function requiredText(v,max=500){return typeof v==='string'?v.trim().slice(0,max):''}
function bookingView(b){return {...b,add_ons:JSON.parse(b.add_ons||'[]')}}
function runTransaction(callback){db.exec('BEGIN IMMEDIATE');try{const result=callback();db.exec('COMMIT');return result}catch(error){try{db.exec('ROLLBACK')}catch{}throw error}}
function parseImageUpload(file,maxBytes=5*1024*1024){
  if(!file||typeof file.data!=='string')throw Error('Choose a photo file.');
  const match=file.data.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/);if(!match)throw Error('Upload a JPG, PNG, WebP, or GIF image.');
  const mimeType=match[1],buffer=Buffer.from(match[2],'base64');if(!buffer.length||buffer.length>maxBytes)throw Error('Each image must be smaller than 5 MB.');
  const valid=mimeType==='image/jpeg'?buffer.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff])):mimeType==='image/png'?buffer.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])):mimeType==='image/webp'?buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP':buffer.toString('ascii',0,3)==='GIF';
  if(!valid)throw Error('The selected file does not appear to be a valid image.');
  const ext={ 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif' }[mimeType];return {buffer,mimeType,originalName:requiredText(file.name,160).replace(/[\\/\x00-\x1f]/g,'_')||`upload.${ext}`,storedName:`${crypto.randomUUID()}.${ext}`};
}
const uploadDir=path.join(DATA_DIR,'uploads');fs.mkdirSync(uploadDir,{recursive:true});
const recent=new Map();function limited(key){const now=Date.now(),x=recent.get(key);if(!x||now-x.start>15*60*1000){recent.set(key,{start:now,n:1});return false}x.n++;return x.n>12}

function bootstrapAdmin(){
  const found=db.prepare('SELECT id FROM users WHERE email=?').get(ADMIN_EMAIL);
  if(found){if(process.env.ADMIN_PASSWORD){const h=passwordHash(process.env.ADMIN_PASSWORD);db.prepare("UPDATE users SET password_salt=?,password_hash=?,role='admin' WHERE id=?").run(h.salt,h.hash,found.id)}return}
  const password=process.env.ADMIN_PASSWORD||crypto.randomBytes(9).toString('base64url');const h=passwordHash(password);
  db.prepare("INSERT INTO users(id,email,name,phone,role,password_salt,password_hash) VALUES(?,?,?,?,?,?,?)").run(crypto.randomUUID(),ADMIN_EMAIL,'Lesa','9178255246','admin',h.salt,h.hash);
  console.log('\nClean by Lesa admin account created');console.log(`Admin email: ${ADMIN_EMAIL}`);console.log(`Temporary password: ${password}`);console.log('Sign in and change this password in the admin panel. Save it somewhere safe.\n');
}
bootstrapAdmin();

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');const route=url.pathname;
  if(route.startsWith('/api/')){
    if(['POST','PATCH','DELETE'].includes(req.method)&&!isSameSite(req))return fail(res,403,'Request origin could not be verified. Reload the page and try again.');
    const user=currentUser(req);
    try{
      if(route==='/api/health'&&req.method==='GET')return send(res,200,{ok:true});
      if(route==='/api/me'&&req.method==='GET')return user?send(res,200,{user}):fail(res,401,'Sign in to continue.');
      if(route==='/api/auth/signup'&&req.method==='POST'){
        if(limited(`signup:${req.socket.remoteAddress}`))return fail(res,429,'Too many attempts. Please wait and try again.');
        const b=await readJson(req),email=requiredText(b.email,254).toLowerCase(),name=requiredText(b.name,100),phone=requiredText(b.phone,40),password=String(b.password||'');
        if(!/^\S+@\S+\.\S+$/.test(email)||!name||!phone||password.length<8||password.length>200)return fail(res,400,'Enter your name, phone, valid email, and a password of at least 8 characters.');
        const h=passwordHash(password);const id=crypto.randomUUID();try{db.prepare("INSERT INTO users(id,email,name,phone,password_salt,password_hash) VALUES(?,?,?,?,?,?)").run(id,email,name,phone,h.salt,h.hash)}catch{return fail(res,409,'An account with that email may already exist. Try signing in.')}
        const created=db.prepare('SELECT id,email,name,phone,role FROM users WHERE id=?').get(id);setSession(res,created);return send(res,201,{user:created});
      }
      if(route==='/api/auth/login'&&req.method==='POST'){
        if(limited(`login:${req.socket.remoteAddress}`))return fail(res,429,'Too many attempts. Wait 15 minutes before trying again.');
        const b=await readJson(req),email=requiredText(b.email,254).toLowerCase(),password=String(b.password||''),record=db.prepare('SELECT * FROM users WHERE email=?').get(email);
        if(!record)return fail(res,401,'Email or password is incorrect.');const h=passwordHash(password,record.password_salt);if(!safeEqual(h.hash,record.password_hash))return fail(res,401,'Email or password is incorrect.');
        const signed={id:record.id,email:record.email,name:record.name,phone:record.phone,role:record.role};setSession(res,signed);return send(res,200,{user:signed});
      }
      if(route==='/api/auth/logout'&&req.method==='POST'){clearSession(res);return send(res,200,{ok:true})}
      if(route==='/api/auth/password'&&req.method==='POST'){
        if(!user)return fail(res,401,'Sign in first.');const b=await readJson(req),password=String(b.password||'');if(password.length<8||password.length>200)return fail(res,400,'Use a password with at least 8 characters.');const h=passwordHash(password);db.prepare('UPDATE users SET password_salt=?,password_hash=? WHERE id=?').run(h.salt,h.hash,user.id);clearSession(res);return send(res,200,{ok:true});
      }
      if(route==='/api/bookings'&&req.method==='POST'){
        if(!user)return fail(res,401,'Create an account or sign in to request a booking.');const b=await readJson(req,22*1024*1024);const service=requiredText(b.service_type),pack=requiredText(b.package_name),freq=requiredText(b.frequency),win=requiredText(b.preferred_window,100);
        const address=requiredText(b.address,250),city=requiredText(b.city,100),zip=requiredText(b.zip_code,10),date=requiredText(b.preferred_date,10),notes=requiredText(b.notes,3000),addons=Array.isArray(b.add_ons)?b.add_ons.filter(x=>allowed.addons.includes(x)):[];
        if(!allowed.services.includes(service)||!allowed.packages.includes(pack)||!allowed.frequencies.includes(freq)||!allowed.windows.includes(win)||!address||!city||!/^\d{5}(-\d{4})?$/.test(zip))return fail(res,400,'Please check the service, schedule, address, city, and ZIP code.');
        if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))return fail(res,400,'Enter a valid preferred date.');
        if(!Array.isArray(b.photos)||b.photos.length<1||b.photos.length>5)return fail(res,400,'Upload at least one photo of the space (up to five photos).');
        let photos,total=0;try{photos=b.photos.map(file=>parseImageUpload(file));total=photos.reduce((sum,p)=>sum+p.buffer.length,0)}catch(error){return fail(res,400,error.message)}if(total>15*1024*1024)return fail(res,400,'The photos together must be smaller than 15 MB.');
        const id=crypto.randomUUID();try{for(const p of photos)fs.writeFileSync(path.join(uploadDir,p.storedName),p.buffer);runTransaction(()=>{db.prepare("INSERT INTO bookings(id,user_id,service_type,package_name,frequency,preferred_date,preferred_window,add_ons,address,city,zip_code,notes,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?, 'not_scheduled')").run(id,user.id,service,pack,freq,date||null,win,JSON.stringify(addons),address,city,zip,notes);const addFile=db.prepare('INSERT INTO booking_files(id,booking_id,kind,stored_name,original_name,mime_type) VALUES(?,?,?,?,?,?)');for(const p of photos)addFile.run(crypto.randomUUID(),id,'booking_photo',p.storedName,p.originalName,p.mimeType)})}catch(error){for(const p of photos)try{fs.unlinkSync(path.join(uploadDir,p.storedName))}catch{}throw error}
        return send(res,201,{booking:bookingView(db.prepare('SELECT * FROM bookings WHERE id=?').get(id))});
      }
      if(route==='/api/bookings'&&req.method==='GET'){
        if(!user)return fail(res,401,'Sign in to view bookings.');const rows=user.role==='admin'?db.prepare('SELECT b.*,u.name AS customer_name,u.email AS customer_email,u.phone AS customer_phone FROM bookings b JOIN users u ON u.id=b.user_id ORDER BY b.created_at DESC').all():db.prepare('SELECT * FROM bookings WHERE user_id=? ORDER BY created_at DESC').all(user.id);return send(res,200,{bookings:rows.map(b=>({...bookingView(b),files:db.prepare('SELECT id,kind,original_name,mime_type,created_at FROM booking_files WHERE booking_id=? ORDER BY created_at').all(b.id)}))});
      }
      const paymentMatch=route.match(/^\/api\/bookings\/([\w-]+)\/payment-submitted$/);
      if(paymentMatch&&req.method==='POST'){
        if(!user)return fail(res,401,'Sign in first.');const booking=db.prepare('SELECT * FROM bookings WHERE id=? AND user_id=?').get(paymentMatch[1],user.id);if(!booking)return fail(res,404,'Booking not found.');if(booking.payment_status==='paid')return fail(res,409,'This deposit is already marked paid.');const b=await readJson(req,8*1024*1024);let proof;try{proof=parseImageUpload(b.payment_proof,5*1024*1024)}catch(error){return fail(res,400,`Payment screenshot required: ${error.message}`)}
        try{fs.writeFileSync(path.join(uploadDir,proof.storedName),proof.buffer);runTransaction(()=>{db.prepare("INSERT INTO booking_files(id,booking_id,kind,stored_name,original_name,mime_type) VALUES(?,?,'payment_proof',?,?,?)").run(crypto.randomUUID(),booking.id,proof.storedName,proof.originalName,proof.mimeType);db.prepare("UPDATE bookings SET payment_reference=?,payment_submitted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(requiredText(b.reference,180),booking.id)})}catch(error){try{fs.unlinkSync(path.join(uploadDir,proof.storedName))}catch{}throw error}return send(res,200,{ok:true});
      }
      const adminMatch=route.match(/^\/api\/admin\/bookings\/([\w-]+)$/);
      if(adminMatch&&req.method==='PATCH'){
        if(!user||user.role!=='admin')return fail(res,403,'Admin access required.');const b=await readJson(req),booking=db.prepare('SELECT * FROM bookings WHERE id=?').get(adminMatch[1]);if(!booking)return fail(res,404,'Booking not found.');let status=requiredText(b.status,30),payment=requiredText(b.payment_status,30),message=requiredText(b.admin_message,1200);
        if(!allowed.statuses.includes(status)||!allowed.payments.includes(payment))return fail(res,400,'Check the booking and payment status.');
        if(payment==='paid'&&booking.payment_status!=='paid'&&!db.prepare("SELECT 1 FROM booking_files WHERE booking_id=? AND kind='payment_proof'").get(booking.id))return fail(res,400,'The customer must upload payment proof before you mark the deposit paid.');
        if(payment==='paid'&&booking.payment_status!=='paid'&&!message)message='Deposit received and verified. Lesa will contact you to arrange your cleaning.';
        db.prepare('UPDATE bookings SET status=?,payment_status=?,admin_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status,payment,message,booking.id);return send(res,200,{ok:true});
      }
      const fileMatch=route.match(/^\/api\/files\/([\w-]+)$/);
      if(fileMatch&&req.method==='GET'){
        if(!user)return fail(res,401,'Sign in to view this image.');const record=db.prepare('SELECT f.*,b.user_id FROM booking_files f JOIN bookings b ON b.id=f.booking_id WHERE f.id=?').get(fileMatch[1]);if(!record)return fail(res,404,'Image not found.');if(user.role!=='admin'&&record.user_id!==user.id)return fail(res,403,'You do not have access to this image.');
        const filePath=path.join(uploadDir,record.stored_name);fs.readFile(filePath,(error,content)=>{if(error){res.writeHead(404,{'Content-Type':'text/plain'});return res.end('Image not found.')}res.writeHead(200,{'Content-Type':record.mime_type,'Content-Length':content.length,'Content-Disposition':`inline; filename="${record.stored_name}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'});res.end(content)});return;
      }
      return fail(res,404,'API route not found.');
    }catch(error){console.error(error);return fail(res,400,'We could not complete that request. Check the information and try again.')}
  }
  const pathname=decodeURIComponent(route==='/'?'/index.html':route),normalized=path.posix.normalize(pathname);if(normalized!==pathname)return fail(res,404,'Page not found.');
  const file=path.resolve(ROOT,`.${normalized}`),relative=path.relative(ROOT,file),inAssetFolder=['css','js','assets'].some(folder=>relative.startsWith(`${folder}${path.sep}`)),isRootHtml=!relative.includes(path.sep)&&relative.toLowerCase().endsWith('.html');
  if((!inAssetFolder&&!isRootHtml)||relative.startsWith('data'+path.sep)||relative.startsWith('node_modules'+path.sep))return fail(res,404,'Page not found.');
  fs.readFile(file,(error,content)=>{if(error){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});return res.end('Page not found.')}res.writeHead(200,{'Content-Type':mime[path.extname(file).toLowerCase()]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'same-origin'});res.end(content)});
});

const port=Number(process.env.PORT)||3101;
server.listen(port,'0.0.0.0',()=>{console.log(`Clean by Lesa website running at http://localhost:${port}`);});
