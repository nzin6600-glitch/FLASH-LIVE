
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const API_KEY = (process.env.API_FOOTBALL_KEY || "").trim();
const API_HOST = "free-api-live-football-data.p.rapidapi.com";
const API_URL = `https://${API_HOST}`;
const ADMIN_KEY = (process.env.ADMIN_ACCESS_KEY || "").trim();

app.use(cors());
app.use(express.json({ limit: "12mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ==========================================
// CONFIGURATION
// ==========================================

const ENDPOINTS = {
    countries: "football-get-all-countries",
    leagues: "football-popular-leagues",
    leaguesAll: "football-get-all-leagues",
    live: "football-current-live",
    fixtures: "football-get-matches-by-date"
};

const supportMessages = [];
const flashStreams = [];
const memoryNotifications = [];
const memoryNotificationReads = new Set();

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const hasSupabase = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

async function sbRequest(table, method = "GET", query = "", body = undefined, prefer = "") {
    if (!hasSupabase) return null;
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
        method,
        headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
            ...(prefer ? { Prefer: prefer } : {})
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Supabase ${table}: ${response.status} ${text.slice(0,300)}`);
    return text ? JSON.parse(text) : [];
}

// ==========================================
// ADMIN AUTHENTICATION
// ==========================================

function requireAdmin(req, res, next) {
    if (!ADMIN_KEY) {
        return res.status(503).json({
            success: false,
            message: "ADMIN_ACCESS_KEY is not configured"
        });
    }

    if ((req.get("x-admin-key") || "") !== ADMIN_KEY) {
        return res.status(401).json({
            success: false,
            message: "Unauthorized"
        });
    }

    next();
}

// ==========================================
// FOOTBALL API REQUEST
// ==========================================

async function footballRequest(endpoint, params = {}) {
    if (!API_KEY) {
        throw new Error("API_FOOTBALL_KEY is missing");
    }

    if (!/^football-[a-z0-9-]+$/.test(endpoint)) {
        throw new Error("Invalid football endpoint");
    }

    const url = new URL(`${API_URL}/${endpoint}`);

    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "") {
            url.searchParams.set(key, String(value));
        }
    }

    const response = await fetch(url, {
        headers: {
            "x-rapidapi-key": API_KEY,
            "x-rapidapi-host": API_HOST,
            accept: "application/json"
        },
        signal: AbortSignal.timeout(20000)
    });

    const body = await response.text();

    let data;

    try {
        data = JSON.parse(body);
    } catch {
        throw new Error("Provider returned invalid JSON");
    }

    if (!response.ok || data.status === "error") {
        const error = new Error(
            data.message ||
            data.error ||
            `Provider HTTP ${response.status}`
        );

        error.status = response.status;
        throw error;
    }

    return data;
}

function handleError(res, error, name) {
    console.error(`${name} ERROR:`, error.message);

    res.status(error.status || 502).json({
        success: false,
        error: `${name} request failed`,
        message: error.message
    });
}

// ==========================================
// STREAM VALIDATION
// ==========================================

function cleanStreamInput(body = {}) {
    const title = String(body.title || "").trim();
    const url = String(body.url || "").trim();

    if (!title || !url) {
        return { error: "Title and URL required" };
    }

    if (title.length > 120 || url.length > 2048) {
        return { error: "Title or URL is too long" };
    }

    let parsed;

    try {
        parsed = new URL(url);
    } catch {
        return { error: "Invalid video URL" };
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
        return { error: "Only HTTP/HTTPS URLs allowed" };
    }

    const host = parsed.hostname.toLowerCase();
    let type = "external";

    if (
        host === "youtu.be" ||
        host === "youtube.com" ||
        host.endsWith(".youtube.com") ||
        host === "youtube-nocookie.com" ||
        host.endsWith(".youtube-nocookie.com")
    ) {
        type = "youtube";
    } else if (/\.(mp4|webm|ogg)$/i.test(parsed.pathname)) {
        type = "mp4";
    } else if (/\.m3u8$/i.test(parsed.pathname)) {
        type = "m3u8";
    }

    return {
        value: { title, url, type }
    };
}

// ==========================================
// HEALTH CHECK
// ==========================================

app.get("/", (req, res) => {
    res.json({
        app: "FLASH LIVE API",
        status: "online",
        version: "4.3.1"
    });
});

app.get("/api/health", (req, res) => {
    res.json({
        status: "ok",
        provider: "RapidAPI",
        host: API_HOST,
        apiKeyConfigured: Boolean(API_KEY),
        adminKeyConfigured: Boolean(ADMIN_KEY),
        version: "4.3.1"
    });
});

// ==========================================
// FLASH LIVE USER APP
// ==========================================
// User and Admin HTML are stored in ./public for this repository layout.

app.get(["/admin", "/admin/"], (req, res) => {
    res.sendFile(path.join(__dirname, "public", "admin.html"), error => {
        if (error && !res.headersSent) res.status(404).send("Admin page missing. Check public/admin.html");
    });
});

app.get(["/app", "/app/"], (req, res) => {
    res.sendFile(
        path.join(__dirname, "public", "index.html"),
        error => {
            if (error && !res.headersSent) {
                console.error("USER APP ERROR:", error.message);
                res.status(404).send("User App missing. Check public/index.html");
            }
        }
    );
});

// ==========================================
// FOOTBALL PROVIDER
// ==========================================

app.get("/api/provider/:endpoint", async (req, res) => {
    try {
        const endpoint = String(req.params.endpoint)
            .replaceAll("_", "-")
            .toLowerCase();

        res.json(await footballRequest(endpoint, req.query));
    } catch (error) {
        handleError(res, error, "PROVIDER");
    }
});

// ==========================================
// FOOTBALL MAIN ENDPOINTS
// ==========================================

const footballRoutes = [
    ["/api/countries", ENDPOINTS.countries],
    ["/api/leagues", ENDPOINTS.leagues],
    ["/api/leagues-all", ENDPOINTS.leaguesAll],
    ["/api/live", ENDPOINTS.live]
];

for (const [route, endpoint] of footballRoutes) {
    app.get(route, async (req, res) => {
        try {
            res.json(await footballRequest(endpoint));
        } catch (error) {
            handleError(res, error, route);
        }
    });
}

// ==========================================
// FOOTBALL FIXTURES
// ==========================================

app.get("/api/fixtures", async (req, res) => {
    try {
        const date = String(req.query.date || "");

        if (!/^\d{8}$/.test(date)) {
            return res.status(400).json({
                success: false,
                error: "Invalid date",
                message: "Use YYYYMMDD format"
            });
        }

        res.json(
            await footballRequest(ENDPOINTS.fixtures, { date })
        );
    } catch (error) {
        handleError(res, error, "FIXTURES");
    }
});

// ==========================================
// USER SUPPORT + PERSISTENT ADMIN REPLIES
// ==========================================
const memorySupportReplies = [];
const autoAckByLang = {
  my: "မင်္ဂလာပါ။ သင့်အကူအညီတောင်းဆိုချက်ကို လက်ခံရရှိပါပြီ။ ကျွန်ုပ်တို့အဖွဲ့က စစ်ဆေးပြီး အမြန်ဆုံး ပြန်လည်ဖြေကြားပေးပါမယ်။ အကြောင်းပြန်ရန် အချိန်ယူရပါက နားလည်ပေးပါရန် မေတ္တာရပ်ခံအပ်ပါတယ်။ ကျေးဇူးတင်ပါတယ်။",
  en: "Hello! We have received your support request. Our team will review it and reply as soon as possible. We appreciate your patience if our response takes some time. Thank you.",
  th: "สวัสดีค่ะ เราได้รับคำขอความช่วยเหลือของคุณแล้ว ทีมงานจะตรวจสอบและตอบกลับโดยเร็วที่สุด ขอขอบคุณที่อดทนรอหากใช้เวลาในการตอบกลับ",
  zh: "您好！我们已收到您的帮助请求。我们的团队会尽快核查并回复。如果回复需要一些时间，感谢您的理解与耐心。",
  es: "¡Hola! Hemos recibido tu solicitud de ayuda. Nuestro equipo la revisará y responderá lo antes posible. Gracias por tu paciencia si la respuesta tarda un poco."
};
app.post("/api/support/messages", async (req, res) => {
    const { user_id, name, email, avatar, message, image, language } = req.body || {};
    const userId = safeUserId(user_id);
    if (!userId) return res.status(400).json({success:false,message:"user_id required"});
    if (!String(message || "").trim() && !image) return res.status(400).json({success:false,message:"Message or image required"});
    if (image && (!String(image).startsWith("data:image/") || String(image).length > 4200000))
        return res.status(413).json({success:false,message:"Image must be an image under 3MB"});
    const item = {
        id:randomUUID(),
        user_id:userId, name:String(name||"Guest User").slice(0,80), email:String(email||"").slice(0,160),
        avatar:typeof avatar==="string"&&avatar.startsWith("data:image/")&&avatar.length<=2800000?avatar:null,
        message:String(message||"").slice(0,4000), image:image||null,
        language:["my","en","th","zh","es"].includes(language)?language:"my",
        created_at:new Date().toISOString(), read:false, status:"new"
    };
    const ack = {id:randomUUID(), user_id:userId, message_id:item.id,
        sender:"admin", body:autoAckByLang[item.language], created_at:new Date().toISOString(), automatic:true};
    try {
        if (hasSupabase) {
            await sbRequest("support_messages","POST","",item,"return=minimal");
            await sbRequest("support_replies","POST","",ack,"return=minimal");
        } else { supportMessages.unshift(item); memorySupportReplies.unshift(ack); }
        res.status(201).json({success:true,id:item.id,acknowledgement:ack.body,persistent:hasSupabase});
    } catch(error) {
        console.error("SUPPORT CREATE ERROR:",error.message);
        res.status(503).json({success:false,message:"Support database unavailable"});
    }
});

app.get("/api/support/thread", async (req,res)=>{
    const userId=safeUserId(req.query.user_id);
    if(!userId)return res.status(400).json({success:false,message:"user_id required"});
    try{
        let messages=[], replies=[];
        if(hasSupabase){
            messages=await sbRequest("support_messages","GET",`?select=*&user_id=eq.${encodeURIComponent(userId)}&order=created_at.asc&limit=100`);
            replies=await sbRequest("support_replies","GET",`?select=*&user_id=eq.${encodeURIComponent(userId)}&order=created_at.asc&limit=200`);
            const userLang=String(req.query.lang||"my");
            replies=(replies||[]).map(x=>({...x,body:(x.translations&&x.translations[userLang])||x.body}));
        }else{
            messages=supportMessages.filter(x=>x.user_id===userId).reverse();
            replies=memorySupportReplies.filter(x=>x.user_id===userId).reverse();
        }
        res.set("Cache-Control","no-store").json({success:true,persistent:hasSupabase,messages,replies});
    }catch(error){console.error("SUPPORT THREAD ERROR:",error.message);res.status(503).json({success:false,message:"Could not load support thread"});}
});

// ==========================================
// ADMIN SUPPORT INBOX + USER SEARCH + REPLY
// ==========================================
app.get("/api/admin/messages", requireAdmin, async (req,res)=>{
    try{
        const messages=hasSupabase
          ? await sbRequest("support_messages","GET","?select=*&order=created_at.desc&limit=500")
          : supportMessages;
        res.json({success:true,persistent:hasSupabase,messages});
    }catch(error){console.error("ADMIN MESSAGES ERROR:",error.message);res.status(503).json({success:false,message:"Could not load support inbox"});}
});
app.get("/api/admin/users", requireAdmin, async (req,res)=>{
    const q=String(req.query.q||"").trim().toLowerCase();
    try{
        const rows=hasSupabase
          ? await sbRequest("support_messages","GET","?select=user_id,name,email,avatar,created_at&order=created_at.desc&limit=1000")
          : supportMessages;
        const seen=new Set(), users=[];
        for(const m of rows||[]){
            const id=String(m.user_id||"");
            if(!id||seen.has(id))continue; seen.add(id);
            const u={user_id:id,name:m.name||"",email:m.email||"",avatar:m.avatar||null,last_seen:m.created_at||m.createdAt||null};
            if(!q||[id,u.name,u.email].some(v=>String(v).toLowerCase().includes(q)))users.push(u);
        }
        res.json({success:true,users:users.slice(0,100),persistent:hasSupabase});
    }catch(error){console.error("ADMIN USERS ERROR:",error.message);res.status(503).json({success:false,message:"Could not search users"});}
});
app.patch("/api/admin/messages/:id", requireAdmin, async (req,res)=>{
    try{
        if(hasSupabase){
            const rows=await sbRequest("support_messages","PATCH",`?id=eq.${encodeURIComponent(req.params.id)}`,{read:Boolean(req.body?.read),status:req.body?.status||"read"},"return=representation");
            if(!rows?.length)return res.status(404).json({success:false,message:"Message not found"});
            return res.json({success:true,message:rows[0]});
        }
        const m=supportMessages.find(x=>x.id===req.params.id);
        if(!m)return res.status(404).json({success:false,message:"Message not found"});
        m.read=Boolean(req.body?.read);m.status=req.body?.status||"read";res.json({success:true,message:m});
    }catch(error){console.error("ADMIN MESSAGE UPDATE ERROR:",error.message);res.status(503).json({success:false,message:"Could not update message"});}
});
app.post("/api/admin/messages/:id/reply", requireAdmin, async (req,res)=>{
    const body=String(req.body?.body||"").trim();
    const translations=req.body?.translations&&typeof req.body.translations==="object"?req.body.translations:{};
    if(!body)return res.status(400).json({success:false,message:"Reply text required"});
    try{
        let message;
        if(hasSupabase){
            const found=await sbRequest("support_messages","GET",`?select=id,user_id& id=eq.${encodeURIComponent(req.params.id)}`.replace("& id","&id"));
            message=found?.[0];
        }else message=supportMessages.find(x=>x.id===req.params.id);
        if(!message)return res.status(404).json({success:false,message:"Message not found"});
        const reply={id:randomUUID(),user_id:message.user_id,message_id:message.id,sender:"admin",body:body.slice(0,4000),translations,created_at:new Date().toISOString(),automatic:false};
        if(hasSupabase){
            await sbRequest("support_replies","POST","",reply,"return=minimal");
            await sbRequest("support_messages","PATCH",`?id=eq.${encodeURIComponent(message.id)}`,{status:"replied",read:true},"return=minimal");
            const nt={id:`nt_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,title:"FLASH LIVE Support",body:body.slice(0,4000),user_id:message.user_id,translations,created_at:new Date().toISOString(),active:true};
            await sbRequest("notifications","POST","",nt,"return=minimal");
        }else { memorySupportReplies.push(reply); memoryNotifications.unshift({id:reply.id,title:"FLASH LIVE Support",body:body,user_id:message.user_id,created_at:reply.created_at,active:true}); }
        res.status(201).json({success:true,persistent:hasSupabase,reply});
    }catch(error){console.error("ADMIN REPLY ERROR:",error.message);res.status(503).json({success:false,message:"Could not send reply"});}
});

// ==========================================
// USER FLASH LIVE STREAM LIST
// ==========================================

app.get("/api/flash-live", (req, res) => {
    res.json({
        success: true,
        streams: flashStreams.filter(
            stream => stream.active !== false
        )
    });
});

// ==========================================
// ADMIN STREAM LIST
// ==========================================

app.get("/api/admin/streams", requireAdmin, (req, res) => {
    res.json({
        success: true,
        streams: flashStreams
    });
});

// ==========================================
// ADMIN ADD STREAM
// ==========================================

app.post("/api/admin/streams", requireAdmin, (req, res) => {
    const parsed = cleanStreamInput(req.body);

    if (parsed.error) {
        return res.status(400).json({
            success: false,
            message: parsed.error
        });
    }

    const stream = {
        id: `st_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        ...parsed.value,
        createdAt: new Date().toISOString(),
        active: true
    };

    flashStreams.unshift(stream);

    res.status(201).json({
        success: true,
        stream
    });
});

// ==========================================
// ADMIN EDIT / START / STOP STREAM
// ==========================================

app.put("/api/admin/streams/:id", requireAdmin, (req, res) => {
    const stream = flashStreams.find(
        item => item.id === req.params.id
    );

    if (!stream) {
        return res.status(404).json({
            success: false,
            message: "Stream not found"
        });
    }

    if (typeof req.body?.active === "boolean") {
        stream.active = req.body.active;
    }

    if (
        req.body?.title !== undefined ||
        req.body?.url !== undefined
    ) {
        const parsed = cleanStreamInput({
            title: req.body.title ?? stream.title,
            url: req.body.url ?? stream.url
        });

        if (parsed.error) {
            return res.status(400).json({
                success: false,
                message: parsed.error
            });
        }

        Object.assign(stream, parsed.value);
    }

    res.json({
        success: true,
        stream
    });
});

// ==========================================
// ADMIN DELETE STREAM
// ==========================================

app.delete("/api/admin/streams/:id", requireAdmin, (req, res) => {
    const index = flashStreams.findIndex(
        item => item.id === req.params.id
    );

    if (index < 0) {
        return res.status(404).json({
            success: false,
            message: "Stream not found"
        });
    }

    flashStreams.splice(index, 1);

    res.json({ success: true });
});


// ==========================================
// NOTIFICATIONS (Admin publish + user inbox)
// ==========================================

function safeUserId(value) {
    const id = String(value || "").trim();
    return id && id.length <= 128 ? id : "";
}

app.get("/api/notifications", async (req, res) => {
    const userId = safeUserId(req.query.user_id);
    const userLang = ["my","en","th","zh","es"].includes(req.query.lang) ? req.query.lang : "my";
    if (!userId) return res.status(400).json({ success: false, message: "user_id required" });
    try {
        let items = [], readIds = new Set();
        if (hasSupabase) {
            const rows = await sbRequest("notifications","GET",
              `?select=*&active=eq.true&or=(user_id.is.null,user_id.eq.${encodeURIComponent(userId)})&order=created_at.desc&limit=100`);
            const reads = await sbRequest("notification_reads","GET",
              `?select=notification_id&user_id=eq.${encodeURIComponent(userId)}`);
            items = Array.isArray(rows) ? rows : [];
            readIds = new Set((Array.isArray(reads) ? reads : []).map(x => x.notification_id));
        } else {
            items = memoryNotifications.filter(x => x.active !== false && (!x.user_id || x.user_id === userId));
            readIds = new Set([...memoryNotificationReads].filter(x => x.startsWith(`${userId}::`)).map(x => x.slice(userId.length + 2)));
        }
        res.set("Cache-Control","no-store");
        res.json({success:true,persistent:hasSupabase,notifications:items.map(x=>({
          id:x.id,title:x.title,body:(x.translations&&x.translations[userLang])||x.body,
          created_at:x.created_at||x.createdAt,read:readIds.has(x.id)
        }))});
    } catch(error) {
        console.error("NOTIFICATIONS GET ERROR:",error.message);
        res.status(503).json({success:false,message:"Notification database unavailable"});
    }
});

app.post("/api/notifications/:id/read", async (req, res) => {
    const userId = safeUserId(req.body?.user_id);
    const id = String(req.params.id || "").trim();
    if (!userId || !id) return res.status(400).json({ success: false, message: "user_id and notification id required" });

    try {
        if (hasSupabase) {
            await sbRequest("notification_reads", "POST", "?on_conflict=user_id,notification_id", {
                user_id: userId,
                notification_id: id,
                read_at: new Date().toISOString()
            }, "resolution=merge-duplicates,return=minimal");
        } else {
            memoryNotificationReads.add(`${userId}::${id}`);
        }
        res.json({ success: true, persistent: hasSupabase });
    } catch (error) {
        console.error("NOTIFICATION READ ERROR:", error.message);
        res.status(503).json({ success: false, message: "Could not save read status" });
    }
});

app.post("/api/notifications/read-all", async (req, res) => {
    const userId = safeUserId(req.body?.user_id);
    if (!userId) return res.status(400).json({ success: false, message: "user_id required" });

    try {
        if (hasSupabase) {
            const rows = await sbRequest(
                "notifications",
                "GET",
                `?select=id&active=eq.true&or=(user_id.is.null,user_id.eq.${encodeURIComponent(userId)})&limit=500`
            );
            const records = (Array.isArray(rows) ? rows : []).map(x => ({
                user_id: userId,
                notification_id: x.id,
                read_at: new Date().toISOString()
            }));
            if (records.length) {
                await sbRequest("notification_reads", "POST", "?on_conflict=user_id,notification_id", records,
                    "resolution=merge-duplicates,return=minimal");
            }
        } else {
            memoryNotifications.filter(x => x.active !== false && (!x.user_id || x.user_id === userId))
                .forEach(x => memoryNotificationReads.add(`${userId}::${x.id}`));
        }
        res.json({ success: true, persistent: hasSupabase });
    } catch (error) {
        console.error("NOTIFICATION READ-ALL ERROR:", error.message);
        res.status(503).json({ success: false, message: "Could not save read status" });
    }
});

app.post("/api/admin/notifications", requireAdmin, async (req, res) => {
    const title=String(req.body?.title||"").trim(), body=String(req.body?.body||"").trim();
    const targetUserId=req.body?.user_id?safeUserId(req.body.user_id):null;
    const translations=req.body?.translations&&typeof req.body.translations==="object"?req.body.translations:{};
    if(!title||!body)return res.status(400).json({success:false,message:"Title and message required"});
    if(title.length>160||body.length>4000)return res.status(400).json({success:false,message:"Title or message is too long"});
    const item={id:`nt_${Date.now()}_${Math.random().toString(36).slice(2,9)}`,title,body,user_id:targetUserId,translations,created_at:new Date().toISOString(),active:true};
    try{
        if(hasSupabase)await sbRequest("notifications","POST","",item,"return=representation");
        else {memoryNotifications.unshift(item);if(memoryNotifications.length>500)memoryNotifications.length=500;}
        res.status(201).json({success:true,persistent:hasSupabase,notification:item});
    }catch(error){console.error("NOTIFICATION PUBLISH ERROR:",error.message);res.status(503).json({success:false,message:"Could not save notification to database"});}
});

// ==========================================
// 404 NOT FOUND
// ==========================================

app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: "API endpoint not found",
        path: req.path
    });
});

// ==========================================
// START SERVER
// ==========================================

app.listen(PORT, "0.0.0.0", () => {
    console.log(
        `FLASH LIVE API v4.3.1 listening on ${PORT}`
    );
});