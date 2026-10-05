# Farah Master Dashboard

A full-stack Next.js dashboard with real-time integrations for Gmail, Google Calendar, and weather—designed for busy parents managing tasks, projects, and household logistics.

## Features

✅ **Task Management** - Categories (Kids, Work, Home, Errands, Self, Activity, Omar)
✅ **Projects & Ideas** - Track ongoing work and capture ideas
✅ **Grocery Lists** - Organize by store (Costco, Trader Joe's, Target, etc.)
✅ **Gmail Integration** - View unread emails as action items
✅ **Google Calendar** - See next 7 days of events
✅ **Weather** - Real-time Rochester, MN weather
✅ **Responsive Design** - Dark/light mode, mobile-friendly
✅ **Real-time Sync** - Supabase backend syncs across devices
✅ **OAuth Authentication** - Google sign-in with permission scopes

## Quick Start

### 1. Clone & Install
```bash
git clone https://github.com/yourusername/farah-dashboard.git
cd farah-dashboard
npm install
```

### 2. Supabase Setup
1. Create account at supabase.com
2. New project → copy Project URL and Anon Key
3. SQL Editor → paste contents of `supabase/schema.sql` → Run
4. Add to `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=your_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_key
```

### 3. Google OAuth
1. Google Cloud Console → Create project
2. Enable Gmail API & Google Calendar API
3. OAuth 2.0 credentials (Web):
   - Redirect URI: http://localhost:3000/api/auth/callback/google
4. Add to `.env.local`:
```
GOOGLE_CLIENT_ID=your_id
GOOGLE_CLIENT_SECRET=your_secret
NEXTAUTH_SECRET=$(openssl rand -base64 32)
NEXTAUTH_URL=http://localhost:3000
```

### 4. Run Locally
```bash
npm run dev
# Open http://localhost:3000
```

## Deploy to Vercel

1. Push to GitHub
2. vercel.com → Import from GitHub
3. Add environment variables
4. Deploy!

## Tech Stack

- Next.js 16 + React 19 + Tailwind CSS
- Supabase (PostgreSQL + Auth)
- NextAuth.js (Google OAuth)
- Gmail, Google Calendar, Open-Meteo APIs

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Client Secret |
| `NEXTAUTH_SECRET` | Random 32-char secret |
| `NEXTAUTH_URL` | http://localhost:3000 (dev) or your domain (prod) |

## Features in Detail

### Brain Dump
Type freely, hit "Organize" to parse into tasks/groceries/ideas. Review before adding.

### Task Management
- Categories: Kids, Work, Home, Errands, Self, Activity, Omar
- Status: Todo, Doing, Done, Dropped
- Date, time, project assignment
- Carried-over tasks highlighted at top

### Schedule Views
- **Kanban**: Tasks by status with donut breakdown
- **Week**: 7-day view with calendar events

### Projects
Track ongoing work with linked tasks.

### Grocery
Items by store. Check off as you shop. Suggestions for grouped trips.

### Dress Code
Set clothing recommendations for each child based on weather.

### Real-time Sync
All changes sync instantly to Supabase and across your devices.

### API Integrations
- **Gmail**: Last 5 unread emails in "Action Items"
- **Calendar**: Next 7 days of events in Week View
- **Weather**: Real-time temp, condition, feels-like for Rochester, MN

## File Structure

```
app/
  ├── page.tsx              # Sign-in & main page
  ├── layout.tsx            # Root layout with NextAuth provider
  └── api/
      ├── auth/[...nextauth].ts
      ├── gmail/route.ts
      ├── calendar/route.ts
      └── weather/route.ts
components/
  └── Dashboard.tsx         # Main UI component
lib/
  └── supabase.ts          # DB client & types
supabase/
  └── schema.sql           # Database schema
```

## Customization

### Change Weather Location
Edit `app/api/weather/route.ts` (currently Rochester, MN):
```typescript
// Change coordinates
const response = await fetch(
  "https://api.open-meteo.com/v1/forecast?latitude=40.7128&longitude=-74.0060&..."
);
```

### Add Google APIs
Update scopes in `app/api/auth/[...nextauth].ts`:
```typescript
scope: "...&https://www.googleapis.com/auth/drive.readonly&...",
```

## Troubleshooting

**Unauthorized Gmail/Calendar errors?**
- Enable APIs in Google Cloud Console
- Check OAuth scopes include `gmail.readonly` & `calendar.readonly`
- Re-sign in after enabling

**Supabase connection fails?**
- Verify URL & keys in `.env.local`
- Check RLS policies in Supabase dashboard
- Test connection in SQL Editor

**Vercel 500 errors?**
- Set all env vars in Vercel dashboard
- Review logs in Analytics
- Don't commit `.env.local`

## License

MIT

---

**Made for busy families managing chaos one task at a time**
