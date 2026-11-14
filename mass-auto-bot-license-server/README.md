# Mass Auto Bot — License Key Server

Supabase-er bodle nijer license server. Node.js, kono dependency lagbe na — `node server.js` dilei cholbe.

Extension-er `popup.js` age Supabase-ke jevabe call korto (`/rest/v1/licenses`), ei server thik sei endpoint-guloi dey. Tai extension-e sudhu **1 ta line** bodlate hobe: server-er URL.

## Files

- `server.js` — puro server (zero dependency)
- `package.json` — `npm start` = `node server.js`
- `licenses.json` — key-gulor database (JSON file). Eta backup kore rekho.
- `.env.example` — copy kore `.env` banao, ba hosting-e environment variable set koro

## 1. Local-e chalao

```bash
node server.js
# listening on http://localhost:3000
# admin UI: http://localhost:3000/admin
```

`ADMIN_KEY` set na thakle terminal-e ekta random key print hobe — ota diye `/admin`-e login koro. Permanent key chaile:

```bash
PORT=3000 ADMIN_KEY=tomar-lomba-secret node server.js
```

Test koro:

```bash
# key banao (admin)
curl -X POST http://localhost:3000/api/admin/generate \
  -H "x-admin-key: TOMAR-ADMIN-KEY" -H "Content-Type: application/json" \
  -d '{"prefix":"USER"}'

# verify koro
curl -X POST http://localhost:3000/api/verify \
  -H "Content-Type: application/json" \
  -d '{"key":"USER-XXXX-XXXX-XXXX","device_id":"dev_test123"}'

# list
curl http://localhost:3000/api/admin/licenses -H "x-admin-key: TOMAR-ADMIN-KEY"
```

## 2. Online deploy koro (jekono ekta)

Server-ke internet-e rakhte hobe, nahole onno user-er extension key verify korte parbe na.

**Render (free, shohoj):**
1. Ei folder-ta GitHub-e push koro
2. Render > New Web Service > repo select koro
3. Build Command: khali rakho / `npm install` (kono dependency nei)
4. Start Command: `node server.js`
5. Environment variable: `ADMIN_KEY` = lomba random secret
6. Deploy hole URL paba, jemon `https://mass-license.onrender.com`

**Railway / VPS:** same — `node server.js`, `PORT` hosting nije set kore, `ADMIN_KEY` environment-e set koro.

> Free Render service ghumiye gele prothom request-e 30-60 sec lagte pare. Extension-e verify fail hole popup-e "Network error" dekhabe — eta server ghumiye thakar karon hote pare.

## 3. Extension-ke server-er sathe jukto koro

`popup.js`-e **sudhu ei line-ta** bodlao:

```js
const SUPABASE_URL = "https://TOMAR-SERVER-URL";
```

`SUPABASE_KEY`-er line-ta jemon ache temon rekho — server oi header-ta ignore kore.

`manifest.json`-e server-er host-ta add koro, nahole Chrome fetch block korbe:

```json
"host_permissions": [
  "https://*.supabase.co/",
  "https://TOMAR-SERVER-URL/*"
]
```

Tarpor extension-ta abar zip kore Load unpacked diye load koro (version bodlate hobe na).

## 4. Key manage koro

**Admin web UI:** `https://TOMAR-SERVER-URL/admin` — `ADMIN_KEY` diye login.
Ekhane Generate / Revoke / Unlock / Unbind device / Delete korte parba.

**Extension-er vitore admin panel-o cholbe** — master key diye unlock korle Dashboard-e Admin button asbe, ager motoi key generate / list / revoke / delete kora jabe.

## Key-er niyom (ager motoi)

- Key format: `PREFIX-XXXX-XXXX-XXXX`, jemon `USER-A1B2-C3D4-E5F6`
- Prothom bar use korle key-ta oi device-er sathe lock hoye jay (`device_id`)
- Onno device-e cholbe na — admin chaile `/admin` theke **Unbind device** korte pare
- `status: revoked` hole unlock hobe na, ar extension 10 sec por por check kore — admin Unlock korle dashboard-e chole jabe

## API (extension-er jonno — Supabase-compatible)

```
GET    /rest/v1/licenses?key=eq.KEY&select=*
GET    /rest/v1/licenses?select=*&order=created_at.desc
POST   /rest/v1/licenses            { "key": "...", "status": "active" }
PATCH  /rest/v1/licenses?key=eq.KEY  { "device_id": "..." } / { "status": "revoked" }
DELETE /rest/v1/licenses?key=eq.KEY
```

Clean API:

```
POST /api/verify           { "key": "...", "device_id": "..." }
GET  /api/admin/licenses   (header: x-admin-key)
POST /api/admin/generate   { "prefix": "USER" }
POST /api/admin/toggle     { "key": "..." }
POST /api/admin/unbind     { "key": "..." }
DELETE /api/admin/licenses/:key
```

## Security — joruri

- `/rest/v1/*` endpoint-gulo khola, ager Supabase anon-key setup-er motoi. **Server-er URL publicly share koro na.**
- `ADMIN_KEY` kauke dio na — eta admin panel-er password, extension-er master key theke alada.
- `licenses.json` backup rakho — ei file harale sob key harabe.
- `REQUIRE_ADMIN_FOR_WRITE=1` set korle Supabase-style POST/DELETE-e admin token lagbe — tokhon extension-er vitore admin panel diye generate/delete cholbe na, sudhu `/admin` diye korte hobe.
