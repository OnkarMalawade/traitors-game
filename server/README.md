# Traitors Voice & Signaling Server

Real-time WebRTC audio signaling and presence server for Traitors (Web & Mobile).

---

## 🚀 Running Locally
```bash
cd server
npm start
```
By default, the server runs on `http://localhost:3001`.
Health check: `http://localhost:3001/health`

---

## 🌐 Free Cloud Deployment (Render / Railway)

### Deploying to Render
1. Create a new **Web Service** on [Render.com](https://render.com).
2. Connect your GitHub repository (`traitors-game`).
3. Set the Root Directory to: `server`
4. Set Build Command: `npm install`
5. Set Start Command: `node index.js`
6. Once deployed, copy your Render URL (e.g. `https://traitors-voice.onrender.com`).
7. In your Netlify web app environment variables, set:
   ```env
   NEXT_PUBLIC_VOICE_SERVER_URL=https://traitors-voice.onrender.com
   ```
8. In `mobile/.env` or EAS secrets, set:
   ```env
   EXPO_PUBLIC_VOICE_SERVER_URL=https://traitors-voice.onrender.com
   ```
