# DeafApp

Prototype live-caption app for Tunisian Arabic speech.

## What is built

- `frontend/`: Ionic Angular app that captures microphone audio, streams 16 kHz PCM to the backend, shows live captions, and can request browser notification permission.
- `backend/`: FastAPI app with a WebSocket endpoint backed by the LinTO Tunisian Arabic Vosk/Kaldi model.

The ASR model used here is `linagora/linto-asr-ar-tn-0.1`, specifically the lighter `android-model.zip`.

## Run

Backend:

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Frontend:

```powershell
cd frontend
npm start -- --host 0.0.0.0 --port 8100
```

Open `http://localhost:8100`.

On a phone connected to the same Wi-Fi, open `http://<computer-ip>:8100` and set the ASR server field in the app to `ws://<computer-ip>:8000/ws/transcribe`.

## Mobile notes

The Android app now has an offline native path:

- The LinTO/Vosk Tunisian model is packaged into the APK under `frontend/android/app/src/main/assets/model-ar-tn`.
- On first start of the native caption service, Vosk unpacks that asset model into app-private storage because it needs normal filesystem paths.
- The APK is large: the current debug APK is about 207 MB.
- A native Android foreground service keeps the microphone alive and shows a persistent notification with the latest caption and a Stop action.

Build the debug APK:

```powershell
cd frontend
npm run android:sync
$env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"
$env:PATH="$env:JAVA_HOME\bin;$env:PATH"
.\android\gradlew.bat -p android assembleDebug
```

APK output:

```text
frontend/android/app/build/outputs/apk/debug/app-debug.apk
```

Install on a USB-connected Android phone:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r .\android\app\build\outputs\apk\debug\app-debug.apk
```

For a release APK, open Android Studio and create a signed build from `frontend/android`. Debug APKs are fine for testing, but Android will show them as developer builds.

Android requirements:

- Use Android Studio's bundled JDK 21 or another Java 21 install. The global Java on this machine is Java 8, which will not build this project.
- The Android project is pinned for this Android Studio version: Android Gradle Plugin `8.7.1`, Gradle `8.9`, `compileSdk 35`, and `targetSdk 35`.
- Grant microphone permission when the app asks.
- On Android 13+, grant notification permission so the foreground caption notification is visible.

The browser/FastAPI path still exists for desktop testing, but the APK uses the packaged native Vosk model instead of the FastAPI server.

## Repository notes

This repo uses Git LFS for the packaged Android Vosk model under:

```text
frontend/android/app/src/main/assets/model-ar-tn
```

After cloning, install Git LFS and pull the model files:

```powershell
git lfs install
git lfs pull
```

FastAPI is optional for desktop/browser testing. The Android APK does not need the FastAPI server because it runs the packaged Vosk model directly on the phone.

Always-on listening from the notification bar is restricted by Android rules:

- Android requires a foreground service with a persistent notification for continuous microphone access.
- iOS is much more restrictive for continuous background microphone capture.
- If Android kills the app because of battery optimization, disable battery optimization for DeafApp in system settings.

## Microphone troubleshooting

If the app shows `The browser could not start the microphone`:

- Close other apps or browser tabs that may be using the microphone.
- On Windows, check `Settings > Privacy & security > Microphone` and allow microphone access for desktop apps.
- Use the microphone selector in the app and try another input device.
- If you opened the app on a phone with `http://<computer-ip>:8100`, the phone browser may block microphone capture because it is not HTTPS. Use `localhost` on the computer for browser testing, or run a native Android/Capacitor build for phone testing.
