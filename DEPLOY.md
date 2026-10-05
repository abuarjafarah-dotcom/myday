# Deployment Guide: Farah Dashboard to Vercel

This guide walks through deploying your dashboard to production on Vercel with full API integrations.

## Prerequisites

- GitHub account
- Vercel account (free)
- Supabase account (free)
- Google Cloud Console project with OAuth configured

---

## Step 1: Push to GitHub

```bash
git remote add origin https://github.com/YOUR_USERNAME/farah-dashboard.git
git branch -M main
git push -u origin main
```

## Step 2: Set Up Supabase

### Create Project
1. Go to [supabase.com](https://supabase.com)
2. New project → save credentials
3. Go to **SQL Editor** → paste contents of `supabase/schema.sql`
4. Run the SQL to create tables and RLS policies

### Get Connection Info
- Project URL: Settings → API → Project URL
- Anon Key: Settings → API → anon public key

## Step 3: Configure Google OAuth

### In Google Cloud Console

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create new project (or use existing)
3. **Enable APIs**:
   - Search "Gmail API" → Enable
   - Search "Google Calendar API" → Enable

4. **Create OAuth Credentials**:
   - APIs & Services → Credentials → Create Credentials → OAuth client ID
   - Application type: Web application
   - Authorized redirect URIs:
     - `http://localhost:3000/api/auth/callback/google` (for local dev)
     - `https://YOUR_DOMAIN.vercel.app/api/auth/callback/google` (for production)
   - Copy **Client ID** and **Client Secret**

## Step 4: Deploy to Vercel

### Connect GitHub to Vercel

1. Go to [vercel.com](https://vercel.com)
2. Sign in with GitHub
3. Import project from GitHub → select `farah-dashboard`
4. Vercel auto-detects Next.js framework ✓

### Add Environment Variables

In Vercel dashboard, go to project settings → Environment Variables:

```
NEXT_PUBLIC_SUPABASE_URL=<your_supabase_url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your_supabase_anon_key>
GOOGLE_CLIENT_ID=<your_google_client_id>
GOOGLE_CLIENT_SECRET=<your_google_client_secret>
NEXTAUTH_SECRET=<random_32_char_secret>
NEXTAUTH_URL=https://YOUR_DOMAIN.vercel.app
```

### Generate NEXTAUTH_SECRET

```bash
openssl rand -base64 32
```

Then paste output in Vercel environment variables.

### Deploy

Click **Deploy** → Vercel builds and deploys your app.

Your dashboard is now live at `https://farah-dashboard-[random].vercel.app`

## Step 5: Update Google OAuth URI

Now that you have your Vercel domain, add it to Google OAuth:

1. Google Cloud Console → OAuth 2.0 Clients → your client
2. Add redirect URI:
   ```
   https://your-vercel-domain.vercel.app/api/auth/callback/google
   ```
3. Save

## Step 6: Custom Domain (Optional)

1. Buy domain from registrar (Vercel Domains, Namecheap, GoDaddy, etc.)
2. Vercel dashboard → Settings → Domains
3. Add your domain
4. Follow DNS configuration instructions
5. Update Google OAuth redirect URI with custom domain

## Step 7: Test Live App

1. Visit your production URL
2. Click "Sign in with Google"
3. Approve Gmail and Calendar access
4. Dashboard fetches:
   - ✅ Weather for Rochester, MN
   - ✅ Last 5 unread emails
   - ✅ Next 7 days of calendar events

## Monitoring & Troubleshooting

### View Logs

Vercel dashboard → Deployments → select deployment → Function Logs

### Common Issues

| Issue | Solution |
|-------|----------|
| 401 Unauthorized on Gmail/Calendar | Re-sign in after enabling APIs in Google Cloud |
| Missing environment variables | Check all vars are in Vercel dashboard |
| Email: "Failed to fetch emails" | Verify Gmail API is enabled, OAuth scopes correct |
| Calendar: "Error fetching events" | Verify Calendar API is enabled |
| Weather shows "Unknown" | Check Open-Meteo API is accessible (it's free, no config) |

### Database Connection Issues

1. Vercel → Project Settings → SQL
2. Check Supabase connection string
3. Verify RLS policies in Supabase dashboard
4. Test query in Supabase SQL Editor

---

## Continuous Deployment

Every `git push` to main triggers:
1. Vercel builds your app
2. Runs in preview environment
3. Auto-deploys to production if build succeeds

To preview before merging:
1. Create feature branch: `git checkout -b feature/my-feature`
2. Push to GitHub: `git push origin feature/my-feature`
3. Vercel creates preview deployment (link in PR)
4. Merge to main to deploy to production

---

## Performance & Scaling

- **Vercel Serverless Functions**: Auto-scale API routes
- **Supabase**: Free tier supports ~500K requests/month
- **Database**: Auto-backup, RLS improves security
- **Weather API**: Free Open-Meteo service, 10K req/day

---

## Adding More Features

### Add Another Google API
1. Enable API in Google Cloud Console
2. Update OAuth scopes in `app/api/auth/[...nextauth].ts`
3. Create new API route (e.g., `app/api/gmail/route.ts`)
4. Deploy to Vercel

### Change Weather Location
Edit `app/api/weather/route.ts`:
```typescript
const response = await fetch(
  "https://api.open-meteo.com/v1/forecast?latitude=40.7128&longitude=-74.0060&..."
);
```

### Add Database Tables
1. Create table in Supabase SQL Editor
2. Add RLS policies
3. Update `lib/supabase.ts` types
4. Use in your components

---

## Rollback to Previous Version

If something breaks:
1. Vercel Deployments → select previous build
2. Click "..." → Redeploy
3. Done! (No git revert needed)

---

## Need Help?

- **Vercel Docs**: https://vercel.com/docs
- **Supabase Docs**: https://supabase.com/docs
- **NextAuth Docs**: https://next-auth.js.org
- **Next.js Docs**: https://nextjs.org/docs

Happy deploying! 🚀
