# Traitors Mobile App (React Native & Expo)

Cross-platform mobile application for **TRAITORS — Trust No One** with real-time Supabase sync and integrated WebRTC Voice Chat.

---

## 🚀 Running the App Locally

### Prerequisites
- Node.js 18+
- [Expo Go](https://expo.dev/go) on your Android / iOS phone, or an Android Emulator

### Steps
1. Navigate to the mobile folder:
   ```bash
   cd mobile
   ```
2. Start the Expo development server:
   ```bash
   npm start
   ```
3. Scan the QR code with **Expo Go** on Android (or Camera app on iOS).

---

## 📱 Generating the Standalone Android APK

To build a standalone installable `.apk` file:

### Option 1: Cloud Build with EAS (Recommended - No Android Studio required)
1. Install the EAS CLI globally (if not already installed):
   ```bash
   npm install -g eas-cli
   ```
2. Log in or create a free Expo account:
   ```bash
   eas login
   ```
3. Trigger the standalone Android APK build:
   ```bash
   eas build -p android --profile preview
   ```
4. Once completed (approx. 5–8 minutes in the cloud), EAS will output a direct download link and QR code to install the `.apk` on any Android device!

### Option 2: Local Android Build (Requires Android Studio & JDK 17)
```bash
npx expo run:android
```
