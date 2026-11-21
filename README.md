# Multistream Scheduler

Schedule a pre-recorded video to go live on **YouTube, Facebook, Instagram and TikTok** at the same time. It runs on a free cloud server, so you use it from any browser, including your phone, and your own computer can be off.

| Platform | What you do |
|---|---|
| YouTube | Nothing. It goes live by itself. |
| Facebook Page | Nothing. It goes live by itself. |
| Instagram | Paste a new stream key before each stream (your phone reminds you). |
| TikTok | Paste a new stream key before each stream (your phone reminds you). |

Instagram and TikTok don't let outside apps start a live for you, and they give you a new key every time, so that one paste is the only manual step.

---

## 1. Put it on a free cloud server (one time, about 30 minutes)

You need three things: a server, a web address, and this code on the server.

### a) Get a free server (Oracle Cloud "Always Free")
1. Sign up at <https://www.oracle.com/cloud/free/>. Oracle asks for a card to verify your identity, but "Always Free" resources are never charged.
2. Go to **Compute → Instances → Create instance**:
   - **Image:** Ubuntu 24.04
   - **Shape:** Ampere `VM.Standard.A1.Flex` with 2 OCPUs and 12 GB memory (all free).
   - **SSH keys:** download the private key it offers, or paste your own public key.
   - Click **Create**, then copy the **Public IP address**.
   - If it says "Out of capacity", try another Availability Domain or try again later. This is common.
3. Open the web ports: on the instance page, click the **Subnet → Security List → Add Ingress Rules** and add two rules, each with source `0.0.0.0/0`, TCP, destination ports `80` and `443`.

> Any other Ubuntu server works the same way, for example a €4/month VPS. Oracle's free tier includes 10 TB of outgoing data per month. Streaming to all 4 platforms uses about 8 GB per hour, so that's plenty.

### b) Get a free web address (DuckDNS)
1. Sign in at <https://www.duckdns.org>.
2. Create a subdomain, for example `mystreams`, and set its **current ip** to your server's public IP.
3. Your address is now `mystreams.duckdns.org`.

### c) Install the app on the server
Connect to the server from Terminal (Mac) or PowerShell (Windows):

```bash
ssh -i path/to/your-key ubuntu@YOUR.SERVER.IP
```

This repository is **private**, so the server has to sign in to GitHub once before it can download the code. On the server:

```bash
sudo apt-get update && sudo apt-get install -y gh
gh auth login
```

Choose **GitHub.com → HTTPS → Login with a web browser**. It shows a short code: open <https://github.com/login/device> on your own computer or phone and enter it. Then:

```bash
gh repo clone fizoccct-creator/multistream-scheduler
cd multistream-scheduler
sudo bash deploy/setup.sh
```

The script asks for your web address, your time zone and a login password. It then installs everything: FFmpeg, automatic HTTPS, and a background service that restarts by itself. When it finishes, open `https://mystreams.duckdns.org` and sign in.

> Prefer not to sign in to GitHub on the server? Copy the folder from your computer instead: `scp -r multistream-scheduler ubuntu@YOUR.SERVER.IP:` and then run the same `cd` and `sudo bash` commands.

**Updating later:** on the server, run `cd multistream-scheduler && git pull && sudo bash deploy/update.sh`.

---

## 2. Phone notifications (recommended)

Because the app runs on a server, reminders go to your phone through **ntfy**, a free app that needs no account.
1. Install **ntfy** from the App Store or Google Play.
2. In the app's **Settings → Phone notifications**, click **New random**, then **Save**.
3. In the ntfy phone app, tap **+** and subscribe to that same topic.
4. Click **Send test**.

You'll get the "paste your stream key" reminder 15 minutes before a stream (you can change the time in Settings), plus a notification when each stream starts and finishes. Tapping a notification opens the stream in your browser.

Keep the topic name private, because anyone who knows it can read your alerts.

---

## 3. Connect YouTube (one time)

1. Go to <https://console.cloud.google.com> and create a project (any name).
2. **APIs & Services → Library**: search for **YouTube Data API v3** and click **Enable**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External**
   - Fill in an app name and your email.
   - Under **Test users** (sometimes called Audience), add the Google account that owns your YouTube channel.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - **Authorized redirect URIs**: paste the URI shown in the app's Settings page, for example `https://mystreams.duckdns.org/auth/youtube/callback`.
5. Copy the **Client ID** and **Client secret** into the app's Settings page, then click **Connect YouTube** and sign in.
6. Your channel must have live streaming turned on. Check at <https://studio.youtube.com> → **Create → Go live**. The first time can take up to 24 hours to activate.

> While the Google project is in "Testing" mode, Google may ask you to reconnect after 7 days. To avoid that, click **Publish app** on the consent screen. Because only you use it, you don't need Google's verification. Just click through the "unverified app" warning when you sign in.

When you schedule a stream, the app creates the YouTube broadcast right away. It shows up as "Upcoming" on your channel, and the broadcast starts and ends by itself.

## 4. Connect your Facebook Page (one time)

Facebook can only go live automatically on a **Page** (not a personal profile).

1. Go to <https://developers.facebook.com/apps> and create an app (type: **Business**, or "Other → Business").
2. Open the **Graph API Explorer** (<https://developers.facebook.com/tools/explorer>):
   - Select your app.
   - Add these permissions: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `publish_video`
   - Click **Generate Access Token** and allow access to your Page.
3. Make the token long-lived:
   - Open the **Access Token Debugger** (<https://developers.facebook.com/tools/debug/accesstoken>), paste the token, and click **Extend Access Token**. Copy the new token.
   - Back in Graph API Explorer, paste that long-lived token and run `GET me/accounts`.
   - Find your Page in the result. Copy its `id` (the **Page ID**) and its `access_token` (the **Page access token**). A Page token made this way does not expire.
4. Paste both into the app's Settings page and click **Save & test**. You should see your Page's name.

> If Meta has renamed or changed a permission, the **Save & test** button shows Facebook's exact error message.

## 5. Instagram and TikTok (before each stream)

**Instagram** (some accounts may need to be Professional or Creator accounts):
1. On a computer, go to <https://www.instagram.com>, click **Create (+) → Live video**.
2. Enter a title and choose who can watch. Instagram shows a **Stream URL** and a **Stream key**.
3. Paste them into the stream's card in the app and click **Save key**.
4. **Leave the Instagram tab open.** When your video starts arriving, Instagram may also need you to click **Go live** there. This depends on your account.

**TikTok** (needs TikTok's LIVE access with a stream key, which not every account has):
1. Go to TikTok **LIVE Producer** (on tiktok.com, click **LIVE** or open the Creator tools) and set up a live.
2. Copy the **Server URL** and **Stream key** into the app and click **Save key**.
3. Keep that page open. TikTok usually needs you to press **Go LIVE** there once the video is coming in.

The app remembers the server URL you used last time, so next time you'll usually only need to paste the key.

**If you don't paste a key in time**, that platform is skipped and the others go live as usual.

## 6. Use it inside OBS Studio (optional, on your own computer)

Instead of sending the video file straight to the platforms, a scheduled stream can play **inside one of your OBS scenes**, so your logo, lower thirds and other overlays are included. The app shows up as a panel inside OBS.

OBS mode needs the app running on the **same computer as OBS**, either as the desktop app or with `npm run server-only`. The cloud version can't control the OBS on your computer.

**Set up once:**
1. In OBS, open **Tools → WebSocket Server Settings**, turn on **Enable WebSocket server**, then click **Show Connect Info** and copy the password. This is built into OBS 28 and newer.
2. In the app, open **Settings → OBS Studio**, paste the password and click **Connect & test**. Your scenes appear.
3. To get the panel inside OBS, choose **Docks → Custom Browser Docks**, name it "Scheduler", and enter `http://localhost:3030`. Drag the panel wherever you like.
4. Connect YouTube from a normal browser tab at `http://localhost:3030`, not from inside OBS, because Google doesn't allow sign-in inside apps.

**Schedule a stream:** under **Send with**, choose **OBS scene** and pick the scene. At the start time the app:
1. Loads the video into a source called **"Scheduled video"** in that scene. It's created the first time and fills the screen behind your other sources. You can move or resize it in OBS, and your changes are kept.
2. Switches OBS to that scene.
3. Points OBS's stream at a private address on your computer and clicks **Start Streaming**. It saves your own stream settings first.
4. Copies the stream to every platform without re-encoding, so quality and bitrate come from your OBS settings.
5. When the video ends, stops streaming and **puts your own OBS stream settings back**.

**Good to know:**
- OBS must be open at the start time. If it isn't, the stream is marked **Failed** and you get a notification.
- Don't stream from OBS by hand at the same time.
- In **OBS → Settings → Output**, set the **Keyframe Interval** to **2 s**, because YouTube and Facebook expect it. Also make sure your **Video Bitrate** suits your upload speed: the app sends the same stream 4 times, so 4,500 kbps needs about 20 Mbps of upload.
- **Stop stream** in the app, or **Stop Streaming** in OBS, both end the stream on every platform.
- This is separate from the Aitum Multistream plugin. You can keep using that for your manual streams.

---

## Using the app

1. **Upload** a video. It goes to the server, so a big file takes a while on a slow connection. The form shows how much space is left on the server.
2. Enter a title, pick a start time (in your own time zone) and the platforms, then click **Schedule stream**.
3. Paste the Instagram and TikTok keys when you're reminded.
4. At the start time the stream goes out to every platform at once. You'll see progress, and you can **Stop stream** at any point.

Other buttons:
- **Start now**: start a scheduled stream immediately (good for testing).
- **Cancel**: cancel an upcoming stream. This also removes its YouTube broadcast.
- **Show log**: see exactly what happened. Stream keys are hidden in the log.
- **Delete selected video**: frees up space on the server.

If one platform drops out mid-stream, the others keep going, and that platform is marked **Problem**.

## Good to know

- **Security.** The app is protected by your password, uses HTTPS, and locks sign-in for 15 minutes after 10 wrong passwords. You stay signed in on a device for 30 days. To change the password, run `sudo bash deploy/setup.sh` again.
- **Video format.** Any common video file works. The app sends 30 fps H.264 video and AAC audio, with the longer side capped at 1920 px. Vertical videos stay vertical. If a video has no sound, silent audio is added because some platforms require an audio track.
- **"Live" pre-recorded content.** Platforms may limit or flag pre-recorded videos shown as live. Check each platform's rules, and say in the title or description that it's a replay if you're unsure.
- **Where things are stored on the server.** Settings, tokens and the schedule are in `/var/lib/multistream/data`, videos are in `/var/lib/multistream/videos`, and the server settings are in `/etc/multistream/env`. Instagram and TikTok keys are deleted after each stream.
- **If the server was down at the start time**, the stream is marked **Missed** after 30 minutes. You can still click **Start now** on it.

## Troubleshooting

| Problem | Fix |
|---|---|
| The site doesn't load | Check that ports 80 and 443 are open in Oracle's Security List (step 1a), and that DuckDNS points to the right IP. On the server, run `sudo systemctl status multistream caddy`. |
| Not sure what the app is doing | On the server, run `sudo journalctl -u multistream -f` to see the live log. |
| YouTube: "The user is not enabled for live streaming" | Turn on live streaming in YouTube Studio and wait up to 24 hours. |
| YouTube: "redirect_uri_mismatch" | The redirect URI in Google Cloud must match the one shown in Settings exactly, including `https://`. |
| YouTube: "Google did not return a refresh token" | Remove the app at <https://myaccount.google.com/permissions> and connect again. |
| Facebook error about permissions | Generate the token again with all four permissions listed in step 4. |
| Facebook: "version is no longer supported" | Change `v24.0` near the top of `lib/facebook.js` to a newer version, then update the server. |
| Instagram or TikTok shows **Problem** | The key probably expired or was used already. Get a fresh one next time. |
| Stream stutters | Lower the video bitrate in Settings, or stream to fewer platforms. |
| Times are off by some hours | Run `sudo bash deploy/setup.sh` again and enter the correct time zone. |

---

## For developers

Run it on your own computer (no password needed on localhost):

```bash
npm run server-only   # then open http://localhost:3030 (needs FFmpeg on PATH)
```

These settings are read from environment variables (`deploy/setup.sh` writes them to `/etc/multistream/env`):

| Variable | Meaning |
|---|---|
| `PUBLIC_URL` | The address you open in the browser, e.g. `https://mystreams.duckdns.org`. |
| `ADMIN_PASSWORD_HASH` | Password hash. Make one with `printf '%s' 'your password' \| node lib/auth.js`. If `PUBLIC_URL` isn't localhost, the app refuses to start without it. |
| `HOST`, `PORT` | Where the app listens (default `127.0.0.1:3030`, behind Caddy). |
| `TZ` | Time zone used in reminders and logs. |
| `MS_DATA_DIR`, `MS_VIDEOS_DIR` | Where data and videos are stored. |

**Optional desktop version.** The same code also runs as a Mac or Windows desktop app (`npm start` from source, or `npm run dist:mac`). Pushing a tag like `v1.0.1` makes GitHub Actions build both installers and publish them on the Releases page. The bundled FFmpeg comes from the [`ffmpeg-static`](https://www.npmjs.com/package/ffmpeg-static) package and is GPL-licensed.
