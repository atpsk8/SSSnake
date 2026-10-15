# Online setup: play strangers and friends over the internet

Online Versus (`match`, `invite`, `join`), the global leaderboard and leaderboard replays need three things:

1. **The game deployed on Vercel.** Players open the same public URL.
2. **An Upstash Redis store** connected to the Vercel project. It holds matchmaking rooms (briefly), the quick-match queue, scores and replays. The free tier is plenty.
3. **Optional, but recommended: a TURN relay.** Most players connect directly peer to peer. Some networks (offices, schools, some mobile carriers) block that, and a relay passes the traffic through instead. Without one, those players will see "couldn't connect".

Everything else (the endpoints, the code, the fallbacks) is already in the repo. The steps below need your accounts, so only you can do them.

---

## 1. Log in to Vercel (you)

In a terminal in the project folder:

```bash
npx vercel login
```

Pick how to log in (GitHub, email, etc.) and finish in the browser.

## 2. Create the project and do a first deploy

```bash
npx vercel link
npx vercel deploy --prod
```

`link` asks a few questions. Accept the defaults: it creates a project called `sssnake`, and the framework is detected as **Vite**. The deploy prints your public URL (e.g. `https://sssnake.vercel.app`).

> Claude can run these two for you once you're logged in. Just say so. Deploying publishes the game.

## 3. Add the Upstash Redis store (you, in the browser)

1. Open the project on vercel.com, go to the **Storage** tab, and click **Create Database**.
2. Choose **Upstash for Redis** (from the Marketplace), pick the **Free** plan and a region near your players, and create it.
3. Connect it to the `sssnake` project for **Production** and **Preview**.

Vercel adds `KV_REST_API_URL` / `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`) to the project automatically. The game accepts either naming.

## 4. Add a TURN relay (recommended)

Pick **one**.

**Option A: Cloudflare TURN (generous free allowance)**

1. Cloudflare dashboard → **Realtime** (sometimes listed as **Calls**) → **TURN Server** → **Create**.
2. Copy the **Turn Token ID** and the **API Token** shown once at creation.
3. Add them to Vercel:
   ```bash
   npx vercel env add CLOUDFLARE_TURN_KEY_ID production
   npx vercel env add CLOUDFLARE_TURN_KEY_API_TOKEN production
   ```
   Paste each value when asked. The token stays on the server: browsers only receive short-lived credentials from `/api/ice`.

**Option B: any TURN provider** (e.g. Metered's free plan, or your own coturn server)

```bash
npx vercel env add TURN_URLS production         # e.g. turn:global.relay.metered.ca:80,turns:global.relay.metered.ca:443?transport=tcp
npx vercel env add TURN_USERNAME production
npx vercel env add TURN_CREDENTIAL production
```

Check the provider's current pricing and limits before going public.

## 5. Redeploy so the new settings take effect

```bash
npx vercel deploy --prod
```

## 6. Check it works

1. Open your URL and type `netcheck`. You want:
   ```
   matchmaking store .... OK
   relay (turn) ......... OK (cloudflare)
   webrtc ............... OK
   ```
2. **Friend test:** on a laptop, type `invite`. On a phone **on mobile data** (not your Wi-Fi), type `join CODE` or open the link. Mobile data is the hard case, so if this works, most networks will.
3. **Strangers:** both players type `match`. The first one waits in the public queue, and the second joins them.

---

## What players see if something is missing

| Missing | Effect |
| --- | --- |
| Upstash | `match` / `invite` say online play isn't set up; leaderboards fall back to this device. |
| TURN relay | Most matches still connect; players on strict networks get "couldn't connect". |
| Deployment | Online play only works on `npm run dev` (two windows on one machine). |

## Privacy and cost notes

- Peer-to-peer means each player can see the other's IP address (as in most P2P games). Through a relay, they see the relay's address instead.
- Matchmaking rooms hold connection offers for up to 10 minutes and are deleted as soon as players connect.
- Upstash's free tier and Vercel's Hobby plan comfortably cover a hobby game. A relay only carries traffic for players who can't connect directly; a match uses well under 1 MB per minute.
