# Habla Tutor: install on your phone

Habla Tutor is a web app you install from Chrome. It talks to Google Gemini (or Groq) using your own free API key, so it uses no Claude credits.

## 1. Get a free API key (2 minutes)

- **Gemini (recommended):** go to https://aistudio.google.com/apikey, sign in with Google, and create a key. On the free tier, Google may use your messages to improve its products.
- **Groq (alternative):** go to https://console.groq.com/keys and create a key.

## 2. Put the app online (free, about 5 minutes)

The app has to be served over https for the microphone and install button to work. Opening the file directly from your phone's storage won't work properly.

**GitHub Pages:**
1. Create a free account at github.com.
2. Create a new public repository, for example `habla`.
3. Choose **Add file → Upload files** and upload every file in this folder: `index.html`, `app.js`, `sw.js`, `manifest.webmanifest`, `icon-192.png`, `icon-512.png`.
4. Go to **Settings → Pages**. Under "Branch", pick `main` and `/ (root)`, then press Save.
5. After a minute, your app is live at `https://YOUR-USERNAME.github.io/habla/`.

Your API key is never uploaded. It is typed into the app and stays on your phone.

## 3. Install it

1. Open the link in **Chrome** on your phone.
2. Tap the **⋮ menu → Add to Home screen → Install**.
3. Open Habla from your home screen, tap ⚙, paste your key, press **Load list**, pick a model with "flash" in its name, then press **Test connection** and **Save**.

## What's inside

- **Chat:** role-play scenarios (café, travel, small talk, team meeting, presentation, client call, job interview, IELTS/DELE-style speaking exam). Every message gets grammar corrections plus a **"Sounds more natural"** rewrite.
- **Voice chat:** switch it on and the tutor reads each reply aloud, then listens; your answer is sent when you stop talking. If your phone doesn't start listening by itself, tap 🎙.
- **Speak tab (pronunciation drills):** listen, listen slowly, then say the sentence. Use the built-in starter set (works offline, no key needed), sentences you saved from chat (🎯 buttons), or an AI-generated set for a sound you want to work on.
- **Tutor voice and speed:** pick from the voices installed on your phone in Settings ⚙.

**About the pronunciation score:** it's the share of the sentence's words your phone's speech recognizer understood. It tells you whether you were understood, not how close your accent is to a native speaker's, and recognizers are forgiving, so treat 90%+ as "clear", not "perfect". Real sound-by-sound scoring (like paid apps use) needs a paid speech-assessment service.

## Notes

- The app opens offline, but the tutor needs internet to reply. Speech recognition in Chrome also needs internet.
- For Spanish read-aloud, your phone needs a Spanish voice: go to Android Settings → General management → Text-to-speech, and install Spanish in Google's speech engine.
- Your notebook, error counts and current conversation are stored on the phone only. Clearing Chrome's site data erases them.
- If you see "rate limit", you've used the free tier's quota for now. Wait a minute, or until the next day if it's the daily limit.
