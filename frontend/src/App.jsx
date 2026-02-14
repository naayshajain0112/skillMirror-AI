import { useEffect,useRef, useState } from "react";
import WS_URL from "./config"; // e.g., ws://localhost:8000/ws

function App() {
  const videoRef = useRef(null);
  const wsRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const intervalRef = useRef(null);
  const fileInputRef = useRef(null);
  const cursorRef = useRef(null);

  const [question, setQuestion] = useState("");
  const [running, setRunning] = useState(false);
  const [connected, setConnected] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [fillers, setFillers] = useState(0);
  const [wpm, setWpm] = useState(0);
  const [confidence, setConfidence] = useState(0);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [recordingComplete, setRecordingComplete] = useState(false);
  const [uploadedVideo, setUploadedVideo] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Track cursor position
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (cursorRef.current) {
        cursorRef.current.style.left = e.clientX + 'px';
        cursorRef.current.style.top = e.clientY + 'px';
      }
    };

    if (showWelcome) {
      document.addEventListener('mousemove', handleMouseMove);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
    };
  }, [showWelcome]);

  // -----------------------------
  // Fetch random question
  // -----------------------------
  const generateQuestion = async () => {
    const res = await fetch("http://localhost:8000/question");
    const data = await res.json();
    setQuestion(data.question);
    setShowAnalysis(false);
    setRecordingComplete(false);
    setUploadedVideo(null);
  };

  // -----------------------------
  // Start recording & WebSocket
  // -----------------------------
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setRunning(true);
        setShowAnalysis(false);
        setRecordingComplete(false);
        startAudio(stream);
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        setTranscript(data.transcript || "");
        setFillers(data.fillers || 0);
        setWpm(data.wpm || 0);
        setConfidence(data.confidence || 0);
      };

      ws.onclose = () => {
        setConnected(false);
        setRunning(false);
      };
    } catch (error) {
      console.error("Error accessing camera:", error);
      alert("Unable to access camera. Please check permissions.");
    }
  };

  // -----------------------------
  // Start Audio Recording
  // -----------------------------
  const startAudio = (stream) => {
    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = async (e) => {
      if (!wsRef.current || wsRef.current.readyState !== 1) return;

      const buffer = await e.data.arrayBuffer();
      const base64Audio = btoa(String.fromCharCode(...new Uint8Array(buffer)));

      wsRef.current.send(JSON.stringify({ audio: base64Audio }));
    };

    recorder.start();

    intervalRef.current = setInterval(() => {
      if (recorder.state === "recording") recorder.requestData();
    }, 2000);
  };

  // -----------------------------
  // Stop Recording
  // -----------------------------
  const stopRecording = () => {
    wsRef.current?.close();
    clearInterval(intervalRef.current);
    mediaRecorderRef.current?.stop();

    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }

    setRunning(false);
    setConnected(false);
    setRecordingComplete(true);
  };

  // -----------------------------
  // Handle Video Upload
  // -----------------------------
  const handleVideoUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const videoURL = URL.createObjectURL(file);
      setUploadedVideo(videoURL);
    }
  };

  // -----------------------------
  // Analyze uploaded video
  // -----------------------------
  const analyzeUploadedVideo = async () => {
    if (!fileInputRef.current?.files[0]) return;

    setIsAnalyzing(true);

    const formData = new FormData();
    formData.append("file", fileInputRef.current.files[0]);

    try {
      const res = await fetch("http://localhost:8000/analyze_video", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      setTranscript(data.transcript);
      setFillers(data.fillers);
      setWpm(data.wpm);
      setConfidence(data.confidence);
      setIsAnalyzing(false);
      setShowAnalysis(true);
    } catch (err) {
      console.error("Error analyzing video:", err);
      setIsAnalyzing(false);
      alert("Failed to analyze video.");
    }
  };

  const getConfidenceColor = () => {
    if (confidence >= 80) return "#10b981";
    if (confidence >= 60) return "#f59e0b";
    return "#ef4444";
  };

  const getWpmColor = () => {
    if (wpm >= 130 && wpm <= 170) return "#10b981";
    if (wpm >= 100 && wpm < 130) return "#f59e0b";
    if (wpm > 170 && wpm <= 200) return "#f59e0b";
    return "#ef4444";
  };

  // -----------------------------
  // Generate AI Suggestions
  // -----------------------------
  const getSuggestions = () => {
    const suggestions = [];

    // WPM Suggestions
    if (wpm < 100) {
      suggestions.push({
        title: "Speak Faster",
        message: "You're speaking too slowly. Aim for 130-170 words per minute for a natural, confident pace.",
        type: "warning"
      });
    } else if (wpm > 200) {
      suggestions.push({
        title: "Slow Down",
        message: "You're speaking too fast! Take a breath and slow down to 130-170 words per minute for better clarity.",
        type: "warning"
      });
    } else if (wpm >= 100 && wpm < 130) {
      suggestions.push({
        title: "Slightly Faster",
        message: "Good pace, but try speaking a bit faster to sound more energetic and confident.",
        type: "info"
      });
    } else if (wpm > 170 && wpm <= 200) {
      suggestions.push({
        title: "Slightly Slower",
        message: "Good energy, but consider slowing down just a bit for better comprehension.",
        type: "info"
      });
    } else {
      suggestions.push({
        title: "Perfect Pace",
        message: "Excellent speaking pace! You're in the ideal range of 130-170 words per minute.",
        type: "success"
      });
    }

    // Filler Words Suggestions
    if (fillers > 10) {
      suggestions.push({
        title: "Too Many Filler Words",
        message: "You used a lot of filler words (um, uh, like). Practice pausing instead of filling silence. It shows confidence!",
        type: "warning"
      });
    } else if (fillers > 5) {
      suggestions.push({
        title: "Reduce Filler Words",
        message: "Try to minimize filler words. Take brief pauses to gather your thoughts instead.",
        type: "info"
      });
    } else if (fillers <= 3) {
      suggestions.push({
        title: "Great Clarity",
        message: "Excellent! You kept filler words to a minimum, showing strong communication skills.",
        type: "success"
      });
    }

    // Confidence Suggestions
    if (confidence < 60) {
      suggestions.push({
        title: "Build Confidence",
        message: "Practice makes perfect! Maintain eye contact with the camera, speak clearly, and believe in your answers.",
        type: "warning"
      });
    } else if (confidence >= 60 && confidence < 80) {
      suggestions.push({
        title: "Almost There",
        message: "Good confidence level! Focus on maintaining steady eye contact and projecting your voice.",
        type: "info"
      });
    } else {
      suggestions.push({
        title: "Highly Confident",
        message: "Outstanding confidence! You came across as assured and professional.",
        type: "success"
      });
    }

    // General camera/posture tip
    suggestions.push({
      title: "Camera & Posture",
      message: "Remember to look directly at the camera (not the screen), sit up straight, and keep your hands visible for gestures.",
      type: "info"
    });

    return suggestions;
  };

  // Handle smooth transition
  const handleGetStarted = () => {
    setIsTransitioning(true);
    setTimeout(() => {
      setShowWelcome(false);
    }, 600);
    setTimeout(() => {
      setIsTransitioning(false);
    }, 1000);
  };

  // -----------------------------
  // WELCOME PAGE
  // -----------------------------
  if (showWelcome) {
    return (
      <div 
        style={{
          minHeight: "100vh",
          width: "100vw",
          background: "linear-gradient(135deg, #190019 0%, #2B124C 30%, #522B5B 60%, #854F6C 85%, #DFB6B2 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px 20px",
          fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          boxSizing: "border-box",
          position: "relative",
          overflow: "hidden",
          cursor: "none",
          opacity: isTransitioning ? 0 : 1,
          transition: "opacity 0.6s ease-out"
        }}
        onMouseMove={(e) => {
          // Create splash particle
          const splash = document.createElement('div');
          splash.className = 'splash-particle';
          
          const x = e.clientX;
          const y = e.clientY;
          
          splash.style.left = x + 'px';
          splash.style.top = y + 'px';
          
          // Random size between 30-60px
          const size = Math.random() * 30 + 30;
          splash.style.width = size + 'px';
          splash.style.height = size + 'px';
          
          // Blue/Cyan colors matching your image
          const colors = [
            'rgba(178, 235, 242, 0.7)',
            'rgba(129, 212, 250, 0.7)',
            'rgba(79, 195, 247, 0.7)',
            'rgba(41, 182, 246, 0.7)',
            'rgba(3, 169, 244, 0.6)',
            'rgba(224, 247, 250, 0.8)',
          ];
          splash.style.background = colors[Math.floor(Math.random() * colors.length)];
          
          e.currentTarget.appendChild(splash);
          
          setTimeout(() => splash.remove(), 1500);
        }}
      >
        {/* Custom Cursor */}
        <div
          ref={cursorRef}
          style={{
            position: 'fixed',
            width: '20px',
            height: '20px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(251, 228, 216, 0.9) 0%, rgba(251, 228, 216, 0.4) 70%, transparent 100%)',
            pointerEvents: 'none',
            zIndex: 10000,
            transform: 'translate(-50%, -50%)',
            boxShadow: '0 0 20px rgba(251, 228, 216, 0.8), 0 0 40px rgba(251, 228, 216, 0.5)',
            transition: 'width 0.2s ease, height 0.2s ease'
          }}
        />

        <style>{`
          @import url('https://fonts.cdnfonts.com/css/horizon');
          
          .splash-particle {
            position: fixed;
            border-radius: 50%;
            pointer-events: none;
            animation: splashBlur 1.5s ease-out forwards;
            z-index: 1;
            filter: blur(0px);
          }
          
          @keyframes splashBlur {
            0% {
              transform: translate(-50%, -50%) scale(0);
              opacity: 1;
              filter: blur(0px);
            }
            50% {
              opacity: 0.9;
              filter: blur(20px);
            }
            100% {
              transform: translate(-50%, -50%) scale(4);
              opacity: 0;
              filter: blur(40px);
            }
          }
        `}</style>
        
        <div style={{
          textAlign: "center",
          maxWidth: "900px",
          width: "100%",
          position: "relative",
          zIndex: 10
        }}>
          <h1 style={{
            fontFamily: "'Horizon', 'Inter', sans-serif",
            fontSize: "clamp(60px, 10vw, 120px)",
            fontWeight: 700,
            color: "#FBE4D8",
            margin: "0 0 30px 0",
            textShadow: "0 4px 20px rgba(0,0,0,0.4)",
            letterSpacing: "2px"
          }}>
            WELCOME
          </h1>
          
          <div style={{
            background: "rgba(251, 228, 216, 0.1)",
            backdropFilter: "blur(10px)",
            borderRadius: "20px",
            padding: "40px 30px",
            marginBottom: "50px",
            border: "2px solid rgba(251, 228, 216, 0.2)"
          }}>
            <h2 style={{
              fontSize: "clamp(24px, 4vw, 36px)",
              fontWeight: 600,
              color: "#FBE4D8",
              margin: "0 0 15px 0",
              lineHeight: 1.4
            }}>
              SkillMirror AI
            </h2>
            <p style={{
              fontSize: "clamp(16px, 2.5vw, 20px)",
              color: "#DFB6B2",
              margin: 0,
              lineHeight: 1.6,
              fontWeight: 400
            }}>
              Interview Anxiety & Confidence Intelligence System
            </p>
          </div>
          
          <button 
            onClick={handleGetStarted}
            style={{
              background: "linear-gradient(135deg, #FBE4D8 0%, #F5D5CE 100%)",
              color: "#2B124C",
              border: "none",
              padding: "22px 70px",
              fontSize: "clamp(18px, 3vw, 24px)",
              fontWeight: 700,
              borderRadius: "16px",
              cursor: "none",
              boxShadow: "0 15px 35px rgba(0, 0, 0, 0.6), 0 8px 20px rgba(251, 228, 216, 0.3), inset 0 2px 4px rgba(255, 255, 255, 0.4)",
              transition: "all 0.3s ease",
              textTransform: "uppercase",
              letterSpacing: "2px",
              position: "relative",
              overflow: "hidden"
            }}
            onMouseOver={(e) => {
              e.target.style.transform = "translateY(-6px)";
              e.target.style.boxShadow = "0 20px 45px rgba(0, 0, 0, 0.7), 0 12px 28px rgba(251, 228, 216, 0.4), inset 0 2px 4px rgba(255, 255, 255, 0.5)";
              if (cursorRef.current) {
                cursorRef.current.style.width = '40px';
                cursorRef.current.style.height = '40px';
              }
            }}
            onMouseOut={(e) => {
              e.target.style.transform = "translateY(0)";
              e.target.style.boxShadow = "0 15px 35px rgba(0, 0, 0, 0.6), 0 8px 20px rgba(251, 228, 216, 0.3), inset 0 2px 4px rgba(255, 255, 255, 0.4)";
              if (cursorRef.current) {
                cursorRef.current.style.width = '20px';
                cursorRef.current.style.height = '20px';
              }
            }}
          >
            Get Started
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: "100vh",
      width: "100vw",
      background: "linear-gradient(135deg, #190019 0%, #2B124C 30%, #522B5B 60%, #854F6C 85%, #DFB6B2 100%)",
      padding: "40px 20px",
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      boxSizing: "border-box",
      opacity: isTransitioning ? 0 : 1,
      transition: "opacity 0.6s ease-in"
    }}>
      <div style={{ maxWidth: "100%", width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <h1 style={{
            fontSize: 48,
            fontWeight: 700,
            color: "#FBE4D8",
            margin: 0,
            marginBottom: 10,
            textShadow: "0 2px 10px rgba(0,0,0,0.3)"
          }}>
            AI Interview Coach
          </h1>
          <p style={{
            color: "#FBE4D8",
            fontSize: 18,
            margin: 0,
            opacity: 0.9
          }}>
            Practice your interview skills with real-time feedback
          </p>
        </div>

        {/* Step 1: Generate Question */}
        {!question && (
          <div style={{
            background: "#FBE4D8",
            borderRadius: 16,
            padding: 30,
            boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
            textAlign: "center",
            maxWidth: 600,
            margin: "0 auto"
          }}>
            <button onClick={generateQuestion} style={{
              background: "linear-gradient(135deg, #2B124C 0%, #522B5B 100%)",
              color: "#FBE4D8",
              border: "none",
              padding: "18px 50px",
              fontSize: 18,
              fontWeight: 700,
              borderRadius: 14,
              cursor: "pointer",
              boxShadow: "0 10px 25px rgba(43, 18, 76, 0.6), 0 5px 15px rgba(0, 0, 0, 0.4), inset 0 1px 3px rgba(255, 255, 255, 0.2)",
              transition: "all 0.3s ease",
              letterSpacing: "0.5px"
            }}
            onMouseOver={(e) => {
              e.target.style.transform = "translateY(-3px)";
              e.target.style.boxShadow = "0 14px 32px rgba(43, 18, 76, 0.7), 0 8px 20px rgba(0, 0, 0, 0.5), inset 0 1px 3px rgba(255, 255, 255, 0.3)";
            }}
            onMouseOut={(e) => {
              e.target.style.transform = "translateY(0)";
              e.target.style.boxShadow = "0 10px 25px rgba(43, 18, 76, 0.6), 0 5px 15px rgba(0, 0, 0, 0.4), inset 0 1px 3px rgba(255, 255, 255, 0.2)";
            }}
            >
              Generate Question
            </button>
          </div>
        )}

        {/* Step 2: Show Question and Start Recording */}
        {question && !running && !recordingComplete && (
          <div style={{
            background: "#FBE4D8",
            borderRadius: 16,
            padding: 30,
            boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
            marginBottom: 30,
            maxWidth: 900,
            margin: "0 auto"
          }}>
            <div style={{
              background: "#DFB6B2",
              padding: 24,
              borderRadius: 12,
              marginBottom: 24,
              border: "2px solid #854F6C"
            }}>
              <div style={{
                fontSize: 14,
                fontWeight: 600,
                color: "#2B124C",
                marginBottom: 8,
                textTransform: "uppercase",
                letterSpacing: 1
              }}>
                Interview Question
              </div>
              <div style={{
                fontSize: 20,
                fontWeight: 500,
                color: "#1f2937",
                lineHeight: 1.6
              }}>
                {question}
              </div>
            </div>

            <div style={{ textAlign: "center", display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
              <button onClick={startRecording} style={{
                background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                color: "white",
                border: "none",
                padding: "18px 55px",
                fontSize: 18,
                fontWeight: 700,
                borderRadius: 14,
                cursor: "pointer",
                boxShadow: "0 10px 25px rgba(16, 185, 129, 0.5), 0 5px 15px rgba(0, 0, 0, 0.3), inset 0 1px 3px rgba(255, 255, 255, 0.3)",
                transition: "all 0.3s ease",
                letterSpacing: "0.5px"
              }}
              onMouseOver={(e) => {
                e.target.style.transform = "translateY(-3px)";
                e.target.style.boxShadow = "0 14px 32px rgba(16, 185, 129, 0.6), 0 8px 20px rgba(0, 0, 0, 0.4), inset 0 1px 3px rgba(255, 255, 255, 0.4)";
              }}
              onMouseOut={(e) => {
                e.target.style.transform = "translateY(0)";
                e.target.style.boxShadow = "0 10px 25px rgba(16, 185, 129, 0.5), 0 5px 15px rgba(0, 0, 0, 0.3), inset 0 1px 3px rgba(255, 255, 255, 0.3)";
              }}
              >
                Start Recording
              </button>
              <button onClick={generateQuestion} style={{
                background: "linear-gradient(135deg, #2B124C 0%, #522B5B 100%)",
                color: "#FBE4D8",
                border: "none",
                padding: "18px 55px",
                fontSize: 18,
                fontWeight: 700,
                borderRadius: 14,
                cursor: "pointer",
                boxShadow: "0 10px 25px rgba(43, 18, 76, 0.6), 0 5px 15px rgba(0, 0, 0, 0.4), inset 0 1px 3px rgba(255, 255, 255, 0.2)",
                transition: "all 0.3s ease",
                letterSpacing: "0.5px"
              }}
              onMouseOver={(e) => {
                e.target.style.transform = "translateY(-3px)";
                e.target.style.boxShadow = "0 14px 32px rgba(43, 18, 76, 0.7), 0 8px 20px rgba(0, 0, 0, 0.5), inset 0 1px 3px rgba(255, 255, 255, 0.3)";
              }}
              onMouseOut={(e) => {
                e.target.style.transform = "translateY(0)";
                e.target.style.boxShadow = "0 10px 25px rgba(43, 18, 76, 0.6), 0 5px 15px rgba(0, 0, 0, 0.4), inset 0 1px 3px rgba(255, 255, 255, 0.2)";
              }}
              >
                Change Question
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Recording View */}
        {running && (
          <div style={{
            background: "#FBE4D8",
            borderRadius: 16,
            padding: 30,
            boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
            width: "100%",
            maxWidth: "100%"
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 16 }}>
              <div>
                <div style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#2B124C",
                  marginBottom: 4,
                  textTransform: "uppercase",
                  letterSpacing: 1
                }}>Recording</div>
                <div style={{ fontSize: 18, fontWeight: 500, color: "#1f2937" }}>{question}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderRadius: 20, background: connected ? "#d1fae5" : "#fee2e2", fontSize: 14, fontWeight: 600 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: connected ? "#10b981" : "#ef4444" }}></span>
                {connected ? "REC" : "Disconnected"}
              </div>
            </div>

            <div style={{ background: "#000", borderRadius: 12, overflow: "hidden", marginBottom: 24, border: "3px solid #522B5B" }}>
              <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", height: "auto", minHeight: "500px", objectFit: "cover", display: "block" }} />
            </div>

            <div style={{ textAlign: "center" }}>
              <button onClick={stopRecording} style={{
                background: "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
                color: "white",
                border: "none",
                padding: "18px 55px",
                fontSize: 18,
                fontWeight: 700,
                borderRadius: 14,
                cursor: "pointer",
                boxShadow: "0 10px 25px rgba(239, 68, 68, 0.5), 0 5px 15px rgba(0, 0, 0, 0.3), inset 0 1px 3px rgba(255, 255, 255, 0.3)",
                transition: "all 0.3s ease",
                letterSpacing: "0.5px"
              }}
              onMouseOver={(e) => {
                e.target.style.transform = "translateY(-3px)";
                e.target.style.boxShadow = "0 14px 32px rgba(239, 68, 68, 0.6), 0 8px 20px rgba(0, 0, 0, 0.4), inset 0 1px 3px rgba(255, 255, 255, 0.4)";
              }}
              onMouseOut={(e) => {
                e.target.style.transform = "translateY(0)";
                e.target.style.boxShadow = "0 10px 25px rgba(239, 68, 68, 0.5), 0 5px 15px rgba(0, 0, 0, 0.3), inset 0 1px 3px rgba(255, 255, 255, 0.3)";
              }}
              >
                Stop Recording
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Upload Video Section */}
        {recordingComplete && !showAnalysis && !isAnalyzing && (
          <div style={{ background: "#FBE4D8", borderRadius: 16, padding: 40, boxShadow: "0 20px 60px rgba(0,0,0,0.4)", textAlign: "center", maxWidth: 900, margin: "0 auto" }}>
            <h3 style={{ fontSize: 24, fontWeight: 600, color: "#1f2937", marginBottom: 24 }}>Upload Your Interview Video</h3>
            <input type="file" ref={fileInputRef} accept="video/*" onChange={handleVideoUpload} style={{ display: "none" }} />

            {!uploadedVideo ? (
              <button onClick={() => fileInputRef.current.click()} style={{ 
                background: "#DFB6B2", 
                color: "#2B124C", 
                border: "2px dashed #854F6C", 
                padding: "60px 40px", 
                fontSize: 18, 
                fontWeight: 600, 
                borderRadius: 12, 
                cursor: "pointer", 
                width: "100%", 
                maxWidth: 500, 
                margin: "0 auto", 
                display: "block",
                boxShadow: "0 8px 20px rgba(133, 79, 108, 0.3), inset 0 2px 4px rgba(255, 255, 255, 0.3)",
                transition: "all 0.3s ease"
              }}
              onMouseOver={(e) => {
                e.target.style.transform = "translateY(-3px)";
                e.target.style.boxShadow = "0 12px 28px rgba(133, 79, 108, 0.4), inset 0 2px 4px rgba(255, 255, 255, 0.4)";
              }}
              onMouseOut={(e) => {
                e.target.style.transform = "translateY(0)";
                e.target.style.boxShadow = "0 8px 20px rgba(133, 79, 108, 0.3), inset 0 2px 4px rgba(255, 255, 255, 0.3)";
              }}
              >
                Click to Upload Video
                <div style={{ fontSize: 14, marginTop: 8, opacity: 0.9 }}>Supported formats: MP4, MOV, AVI, WebM</div>
              </button>
            ) : (
              <div>
                <div style={{ background: "#000", borderRadius: 12, overflow: "hidden", marginBottom: 24, border: "3px solid #522B5B", maxWidth: 700, margin: "0 auto 24px" }}>
                  <video src={uploadedVideo} controls style={{ width: "100%", display: "block" }} />
                </div>
                <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
                  <button onClick={analyzeUploadedVideo} style={{ 
                    background: "linear-gradient(135deg, #10b981 0%, #059669 100%)", 
                    color: "white", 
                    border: "none", 
                    padding: "18px 55px", 
                    fontSize: 18, 
                    fontWeight: 700, 
                    borderRadius: 14, 
                    cursor: "pointer",
                    boxShadow: "0 10px 25px rgba(16, 185, 129, 0.5), 0 5px 15px rgba(0, 0, 0, 0.3), inset 0 1px 3px rgba(255, 255, 255, 0.3)",
                    transition: "all 0.3s ease",
                    letterSpacing: "0.5px"
                  }}
                  onMouseOver={(e) => {
                    e.target.style.transform = "translateY(-3px)";
                    e.target.style.boxShadow = "0 14px 32px rgba(16, 185, 129, 0.6), 0 8px 20px rgba(0, 0, 0, 0.4), inset 0 1px 3px rgba(255, 255, 255, 0.4)";
                  }}
                  onMouseOut={(e) => {
                    e.target.style.transform = "translateY(0)";
                    e.target.style.boxShadow = "0 10px 25px rgba(16, 185, 129, 0.5), 0 5px 15px rgba(0, 0, 0, 0.3), inset 0 1px 3px rgba(255, 255, 255, 0.3)";
                  }}
                  >Show Analysis</button>
                  <button onClick={() => { setUploadedVideo(null); fileInputRef.current.value = ""; }} style={{ 
                    background: "linear-gradient(135deg, #6b7280 0%, #4b5563 100%)", 
                    color: "white", 
                    border: "none", 
                    padding: "18px 55px", 
                    fontSize: 18, 
                    fontWeight: 700, 
                    borderRadius: 14, 
                    cursor: "pointer",
                    boxShadow: "0 10px 25px rgba(107, 114, 128, 0.5), 0 5px 15px rgba(0, 0, 0, 0.3), inset 0 1px 3px rgba(255, 255, 255, 0.2)",
                    transition: "all 0.3s ease",
                    letterSpacing: "0.5px"
                  }}
                  onMouseOver={(e) => {
                    e.target.style.transform = "translateY(-3px)";
                    e.target.style.boxShadow = "0 14px 32px rgba(107, 114, 128, 0.6), 0 8px 20px rgba(0, 0, 0, 0.4), inset 0 1px 3px rgba(255, 255, 255, 0.3)";
                  }}
                  onMouseOut={(e) => {
                    e.target.style.transform = "translateY(0)";
                    e.target.style.boxShadow = "0 10px 25px rgba(107, 114, 128, 0.5), 0 5px 15px rgba(0, 0, 0, 0.3), inset 0 1px 3px rgba(255, 255, 255, 0.2)";
                  }}
                  >Upload Different Video</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Loading Screen */}
        {isAnalyzing && (
          <div style={{ 
            background: "#FBE4D8", 
            borderRadius: 16, 
            padding: 60, 
            boxShadow: "0 20px 60px rgba(0,0,0,0.4)", 
            textAlign: "center", 
            maxWidth: 700, 
            margin: "0 auto" 
          }}>
            <div style={{
              width: 80,
              height: 80,
              margin: "0 auto 30px",
              border: "6px solid #DFB6B2",
              borderTop: "6px solid #2B124C",
              borderRadius: "50%",
              animation: "spin 1s linear infinite"
            }}></div>
            <style>{`
              @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
              }
            `}</style>
            <h3 style={{ 
              fontSize: 28, 
              fontWeight: 700, 
              color: "#1f2937", 
              marginBottom: 12 
            }}>
              Analyzing Your Interview...
            </h3>
            <p style={{ 
              fontSize: 16, 
              color: "#6b7280", 
              margin: 0,
              lineHeight: 1.6 
            }}>
              Our AI is processing your video, analyzing speech patterns, confidence level, and providing personalized feedback. This may take a moment.
            </p>
            <div style={{ 
              marginTop: 30,
              display: "flex",
              gap: 10,
              justifyContent: "center",
              alignItems: "center"
            }}>
              <div style={{
                width: 10,
                height: 10,
                background: "#2B124C",
                borderRadius: "50%",
                animation: "pulse 1.5s ease-in-out infinite"
              }}></div>
              <div style={{
                width: 10,
                height: 10,
                background: "#2B124C",
                borderRadius: "50%",
                animation: "pulse 1.5s ease-in-out 0.2s infinite"
              }}></div>
              <div style={{
                width: 10,
                height: 10,
                background: "#2B124C",
                borderRadius: "50%",
                animation: "pulse 1.5s ease-in-out 0.4s infinite"
              }}></div>
            </div>
            <style>{`
              @keyframes pulse {
                0%, 100% { opacity: 0.3; transform: scale(0.8); }
                50% { opacity: 1; transform: scale(1.2); }
              }
            `}</style>
          </div>
        )}

        {/* Step 5: Analysis Results */}
        {showAnalysis && (
          <div style={{ width: "100%", maxWidth: "100%" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 30, marginBottom: 30 }}>
              {/* Confidence */}
              <div style={{ background: "#FBE4D8", borderRadius: 16, padding: 24, boxShadow: "0 10px 30px rgba(0,0,0,0.3)" }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#6b7280", marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>Confidence Level</div>
                <div style={{ fontSize: 48, fontWeight: 700, color: getConfidenceColor(), marginBottom: 8 }}>{confidence}%</div>
                <div style={{ width: "100%", height: 8, background: "#DFB6B2", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ width: `${confidence}%`, height: "100%", background: getConfidenceColor(), transition: "width 0.5s ease" }}></div>
                </div>
              </div>

              {/* Filler Words */}
              <div style={{ background: "#FBE4D8", borderRadius: 16, padding: 24, boxShadow: "0 10px 30px rgba(0,0,0,0.3)" }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#6b7280", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Filler Words</div>
                <div style={{ fontSize: 40, fontWeight: 700, color: fillers > 5 ? "#ef4444" : "#10b981" }}>{fillers}</div>
              </div>

              {/* WPM */}
              <div style={{ background: "#FBE4D8", borderRadius: 16, padding: 24, boxShadow: "0 10px 30px rgba(0,0,0,0.3)" }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#6b7280", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Words/Min</div>
                <div style={{ fontSize: 40, fontWeight: 700, color: getWpmColor() }}>{wpm}</div>
              </div>
            </div>

            {/* Transcript */}
            <div style={{ background: "#FBE4D8", borderRadius: 16, padding: 30, boxShadow: "0 20px 60px rgba(0,0,0,0.4)", marginBottom: 30 }}>
              <h3 style={{ margin: 0, marginBottom: 16, fontSize: 18, fontWeight: 600, color: "#1f2937" }}>Transcript</h3>
              <div style={{ fontSize: 16, lineHeight: 1.8, color: "#4b5563", minHeight: 100, fontStyle: transcript ? "normal" : "italic" }}>
                {transcript || "No transcript available"}
              </div>
            </div>

            {/* AI Suggestions */}
            <div style={{ background: "#FBE4D8", borderRadius: 16, padding: 30, boxShadow: "0 20px 60px rgba(0,0,0,0.4)", marginBottom: 30 }}>
              <h3 style={{ margin: 0, marginBottom: 20, fontSize: 18, fontWeight: 600, color: "#1f2937" }}>
                Suggestions for Improvement
              </h3>
              <div style={{ display: "grid", gap: 16 }}>
                {getSuggestions().map((suggestion, index) => {
                  const bgColor = 
                    suggestion.type === "success" ? "#d1fae5" :
                    suggestion.type === "warning" ? "#fee2e2" :
                    "#dbeafe";
                  
                  const borderColor = 
                    suggestion.type === "success" ? "#10b981" :
                    suggestion.type === "warning" ? "#ef4444" :
                    "#3b82f6";

                  return (
                    <div key={index} style={{
                      background: bgColor,
                      border: `2px solid ${borderColor}`,
                      borderRadius: 12,
                      padding: "16px 20px",
                      boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)"
                    }}>
                      <div style={{ fontSize: 16, fontWeight: 600, color: "#1f2937", marginBottom: 4 }}>
                        {suggestion.title}
                      </div>
                      <div style={{ fontSize: 14, color: "#4b5563", lineHeight: 1.6 }}>
                        {suggestion.message}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Start Over Button */}
            <div style={{ textAlign: "center" }}>
              <button onClick={() => {
                setQuestion("");
                setShowAnalysis(false);
                setRecordingComplete(false);
                setUploadedVideo(null);
                setTranscript("");
                setFillers(0);
                setWpm(0);
                setConfidence(0);
                setIsAnalyzing(false);
              }} style={{ 
                background: "linear-gradient(135deg, #2B124C 0%, #522B5B 100%)", 
                color: "#FBE4D8", 
                border: "none", 
                padding: "18px 55px", 
                fontSize: 18, 
                fontWeight: 700, 
                borderRadius: 14, 
                cursor: "pointer",
                boxShadow: "0 10px 25px rgba(43, 18, 76, 0.6), 0 5px 15px rgba(0, 0, 0, 0.4), inset 0 1px 3px rgba(255, 255, 255, 0.2)",
                transition: "all 0.3s ease",
                letterSpacing: "0.5px"
              }}
              onMouseOver={(e) => {
                e.target.style.transform = "translateY(-3px)";
                e.target.style.boxShadow = "0 14px 32px rgba(43, 18, 76, 0.7), 0 8px 20px rgba(0, 0, 0, 0.5), inset 0 1px 3px rgba(255, 255, 255, 0.3)";
              }}
              onMouseOut={(e) => {
                e.target.style.transform = "translateY(0)";
                e.target.style.boxShadow = "0 10px 25px rgba(43, 18, 76, 0.6), 0 5px 15px rgba(0, 0, 0, 0.4), inset 0 1px 3px rgba(255, 255, 255, 0.2)";
              }}
              >
                Start Over
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;