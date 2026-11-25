# Multistream Scheduler

Schedule a pre-recorded video to go live on **YouTube, Facebook, Instagram and TikTok** at the same time, either straight from the video file or **through an OBS scene** with your overlays.

| Platform | What you do |
|---|---|
| YouTube | Nothing. It goes live by itself. |
| Facebook Page | Nothing. It goes live by itself. |
| Instagram | Nothing, once you save the profile's stream key in Settings. Without a saved key, you paste one per stream (you get a reminder). |
| TikTok | Hidden for now (turn it on in **Settings → General → Show TikTok**). It needs a new key pasted for every stream. |

**Profiles:** one app handles several brands or podcasts, for example **YGC** and **BYP**. Each profile has its own YouTube channel, Facebook Page and Instagram key. You pick the profile when you schedule. Streams never overlap: the app blocks a time that clashes with any other stream.

---

## 1. Install: choose how to run it

| | **Desktop app** (Mac or Windows) | **Cloud server** |
|---|---|---|
| Setup | Download and install, about 5 minutes | Rent or get a free server, about 30 minutes |
| Your computer | Must stay on at stream time | Can be off |
| OBS scenes and overlays | ✅ Yes | ❌ No (video file only) |
| Use from your phone | Notifications only | ✅ Full dashboard |
| Upload speed used | Your home internet | The server's |

Most people should start with the **desktop app**.

---

## Option A: Desktop app for Windows and Mac

### Download

| Your computer | Download |
|---|---|
| **Windows** 10 or 11 (64-bit) | [**Multistream-Scheduler-Windows-Setup.exe**](https://github.com/fizoccct-creator/multistream-scheduler/releases/latest/download/Multistream-Scheduler-Windows-Setup.exe) |
| **Mac** with Apple Silicon (M1 or newer) | [**Multistream-Scheduler-Mac.dmg**](https://github.com/fizoccct-creator/multistream-scheduler/releases/latest/download/Multistream-Scheduler-Mac.dmg) |

These links always point to the newest version. All versions are on the [Releases page](https://github.com/fizoccct-creator/multistream-scheduler/releases). This repository is private, so you must be signed in to GitHub to download. FFmpeg is included, so you don't need to install anything else.

### Install on Windows

1. Run **Multistream-Scheduler-Windows-Setup.exe**.
2. If you see **"Windows protected your PC"**, click **More info → Run anyway**. This appears because the installer isn't signed with a paid certificate.
3. Follow the installer. You can choose where to install it. The app opens when it's done.
4. If **Windows Firewall** asks about the app, choose **Private networks** only. The app only talks to your own PC and the streaming platforms.

### Install on Mac

1. Open **Multistream-Scheduler-Mac.dmg** and drag **Multistream Scheduler** into **Applications**.
2. Open the app. macOS says it can't verify the developer: click **Done**. (The app isn't signed with a paid Apple developer account.)
3. Go to **System Settings → Privacy & Security**, scroll down, click **Open Anyway**, and confirm with your password.
4. If macOS instead says the app "is damaged", run this once in Terminal, then open it again:
   ```bash
   xattr -cr "/Applications/Multistream Scheduler.app"
   ```

### While it runs (both systems)

- **Closing the window doesn't quit the app.** It keeps running in the **system tray** (Windows, bottom-right) or **menu bar** (Mac, top-right), so scheduled streams still start. Click that icon to reopen the window or quit.
- In the icon's menu, turn on **Start when I log in** so the app is always ready.
- **The app keeps your computer awake while it's open.** Keep it plugged in. On a laptop, keep the lid open, because closing it still causes sleep.
- **Upload speed:** sending to all 4 platforms at the default 4,500 kbps needs about **20 Mbps upload**. Lower the bitrate in Settings if your connection is slower.
- The dashboard is also available in any browser on the same computer at `http://localhost:3030`.
- **Each computer has its own settings and schedule.** If you install it on two computers, set up both, and don't schedule the same stream on both.

Then set up notifications and connect your platforms (sections 2–5). Settings for the YGC and BYP profiles are in **Settings → Profiles**.

---

## Option B: Cloud server (your computer can be off)

You need three things: a server, a web address, and this code on the server.

### a) Get a server
- **Free:** Oracle Cloud "Always Free". Sign up at <https://www.oracle.com/cloud/free/>; Oracle asks for a card to verify you, but "Always Free" resources are never charged.
  1. Go to **Compute → Instances → Create instance**. Choose the **Ubuntu 24.04** image and the Ampere `VM.Standard.A1.Flex` shape with 2 OCPUs and 12 GB memory, add an SSH key, and copy the **Public IP**.
  2. If it says "Out of capacity", try another Availability Domain or try again later.
  3. Open the web ports: on the instance page, click **Subnet → Security List → Add Ingress Rules**. Add TCP ports `80` and `443` from source `0.0.0.0/0`.
- **Paid alternative:** any Ubuntu 22.04 or 24.04 server with 2 CPUs works the same way, for example Hetzner Cloud at about €6/month. Streaming to all 4 platforms uses about 8 GB of data per hour.

### b) Get a free web address (DuckDNS)
Sign in at <https://www.duckdns.org>, create a subdomain (for example `mystreams`), and set its IP to your server's public IP. Your address is then `mystreams.duckdns.org`.

### c) Install on the server
Connect with `ssh -i path/to/your-key ubuntu@YOUR.SERVER.IP`. The repository is private, so sign in to GitHub on the server first:

```bash
sudo apt-get update && sudo apt-get install -y gh
gh auth login
```

Choose **GitHub.com → HTTPS → Login with a web browser**, then enter the code shown at <https://github.com/login/device> on your phone or computer. Then:

```bash
gh repo clone fizoccct-creator/multistream-scheduler
cd multistream-scheduler
sudo bash deploy/setup.sh
```

The script asks for your web address, your time zone and a login password. It then installs FFmpeg, automatic HTTPS, and a background service that restarts by itself. When it's done, open `https://mystreams.duckdns.org` and sign in.

**Updating later:** run `cd multistream-scheduler && git pull && sudo bash deploy/update.sh`.

---

## 2. Phone notifications (recommended)

Reminders and alerts can go to your phone through **ntfy**, a free app that needs no account.
1. Install **ntfy** from the App Store or Google Play.
2. In the app, open **Settings → Phone notifications**, click **New random**, then **Save**.
3. In the ntfy phone app, tap **+** and subscribe to the same topic.
4. Click **Send test**.

You'll get the "paste your stream key" reminder 15 minutes before a stream (you can change the time in Settings), plus a notification when each stream starts and finishes. Keep the topic name private, because anyone who knows it can read your alerts. The desktop app also shows normal Windows or Mac notifications.

## Profiles (YGC, BYP and more)

- **Settings → Profiles** shows a tab for each profile. YGC and BYP are created for you. Use **+ Add profile** for another podcast or brand (up to 6), and **Rename** or **Delete profile** to change them.
- Each profile tab has its own **YouTube**, **Facebook Page** and **Instagram** cards. Set them up once per profile (sections 3–5).
- When you schedule, choose the profile at the top of the form. Each stream card shows a colored profile tag.
- The chips above the stream list (**All profiles**, **YGC**, **BYP**) filter what you see.
- **Streams can't overlap**, even across profiles: there's one internet connection and one OBS. The app keeps at least 2 minutes between streams and tells you which stream clashes.
- A profile can't be deleted while it has upcoming streams.

## 3. Connect YouTube (one time per profile)

1. Go to <https://console.cloud.google.com> and create a project (any name).
2. **APIs & Services → Library**: search for **YouTube Data API v3** and click **Enable**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External**
   - Fill in an app name and your email.
   - Under **Test users** (sometimes called Audience), add the Google account that owns your YouTube channel.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - **Authorized redirect URIs**: paste the URI shown in the app's Settings page.
     - Desktop app (Mac or Windows): `http://localhost:3030/auth/youtube/callback`
     - Cloud server: `https://mystreams.duckdns.org/auth/youtube/callback`

     You can add both to the same client.
5. Copy the **Client ID** and **Client secret** into **Settings → Google OAuth client** and click **Save**. This one client works for every profile.
6. Go to **Settings → Profiles**, pick the profile (YGC or BYP), and click **Connect YouTube** in its YouTube card. Sign-in opens in your normal web browser: sign in with **that profile's** Google account or channel. Repeat for each profile.
7. Each channel must have live streaming turned on. Check at <https://studio.youtube.com> → **Create → Go live**. The first time can take up to 24 hours to activate.

> While the Google project is in "Testing" mode, Google may ask you to reconnect after 7 days. To avoid that, click **Publish app** on the consent screen. Because only you use it, you don't need Google's verification. Just click through the "unverified app" warning when you sign in.

When you schedule a stream, the app creates the YouTube broadcast right away. It shows up as "Upcoming" on your channel, and the broadcast starts and ends by itself.

## 4. Connect your Facebook Page (one time per profile)

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
4. In **Settings → Profiles**, pick the profile, paste both into its **Facebook Page** card and click **Save & test**. You should see the Page's name.

Do this for each profile's Page (for example the YGC Page and the BYP Page). You can reuse the same Page ID and token on another computer.

## 5. Instagram (saved key) and TikTok

**Instagram: save the key once per profile**
1. Get the profile's Instagram **Server URL** and **Stream key** (on instagram.com: **Create (+) → Live video**; some accounts need to be Professional or Creator accounts).
2. In **Settings → Profiles**, pick the profile, paste both into its **Instagram** card and click **Save key**.
3. From then on, every stream for that profile uses the saved key automatically, with no reminder or paste needed. The key stays saved after each stream.
4. To use a different key for one stream only, click **Use a different key for this stream** on that stream's card. The saved key isn't changed.
5. If Instagram ever gives you a new key, paste it in the same card to replace it, or click **Remove key**.

If a profile has no saved key, you can still paste a key on each stream; you'll get a reminder before it starts. Depending on your account, Instagram may also need you to click **Go live** in its own window once the video arrives.

**TikTok** is hidden for now. Turn it on in **Settings → General → Show TikTok** (it needs TikTok's LIVE access with a stream key, which not every account has):

**TikTok** (needs TikTok's LIVE access with a stream key, which not every account has):
1. Go to TikTok **LIVE Producer** (on tiktok.com, click **LIVE** or open the Creator tools) and set up a live.
2. Copy the **Server URL** and **Stream key** into the app and click **Save key**.
3. Keep that page open. TikTok usually needs you to press **Go LIVE** there once the video is coming in.

The app remembers the server URL you used last time, so next time you'll usually only need to paste the key. **If you don't paste a key in time**, that platform is skipped and the others go live as usual.

---

## 6. Use it inside OBS Studio (desktop app, Windows and Mac)

A scheduled stream can play **inside one of your OBS scenes**, so your logos, lower thirds and other overlays are included. OBS and the app must be on the **same computer**. The steps are the same on Windows and Mac.

### Set up once
1. **Turn on OBS's WebSocket** (built into OBS 28 and newer): in OBS, open **Tools → WebSocket Server Settings**, tick **Enable WebSocket server**, click **Show Connect Info**, and copy the **Server Password**.
2. **Connect the app:** go to **Settings → OBS Studio**, paste the password, and click **Connect & test**. It should show **Connected** and list your scenes.
3. **Add the app as a panel inside OBS:** choose **Docks → Custom Browser Docks**, name it **Scheduler**, enter the URL **`http://localhost:3030`**, and click **Apply**. Drag the panel wherever you like.
4. **Make a scene just for scheduled streams**, for example "Scheduled", with your logos and overlays but no camera. That way nothing can cover the video.
5. **Set the keyframe interval:** go to **OBS → Settings → Output**, set Output Mode to **Advanced**, and under **Streaming** set **Keyframe Interval** to **2 s**. YouTube and Facebook expect this.
6. **Check your bitrate:** the app sends your OBS stream 4 times, so a 4,500 kbps video bitrate needs about 20 Mbps of upload.
7. Connect YouTube from your **normal web browser** at `http://localhost:3030`, not from inside OBS, because Google blocks sign-in inside apps.

### For each stream
1. In the **Scheduler** panel, upload or pick the video, enter a title, set **Send with → OBS scene**, pick your scene, set the start time and platforms, then click **Schedule stream**.
2. When reminded, paste the Instagram and TikTok keys (section 5).
3. Keep **OBS and the app open**, and don't start a stream in OBS by hand around that time.
4. **At the start time it's automatic:**
   1. The video loads into a source called **"Scheduled video"** in your scene. It's created the first time and fills the screen behind your overlays; you can move or resize it, and your changes are kept.
   2. OBS switches to that scene and starts streaming. The app first saves your own OBS stream settings.
   3. The app copies OBS's stream to every platform without re-encoding.
5. **When the video ends**, OBS stops streaming and **your own OBS stream settings are put back**. To end early, click **Stop stream** in the panel or **Stop Streaming** in OBS.

**Note:** the stream has the shape of your OBS canvas. If your canvas is vertical (1080×1920), YouTube and Facebook get a vertical video too.

---

## Using the app

1. **Upload** a video, or pick one you uploaded before.
2. Enter a title, pick a start time and the platforms, choose **Send with** (video file or OBS scene), then click **Schedule stream**.
3. Paste the Instagram and TikTok keys when you're reminded.
4. At the start time the stream goes out to every platform at once. You'll see progress, and you can **Stop stream** at any point.

Other buttons:
- **Start now**: start a scheduled stream immediately (good for testing).
- **Cancel**: cancel an upcoming stream. This also removes its YouTube broadcast.
- **Show log**: see exactly what happened. Stream keys are hidden in the log.
- **Delete selected video**: frees up disk space.

If one platform drops out mid-stream, the others keep going, and that platform is marked **Problem**.

## Good to know

- **Where things are stored:**
  - Windows: `%APPDATA%\Multistream Scheduler`
  - Mac: `~/Library/Application Support/Multistream Scheduler`
  - Cloud server: `/var/lib/multistream`

  Settings and tokens are in `data/config.json`, the schedule in `data/jobs.json`, logs in `data/logs/`, and videos in `videos/`. On desktop, the tray or menu bar icon has **Open videos folder**. Instagram and TikTok keys are deleted after each stream.
- **Video format (video-file mode).** Any common video file works. The app sends 30 fps H.264 video and AAC audio, with the longer side capped at 1920 px. Vertical videos stay vertical. If a video has no sound, silent audio is added because some platforms require it.
- **"Live" pre-recorded content.** Platforms may limit or flag pre-recorded videos shown as live. Check each platform's rules, and say it's a replay in the title or description if you're unsure.
- **If the app or OBS wasn't running at the start time**, the stream is marked **Missed** (app off for 30+ minutes) or **Failed** (OBS closed). You can click **Start now** on a missed stream.
- **Cloud server security.** It's protected by your password and HTTPS, and sign-in locks for 15 minutes after 10 wrong passwords. To change the password, run `sudo bash deploy/setup.sh` again.

## Troubleshooting

| Problem | Fix |
|---|---|
| Windows: "Windows protected your PC" | Click **More info → Run anyway**. |
| Mac: "can't be opened" / "developer cannot be verified" | **System Settings → Privacy & Security → Open Anyway**. |
| Mac: "is damaged and can't be opened" | Run `xattr -cr "/Applications/Multistream Scheduler.app"` in Terminal. |
| "Port 3030 is already being used" | Another copy of the app (or another program) is running. Quit it from the tray or menu bar and reopen. |
| The OBS panel is blank | Make sure the app is running, and that the dock URL is exactly `http://localhost:3030`. |
| "Could not reach OBS" | OBS is closed, or **Tools → WebSocket Server Settings → Enable WebSocket server** is off. |
| "Wrong OBS WebSocket password" | Copy it again from **Show Connect Info** in OBS. |
| The video is hidden in OBS | Another source in the scene covers it. Use a dedicated scene, or move "Scheduled video" in the source list. |
| YouTube: "The user is not enabled for live streaming" | Turn on live streaming in YouTube Studio and wait up to 24 hours. |
| YouTube: "redirect_uri_mismatch" | Add the exact redirect URI shown in Settings to your Google OAuth client. |
| YouTube: "Google did not return a refresh token" | Remove the app at <https://myaccount.google.com/permissions> and connect again. |
| Facebook error about permissions | Generate the token again with all four permissions listed in section 4. |
| Facebook: "version is no longer supported" | Change `v24.0` near the top of `lib/facebook.js` to a newer version. |
| Instagram or TikTok shows **Problem** | The key probably expired or was used already. Get a fresh one next time. |
| Stream stutters | Lower the bitrate (in Settings, or in OBS for OBS mode), or stream to fewer platforms. |
| Cloud: the site doesn't load | Check ports 80 and 443 are open (Option B, step a) and DuckDNS points to the right IP. Then run `sudo systemctl status multistream caddy`. |

---

## For developers

```bash
npm install
npm start              # run the desktop app from source
npm run server-only    # run only the server, then open http://localhost:3030 (needs FFmpeg on PATH)
npm run dist:mac       # build the Mac installer into dist/
npm run dist:win       # build the Windows installer (best built on Windows or by GitHub Actions)
```

**Publishing a new version with installers:**
1. Change `"version"` in `package.json`, for example to `1.0.1`, and commit.
2. Create and push a matching tag:
   ```bash
   git tag v1.0.1 && git push origin main --tags
   ```
3. GitHub Actions builds the Windows and Mac installers (about 10–15 minutes) and publishes them on the Releases page. The download links at the top of this README then point to the new version automatically.

**Server settings** (environment variables; `deploy/setup.sh` writes them to `/etc/multistream/env`):

| Variable | Meaning |
|---|---|
| `PUBLIC_URL` | The address you open in the browser, e.g. `https://mystreams.duckdns.org`. |
| `ADMIN_PASSWORD_HASH` | Password hash. Make one with `printf '%s' 'your password' \| node lib/auth.js`. If `PUBLIC_URL` isn't localhost, the app refuses to start without it. |
| `HOST`, `PORT` | Where the app listens (default `127.0.0.1:3030`, behind Caddy). |
| `TZ` | Time zone used in reminders and logs. |
| `MS_DATA_DIR`, `MS_VIDEOS_DIR` | Where data and videos are stored. |

The bundled FFmpeg in the desktop app comes from the [`ffmpeg-static`](https://www.npmjs.com/package/ffmpeg-static) package and is GPL-licensed.
