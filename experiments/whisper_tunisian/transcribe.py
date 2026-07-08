import argparse
import os
import tempfile
import time
from pathlib import Path


MODEL_ID = "TuniSpeech-AI/whisper-tunisian-dialect"
SAMPLE_RATE = 16_000


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Standalone tester for the TuniSpeech Tunisian Whisper model."
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--audio", type=Path, help="Path to an audio file: wav, mp3, flac, m4a, etc.")
    source.add_argument("--record", type=float, help="Record from the default microphone for N seconds.")
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"], help="Inference device.")
    parser.add_argument("--chunk-seconds", type=float, default=20.0, help="Chunk length for longer files.")
    parser.add_argument("--batch-size", type=int, default=1, help="Batch size. Keep 1 on CPU.")
    parser.add_argument("--save-recording", type=Path, help="Where to save recorded microphone audio.")
    return parser.parse_args()


def choose_device(device_arg: str):
    import torch

    if device_arg == "cuda":
      if not torch.cuda.is_available():
          raise RuntimeError("CUDA was requested, but torch cannot see a CUDA GPU.")
      return "cuda:0", torch.float16

    if device_arg == "cpu":
        return "cpu", torch.float32

    if torch.cuda.is_available():
        return "cuda:0", torch.float16

    return "cpu", torch.float32


def record_audio(seconds: float, output_path: Path | None) -> Path:
    import sounddevice as sd
    import soundfile as sf

    if seconds <= 0:
        raise ValueError("--record must be greater than 0.")

    target = output_path
    if target is None:
        handle = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        handle.close()
        target = Path(handle.name)

    target.parent.mkdir(parents=True, exist_ok=True)
    print(f"Recording {seconds:.1f}s from the default microphone...")
    audio = sd.rec(int(seconds * SAMPLE_RATE), samplerate=SAMPLE_RATE, channels=1, dtype="float32")
    sd.wait()
    sf.write(target, audio, SAMPLE_RATE)
    print(f"Saved recording: {target}")
    return target


def load_audio(path: Path):
    import librosa

    if not path.exists():
        raise FileNotFoundError(path)

    audio, _ = librosa.load(path, sr=SAMPLE_RATE, mono=True)
    return {"array": audio, "sampling_rate": SAMPLE_RATE}


def build_pipeline(device_arg: str, chunk_seconds: float, batch_size: int):
    import torch
    from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor, pipeline

    device, torch_dtype = choose_device(device_arg)
    print(f"Loading {MODEL_ID} on {device} ({torch_dtype})...")

    model = AutoModelForSpeechSeq2Seq.from_pretrained(
        MODEL_ID,
        torch_dtype=torch_dtype,
        low_cpu_mem_usage=True,
        use_safetensors=True,
    )
    model.to(device)

    processor = AutoProcessor.from_pretrained(MODEL_ID)

    return pipeline(
        "automatic-speech-recognition",
        model=model,
        tokenizer=processor.tokenizer,
        feature_extractor=processor.feature_extractor,
        torch_dtype=torch_dtype,
        device=device,
        chunk_length_s=chunk_seconds,
        batch_size=batch_size,
        generate_kwargs={"language": "ar", "task": "transcribe"},
    )


def main() -> None:
    args = parse_args()
    os.environ.setdefault("HF_HUB_ENABLE_HF_TRANSFER", "1")

    audio_path = args.audio
    if args.record is not None:
        audio_path = record_audio(args.record, args.save_recording)

    assert audio_path is not None
    audio = load_audio(audio_path)

    started = time.perf_counter()
    asr = build_pipeline(args.device, args.chunk_seconds, args.batch_size)
    print("Transcribing...")
    result = asr(audio)
    elapsed = time.perf_counter() - started

    print("\n--- Transcript ---")
    print(result["text"].strip())
    print(f"\nElapsed: {elapsed:.1f}s")


if __name__ == "__main__":
    main()
