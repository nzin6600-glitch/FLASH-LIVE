FLASH LIVE V4 - Notification Inbox

ပါဝင်သောဖိုင်များ
- index.html: User App (Notification bell + inbox + unread badge)
- admin.html: Admin notification broadcast panel
- server.js: Notification API + Admin protected publish endpoint
- notifications.sql: Supabase database tables
- .env.example: Render environment variables sample

တပ်ဆင်ရန်
1) Supabase SQL Editor တွင် notifications.sql ကို Run လုပ်ပါ။
2) Render Environment တွင် ADMIN_ACCESS_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY ထည့်ပါ။
   API_FOOTBALL_KEY ကိုလည်း သင့်ကိုယ်ပိုင် key ဖြင့် ထည့်ပါ။
3) SUPABASE_SERVICE_ROLE_KEY ကို HTML/Admin page ထဲ မထည့်ပါနှင့်။ Server Environment တွင်သာထားပါ။
4) Git repository root တွင် index.html, admin.html, server.js, package.json တင်ပါ။
5) Render Start Command: npm start
6) User App: /app သို့မဟုတ် root static serving setup ကိုသုံးပါ။ Server က /app နှင့် /admin route များမှ index.html၊ admin.html ကို ဖွင့်ပေးသည်။
7) Admin Page: /admin ကိုဖွင့်ပါ။

သတိပြုရန်
- Supabase env များ မထည့်ထားလျှင် notification များသည် RAM ထဲသာသိမ်းပြီး server restart လုပ်လျှင် ပျောက်မည်။
- ဒီ build သည် App အတွင်း Notification Inbox ဖြစ်သည်။ ဖုန်း lock screen / background push notification မဟုတ်သေးပါ။
  Push အစစ်အတွက် Firebase Cloud Messaging project, Web Push certificate/VAPID, service worker နှင့် device subscription flow ထပ်လိုသည်။
- Notification inbox, unread badge, read-one, read-all, admin broadcast endpoints ၏ JavaScript syntax ကို စစ်ဆေးပြီးဖြစ်သည်။
- Football API integration, live stream licensing, user OAuth ကို ဒီ notification patch က မပြောင်းထားပါ။


NOTIFICATION FIX (V4.1)
======================
Admin notification API routes are now implemented in server.js:
- POST /api/admin/notifications (x-admin-key required)
- GET /api/notifications?user_id=...
- POST /api/notifications/:id/read
- POST /api/notifications/read-all

To make notifications persist:
1. Open Supabase SQL Editor and run notifications.sql.
2. In Render -> Environment, set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
3. Set ADMIN_ACCESS_KEY to a long private random value.
4. Deploy/redeploy the service.
5. Open /admin, enter the same ADMIN_ACCESS_KEY, publish a notification.
6. Open /app and tap the bell. The badge refreshes every 45 seconds while the page is visible.

Without Supabase environment variables, the API uses temporary server memory; notifications are lost after a server restart.
This release implements the in-app notification inbox and admin broadcast. It does NOT implement Android/browser lock-screen push notifications. Those require a push provider (for example Firebase Cloud Messaging), client token registration, and service-worker/native-app integration.


FLASH LIVE USER SUPPORT + NOTIFICATION UPDATE
=============================================
- public/index.html: User notification bell, unread badge, support conversation thread and acknowledgement.
- public/admin.html: Admin notification composer, optional per-language message fields, user search (users with support history), support inbox and reply composer.
- server.js: Persistent Supabase notification/support APIs. Admin replies also create a targeted FLASH LIVE notification.
- notifications.sql: Run the FULL updated SQL in Supabase SQL Editor to add notification targeting/translations and support reply storage.

IMPORTANT:
1. Replace the matching files in GitHub: public/index.html, public/admin.html, root server.js, and root notifications.sql.
2. Run the complete updated notifications.sql in Supabase SQL Editor.
3. Keep SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_ACCESS_KEY, API_FOOTBALL_KEY and RAPIDAPI_KEY in Render Environment. Never place the service-role key in HTML.
4. Admin user search can find users who have submitted a support message. This project currently has no verified sign-in/user directory, so it cannot search accounts that have never contacted support.
5. Name/email/avatar shown to Admin are the values entered in the user's local Profile, not Google-verified identity.
6. The app shows an in-app inbox, notification badge, and foreground browser notification/sound while the page is open and permission is granted. True background/closed-app push requires Firebase Cloud Messaging (FCM) setup and credentials; it is not enabled by these files.
7. Per-language notification/reply translations are supplied through the optional English, Thai, Chinese and Spanish fields. If a translation field is left blank, the original message is shown; automatic machine translation is not configured.
