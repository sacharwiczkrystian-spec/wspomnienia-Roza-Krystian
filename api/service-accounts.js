const URL=process.env.SUPABASE_URL||"https://khggputlakhupiypybic.supabase.co";
const PUB=process.env.SUPABASE_PUBLISHABLE_KEY||"sb_publishable_NKmlxY9hjAVDeSD4FEhZhQ_8_AOunOe";
const { requirePhoneVerified } = require("./_lib/phone-verification");
const crypto=require("crypto");
const {promisify}=require("util");
const scrypt=promisify(crypto.scrypt);
const headers=(key,extra={})=>{const value=String(key||""),result={apikey:value,...extra};if(!value.startsWith("sb_secret_"))result.Authorization="Bearer "+value;return result};
const reply=(res,status,data)=>res.status(status).setHeader("Content-Type","application/json; charset=utf-8").setHeader("Cache-Control","no-store").end(JSON.stringify(data));
async function db(path,key,opts={}){const r=await fetch(URL+"/rest/v1/"+path,{...opts,headers:headers(key,{"Content-Type":"application/json",...(opts.headers||{})})});const t=await r.text();if(!r.ok)throw Error("Operacja w bazie nie powiodła się.");return t?JSON.parse(t):[]}
function serverKey(){return process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||null}
async function authUser(req){const token=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");if(!token)throw Object.assign(Error("Zaloguj się ponownie."),{status:401});const r=await fetch(URL+"/auth/v1/user",{headers:{apikey:PUB,Authorization:"Bearer "+token}});if(!r.ok)throw Object.assign(Error("Sesja wygasła."),{status:401});return r.json()}
async function adminContext(req){const user=await authUser(req),key=serverKey();if(!key)throw Object.assign(Error("Brak konfiguracji serwera. Administrator projektu musi dodać SUPABASE_SERVICE_ROLE_KEY w Vercel i wykonać redeploy."),{status:503});if(!await requirePhoneVerified(user.id,key))throw Object.assign(Error("Najpierw potwierdź numer telefonu."),{status:403});const rows=await db("admin_users?user_id=eq."+encodeURIComponent(user.id)+"&select=user_id&limit=1",key);if(!rows.length)throw Object.assign(Error("Brak uprawnień administratora."),{status:403});return {user,key}}
function validLogin(s){return /^[a-z0-9._-]{3,32}$/.test(s)}
async function hashPassword(password,salt){return (await scrypt(password,Buffer.from(salt,"hex"),64)).toString("hex")}
module.exports=async(req,res)=>{
 if(req.method!=="POST"){res.setHeader("Allow","POST");return reply(res,405,{error:"Method not allowed"})}
 try{
  const b=typeof req.body==="string"?JSON.parse(req.body):req.body||{},action=b.action;
  if(action==="verify_second"){
   const user=await authUser(req),key=serverKey();
   if(!key)return reply(res,503,{error:"Serwer nie ma skonfigurowanego klucza dostępu."});
   if(user.app_metadata?.account_type!=="service_collaboration")return reply(res,403,{error:"To konto nie ma dostępu do panelu współpracy."});
   const rows=await db("service_collaboration_accounts?user_id=eq."+encodeURIComponent(user.id)+"&select=login,display_name,institution_label,second_password_salt,second_password_hash,account_status,failed_attempts,locked_until&limit=1",key);
   const a=rows[0];if(!a||a.account_status!=="active")return reply(res,403,{error:"Konto jest nieaktywne lub nie istnieje."});
   if(a.locked_until&&new Date(a.locked_until).getTime()>Date.now())return reply(res,429,{error:"Logowanie jest czasowo zablokowane. Spróbuj później."});
   const candidate=await hashPassword(String(b.second_password||""),a.second_password_salt);
   const ok=crypto.timingSafeEqual(Buffer.from(candidate,"hex"),Buffer.from(a.second_password_hash,"hex"));
   if(!ok){const n=(a.failed_attempts||0)+1,locked=n>=5?new Date(Date.now()+15*60*1000).toISOString():null;await db("service_collaboration_accounts?user_id=eq."+user.id,key,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({failed_attempts:n>=5?0:n,locked_until:locked,updated_at:new Date().toISOString()})});return reply(res,401,{error:"Drugie hasło jest nieprawidłowe."})}
   await db("service_collaboration_accounts?user_id=eq."+user.id,key,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({failed_attempts:0,locked_until:null,updated_at:new Date().toISOString()})});
   return reply(res,200,{ok:true,display_name:a.display_name,institution_label:a.institution_label});
  }
  const {user,key}=await adminContext(req);
  if(action==="create"){
   const login=String(b.login||"").trim().toLowerCase(),name=String(b.display_name||"").trim(),institution=String(b.institution_label||"").trim(),p1=String(b.password||""),p2=String(b.second_password||"");
   if(!validLogin(login))return reply(res,400,{error:"Login: 3–32 znaków, małe litery, cyfry, kropka, myślnik lub podkreślenie."});
   if(name.length<2||name.length>120||institution.length<2||institution.length>160)return reply(res,400,{error:"Uzupełnij prawidłową nazwę osoby i jednostki (2–160 znaków)."});
   if(p1.length<12||p1.length>72||p2.length<12||p2.length>72)return reply(res,400,{error:"Każde hasło musi mieć od 12 do 72 znaków."});
   if(p1===p2)return reply(res,400,{error:"Oba hasła muszą być różne."});
   if((await db("service_collaboration_accounts?login=eq."+encodeURIComponent(login)+"&select=user_id&limit=1",key)).length)return reply(res,409,{error:"Ten login jest już zajęty."});
   const email="svc-"+login+"@service-accounts.love-story-nowa.vercel.app";
   const created=await fetch(URL+"/auth/v1/admin/users",{method:"POST",headers:headers(key,{"Content-Type":"application/json"}),body:JSON.stringify({email,password:p1,email_confirm:true,app_metadata:{account_type:"service_collaboration"},user_metadata:{display_name:name}})});
   const auth=await created.json();if(!created.ok||!auth.id)return reply(res,409,{error:"Nie udało się utworzyć konta logowania. Sprawdź, czy login nie jest zajęty."});
   try{const salt=crypto.randomBytes(32).toString("hex"),secondHash=await hashPassword(p2,salt);await db("service_collaboration_accounts",key,{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({user_id:auth.id,login,display_name:name,institution_label:institution,second_password_salt:salt,second_password_hash:secondHash,created_by:user.id,account_status:"active"})})}
   catch(e){await fetch(URL+"/auth/v1/admin/users/"+auth.id,{method:"DELETE",headers:headers(key)});throw e}
   return reply(res,200,{ok:true,login,display_name:name,institution_label:institution});
  }
  if(action==="list"){const rows=await db("service_collaboration_accounts?select=user_id,login,display_name,institution_label,account_status,created_at&order=created_at.desc&limit=300",key);return reply(res,200,{accounts:rows})}
  if(action==="set_status"){const id=String(b.user_id||""),status=String(b.status||"");if(!/^[0-9a-f-]{36}$/i.test(id)||!["active","disabled"].includes(status))return reply(res,400,{error:"Nieprawidłowe dane."});const rows=await db("service_collaboration_accounts?user_id=eq."+id+"&select=user_id&limit=1",key);if(!rows.length)return reply(res,404,{error:"Nie znaleziono konta."});await db("service_collaboration_accounts?user_id=eq."+id,key,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({account_status:status,failed_attempts:0,locked_until:null,updated_at:new Date().toISOString()})});return reply(res,200,{ok:true,status})}
  if(action==="reset_second"){const id=String(b.user_id||""),p=String(b.second_password||"");if(!/^[0-9a-f-]{36}$/i.test(id)||p.length<12||p.length>72)return reply(res,400,{error:"Drugie hasło musi mieć 12–72 znaki."});const rows=await db("service_collaboration_accounts?user_id=eq."+id+"&select=user_id&limit=1",key);if(!rows.length)return reply(res,404,{error:"Nie znaleziono konta."});const salt=crypto.randomBytes(32).toString("hex"),h=await hashPassword(p,salt);await db("service_collaboration_accounts?user_id=eq."+id,key,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({second_password_salt:salt,second_password_hash:h,failed_attempts:0,locked_until:null,updated_at:new Date().toISOString()})});return reply(res,200,{ok:true})}
  return reply(res,400,{error:"Nieznana operacja."});
 }catch(e){console.error("service-accounts",e.message);return reply(res,e.status||500,{error:e.message||"Błąd serwera."})}
};