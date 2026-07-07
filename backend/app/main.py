import json
import os
from functools import lru_cache

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from vosk import KaldiRecognizer, Model, SetLogLevel


SAMPLE_RATE = int(os.getenv("ASR_SAMPLE_RATE", "16000"))
MODEL_PATH = os.getenv("VOSK_MODEL_PATH", "./models/android-model")

SetLogLevel(-1)

app = FastAPI(title="DeafApp Tunisian ASR")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def is_vosk_model_dir(path: str) -> bool:
    return all(os.path.isdir(os.path.join(path, folder)) for folder in ("am", "conf", "graph"))


def resolve_model_path(path: str) -> str:
    if is_vosk_model_dir(path):
        return path

    if os.path.isdir(path):
        children = [os.path.join(path, child) for child in os.listdir(path)]
        model_children = [child for child in children if os.path.isdir(child) and is_vosk_model_dir(child)]
        if len(model_children) == 1:
            return model_children[0]

    return path


@lru_cache(maxsize=1)
def get_model() -> Model:
    model_path = resolve_model_path(MODEL_PATH)
    if not is_vosk_model_dir(model_path):
        raise RuntimeError(
            f"Vosk model not found at '{MODEL_PATH}'. "
            "Download android-model.zip from Hugging Face and extract it there, "
            "or set VOSK_MODEL_PATH."
        )

    return Model(model_path)


@app.get("/health")
def health() -> dict[str, str | int]:
    return {
        "status": "ok",
        "sample_rate": SAMPLE_RATE,
        "model_path": resolve_model_path(MODEL_PATH),
        "model_ready": str(is_vosk_model_dir(resolve_model_path(MODEL_PATH))).lower(),
    }


@app.websocket("/ws/transcribe")
async def transcribe(websocket: WebSocket) -> None:
    await websocket.accept()

    try:
        recognizer = KaldiRecognizer(get_model(), SAMPLE_RATE)
        recognizer.SetWords(True)
        if hasattr(recognizer, "SetPartialWords"):
            recognizer.SetPartialWords(True)
        last_partial = ""
        await websocket.send_json({"type": "ready", "sampleRate": SAMPLE_RATE})

        while True:
            chunk = await websocket.receive_bytes()
            if recognizer.AcceptWaveform(chunk):
                result = json.loads(recognizer.Result())
                await websocket.send_json(
                    {
                        "type": "final",
                        "text": result.get("text", "").strip(),
                        "result": result.get("result", []),
                    }
                )
            else:
                partial = json.loads(recognizer.PartialResult())
                partial_text = partial.get("partial", "").strip()
                if partial_text == last_partial:
                    continue

                last_partial = partial_text
                await websocket.send_json(
                    {
                        "type": "partial",
                        "text": partial_text,
                        "result": partial.get("partial_result", []),
                    }
                )
    except WebSocketDisconnect:
        return
    except Exception as exc:
        await websocket.send_json({"type": "error", "message": str(exc)})
        await websocket.close(code=1011)
