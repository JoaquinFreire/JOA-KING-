import json
import os
import sys


model = None
model_error = None
model_name = os.environ.get("WHISPER_MODEL", "small")

for line in sys.stdin:
    try:
        request = json.loads(line)
        request_id = request.get("id")
        audio_path = request.get("path")

        if model is None and model_error is None:
            try:
                from faster_whisper import WhisperModel

                model = WhisperModel(
                    model_name,
                    device="cpu",
                    compute_type="int8",
                    cpu_threads=min(os.cpu_count() or 4, 8),
                )
            except Exception as error:
                model_error = str(error)

        if model_error:
            raise RuntimeError(model_error)

        if request.get("warmup"):
            result = {"id": request_id, "ready": True}
        else:
            segments, info = model.transcribe(
                audio_path,
                language="es",
                beam_size=5,
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 500},
            )
            text = " ".join(segment.text.strip() for segment in segments).strip()
            result = {"id": request_id, "text": text, "language": info.language}
    except Exception as error:
        result = {"id": request.get("id") if "request" in locals() else None, "error": str(error)}

    print(json.dumps(result), flush=True)