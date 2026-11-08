const URL=process.env.SUPABASE_URL||"https://khggputlakhupiypybic.supabase.co";
const PUB=process.env.SUPABASE_PUBLISHABLE_KEY||"sb_publishable_NKmlxY9hjAVDeSD4FEhZhQ_8_AOunOe";
const headers=(key,extra={})=>({apikey:key,Authorization:"Bearer "+key,...extra});
const reply=(res,status,data)=>res.status(status).setHeader("Content-Type","application/json; charset=utf-8").setHeader("Cache-Control","no-store").end(JSON.stringify(data));
const validNip=n=>/^\d{10}$/.test(n)&&[6,5,7,2,3,4,5,6,7].reduce((s,w,i)=>s+w*Number(n[i]),0)%11===Number(n[9]);
const tempPassword=()=>{const c="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";return [...require("crypto").randomBytes(24)].map(x=>c[x%c.length]).join("")};
async function db(path,key,opts={}){const r=await fetch(URL+"/rest/v1/"+path,{...opts,headers:headers(key,{"Content-Type":"application/json",...(opts.headers||{})})});const t=await r.text();if(!r.ok)throw Error("Operacja w bazie nie powiodła się.");return t?JSON.parse(t):[]}
async function context(req,admin){const token=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");if(!token)return {error:[401,"Zaloguj się ponownie."]};const a=await fetch(URL+"/auth/v1/user",{headers:{apikey:PUB,Authorization:"Bearer "+token}});if(!a.ok)return {error:[401,"Sesja wygasła."]};const user=await a.json();let key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;try{const bundle=JSON.parse(process.env.SUPABASE_SECRET_KEYS||"{}");key=key||bundle.default||bundle.secret_key||null}catch{}if(!key)return {error:[503,"Brak konfiguracji serwera. Właściciel projektu musi dodać SUPABASE_SECRET_KEY (lub SUPABASE_SERVICE_ROLE_KEY) w Vercel."]};if(admin){const rows=await db("admin_users?user_id=eq."+encodeURIComponent(user.id)+"&select=user_id&limit=1",key);if(!rows.length)return {error:[403,"Brak uprawnień administratora."]}}return {user,key}}
module.exports=async(req,res)=>{if(req.method!=="POST"){res.setHeader("Allow","POST");return reply(res,405,{error:"Method not allowed"})}try{const b=typeof req.body==="string"?JSON.parse(req.body):req.body||{},action=b.action;
if(["create","create_collaborator","list_collaborators","set_collaborator_status","list_ads","review_ad"].includes(action)){const c=await context(req,true);if(c.error)return reply(res,c.error[0],{error:c.error[1]});const {user,key}=c;
if(action==="create"){
 const accountType=b.account_type==="unregistered"?"unregistered":"registered";
 const nip=accountType==="registered"?String(b.nip||"").replace(/\D/g,""):null;
 const name=String(b.company_name||"").trim();
 if(accountType==="registered"&&!validNip(nip))return reply(res,400,{error:"Nieprawidłowy NIP."});
 if(name.length<2||name.length>160)return reply(res,400,{error:"Nazwa firmy lub działalności musi mieć 2–160 znaków."});
 if(accountType==="registered"&&(await db("partner_company_accounts?nip=eq."+nip+"&select=user_id&limit=1",key)).length)return reply(res,409,{error:"Konto dla tego NIP-u już istnieje."});
 const customPassword=typeof b.password==="string"&&b.password.length>0;
 if(!customPassword||b.password.length<6||b.password.length>72)return reply(res,400,{error:"Hasło musi mieć od 6 do 72 znaków."});
 const mustChangePassword=false;
 let loginIdentifier=nip;
 if(accountType==="unregistered"){
   loginIdentifier="LS-"+require("crypto").randomBytes(4).toString("hex").toUpperCase();
   if((await db("partner_company_accounts?login_identifier=eq."+encodeURIComponent(loginIdentifier)+"&select=user_id&limit=1",key)).length)return reply(res,503,{error:"Nie udało się wygenerować unikalnego loginu. Spróbuj ponownie."});
 }
 const email=(accountType==="registered"?"nip-"+nip:"login-"+loginIdentifier.toLowerCase())+"@partners.love-story-nowa.vercel.app";
 const password=b.password;
 const userMetadata={company_name:name,business_type:accountType,...(accountType==="registered"?{nip}:{})};
 const r=await fetch(URL+"/auth/v1/admin/users",{method:"POST",headers:headers(key,{"Content-Type":"application/json"}),body:JSON.stringify({email,password,email_confirm:true,app_metadata:{account_type:"partner_company",business_type:accountType,must_change_password:mustChangePassword},user_metadata:userMetadata})}),u=await r.json();
 if(!r.ok||!u.id)throw Error("Nie udało się utworzyć konta Auth.");
 try{
  await db("partner_company_accounts",key,{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({user_id:u.id,nip,account_type:accountType,login_identifier:loginIdentifier,company_name:name,created_by:user.id,account_status:"active",must_change_password:mustChangePassword})});
  await db("staff_permissions",key,{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({user_id:u.id,permission:"partner_company",granted_by:user.id})});
 }catch(e){
  await fetch(URL+"/auth/v1/admin/users/"+u.id,{method:"DELETE",headers:headers(key)});
  await db("partner_company_accounts?user_id=eq."+u.id,key,{method:"DELETE"}).catch(()=>{});
  throw e;
 }
 return reply(res,200,{ok:true,account_type:accountType,login_identifier:loginIdentifier,nip,company_name:name,must_change_password:mustChangePassword});
}
if(action==="create_collaborator"){
 const email=String(b.email||"").trim().toLowerCase(),display=String(b.display_name||"").trim();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return reply(res,400,{error:"Podaj prawidłowy adres e-mail."});
 if(display.length<2||display.length>100)return reply(res,400,{error:"Nazwa współpracownika musi mieć 2–100 znaków."});
 if((await db("partner_collaborator_accounts?email=eq."+encodeURIComponent(email)+"&select=user_id&limit=1",key)).length)return reply(res,409,{error:"Konto współpracownika z tym adresem e-mail już istnieje."});
 const password=tempPassword();
 const authRes=await fetch(URL+"/auth/v1/admin/users",{method:"POST",headers:headers(key,{"Content-Type":"application/json"}),body:JSON.stringify({email,password,email_confirm:true,app_metadata:{account_type:"partner_collaborator",must_change_password:true},user_metadata:{display_name:display}})});
 const authUser=await authRes.json();
 if(!authRes.ok||!authUser.id)throw Error("Nie udało się utworzyć konta logowania.");
 try{
  await db("partner_collaborator_accounts",key,{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({user_id:authUser.id,display_name:display,email,company_name:display,account_status:"active",must_change_password:true,created_by:user.id})});
  await db("staff_permissions",key,{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({user_id:authUser.id,permission:"partner_collaborator",granted_by:user.id})});
 }catch(e){
  await fetch(URL+"/auth/v1/admin/users/"+authUser.id,{method:"DELETE",headers:headers(key)});
  await db("partner_collaborator_accounts?user_id=eq."+authUser.id,key,{method:"DELETE"}).catch(()=>{});
  await db("staff_permissions?user_id=eq."+authUser.id+"&permission=eq.partner_collaborator",key,{method:"DELETE"}).catch(()=>{});
  throw e;
 }
 return reply(res,200,{ok:true,email,display_name:display,temporary_password:password});
}
if(action==="list_collaborators"){
 const accounts=await db("partner_collaborator_accounts?select=user_id,display_name,email,company_name,account_status,must_change_password,created_at&order=created_at.desc&limit=300",key);
 return reply(res,200,{collaborators:accounts});
}
if(action==="set_collaborator_status"){
 const id=String(b.user_id||""),status=String(b.status||"");
 if(!/^[0-9a-f-]{36}$/i.test(id)||!["active","disabled"].includes(status))return reply(res,400,{error:"Nieprawidłowe dane konta."});
 const rows=await db("partner_collaborator_accounts?user_id=eq."+id+"&select=user_id&limit=1",key);
 if(!rows.length)return reply(res,404,{error:"Nie znaleziono konta współpracownika."});
 await db("partner_collaborator_accounts?user_id=eq."+id,key,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({account_status:status,updated_at:new Date().toISOString()})});
 return reply(res,200,{ok:true,status});
}
if(action==="list_ads"){const ads=await db("company_ads?select=id,company_user_id,company_name,title,description,website_url,contact_email,phone,status,admin_note,created_at&status=eq.pending&order=created_at.desc&limit=100",key),ids=[...new Set(ads.map(x=>x.company_user_id))];const ac=ids.length?await db("partner_company_accounts?user_id=in.("+ids.join(",")+")&select=user_id,nip",key):[];const m=new Map(ac.map(x=>[x.user_id,x.nip]));return reply(res,200,{ads:ads.map(x=>({...x,nip:m.get(x.company_user_id)||"—"}))})}
if(action==="review_ad"){const id=String(b.id||"");if(!/^[0-9a-f-]{36}$/i.test(id)||!["approve","reject"].includes(b.decision))return reply(res,400,{error:"Nieprawidłowe dane decyzji."});const rows=await db("company_ads?id=eq."+id+"&status=eq.pending&select=id&limit=1",key);if(!rows.length)return reply(res,404,{error:"Reklama nie oczekuje już na decyzję."});await db("company_ads?id=eq."+id,key,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({status:b.decision==="approve"?"approved":"rejected",admin_note:typeof b.note==="string"?b.note.slice(0,1000):null,reviewed_at:new Date().toISOString(),reviewed_by:user.id,updated_at:new Date().toISOString()})});return reply(res,200,{ok:true})}}
if(action==="complete_password_change"){const c=await context(req,false);if(c.error)return reply(res,c.error[0],{error:c.error[1]});const {user,key}=c;if(!["partner_company","partner_collaborator"].includes(user.app_metadata?.account_type)||user.app_metadata?.must_change_password!==true)return reply(res,200,{ok:true});const r=await fetch(URL+"/auth/v1/admin/users/"+user.id,{method:"PUT",headers:headers(key,{"Content-Type":"application/json"}),body:JSON.stringify({app_metadata:{...user.app_metadata,must_change_password:false}})});if(!r.ok)throw Error("Nie udało się potwierdzić zmiany hasła.");const table=user.app_metadata.account_type==="partner_collaborator"?"partner_collaborator_accounts":"partner_company_accounts";await db(table+"?user_id=eq."+user.id,key,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({must_change_password:false,updated_at:new Date().toISOString()})});return reply(res,200,{ok:true})}
return reply(res,400,{error:"Nieznana operacja."})}catch(e){console.error("company-accounts",e.message);return reply(res,500,{error:e.message||"Błąd serwera."})}};