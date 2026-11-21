## Download

| Computer | File |
|---|---|
| **Windows** 10 or 11 (64-bit) | `Multistream-Scheduler-Windows-Setup.exe` |
| **Mac** with Apple Silicon (M1 or newer) | `Multistream-Scheduler-Mac.dmg` |

FFmpeg is included, so you don't need to install anything else.

## Install on Windows
1. Run `Multistream-Scheduler-Windows-Setup.exe`.
2. If you see **"Windows protected your PC"**, click **More info → Run anyway**. This appears because the installer isn't signed with a paid certificate.
3. Follow the installer. The app opens when it's done.

## Install on Mac
1. Open `Multistream-Scheduler-Mac.dmg` and drag **Multistream Scheduler** into **Applications**.
2. Open the app. macOS says it can't verify the developer: click **Done**.
3. Go to **System Settings → Privacy & Security**, scroll down, and click **Open Anyway**.
4. If macOS says the app "is damaged", run this once in Terminal, then open it again:
   `xattr -cr "/Applications/Multistream Scheduler.app"`

Full instructions are in the README.
