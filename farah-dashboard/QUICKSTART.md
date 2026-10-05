# 🚀 Quick Start (5 Minutes)

Get your dashboard running locally in minutes.

## 1. Clone & Install (1 min)

```bash
git clone https://github.com/YOUR_USERNAME/farah-dashboard.git
cd farah-dashboard
npm install
```

## 2. Get Supabase Keys (2 min)

1. Sign up: [supabase.com](https://supabase.com)
2. Create project
3. Settings → API → copy Project URL and Anon Key
4. Create `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=<paste_url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<paste_key>
```

5. Go to SQL Editor, paste this, and run:

```sql
-- Tables for dashboard
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID DEFAULT auth.uid(),
  title TEXT,
  category TEXT,
  date DATE,
  status TEXT DEFAULT 'todo'
);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID DEFAULT auth.uid(),
  name TEXT
);

CREATE TABLE IF NOT EXISTS grocery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID DEFAULT auth.uid(),
  item TEXT,
  store TEXT
);

-- Enable RLS
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE grocery ENABLE ROW LEVEL SECURITY;
```

## 3. Get Google OAuth Keys (2 min)

1. Go: [console.cloud.google.com](https://console.cloud.google.com)
2. Create project
3. Enable APIs: Search "Gmail API" → Enable, Search "Calendar API" → Enable
4. Credentials → Create OAuth 2.0 Client ID (Web application)
5. Authorized redirect: `http://localhost:3000/api/auth/callback/google`
6. Copy Client ID and Secret to `.env.local`:

```bash
GOOGLE_CLIENT_ID=<paste_id>
GOOGLE_CLIENT_SECRET=<paste_secret>
NEXTAUTH_SECRET=$(openssl rand -base64 32)
NEXTAUTH_URL=http://localhost:3000
```

## 4. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) → Click "Sign in with Google"

✅ Done! Your dashboard is live locally.

---

## What Works

- ✅ Weather (Rochester, MN)
- ✅ Gmail (last 5 unread)
- ✅ Calendar (next 7 days)
- ✅ Dark mode
- ✅ Responsive mobile view

## Next Steps

1. **Deploy to Vercel**: See [DEPLOY.md](./DEPLOY.md)
2. **Add tasks to database**: Use the dashboard to create tasks
3. **Customize styling**: Edit `app/globals.css` and Tailwind config
4. **Change weather location**: Edit `app/api/weather/route.ts`

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Unauthorized" emails/calendar | Re-sign in after enabling APIs |
| `.env.local` not found | Create file in project root |
| Port 3000 in use | `npm run dev -- -p 3001` |
| Can't sign in | Check NEXTAUTH_URL = http://localhost:3000 |

---

For full setup & deployment: [DEPLOY.md](./DEPLOY.md)
