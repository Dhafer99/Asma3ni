# TuniSpeech Whisper Test

Standalone tester for:

```text
TuniSpeech-AI/whisper-tunisian-dialect
```

This is not integrated into the Ionic/Android app. It is for accuracy testing only.

## Setup

From the repo root:

```powershell
python -m venv .venv-whisper
.\.venv-whisper\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r experiments\whisper_tunisian\requirements.txt
```

The first run downloads the model from Hugging Face. It is large because it is based on Whisper large-v2.

## Test An Audio File

```powershell
python experiments\whisper_tunisian\transcribe.py --audio C:\path\to\tunisian.wav
```

## Test The Microphone

```powershell
python experiments\whisper_tunisian\transcribe.py --record 5 --save-recording recordings\sample.wav
```

## Notes

- On CPU, expect slow inference. Use short clips, around 5 seconds.
- With an NVIDIA GPU and CUDA PyTorch, use `--device cuda`.
- The model transcribes to Arabic text. It does not translate to French or English.
- This model is licensed `cc-by-nc-4.0`, so check the license before commercial use.
