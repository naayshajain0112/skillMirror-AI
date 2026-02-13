from fastapi import FastAPI, WebSocket, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydub import AudioSegment
import base64, io, time, random, os, re

import whisper
import numpy as np

import cv2
import mediapipe as mp

# -------------------------
# App setup
# -------------------------
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)#setup is completed 

@app.get("/")
def health():
    return {"status": "Backend running 🚀"}

# -------------------------
# Interview questions
# -------------------------
QUESTIONS = [
    "Tell me about yourself.",
    "How do you handle pressure or tight deadlines?",
    "Where do you see yourself in 5 years?",
    "How do you handle criticism?",
    "How do you stay motivated when work is repetitive?",
    "How do you deal with failure or mistakes?",
    "What are your strengths?",
    "What is your biggest weakness?",
    "How do you manage stress?",
    "Why do you want this job?",
    "Describe a challenge you overcame."
]

@app.get("/question")
def get_question():
    return {"question": random.choice(QUESTIONS)}

# -------------------------
# Whisper setup (CPU SAFE)
# -------------------------
print("⏳ Loading Whisper model...")
whisper_model = whisper.load_model("small")
print("✅ Whisper model loaded")

# ✅ Expanded filler list
FILLERS = {
    "um", "uh", "umm", "uhh", "ah", "aa",
    "er", "erm", "hmm", "mm",
    "like", "you", "know", "so", "actually", "basically"
}

def clean_words(text: str):
    text = text.lower()
    text = re.sub(r"[^\w\s]", "", text)
    return text.split()

# =========================================================
# 🔴 REAL-TIME WEBSOCKET (WHISPER)
# =========================================================
@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    print("✅ WebSocket connected (Whisper)")

    final_words = []
    total_fillers = 0
    speaking_seconds = 0.0

    while True:
        try:
            data = await ws.receive_json()
        except:
            print("❌ WebSocket disconnected")
            break

        if "audio" not in data:
            continue

        try:
            audio_bytes = base64.b64decode(data["audio"])

            audio = AudioSegment.from_file(io.BytesIO(audio_bytes), format="webm")
            audio = audio.set_channels(1).set_frame_rate(16000)

            samples = (
                np.array(audio.get_array_of_samples())
                .astype(np.float32) / 32768.0
            )

            duration_seconds = len(samples) / 16000.0

            # 🔴 FIXED WHISPER CONFIG
            result = whisper_model.transcribe(
                samples,
                language="en",
                fp16=False,
                verbose=False,
                temperature=0,
                condition_on_previous_text=False,
                word_timestamps=True,
                initial_prompt="Include filler words like um, uh, ah, er, hmm."
            )

            words = clean_words(result["text"])

            if words:
                final_words.extend(words)
                total_fillers += sum(w in FILLERS for w in words)
                speaking_seconds += duration_seconds

            speaking_minutes = speaking_seconds / 60
            wpm = int(len(final_words) / speaking_minutes) if speaking_minutes > 0 else 0

            filler_penalty = total_fillers * 2
            wpm_score = max(0, 20 - abs(wpm - 150) // 3)
            confidence = min(max(50 + wpm_score - filler_penalty, 40), 100)

            await ws.send_json({
                "transcript": " ".join(final_words),
                "fillers": total_fillers,
                "wpm": wpm,
                "confidence": confidence
            })

        except Exception as e:
            print("❌ Audio error:", e)
            await ws.send_json({
                "transcript": " ".join(final_words),
                "fillers": total_fillers,
                "wpm": 0,
                "confidence": 50
            })

# =========================================================
# 🎥 VIDEO UPLOAD ANALYSIS
# =========================================================
@app.post("/analyze_video")
async def analyze_video(file: UploadFile = File(...)):
    video_bytes = await file.read()
    temp_path = f"temp_{int(time.time())}.mp4"

    with open(temp_path, "wb") as f:
        f.write(video_bytes)

    audio = AudioSegment.from_file(temp_path)
    audio = audio.set_channels(1).set_frame_rate(16000)

    samples = (
        np.array(audio.get_array_of_samples())
        .astype(np.float32) / 32768.0
    )

    result = whisper_model.transcribe(
        samples,
        language="en",
        fp16=False,
        temperature=0,
        condition_on_previous_text=False,
        word_timestamps=True,
        initial_prompt="Include filler words like um, uh, ah, er, hmm."
    )

    words = clean_words(result["text"])
    total_fillers = sum(w in FILLERS for w in words)

    duration_minutes = (len(samples) / 16000) / 60
    wpm = int(len(words) / duration_minutes) if duration_minutes > 0 else 0

    # -------------------------
    # Eye contact (unchanged)
    # -------------------------
    mp_face = mp.solutions.face_mesh
    cap = cv2.VideoCapture(temp_path)

    total_frames = 0
    eye_contact_frames = 0

    with mp_face.FaceMesh(max_num_faces=1, refine_landmarks=True) as face_mesh:
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            total_frames += 1
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = face_mesh.process(rgb)

            if results.multi_face_landmarks:
                lm = results.multi_face_landmarks[0].landmark
                if abs(lm[159].y - lm[145].y) > 0.02 and abs(lm[386].y - lm[374].y) > 0.02:
                    eye_contact_frames += 1

    cap.release()
    os.remove(temp_path)

    eye_score = int((eye_contact_frames / total_frames) * 10) if total_frames else 0

    filler_penalty = total_fillers * 2
    wpm_score = max(0, 20 - abs(wpm - 150) // 3)
    confidence = min(max(50 + wpm_score - filler_penalty + eye_score, 40), 100)

    return {
        "transcript": result["text"],
        "fillers": total_fillers,
        "wpm": wpm,
        "confidence": confidence
    }
