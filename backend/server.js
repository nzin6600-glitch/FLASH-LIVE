import express from "express";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();
const app=express();
app.use(cors());
app.use(express.json({limit:"5mb"}));
const PORT=process.env.PORT||3000;
const API_KEY=(process.env.API_FOOTBALL_KEY||"").trim();
const API_HOST="free-api-live-football-data.p.rapidapi.com";
const API_URL=`https://${API_HOST}`;
const ADMIN_KEY=(process.env.ADMIN_ACCESS_KEY||"").trim();
const ENDPOINTS={countries:"football-get-all-countries",leagues:"football-popular-leagues",leaguesAll:"football-get-all-leagues",live:"football-current-live",fixtures:"football-get-matches-by-date"};
// Temporary in-memory storage. Configure a database before production use.
const supportMessages=[];const flashStreams=[];
function requireAdmin(req,res,next){if(!ADMIN_KEY)return res.status(503).json({success:false,message:"ADMIN_ACCESS_KEY is not configured"});if((req.get("x-admin-key")||"")!==ADMIN_KEY)return res.status(401).json({success:false,message:"Unauthorized"});next();}
async function footballRequest(endpoint,params={}){if(!API_KEY)throw new Error("API_FOOTBALL_KEY is missing");if(!/^football-[a-z0-9-]+$/.test(endpoint))throw new Error("Invalid football endpoint");const url=new URL(`${API_URL}/${endpoint}`);for(const [k,v] of Object.entries(params)){if(v!==undefined&&v!==null&&v!=="")url.searchParams.set(k,String(v));}const response=await fetch(url,{headers:{"x-rapidapi-key":API_KEY,"x-rapidapi-host":API_HOST,accept:"application/json"},signal:AbortSignal.timeout(20000)});const body=await response.text();let data;try{data=JSON.parse(body)}catch{throw new Error("Provider returned invalid JSON")}if(!response.ok||data.status==="error"){const e=new Error(data.message||data.error||`Provider HTTP ${response.status}`);e.status=response.status;throw e;}return data;}
function handleError(res,error,name){console.error(`${name} ERROR:`,error.message);res.status(502).json({success:false,error:`${name} request failed`,message:error.message});}
app.get("/",(req,res)=>res.json({app:"FLASH LIVE API",status:"online",provider:"RabbitApi",version:"4.0.0"}));
app.get("/api/health",(req,res)=>res.json({status:"ok",provider:"RapidAPI",host:API_HOST,apiKeyConfigured:Boolean(API_KEY),adminKeyConfigured:Boolean(ADMIN_KEY),version:"4.0.0"}));
app.get("/api/provider/:endpoint",async(req,res)=>{try{const endpoint=String(req.params.endpoint).replaceAll("_","-").toLowerCase();res.json(await footballRequest(endpoint,req.query));}catch(e){handleError(res,e,"PROVIDER");}});
for(const [route,endpoint] of [["/api/countries",ENDPOINTS.countries],["/api/leagues",ENDPOINTS.leagues],["/api/leagues-all",ENDPOINTS.leaguesAll],["/api/live",ENDPOINTS.live]])app.get(route,async(req,res)=>{try{res.json(await footballRequest(endpoint));}catch(e){handleError(res,e,route);}});
app.get("/api/fixtures",async(req,res)=>{try{const date=String(req.query.date||"");if(!/^\d{8}$/.test(date))return res.status(400).json({success:false,error:"Invalid date",message:"Use YYYYMMDD format"});res.json(await footballRequest(ENDPOINTS.fixtures,{date}));}catch(e){handleError(res,e,"FIXTURES");}});
// User sends support message with optional base64 image.
app.post("/api/support/messages",(req,res)=>{const {name,email,message,image}=req.body||{};if(!String(message||"").trim()&&!image)return res.status(400).json({success:false,message:"Message or image required"});if(image&&(!String(image).startsWith("data:image/")||String(image).length>4_200_000))return res.status(413).json({success:false,message:"Image must be an image under 3MB"});const item={id:`msg_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,name:String(name||"Guest User").slice(0,80),email:String(email||"").slice(0,160),message:String(message||"").slice(0,4000),image:image||null,createdAt:new Date().toISOString(),read:false};supportMessages.unshift(item);res.status(201).json({success:true,id:item.id});});
app.get("/api/admin/messages",requireAdmin,(req,res)=>res.json({success:true,messages:supportMessages}));
app.patch("/api/admin/messages/:id",requireAdmin,(req,res)=>{const m=supportMessages.find(x=>x.id===req.params.id);if(!m)return res.status(404).json({success:false,message:"Message not found"});m.read=Boolean(req.body?.read);res.json({success:true,message:m});});
app.get("/api/flash-live",(req,res)=>res.json({success:true,streams:flashStreams.filter(s=>s.active!==false)}));
app.post("/api/admin/streams",requireAdmin,(req,res)=>{const title=String(req.body?.title||"").trim(),url=String(req.body?.url||"").trim();if(!title||!url)return res.status(400).json({success:false,message:"Title and URL required"});let parsed;try{parsed=new URL(url)}catch{return res.status(400).json({success:false,message:"Invalid video URL"})}if(!["http:","https:"].includes(parsed.protocol))return res.status(400).json({success:false,message:"Only HTTP/HTTPS URLs allowed"});const stream={id:`st_${Date.now()}`,title:title.slice(0,120),url,createdAt:new Date().toISOString(),active:true};flashStreams.unshift(stream);res.status(201).json({success:true,stream});});
app.delete("/api/admin/streams/:id",requireAdmin,(req,res)=>{const i=flashStreams.findIndex(s=>s.id===req.params.id);if(i<0)return res.status(404).json({success:false,message:"Stream not found"});flashStreams.splice(i,1);res.json({success:true});});
app.use((req,res)=>res.status(404).json({success:false,error:"API endpoint not found",path:req.path}));
app.listen(PORT,"0.0.0.0",()=>console.log(`FLASH LIVE API v4.0.0 listening on ${PORT}; provider ${API_HOST}; key configured ${Boolean(API_KEY)}`));
