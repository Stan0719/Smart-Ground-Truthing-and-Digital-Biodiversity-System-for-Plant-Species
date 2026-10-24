# Mobile app backend connection

The plant screen requests `GET /api/species` from the backend. Configure the API origin in `mobileapp/.env.local`:

```env
EXPO_PUBLIC_API_URL=https://your-deployed-backend.example.com
```

Restart Expo after changing the value. The app currently falls back to the existing Render deployment if the variable is unset. Use an HTTPS address reachable from the phone; `localhost` on a phone refers to the phone itself.

## Supabase database

The mobile app must not contain a PostgreSQL connection string, database password, or Supabase service-role key. Configure `DATABASE_URL` in the backend host's server-side environment (for example, Render's environment settings) using the Supabase PostgreSQL connection string. Keep it private, redeploy/restart the backend, then check:

- `https://your-deployed-backend.example.com/api/db-test`
- `https://your-deployed-backend.example.com/api/species`

The database test should report success, and the species endpoint should return JSON. Then set `EXPO_PUBLIC_API_URL` to that same backend origin and restart Expo. Never commit `.env.local` or share a real database password in chat.
