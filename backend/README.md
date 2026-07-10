# Asma3ni Backend

FastAPI service that receives 16 kHz mono PCM audio over WebSocket and returns Tunisian Arabic captions from the LinTO Vosk model.

## Setup

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
.\download-model.ps1
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

The default model path is `backend/models/android-model`. To use another model:

```powershell
$env:VOSK_MODEL_PATH="C:\path\to\model"
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

The app streams to `ws://localhost:8000/ws/transcribe` by default. On a physical phone, replace `localhost` in the app settings with your computer's LAN IP address.
