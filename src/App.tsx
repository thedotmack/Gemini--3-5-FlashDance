import React, { useState, useEffect, useRef } from "react";
import { 
  Play, 
  Pause, 
  RotateCcw, 
  SkipForward, 
  SkipBack, 
  Search, 
  Youtube, 
  Sparkles, 
  Tv, 
  Sliders, 
  CheckCircle, 
  Flame,
  Music,
  HelpCircle,
  ExternalLink,
  ChevronRight,
  Trash2,
  Server,
  Mic,
  MicOff
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { DanceRoutine, DanceStep, YouTubeVideoInfo } from "./types";
import { PREBUILT_ROUTINES, FALLBACK_YOUTUBE_VIDEOS } from "./data";
import StickFigure from "./components/StickFigure";

// Firebase modules
import { auth, db, handleFirestoreError, OperationType } from "./firebase";
import { signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, User } from "firebase/auth";
import { collection, doc, setDoc, deleteDoc, onSnapshot, query, where, serverTimestamp } from "firebase/firestore";

export default function App() {
  // State
  const [selectedVideo, setSelectedVideo] = useState<YouTubeVideoInfo | null>(FALLBACK_YOUTUBE_VIDEOS[0]);
  
  // YouTube Video Import states
  const [ytInput, setYtInput] = useState("");
  const [ytMetadata, setYtMetadata] = useState<{ title: string; author: string; thumbnailUrl: string; videoId: string } | null>(null);
  const [isFetchingYtMeta, setIsFetchingYtMeta] = useState(false);
  const [ytMetaError, setYtMetaError] = useState<string | null>(null);

  // Cached persistent database library states
  const [savedSessions, setSavedSessions] = useState<{ id: string; userId?: string; video?: YouTubeVideoInfo; routine: DanceRoutine; savedAt: string }[]>([]);
  const [isLoadingSaved, setIsLoadingSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // Firebase Authentication States
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  // Monitor Auth Changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setIsAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Load saved routines database from server (Fallback Guest mode)
  const fetchSavedSessions = async () => {
    setIsLoadingSaved(true);
    try {
      const res = await fetch("/api/dance/saved");
      if (res.ok) {
        const data = await res.json();
        setSavedSessions(data.items || []);
      }
    } catch (err) {
      console.error("Failed to load saved sessions DB:", err);
    } finally {
      setIsLoadingSaved(false);
    }
  };

  // Real-time synchronization of saved choreography sessions from Firestore
  useEffect(() => {
    if (isAuthLoading) return;
    
    if (!currentUser) {
      // Guest mode: fetch standard saved sessions from cached json file
      fetchSavedSessions();
      return;
    }

    // Authenticated mode: Real-time Firestore sync
    setIsLoadingSaved(true);
    const q = query(
      collection(db, "sessions"),
      where("userId", "==", currentUser.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const dbSessions: any[] = [];
      snapshot.forEach((docSnap) => {
        dbSessions.push(docSnap.data());
      });
      // Sort in descending order of savedAt
      dbSessions.sort((a, b) => {
        const dateA = a.savedAt ? new Date(a.savedAt).getTime() : 0;
        const dateB = b.savedAt ? new Date(b.savedAt).getTime() : 0;
        return dateB - dateA;
      });
      setSavedSessions(dbSessions);
      setIsLoadingSaved(false);
    }, (error) => {
      // Catch error and format matching standard FirestoreErrorInfo JSON format
      handleFirestoreError(error, OperationType.LIST, "sessions");
    });

    return () => unsubscribe();
  }, [currentUser, isAuthLoading]);

  // Handle Google Authentication Sign In Popup
  const handleSignIn = async () => {
    const provider = new GoogleAuthProvider();
    provider.addScope("profile");
    provider.addScope("email");
    try {
      const result = await signInWithPopup(auth, provider);
      if (result.user) {
        // Enforce secure writes: save/update user document inside users collection
        const userRef = doc(db, "users", result.user.uid);
        await setDoc(userRef, {
          userId: result.user.uid,
          email: result.user.email || "",
          displayName: result.user.displayName || "Studio Dancer",
          photoURL: result.user.photoURL || "",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }, { merge: true });

        // Auto synchronizes local routines to cloud on first login
        const guestSessions = savedSessions.filter(s => !s.userId);
        if (guestSessions.length > 0) {
          setSaveStatus(`Syncing ${guestSessions.length} session(s) to cloud...`);
          for (const s of guestSessions) {
            const videoId = s.id;
            await setDoc(doc(db, "sessions", videoId), {
              id: videoId,
              userId: result.user.uid,
              video: s.video || null,
              routine: s.routine,
              savedAt: s.savedAt || new Date().toISOString(),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            });
          }
          setSaveStatus("Offline workouts fully verified & backed up!");
          setTimeout(() => setSaveStatus(null), 3000);
        }
      }
    } catch (err: any) {
      console.error("Sign-in verification failure or user closed the dialog:", err);
    }
  };

  // Handle Sign Out from system
  const handleSignOut = async () => {
    try {
      await signOut(auth);
      setSavedSessions([]); // Clean list references immediately
    } catch (err) {
      console.error("Authentication sign-out issue:", err);
    }
  };

  // Save/Commit active routine to database (supports both Firebase and Express DB)
  const handleSaveActiveRoutine = async () => {
    if (!danceRoutine) return;
    setIsSaving(true);
    setSaveStatus("Saving to Studio DB...");
    
    // Create a unique id from video id if it exists
    const videoId = selectedVideo?.id || `dance-${Date.now()}`;
    const cleanVideo = selectedVideo || {
      id: videoId,
      title: danceRoutine.songTitle,
      description: danceRoutine.styleDescription || "Custom saved studio session",
      thumbnailUrl: "https://images.unsplash.com/photo-1516450360452-9352f5e86fc7?q=80&w=300&auto=format&fit=crop",
      channelTitle: danceRoutine.artist || "Independent Artist",
      publishedAt: new Date().toISOString().split("T")[0]
    };

    if (currentUser) {
      // Authenticated Mode - Save to Cloud Firestore
      try {
        const sessionRef = doc(db, "sessions", videoId);
        await setDoc(sessionRef, {
          id: videoId,
          userId: currentUser.uid,
          video: cleanVideo,
          routine: danceRoutine,
          savedAt: new Date().toISOString(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        setSaveStatus("Saved to Cloud Firestore!");
        setTimeout(() => setSaveStatus(null), 3000);
      } catch (err: any) {
        handleFirestoreError(err, OperationType.CREATE, `sessions/${videoId}`);
      } finally {
        setIsSaving(false);
      }
    } else {
      // Guest Mode - Save to server-side JSON database
      try {
        const res = await fetch("/api/dance/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            video: selectedVideo,
            routine: danceRoutine
          })
        });
        if (res.ok) {
          const data = await res.json();
          setSavedSessions(data.items || []);
          setSaveStatus("Saved to Studio Database (Guest Mode)!");
          setTimeout(() => setSaveStatus(null), 3000);
        } else {
           throw new Error("Persist error.");
        }
      } catch (err: any) {
        console.error(err);
        setSaveStatus("Save failed.");
        setTimeout(() => setSaveStatus(null), 3000);
      } finally {
        setIsSaving(false);
      }
    }
  };

  // Delete matching routine from database (supports both Firebase and Express DB)
  const handleDeleteSavedSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this choreography from the saved database?")) return;
    
    if (currentUser) {
      // Cloud Delete from Firestore
      try {
        await deleteDoc(doc(db, "sessions", id));
        setSaveStatus("Routine deleted from Cloud!");
        setTimeout(() => setSaveStatus(null), 2000);
      } catch (err: any) {
        handleFirestoreError(err, OperationType.DELETE, `sessions/${id}`);
      }
    } else {
      // Guest Delete from local backend REST DB
      try {
        const res = await fetch("/api/dance/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id })
        });
        if (res.ok) {
          const data = await res.json();
          setSavedSessions(data.items || []);
        }
      } catch (err) {
        console.error("Delete call failure:", err);
      }
    }
  };
  
  // Dance State
  const [danceRoutine, setDanceRoutine] = useState<DanceRoutine>(PREBUILT_ROUTINES[0]);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeedMs, setPlaySpeedMs] = useState(1200); // interval duration for play back
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  // Custom modification states for the step coordinates (Choreography Sandbox!)
  const [isEditMode, setIsEditMode] = useState(false);

  // New visual overlay & design configuration states
  const [catalogTab, setCatalogTab] = useState<"featured" | "saved">("featured");

  // Playback Timer Ref
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Camera & AI Dance Compilation State
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraPhotoBuffer, setCameraPhotoBuffer] = useState<string | null>(null);
  const [photoCount, setPhotoCount] = useState(0);

  // Pipeline compile progress states
  const [isCompilingAIPoses, setIsCompilingAIPoses] = useState(false);
  const [compiledPhotoResult, setCompiledPhotoResult] = useState<{
    compiled: boolean;
    videoUrl: string | null;
    stepImages: string[];
    stepSvgs: string[];
  } | null>(null);
  const [compilationProgressMessage, setCompilationProgressMessage] = useState<string>("");

  // Controls for compiled cinematic overlay
  const [showCompiledCinemaOverlay, setShowCompiledCinemaOverlay] = useState(false);

  // 6-step Wizard workflow state
  const [wizardStep, setWizardStep] = useState(1);
  const [songPromptText, setSongPromptText] = useState("");
  const [isGeneratingSongPrompt, setIsGeneratingSongPrompt] = useState(false);
  const [songPromptError, setSongPromptError] = useState<string | null>(null);

  // Suggested pre-selected clips from video
  const [videoClips, setVideoClips] = useState([
    { id: "clip-1", label: "Intro Beats Sequence", startSec: 10, endSec: 20 },
    { id: "clip-2", label: "Choreography Chorus Highlight", startSec: 35, endSec: 45 },
    { id: "clip-3", label: "Ending Grand Outro", startSec: 75, endSec: 85 },
  ]);
  const [activeClipId, setActiveClipId] = useState("clip-1");

  // Web Audio Synthesizer ref & states
  const audioContextRef = useRef<AudioContext | null>(null);
  const synthTimerRef = useRef<number | null>(null);

  // Helper to start/stop synthesized playback loop based on BPM
  const startSynthLoop = (bpm: number) => {
    stopSynthLoop();
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      audioContextRef.current = ctx;
      const intervalSec = 60 / bpm;
      let stepCounter = 0;

      const tick = () => {
        if (!audioContextRef.current || audioContextRef.current.state === "closed") return;
        const time = ctx.currentTime;
        
        // Kick Drum sound
        if (stepCounter % 4 === 0 || stepCounter % 2 === 0) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.setValueAtTime(120, time);
          osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.28);
          gain.gain.setValueAtTime(0.6, time);
          gain.gain.exponentialRampToValueAtTime(0.01, time + 0.3);
          osc.start(time);
          osc.stop(time + 0.32);
        }
        
        // Hi-Hat sound
        if (stepCounter % 2 === 1) {
          const bufferSize = ctx.sampleRate * 0.04;
          const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
          const data = buffer.getChannelData(0);
          for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
          }
          const noise = ctx.createBufferSource();
          noise.buffer = buffer;
          const filter = ctx.createBiquadFilter();
          filter.type = "highpass";
          filter.frequency.value = 8500;
          const gain = ctx.createGain();
          gain.gain.setValueAtTime(0.1, time);
          gain.gain.exponentialRampToValueAtTime(0.01, time + 0.04);
          noise.connect(filter);
          filter.connect(gain);
          gain.connect(ctx.destination);
          noise.start(time);
        }
        
        // Sub chords & arpeggios
        if (stepCounter % 2 === 0) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sawtooth";
          osc.connect(gain);
          const filter = ctx.createBiquadFilter();
          filter.type = "lowpass";
          filter.frequency.setValueAtTime(950, time);
          filter.frequency.exponentialRampToValueAtTime(250, time + 0.12);
          gain.connect(filter);
          filter.connect(ctx.destination);
          const notes = [130.81, 164.81, 196.00, 261.63];
          const noteIndex = Math.floor(stepCounter / 2) % notes.length;
          osc.frequency.setValueAtTime(notes[noteIndex], time);
          gain.gain.setValueAtTime(0.07, time);
          gain.gain.exponentialRampToValueAtTime(0.01, time + 0.18);
          osc.start(time);
          osc.stop(time + 0.22);
        }

        stepCounter++;
        synthTimerRef.current = setTimeout(tick, intervalSec * 1000) as any;
      };
      tick();
    } catch (e) {
      console.warn("Could not start Web Audio Synth:", e);
    }
  };

  const stopSynthLoop = () => {
    if (synthTimerRef.current) {
      clearTimeout(synthTimerRef.current);
      synthTimerRef.current = null;
    }
    if (audioContextRef.current) {
      if (audioContextRef.current.state !== "closed") {
        audioContextRef.current.close().catch(() => {});
      }
      audioContextRef.current = null;
    }
  };

  // Sync synth loop with playback during Step 6
  useEffect(() => {
    if (isPlaying && wizardStep === 6) {
      startSynthLoop(danceRoutine.tempoBpm || 100);
    } else {
      stopSynthLoop();
    }
    return () => stopSynthLoop();
  }, [isPlaying, wizardStep, danceRoutine.tempoBpm]);

  const handleGenerateSongFromPrompt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!songPromptText.trim()) return;

    setIsGeneratingSongPrompt(true);
    setSongPromptError(null);

    try {
      const response = await fetch("/api/dance/generate-song", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songDescription: songPromptText })
      });

      if (!response.ok) {
        throw new Error("Unable to create custom beat. Please try another description!");
      }

      const songData = await response.json();
      
      const newRoutine: DanceRoutine = {
        songTitle: songData.songTitle || "Cybernetic Groove",
        artist: songData.artist || "AI Maestro",
        genre: songData.genre || "Electro Dance",
        tempoBpm: songData.tempoBpm || 120,
        styleDescription: songData.styleDescription || "Energetic pop cyber loops",
        difficulty: songData.difficulty || "Intermediate",
        steps: PREBUILT_ROUTINES[0].steps
      };

      setDanceRoutine(newRoutine);
      setWizardStep(2); // Auto proceed to clip selector!
      
      setSelectedVideo({
        id: "ai-song-gen",
        title: newRoutine.songTitle,
        description: newRoutine.styleDescription,
        thumbnailUrl: "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?q=80&w=300&auto=format&fit=crop",
        channelTitle: newRoutine.artist,
        publishedAt: new Date().toISOString()
      });

    } catch (err: any) {
      console.error(err);
      setSongPromptError(err.message || "Failed to generate song concept.");
    } finally {
      setIsGeneratingSongPrompt(false);
    }
  };

  // Webcam stream references
  const webcamVideoRef = useRef<HTMLVideoElement | null>(null);

  const startWebcam = async () => {
    try {
      setCameraPhotoBuffer(null);
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
      if (webcamVideoRef.current) {
        webcamVideoRef.current.srcObject = stream;
      }
      setIsCameraActive(true);
    } catch (err) {
      console.error("Failed to access camera", err);
      alert("Could not access your camera. Please ensure camera permissions are allowed in your browser settings!");
    }
  };

  const stopWebcam = () => {
    if (webcamVideoRef.current && webcamVideoRef.current.srcObject) {
      const stream = webcamVideoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      webcamVideoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  };

  const captureWebcamSnapshot = () => {
    if (!webcamVideoRef.current) return;
    const video = webcamVideoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg");
      setCameraPhotoBuffer(dataUrl);
      setPhotoCount(prev => prev + 1);
      stopWebcam();
    }
  };

  const compileChoreographyWithPhoto = async () => {
    if (!cameraPhotoBuffer) return;
    setIsCompilingAIPoses(true);
    setCompiledPhotoResult(null);

    const progressSteps = [
      "📸 Isolating facial structure and outfit details...",
      "🧠 Aligning stick skeleton bones with photo ratios...",
      "🎨 Triggering custom Imagen 3 pose simulations sequentially...",
      "⚡ Synchronizing choreo loops at exact step beats...",
      "🎞️ Initializing FFmpeg video transition renderer...",
      "🎬 Merging transitions into master clip file..."
    ];

    let progressIdx = 0;
    setCompilationProgressMessage(progressSteps[0]);

    const progressInterval = setInterval(() => {
      if (progressIdx < progressSteps.length - 1) {
        progressIdx++;
        setCompilationProgressMessage(progressSteps[progressIdx]);
      }
    }, 2200);

    try {
      const response = await fetch("/api/dance/process-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          photo: cameraPhotoBuffer,
          routine: danceRoutine
        })
      });

      clearInterval(progressInterval);

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Internal compilation crash.");
      }

      const data = await response.json();
      setCompiledPhotoResult({
        compiled: data.compiled,
        videoUrl: data.videoUrl,
        stepImages: data.stepImages,
        stepSvgs: data.stepSvgs
      });
      setShowCompiledCinemaOverlay(true);
    } catch (err: any) {
      clearInterval(progressInterval);
      console.error("Dance compilation caught error:", err);
      alert(err.message || "Failed to process pose imagery. Let's retry!");
    } finally {
      setIsCompilingAIPoses(false);
    }
  };

  // Clean closure on component destruction
  useEffect(() => {
    return () => {
      if (webcamVideoRef.current && webcamVideoRef.current.srcObject) {
        const stream = webcamVideoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Helper to parse YouTube ID
  const getYouTubeId = (url: string): string | null => {
    const cleanUrl = url.trim();
    if (cleanUrl.length === 11) return cleanUrl; // Already a video ID
    
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = cleanUrl.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  };

  // Autoload YouTube Metadata when a valid ID/Url is typed or pasted
  useEffect(() => {
    const id = getYouTubeId(ytInput);
    if (!id) {
      setYtMetadata(null);
      setYtMetaError(null);
      return;
    }
    
    let active = true;
    const fetchMeta = async () => {
      setIsFetchingYtMeta(true);
      setYtMetaError(null);
      try {
        const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${id}`);
        if (!res.ok) throw new Error("Could not fetch video details from YouTube.");
        const data = await res.json();
        
        if (!active) return;
        
        if (data.error) {
          // Fallback if video isn't directly listed on oembed
          setYtMetadata({
            title: `YouTube Video (${id})`,
            author: "YouTube Creator",
            thumbnailUrl: `https://img.youtube.com/vi/${id}/0.jpg`,
            videoId: id
          });
        } else {
          setYtMetadata({
            title: data.title || `Video ${id}`,
            author: data.author_name || "Unknown Channel",
            thumbnailUrl: data.thumbnail_url || `https://img.youtube.com/vi/${id}/0.jpg`,
            videoId: id
          });
        }
      } catch (err: any) {
        if (!active) return;
        console.warn("Noembed metadata fetch failed, using direct fallback", err);
        setYtMetadata({
          title: `YouTube Video ID: ${id}`,
          author: "YouTube Channel",
          thumbnailUrl: `https://img.youtube.com/vi/${id}/0.jpg`,
          videoId: id
        });
      } finally {
        if (active) setIsFetchingYtMeta(false);
      }
    };
    
    fetchMeta();
    return () => {
      active = false;
    };
  }, [ytInput]);

  // Handle generating dance from any youtube video url/id
  const handleGenerateYouTubeDance = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = getYouTubeId(ytInput);
    if (!id) {
      setYtMetaError("Please enter a valid YouTube Video URL or 11-character Video ID.");
      return;
    }

    setIsGenerating(true);
    setGenerationError(null);

    const videoTitle = ytMetadata?.title || `YouTube Video (${id})`;
    const videoAuthor = ytMetadata?.author || "YouTube Channel";
    const videoThumb = ytMetadata?.thumbnailUrl || `https://img.youtube.com/vi/${id}/0.jpg`;

    const videoObj: YouTubeVideoInfo = {
      id,
      title: videoTitle,
      description: `Gemini Smart Choreography - Interactive animation extracted dynamically from YouTube Video ID "${id}".`,
      thumbnailUrl: videoThumb,
      channelTitle: videoAuthor,
      publishedAt: new Date().toISOString().split('T')[0]
    };

    setSelectedVideo(videoObj);

    try {
      const response = await fetch('/api/dance/generate', {
        method: "POST",
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: videoTitle,
          artist: videoAuthor,
          description: `Extracted from YouTube Video ID: ${id}. Please find and analyze the authentic music video dance moves, iconic choreographies, or dance routines for ${videoTitle} by ${videoAuthor} and output clean step coordinates.`
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Gemini choreography generator rejected the request.");
      }

      const parsedRoutine: DanceRoutine = await response.json();
      setDanceRoutine(parsedRoutine);
      setActiveStepIndex(0);
      setIsEditMode(false);
      setYtInput("");
      setYtMetadata(null);
    } catch (err: any) {
      console.error(err);
      setGenerationError(err.message || "Choreography engine failed. Falling back to default routine.");
      // Fallback
      setDanceRoutine(PREBUILT_ROUTINES[0]);
    } finally {
      setIsGenerating(false);
    }
  };

  // Helper to parse how many beats a step covers
  const getStepBeatsCount = (beatsStr: string): number => {
    if (!beatsStr) return 2; // Default fallback to 2 beats
    const clean = beatsStr.toLowerCase().trim();
    
    // Try to find ranges like "1-2" or "3-4" or "beats 1-2" or "counts 5-6"
    const rangeMatch = clean.match(/(\d+)\s*[-–to\/]\s*(\d+)/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      if (!isNaN(start) && !isNaN(end) && end >= start) {
        return (end - start) + 1;
      }
    }
    
    // Try to find direct counts (e.g. "beat 2", "beat 1", "count 4", etc.)
    const singleMatch = clean.match(/beat\s*(\d+)/) || clean.match(/count\s*(\d+)/) || clean.match(/^(\d+)$/);
    if (singleMatch) {
      return 1;
    }
    
    // Default to 2 because most music video steps are formatted as "Beats 1-2" or similar pairs.
    return 2;
  };

  // Playback Loop Implementation with dynamic BPM & timing intervals!
  useEffect(() => {
    if (isPlaying) {
      const bpm = danceRoutine.tempoBpm || 100; // default to 100 if no bpm
      const currentStep = danceRoutine.steps[activeStepIndex];
      const stepBeats = currentStep ? getStepBeatsCount(currentStep.beats) : 2;
      
      // Calculate delay based on BPM and step beats
      const beatDelayMs = 60000 / bpm;
      let nextStepDelay = beatDelayMs * stepBeats;
      
      // Adjust for playback speed speed modes (slow: 1.5x, fast: 0.5x, normal: 1.0x)
      const speedMultiplier = playSpeedMs === 1800 ? 1.5 : playSpeedMs === 600 ? 0.5 : 1.0;
      nextStepDelay = nextStepDelay * speedMultiplier;

      timerRef.current = setTimeout(() => {
        setActiveStepIndex((prev) => {
          const totalSteps = danceRoutine.steps.length;
          return totalSteps > 0 ? (prev + 1) % totalSteps : 0;
        });
      }, nextStepDelay);
    } else {
      if (timerRef.current) {
        clearTimeout(timerRef.current as any);
      }
    }
    
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current as any);
      }
    };
  }, [isPlaying, activeStepIndex, playSpeedMs, danceRoutine]);

  // Adjust Joint Coordinates locally in Step Sandbox
  const handleJointTweak = (jointKey: keyof DanceStep, axis: "x" | "y", amount: number) => {
    if (!danceRoutine.steps[activeStepIndex]) return;
    
    setDanceRoutine(prev => {
      const updatedSteps = [...prev.steps];
      const targetStep = { ...updatedSteps[activeStepIndex] };
      
      // Select the joint structure
      const currentVal = targetStep[jointKey] as { x: number; y: number } | undefined;
      if (currentVal) {
        const updatedVal = {
          ...currentVal,
          [axis]: Math.min(115, Math.max(5, currentVal[axis] + amount))
        };
        // Re-inject updated coordinate
        (targetStep as any)[jointKey] = updatedVal;
        updatedSteps[activeStepIndex] = targetStep;
      }
      
      return {
        ...prev,
        steps: updatedSteps
      };
    });
  };

  const currentStep: DanceStep | undefined = danceRoutine.steps[activeStepIndex];

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* Visual background ambient stage lights */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-12 right-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Primary Header */}
      <header className="border-b border-slate-800 bg-[#090d1a]/80 backdrop-blur-md sticky top-0 z-10 px-4 py-3 sm:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Music className="w-5 h-5 text-white animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-indigo-400 via-cyan-400 to-indigo-300 bg-clip-text text-transparent">
              YouTube Dance Moves Generator
            </h1>
            <p className="text-xs text-slate-400 font-mono">
              Leveraging Gemini Smart Choreography
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3">
          {/* Firebase Authentication & Live Sync Pillar */}
          {isAuthLoading ? (
            <div className="text-xs text-slate-500 font-mono border border-slate-800/60 px-3 py-1.5 rounded-full bg-slate-900/40">
              Connecting Cloud...
            </div>
          ) : currentUser ? (
            <div className="flex items-center gap-2.5 bg-slate-900/80 border border-slate-800/80 pl-2 pr-3 py-1 rounded-full text-xs font-mono shadow-inner shadow-black/50">
              {currentUser.photoURL ? (
                <img
                  src={currentUser.photoURL}
                  referrerPolicy="no-referrer"
                  alt={currentUser.displayName || "Dancer"}
                  className="w-5.5 h-5.5 rounded-full border border-indigo-500/50"
                />
              ) : (
                <div className="w-5.5 h-5.5 rounded-full bg-indigo-600 flex items-center justify-center text-[9px] font-bold text-white border border-indigo-500">
                  {currentUser.displayName ? currentUser.displayName[0].toUpperCase() : "D"}
                </div>
              )}
              <div className="flex flex-col text-left">
                <span className="text-slate-200 text-[10.5px] font-semibold max-w-[100px] truncate leading-tight">
                  {currentUser.displayName || "Dancer"}
                </span>
                <span className="text-emerald-400 text-[9px] flex items-center gap-0.5 leading-none mt-0.5 font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" /> Live Synced
                </span>
              </div>
              <button
                type="button"
                onClick={handleSignOut}
                className="ml-1.5 text-slate-500 hover:text-slate-300 text-[9px] hover:underline cursor-pointer uppercase font-bold"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleSignIn}
              className="px-3.5 py-1.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-550 hover:to-violet-550 text-white rounded-full text-xs font-bold font-mono transition-all flex items-center gap-1.5 shadow-md shadow-indigo-600/10 hover:shadow-indigo-600/25 active:scale-95 cursor-pointer border border-indigo-500/40 hover:border-indigo-400/50"
            >
              🚀 Sync with Google Account
            </button>
          )}

          <div className="text-xs bg-indigo-500/10 border border-indigo-500/25 px-3 py-1.5 rounded-lg text-indigo-300 font-mono flex items-center gap-1.5 shrink-0">
            <span className="w-2 h-2 rounded-full bg-[#10b981] animate-ping inline-block" />
            <span>Standalone Stage Active</span>
          </div>
        </div>
      </header>

      {/* Main Container Layout */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto w-full">
        
        {/* WIZARD PIPELINE STEP INDICATOR BOARD */}
        <div className="lg:col-span-12 bg-[#0b1329]/80 backdrop-blur-md border border-slate-800 rounded-2xl p-4 flex flex-col md:flex-row items-center justify-between gap-4 shadow-lg shadow-black/40">
          <div className="flex items-center gap-3">
            <Sparkles className="w-5 h-5 text-indigo-400 animate-pulse" />
            <div>
              <h2 className="text-sm font-bold font-mono uppercase tracking-wider text-slate-200">
                AI Choreography Generation Pipeline
              </h2>
              <p className="text-[10px] text-slate-400">Step-by-step custom sequence designer</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2 max-w-full overflow-x-auto pb-1 md:pb-0 scrollbar-none">
            {[1, 2, 3, 4, 5, 6].map((st) => {
              const isActive = wizardStep === st;
              const isPast = wizardStep > st;
              return (
                <button
                  key={st}
                  onClick={() => setWizardStep(st)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-mono font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                    isActive 
                      ? "bg-indigo-600 border-indigo-400 text-white shadow-md" 
                      : isPast 
                      ? "bg-emerald-950 border-emerald-800 text-emerald-400" 
                      : "bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300"
                  }`}
                >
                  <span className={`w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center ${isActive ? 'bg-white text-indigo-605 text-indigo-600' : isPast ? 'bg-emerald-400 text-slate-950' : 'bg-slate-800 text-slate-400'}`}>
                    {st}
                  </span>
                  <span>
                    {st === 1 && "Vibe/Song"}
                    {st === 2 && "Cutter Clip"}
                    {st === 3 && "Pose Skeleton"}
                    {st === 4 && "Consistency Pose"}
                    {st === 5 && "Beat Video"}
                    {st === 6 && "Live Arena"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        
        {/* LEFT COLUMN: Controls Panel depending on active wizard step (lg:span-4) */}
        <div className="lg:col-span-4 flex flex-col gap-5">
          {wizardStep === 1 && (
            <>
              {/* Catalog Lists Window */}
              <div className="flex-1 overflow-y-auto max-h-[580px] bg-slate-950/40 rounded-xl border border-slate-800 p-4 space-y-4 custom-scrollbar">
                {/* Catalog tab switchers */}
                <div className="flex bg-[#020617] p-1 rounded-lg border border-slate-800/80 mb-2 text-xs font-mono">
                  <button
                    type="button"
                    onClick={() => setCatalogTab("featured")}
                    className={`flex-1 py-1.5 rounded transition-all font-semibold cursor-pointer text-center ${
                      catalogTab === "featured"
                        ? "bg-indigo-600 text-white shadow"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Featured Tracks
                  </button>
                  <button
                    type="button"
                    onClick={() => setCatalogTab("saved")}
                    className={`flex-1 py-1.5 rounded transition-all font-semibold cursor-pointer text-center flex items-center justify-center gap-1 bg-transparent ${
                      catalogTab === "saved"
                        ? "bg-indigo-600 text-white shadow"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <Server className="w-3.5 h-3.5" />
                    <span>{currentUser ? "Cloud Library" : "Studio Cache"} ({savedSessions.length})</span>
                  </button>
                </div>

                {catalogTab === "featured" ? (
                  <div className="space-y-3">
                    <div className="text-xs font-semibold text-slate-400 tracking-wider uppercase flex items-center gap-1.5 font-mono">
                      <Flame className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Featured Choreography Tracks</span>
                    </div>
                    
                    <div className="grid grid-cols-1 gap-3">
                      {FALLBACK_YOUTUBE_VIDEOS.map((video, idx) => (
                        <div
                          key={video.id}
                          onClick={() => {
                            setSelectedVideo(video);
                            const matchingRoutine = PREBUILT_ROUTINES[idx] || PREBUILT_ROUTINES[0];
                            setDanceRoutine(matchingRoutine);
                            setActiveStepIndex(0);
                            setIsEditMode(false);
                          }}
                          className={`group p-2.5 rounded-xl border flex gap-3 text-left transition-all cursor-pointer ${
                            selectedVideo?.id === video.id
                              ? "bg-indigo-500/10 border-indigo-500/20 shadow-md shadow-indigo-100/5"
                              : "bg-slate-900/40 border-slate-800 hover:bg-slate-900/70 hover:border-slate-705 h-16 hover:border-slate-700"
                          }`}
                        >
                          <div className="w-24 h-16 rounded-lg bg-[#020617] overflow-hidden relative flex-shrink-0 border border-slate-800">
                            <img
                              referrerPolicy="no-referrer"
                              src={video.thumbnailUrl}
                              alt={video.title}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                            <div className="absolute right-1 bottom-1 bg-black/80 px-1 py-0.5 rounded text-[9px] font-mono text-cyan-400">
                              CLASSIC
                            </div>
                          </div>
                          <div className="flex flex-col justify-between overflow-hidden">
                            <h3 className="text-xs font-semibold text-slate-200 truncate group-hover:text-white">
                              {video.title}
                            </h3>
                            <p className="text-[10.5px] text-slate-400 truncate">
                              {video.channelTitle}
                            </p>
                            <div className="flex items-center gap-1 mt-1 text-[10px]">
                              <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                              <span className="text-indigo-400 font-medium font-mono">Choreography Ready</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="text-xs font-semibold text-slate-400 tracking-wider uppercase flex items-center gap-1.5 font-mono">
                      <Server className="w-3.5 h-3.5 text-indigo-400" />
                      <span>{currentUser ? "Personal Cloud Library" : "Your Saved Sessions"}</span>
                    </div>

                    {isLoadingSaved ? (
                      <div className="text-center p-6 text-slate-500 text-xs font-mono">Loading library...</div>
                    ) : savedSessions.length === 0 ? (
                      <div className="text-center p-4 border border-dashed border-slate-800 rounded-lg text-slate-500 text-xs leading-normal">
                        <p>No saved choreographies yet.</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-3">
                        {savedSessions.map((session) => (
                          <div
                            key={session.id}
                            onClick={() => {
                              if (session.video) {
                                setSelectedVideo(session.video);
                              } else {
                                setSelectedVideo({
                                  id: session.id,
                                  title: session.routine.songTitle,
                                  description: session.routine.styleDescription || "",
                                  thumbnailUrl: "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?q=80&w=300&auto=format&fit=crop",
                                  channelTitle: session.routine.artist || "Independent Artist",
                                  publishedAt: new Date().toISOString()
                                });
                              }
                              setDanceRoutine(session.routine);
                              setActiveStepIndex(0);
                              setIsEditMode(false);
                            }}
                            className={`group p-2.5 rounded-xl border flex gap-3 text-left transition-all cursor-pointer relative ${
                              selectedVideo?.id === (session.video?.id || session.id)
                                ? "bg-indigo-500/10 border-indigo-505 border-indigo-500 shadow-md shadow-indigo-100/5"
                                : "bg-slate-900/40 border-slate-800 hover:bg-slate-900/70 hover:border-slate-700"
                            }`}
                          >
                            <div className="w-20 h-14 rounded-lg bg-[#020617] overflow-hidden relative flex-shrink-0 border border-slate-800">
                              <img
                                referrerPolicy="no-referrer"
                                src={session.video?.thumbnailUrl || "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?q=80&w=300&auto=format&fit=crop"}
                                alt={session.routine.songTitle}
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <div className="flex flex-col justify-between overflow-hidden flex-1 select-none pr-6">
                              <h3 className="text-xs font-semibold text-slate-200 truncate group-hover:text-white">
                                {session.routine.songTitle}
                              </h3>
                              <p className="text-[10.5px] text-slate-400 truncate">
                                {session.routine.artist}
                              </p>
                              <div className="text-[9px] font-mono text-cyan-400 flex items-center gap-1.5 mt-0.5">
                                <span>{session.routine.steps.length} keyframes</span>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={(e) => handleDeleteSavedSession(e, session.id)}
                              className="absolute right-2.5 top-2.5 p-1 rounded hover:bg-rose-500/10 text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Prompt Suggestion Card */}
              <div className="bg-[#0b1329]/50 border border-slate-850 p-4 rounded-xl shadow-lg">
                <h4 className="text-xs font-semibold text-slate-200 mb-2.5 flex items-center gap-2 font-mono border-b border-slate-800 pb-2">
                  <Sparkles className="w-4 h-4 text-indigo-400 animate-pulse" />
                  <span>Analyze YouTube Clip Template</span>
                </h4>
                
                <form onSubmit={handleGenerateYouTubeDance} className="space-y-3.5">
                  <div>
                    <label className="block text-[10px] text-slate-400 font-mono uppercase mb-1">
                      YouTube Link or Video ID
                    </label>
                    <input
                      type="text"
                      placeholder="Paste link e.g. https://youtu.be/..."
                      required
                      value={ytInput}
                      onChange={(e) => setYtInput(e.target.value)}
                      className="w-full bg-[#020617] border border-slate-800 rounded-lg py-1.5 px-2.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-sans transition-all"
                    />
                    {ytMetaError && (
                      <p className="text-[10px] text-red-400 mt-1 font-mono">{ytMetaError}</p>
                    )}
                  </div>

                  {isFetchingYtMeta && (
                    <div className="bg-[#020617]/50 border border-slate-800/60 p-2.5 rounded-lg flex items-center gap-2.5 text-xs text-slate-400 font-mono">
                      <div className="w-3.5 h-3.5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                      <span>Resolving video parameters...</span>
                    </div>
                  )}

                  {ytMetadata && !isFetchingYtMeta && (
                    <div className="bg-[#020617] border border-slate-800 p-2.5 rounded-lg flex gap-3 items-center">
                      <div className="w-16 h-12 rounded bg-slate-950 overflow-hidden relative flex-shrink-0 border border-slate-800">
                        <img
                          referrerPolicy="no-referrer"
                          src={ytMetadata.thumbnailUrl}
                          alt={ytMetadata.title}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="overflow-hidden flex-1">
                        <span className="text-[9px] font-mono text-cyan-400 block uppercase tracking-wider">FOUND VIDEO</span>
                        <h5 className="text-xs font-semibold text-slate-200 truncate">{ytMetadata.title}</h5>
                      </div>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isGenerating || !getYouTubeId(ytInput)}
                    className="w-full py-2 bg-gradient-to-tr from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-2 cursor-pointer transition-all shadow-md"
                  >
                    {isGenerating ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Gemini Extracting...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5 text-indigo-200" />
                        <span>Load Choreographer</span>
                      </>
                    )}
                  </button>
                  <p className="text-[10px] text-slate-500 leading-normal text-center italic mt-1 bg-slate-900/40 p-1 rounded font-mono">
                    Type a link or pick a classic track from above to begin.
                  </p>
                </form>
              </div>
            </>
          )}

          {wizardStep === 2 && (
            <div className="flex-1 bg-slate-950/40 border border-slate-800 rounded-xl p-5 space-y-4 text-left">
              <span className="text-[10px] font-mono text-indigo-400 font-bold uppercase tracking-wider block">Step 2: Choose Song Window</span>
              <h3 className="text-sm font-bold text-slate-200">Isolate Segment Cutter</h3>
              <p className="text-xs text-slate-500 leading-normal">
                Select the preloaded 10-second choreography window from your track template below to focus the template keyframes.
              </p>
              
              <div className="space-y-3 pt-2">
                {videoClips.map((clip) => {
                  const isSelected = activeClipId === clip.id;
                  return (
                    <div 
                      key={clip.id}
                      onClick={() => setActiveClipId(clip.id)}
                      className={`p-3 rounded-xl border cursor-pointer transition-all ${
                        isSelected 
                          ? "bg-indigo-600/15 border-indigo-500 text-white" 
                          : "bg-slate-900/40 border-slate-800 hover:bg-slate-900/60"
                      }`}
                    >
                      <div className="flex justify-between items-center text-[10.5px] font-mono">
                        <span className="font-bold text-indigo-300">{clip.id.toUpperCase()}</span>
                        <span className="text-slate-500">{clip.startSec}s - {clip.endSec}s</span>
                      </div>
                      <h4 className="text-xs font-semibold text-slate-200 mt-1">{clip.label}</h4>
                    </div>
                  );
                })}
              </div>

              <div className="pt-2">
                <button
                  onClick={() => setWizardStep(3)}
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-mono text-xs font-bold rounded-lg flex items-center justify-center gap-1 cursor-pointer shadow"
                >
                  <span>Build Skeletal Waypoints &rarr;</span>
                </button>
              </div>
            </div>
          )}

          {wizardStep === 3 && (
            <div className="flex-1 bg-slate-950/40 border border-slate-800 rounded-xl p-5 space-y-4 text-left">
              <span className="text-[10px] font-mono text-indigo-400 font-bold uppercase tracking-wider block">Step 3: Skeleton Control Node</span>
              <h3 className="text-sm font-bold text-slate-200">Choreography Positions</h3>
              <p className="text-xs text-slate-500 leading-normal font-sans">
                Click any keyframe node below to isolate and view its active joint coordinates on the simulator stage.
              </p>
              
              <div className="space-y-2 mt-3 overflow-y-auto max-h-[280px] custom-scrollbar">
                {danceRoutine.steps.map((st, idx) => (
                  <div
                    key={idx}
                    onClick={() => setActiveStepIndex(idx)}
                    className={`p-2.5 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                      idx === activeStepIndex ? "bg-indigo-500/10 border-indigo-500/30 text-white shadow" : "bg-slate-950/20 border-slate-900 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center ${idx === activeStepIndex ? 'bg-indigo-600 text-white' : 'bg-slate-900 text-slate-500'}`}>{idx + 1}</span>
                      <span className="text-xs font-bold block">{st.name}</span>
                    </div>
                    <span className="text-[10px] font-mono">Beats: {st.beats}</span>
                  </div>
                ))}
              </div>

              <div className="pt-2">
                <button
                  onClick={() => setWizardStep(4)}
                  className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-mono text-xs font-bold rounded-lg flex items-center justify-center gap-1 cursor-pointer"
                >
                  <span>Snap Posing Space (Step 4) &rarr;</span>
                </button>
              </div>
            </div>
          )}

          {wizardStep === 4 && (
            <div className="flex-1 bg-slate-950/40 border border-slate-800 rounded-xl p-5 space-y-4 text-left">
              <span className="text-[10px] font-mono text-indigo-400 font-bold uppercase tracking-wider block">Step 4: Camera Source Capture</span>
              <h3 className="text-sm font-bold text-slate-200">Source Photo Snapper</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Take a rapid selfie snap using your web camera, or load our gorgeous independent dancer profile preloaded character frame.
              </p>

              <div className="flex gap-2">
                <button
                  onClick={startWebcam}
                  className="flex-1 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-mono text-[10.5px] font-bold rounded-lg cursor-pointer"
                >
                  📷 Start Camera
                </button>
                <button
                  onClick={() => setCameraPhotoBuffer("https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=300&auto=format&fit=crop")}
                  className="flex-1 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 font-mono text-[10.5px] rounded-lg cursor-pointer"
                >
                  Avatar Template
                </button>
              </div>

              {cameraPhotoBuffer && (
                <div className="bg-[#020512] p-2.5 rounded-xl border border-slate-850 text-center relative max-w-[150px] mx-auto overflow-hidden">
                  <img src={cameraPhotoBuffer} alt="Initial selfie snap" className="w-full h-24 object-contain" referrerPolicy="no-referrer" />
                  <span className="text-[8px] font-mono bg-indigo-950 px-1 py-0.5 rounded text-indigo-300 mt-1 block">STARTING REFERENCE</span>
                </div>
              )}
            </div>
          )}

          {wizardStep === 5 && (
            <div className="flex-1 bg-slate-950/40 border border-slate-800 rounded-xl p-5 space-y-4 text-left">
              <span className="text-[10px] font-mono text-indigo-400 font-bold uppercase tracking-wider block">Step 5: Tempos Sync Details</span>
              <h3 className="text-sm font-bold text-slate-200 font-mono">Rhythmic Speeds</h3>
              <p className="text-xs text-slate-500 leading-normal">
                Verify speed duration calculations calculated exactly base on tempo rhythms.
              </p>
              
              <div className="bg-[#020617] p-3 rounded-lg border border-slate-900 font-mono text-[10px] space-y-2 text-indigo-305">
                <div className="flex justify-between">
                  <span>Standard Tempo:</span>
                  <span>{danceRoutine.tempoBpm} BPM</span>
                </div>
                <div className="flex justify-between">
                  <span>Computed Interval delay:</span>
                  <span>{(60 / (danceRoutine.tempoBpm || 100)).toFixed(2)} seconds</span>
                </div>
              </div>
              
              <button
                onClick={() => setWizardStep(6)}
                className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs font-bold rounded-lg flex items-center justify-center gap-1"
              >
                <span>Live Concert Arena &rarr;</span>
              </button>
            </div>
          )}

          {wizardStep === 6 && (
            <div className="flex-1 bg-slate-950/40 border border-slate-800 rounded-xl p-5 space-y-4 text-left">
              <span className="text-[10px] font-mono text-emerald-400 font-bold uppercase tracking-wider block">Step 6: Live Arena Concert</span>
              <h3 className="text-sm font-bold text-slate-200">Sequencer Dashboard</h3>
              <p className="text-xs text-slate-500 leading-normal">
                Playing custom high-fidelity synthesizers live alongside generated pose loops in complete synchronization.
              </p>

              <div className="space-y-2 pt-2">
                <button
                  onClick={() => setIsPlaying(!isPlaying)}
                  className={`w-full py-2 rounded-lg text-xs font-bold font-mono text-white ${isPlaying ? 'bg-rose-600 hover:bg-rose-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}
                >
                  {isPlaying ? "⏸ Pause Audio Loops" : "▶ Start Rhythmic Synth Beat"}
                </button>
                <button
                  onClick={() => {
                    setWizardStep(1);
                    setCameraPhotoBuffer(null);
                    setCompiledPhotoResult(null);
                  }}
                  className="w-full py-2 border border-slate-800 hover:bg-slate-900 text-slate-300 font-mono text-[10.5px] rounded-lg"
                >
                  Reset Generation flow
                </button>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: Studio Panel — Animated stick & Choreography sequence playback (lg:span-8) */}
        <div className="lg:col-span-8 flex flex-col gap-6">
                   {/* Active Song Billboard info card */}
          {selectedVideo && (
            <div className="bg-[#0b1329] border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row items-center gap-4 justify-between">
              <div className="flex items-center gap-3.5">
                <div className="w-16 h-12 bg-[#020617] rounded-lg overflow-hidden relative flex-shrink-0">
                  <img
                    referrerPolicy="no-referrer"
                    src={selectedVideo.thumbnailUrl}
                    alt={selectedVideo.title}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-indigo-600/10" />
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider font-mono text-indigo-400 font-semibold mb-0.5">
                    Currently Selected Song
                  </div>
                  <h2 className="text-base font-bold text-slate-100 line-clamp-1 pr-2">
                    {danceRoutine.songTitle}
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Artist: {danceRoutine.artist} &middot; <span className="font-mono text-[10.5px] bg-[#020617] border border-slate-800 px-1.5 rounded py-0.5 text-indigo-300 mr-1">{danceRoutine.difficulty}</span> &middot; <span className="font-mono text-[10.5px] bg-[#020617] border border-slate-800 px-1.5 rounded py-0.5 text-cyan-400 font-semibold">{danceRoutine.tempoBpm || "100"} BPM</span>
                  </p>
                </div>
              </div>

              {/* Action tags */}
              <div className="flex items-center gap-3 w-full md:w-auto mt-2 md:mt-0 pt-3 md:pt-0 border-t md:border-t-0 border-slate-800 justify-end">
                <div className="text-right">
                  <span className="text-[10px] text-slate-500 block font-mono">STYLE / GENRE</span>
                  <span className="text-xs font-semibold text-slate-300">{danceRoutine.genre || "Pop / Street Dance"}</span>
                </div>
                <div className="w-px h-8 bg-slate-800" />
                <div className="text-left">
                  <span className="text-[10px] text-slate-500 block font-mono">DANCE LENGTH</span>
                  <span className="text-xs font-semibold text-indigo-400">{danceRoutine.steps.length} Keyframes</span>
                </div>
              </div>
            </div>
          )}

          {/* Core Visualizer Board */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            
            {/* STAGE & PLAYBACK CONTROLS (md:span-7) */}
            <div className="md:col-span-7 bg-slate-900/20 border border-slate-800 rounded-2xl p-5 flex flex-col items-center justify-between relative min-h-[465px]">
              
              {/* Playback speed indicator badge */}
              <div className="absolute top-4 left-4 flex gap-1 bg-slate-950/80 p-1.5 rounded-lg border border-slate-800 shadow-md z-20">
                <button
                  id="speed-05"
                  onClick={() => setPlaySpeedMs(1800)}
                  className={`px-2 py-0.5 text-[10px] font-mono rounded transition-colors cursor-pointer ${
                    playSpeedMs === 1800 ? "bg-indigo-500/20 text-indigo-400" : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  0.5x
                </button>
                <button
                  id="speed-10"
                  onClick={() => setPlaySpeedMs(1200)}
                  className={`px-2 py-0.5 text-[10px] font-mono rounded transition-colors cursor-pointer ${
                    playSpeedMs === 1200 ? "bg-indigo-500/20 text-indigo-400" : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  1.0x
                </button>
                <button
                  id="speed-20"
                  onClick={() => setPlaySpeedMs(600)}
                  className={`px-2 py-0.5 text-[10px] font-mono rounded transition-colors cursor-pointer ${
                    playSpeedMs === 600 ? "bg-indigo-500/20 text-indigo-400" : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  2.0x
                </button>
              </div>

              {/* Status Header */}
              <div className="text-center mt-3 z-10 select-none">
                <div className="text-[10px] text-slate-400 font-mono tracking-widest uppercase mb-1 flex items-center justify-center gap-1.5">
                  <Tv className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Theatrical Stage</span>
                </div>
                <h3 className="text-sm font-semibold text-indigo-400">
                  {currentStep ? currentStep.name : "Ready"}
                </h3>
              </div>

              {/* Stick Figure Visual Display with loading screen overlay */}
              <div className={`my-6 relative flex items-center justify-center w-full min-h-[300px] transition-all duration-150 rounded-xl overflow-hidden border shadow-inner ${
                isPlaying 
                  ? "bg-slate-950/20 border-indigo-555 border-indigo-500/30" 
                  : "bg-slate-950/40 border-slate-800/60"
              }`}>
                <AnimatePresence mode="wait">
                  {isGenerating ? (
                    <motion.div 
                      key="loading-stage"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-950/95 rounded-xl"
                    >
                      <div className="relative mb-4">
                        <div className="w-16 h-16 border-4 border-slate-800 rounded-full" />
                        <div className="w-16 h-16 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin absolute top-0 left-0" />
                      </div>
                      <p className="text-xs text-indigo-300 font-medium font-mono">Gemini is parsing choreography loops...</p>
                      <p className="text-[11px] text-slate-500 mt-1">Generating custom anatomically aligned poses</p>
                    </motion.div>
                  ) : showCompiledCinemaOverlay && compiledPhotoResult?.videoUrl ? (
                    <motion.div
                      key="compiled-cinema-player"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 z-25 flex flex-col bg-slate-950 justify-center items-center"
                    >
                      <div className="relative w-full h-full flex items-center justify-center">
                        <video
                          src={compiledPhotoResult.videoUrl}
                          autoPlay
                          loop
                          controls
                          playsInline
                          className="w-full h-full object-contain pointer-events-auto"
                        />
                        <button
                          type="button"
                          onClick={() => setShowCompiledCinemaOverlay(false)}
                          className="absolute top-3 right-3 z-30 px-2.5 py-1 bg-slate-900/95 hover:bg-slate-800 border border-slate-700/60 text-[10px] font-mono text-indigo-400 font-semibold rounded cursor-pointer transition-colors shadow-lg pointer-events-auto"
                        >
                          🪆 Back to Stick Dancer
                        </button>
                      </div>
                    </motion.div>
                  ) : currentStep ? (
                    <motion.div
                      key={`step-${currentStep.stepNumber}`}
                      initial={{ scale: 0.95, opacity: 0.9 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ duration: 0.3 }}
                      className="flex items-center justify-center z-10 bg-transparent pointer-events-none"
                    >
                      <StickFigure 
                        step={currentStep} 
                        width={250} 
                        height={290} 
                        highlightJoints={true} 
                      />
                    </motion.div>
                  ) : (
                    <div className="text-slate-600 text-xs z-10 font-mono">No active step selected.</div>
                  )}
                </AnimatePresence>
              </div>

              {/* Action Buttons & Play controls */}
              <div className="flex flex-col items-center gap-4 w-full px-6">
                
                {/* Micro Step Slider/Progress */}
                <div className="w-full flex items-center justify-between gap-4">
                  <span className="text-[10px] text-slate-500 font-mono">
                    Step {activeStepIndex + 1}/{danceRoutine.steps.length}
                  </span>
                  
                  <div className="flex-1 flex gap-1.5 h-1">
                    {danceRoutine.steps.map((_, idx) => (
                      <div
                        id={`step_bar_${idx}`}
                        key={idx}
                        onClick={() => {
                          setActiveStepIndex(idx);
                          setIsPlaying(false);
                        }}
                        className={`flex-1 h-1.5 rounded-full cursor-pointer transition-all ${
                          idx === activeStepIndex
                            ? "bg-indigo-500 shadow-sm shadow-indigo-500/40"
                            : "bg-slate-800 hover:bg-slate-700"
                        }`}
                      />
                    ))}
                  </div>

                  <span className="text-[10px] text-indigo-400 font-mono font-medium">
                    {currentStep?.beats || "00:00"}
                  </span>
                </div>

                {/* Primary Player Buttons Console */}
                <div className="flex items-center gap-4 py-2">
                  <button
                    id="play-prev"
                    onClick={() => {
                      const total = danceRoutine.steps.length;
                      setActiveStepIndex((prev) => (total > 0 ? (prev - 1 + total) % total : 0));
                    }}
                    className="p-2.5 rounded-full bg-slate-900 border border-slate-800 hover:bg-slate-800 hover:border-slate-700 text-slate-300 transition-all cursor-pointer"
                  >
                    <SkipBack className="w-4 h-4" />
                  </button>

                  <button
                    id="play-toggle"
                    onClick={() => setIsPlaying(!isPlaying)}
                    className="p-4 rounded-full bg-gradient-to-tr from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white shadow-lg shadow-indigo-500/20 active:scale-95 transition-all cursor-pointer"
                  >
                    {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-0.5" />}
                  </button>

                  <button
                    id="play-next"
                    onClick={() => {
                      const total = danceRoutine.steps.length;
                      setActiveStepIndex((prev) => (total > 0 ? (prev + 1) % total : 0));
                    }}
                    className="p-2.5 rounded-full bg-slate-900 border border-slate-800 hover:bg-slate-800 hover:border-slate-700 text-slate-300 transition-all cursor-pointer"
                  >
                    <SkipForward className="w-4 h-4" />
                  </button>

                  <button
                    id="play-reset"
                    onClick={() => {
                      setIsPlaying(false);
                      setActiveStepIndex(0);
                    }}
                    title="Restart Sequence"
                    className="p-2 bg-slate-950 hover:bg-slate-900 text-slate-500 hover:text-indigo-400 border border-slate-900 hover:border-slate-800 rounded-lg transition-all cursor-pointer"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </div>

              </div>

              {/* Real-time Webcam Motion Capture & AI Choreography compiler dashboard */}
              <div className="w-full mt-2 p-4 bg-slate-950/80 rounded-2xl border border-slate-800/80 shadow-md text-left transition-all">
                <div className="flex items-center justify-between mb-3 border-b border-slate-800/60 pb-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${isCompilingAIPoses ? "bg-rose-500 animate-pulse" : isCameraActive ? "bg-emerald-500 animate-ping" : "bg-indigo-500"}`} />
                    <span className="text-[10.5px] font-mono tracking-wider text-slate-300 font-bold uppercase">
                      📸 WEBCAM AI MOTION CAPTURE & CHOREOGRAPHER
                    </span>
                  </div>
                  {compiledPhotoResult && (
                    <span className="text-[9px] font-mono bg-emerald-950 border border-emerald-800/40 px-2 py-0.5 rounded text-emerald-300">
                      ⚡ COMPILATION READY
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-stretch">
                  {/* Camera Viewer / Snapshot Panel */}
                  <div className="md:col-span-5 flex flex-col justify-center bg-[#020617]/40 rounded-xl border border-slate-900 overflow-hidden relative min-h-[160px]">
                    {isCameraActive ? (
                      <div className="relative w-full h-[160px] bg-black">
                        <video
                          ref={webcamVideoRef}
                          autoPlay
                          playsInline
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-2 px-4 shadow-xl">
                          <button
                            type="button"
                            onClick={captureWebcamSnapshot}
                            className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 border border-indigo-400/20 text-white rounded text-xs font-mono font-bold cursor-pointer transition-colors shadow-lg shadow-indigo-550/30"
                          >
                            📸 Snap Photo
                          </button>
                          <button
                            type="button"
                            onClick={stopWebcam}
                            className="px-3 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700/30 text-slate-300 rounded text-xs font-mono cursor-pointer transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : cameraPhotoBuffer ? (
                      <div className="relative w-full h-[160px] bg-slate-950">
                        <img
                          src={cameraPhotoBuffer}
                          alt="Captured snap"
                          className="w-full h-full object-contain"
                        />
                        <div className="absolute top-2 right-2 bg-indigo-950/90 border border-indigo-800/40 text-[9px] font-mono text-indigo-300 px-1.5 py-0.5 rounded">
                          SNAP #{photoCount}
                        </div>
                        <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-2 px-2">
                          <button
                            type="button"
                            onClick={startWebcam}
                            className="px-2.5 py-1 bg-slate-900/90 hover:bg-slate-800 border border-slate-700 text-slate-300 rounded text-[10px] font-mono cursor-pointer transition-colors"
                          >
                            🔄 Retake
                          </button>
                          <button
                            type="button"
                            onClick={compileChoreographyWithPhoto}
                            disabled={isCompilingAIPoses}
                            className="px-3 py-1 bg-gradient-to-tr from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white text-[11px] font-bold font-mono rounded cursor-pointer disabled:opacity-55 active:scale-95 transition-all shadow-md shadow-indigo-600/30 flex items-center gap-1.5"
                          >
                            <span>⚡ Generate AI Video</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 text-center flex flex-col items-center justify-center h-full min-h-[160px]">
                        <p className="text-[10px] text-slate-400 leading-normal max-w-sm">
                          To simulate yourself in every dance position and compile transitions with FFmpeg, snap a photo below.
                        </p>
                        <button
                          type="button"
                          onClick={startWebcam}
                          className="mt-3 flex items-center gap-2 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-505 hover:bg-indigo-500 text-white rounded-lg text-xs font-mono font-bold transition-all cursor-pointer shadow-sm shadow-indigo-500/10 active:scale-95 text-center"
                        >
                          📷 Engage Web Camera
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Processing Progress Indicator & Poses Side-Gallery */}
                  <div className="md:col-span-7 flex flex-col justify-between bg-slate-950/20 p-3 rounded-xl border border-slate-900 min-h-[160px]">
                    {isCompilingAIPoses ? (
                      <div className="flex flex-col items-center justify-center h-full py-4 text-center">
                        <div className="relative mb-3.5">
                          <div className="w-10 h-10 border-2 border-slate-900 rounded-full" />
                          <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin absolute top-0 left-0" />
                        </div>
                        <span className="text-[10.5px] font-mono text-indigo-300 font-semibold animate-pulse">
                          {compilationProgressMessage}
                        </span>
                        <p className="text-[9px] text-slate-500 mt-1">
                          Generating sequential transitions matching each step's exact BPM length.
                        </p>
                      </div>
                    ) : compiledPhotoResult ? (
                      <div className="flex flex-col h-full justify-between gap-3">
                        <div className="space-y-1">
                          <span className="text-[9.5px] font-mono text-slate-400 font-bold uppercase tracking-wider block">
                            🤖 Generated Step Projections Flow
                          </span>
                          <div className="flex gap-2 overflow-x-auto pb-1 max-w-[340px] pr-1 scrollbar-thin scrollbar-thumb-slate-800">
                            {compiledPhotoResult.stepSvgs.map((svgUrl, idx) => (
                              <div
                                key={idx}
                                onClick={() => {
                                  setActiveStepIndex(idx);
                                  setIsPlaying(false);
                                }}
                                className={`flex-shrink-0 w-14 h-16 border rounded bg-slate-950/90 overflow-hidden cursor-pointer transition-all ${
                                  idx === activeStepIndex
                                    ? "border-indigo-505 border-indigo-500 shadow-md shadow-indigo-500/20 scale-105"
                                    : "border-slate-800 hover:border-slate-700"
                                }`}
                              >
                                <img
                                  src={svgUrl}
                                  alt={`Pose Step ${idx + 1}`}
                                  className="w-full h-full object-contain pointer-events-none"
                                  referrerPolicy="no-referrer"
                                />
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="pt-2 border-t border-slate-900 flex flex-col sm:flex-row items-center justify-between gap-2">
                          <div className="text-left">
                            <p className="text-[10px] text-slate-300 leading-normal font-sans font-medium flex items-center gap-1">
                              <span>🎉 Video successfully compiled!</span>
                            </p>
                            <p className="text-[8.5px] text-slate-500 font-mono">
                              {compiledPhotoResult.compiled 
                                ? "FFmpeg stitched 1-to-next exact-beat segments." 
                                : "Fallback active: Playing fluid client-side step animations."}
                            </p>
                          </div>

                          {compiledPhotoResult.videoUrl && (
                            <button
                              type="button"
                              onClick={() => setShowCompiledCinemaOverlay(true)}
                              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-mono font-bold rounded cursor-pointer transition-colors shadow-md shadow-emerald-555/15 flex items-center gap-1 shrink-0"
                            >
                              🎬 Play Final Video
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center text-center h-full p-2">
                        <span className="text-[10px] font-mono text-slate-505 text-slate-500 block mb-1">
                          PROJECTIONS SCHEMATIC STANDBY
                        </span>
                        <p className="text-[9px] text-slate-600 leading-normal max-w-xs">
                          Snap photo to activate sequential stick figure motion projection, combining your picture with choreography skeleton keypoints.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

            </div>

            {/* CHOREOGRAPHY SEQUENCE PANEL & SANDBOX TWEAKER (md:span-5) */}
            <div className="md:col-span-5 flex flex-col gap-5">
              
              {/* Routine Description details */}
              <div className="bg-[#0b1329]/40 border border-slate-800 p-4 rounded-xl">
                <h3 className="text-xs font-semibold text-indigo-400 font-mono tracking-wider uppercase mb-1">
                  Style Description & Context
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed font-sans">
                  {danceRoutine.styleDescription || "No custom dynamic description available for this routine."}
                </p>
              </div>

              {/* Interactive step instruction panels */}
              <div className="bg-slate-900/20 border border-slate-800 rounded-xl p-4 flex-1 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
                    <span className="text-xs font-semibold text-slate-400 font-mono uppercase">
                      Instruction List
                    </span>
                    <button
                      id="edit-mode-toggle"
                      onClick={() => setIsEditMode(!isEditMode)}
                      className={`text-[10.5px] px-2 py-0.5 rounded flex items-center gap-1 cursor-pointer transition-colors ${
                        isEditMode 
                          ? "bg-indigo-500/10 text-indigo-300 border border-indigo-500/40" 
                          : "bg-slate-900 text-slate-400 hover:text-white border border-slate-800"
                      }`}
                    >
                      <Sliders className="w-3.5 h-3.5" />
                      <span>{isEditMode ? "Exit Editor" : "Tweak joints"}</span>
                    </button>
                  </div>

                  {/* Steps sequence scroll list */}
                  <div className="space-y-2 mb-4 overflow-y-auto max-h-[220px] custom-scrollbar">
                    {danceRoutine.steps.map((step, idx) => (
                      <div
                        id={`step_row_${step.stepNumber}`}
                        key={step.stepNumber}
                        onClick={() => {
                          setActiveStepIndex(idx);
                          setIsPlaying(false);
                        }}
                        className={`p-2.5 rounded-lg border text-left cursor-pointer transition-all flex items-center justify-between gap-3 ${
                          idx === activeStepIndex
                            ? "bg-indigo-500/10 border-indigo-500/20 text-slate-100"
                            : "bg-slate-900/40 border-slate-800 hover:bg-slate-900/60"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 overflow-hidden">
                          <span className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center ${
                            idx === activeStepIndex ? "bg-indigo-500 text-white" : "bg-slate-800 text-slate-400"
                          }`}>
                            {step.stepNumber}
                          </span>
                          <div className="overflow-hidden">
                            <h4 className="text-xs font-semibold truncate text-slate-200">
                              {step.name}
                            </h4>
                            <p className="text-[10px] text-slate-400 truncate">
                              {step.description}
                            </p>
                          </div>
                        </div>

                        {/* Chevron right symbol */}
                        <div className="flex-shrink-0 text-slate-600">
                          <ChevronRight className="w-3.5 h-3.5" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Extended info instruction detail */}
                {currentStep && (
                  <div className="bg-[#020617] p-3 rounded-lg border border-slate-800">
                    <div className="flex items-center justify-between mb-1.5 pb-1 border-b border-slate-805/60 border-slate-800">
                      <span className="text-[10px] text-indigo-400 font-mono uppercase bg-indigo-500/10 px-1.5 py-0.5 rounded font-semibold">
                        Step Details & Instruction
                      </span>
                      <span className="text-[10.5px] text-slate-500 font-mono">
                        Beats: {currentStep.beats}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 leading-normal font-sans">
                      {currentStep.description}
                    </p>
                    {currentStep.faceExpression && (
                      <div className="mt-2 text-[10px] text-slate-400 font-mono flex items-center gap-1 bg-[#0b1329] py-1 px-2 rounded-md border border-slate-800">
                        <span className="text-slate-500">Suggested expression:</span>
                        <span className="text-indigo-400 font-bold capitalize">{currentStep.faceExpression}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Dynamic Coordinate Sandbox Drag sliders (Shown when Tweak is Enabled) */}
              {isEditMode && currentStep && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-[#0b1329]/40 border border-slate-800 rounded-xl p-4 mt-2"
                >
                  <div className="text-xs font-semibold text-indigo-400 font-mono uppercase mb-2 flex items-center justify-between">
                    <span>Joint Coordinate Tweak Box</span>
                    <span className="text-[10px] text-slate-500 italic lowercase normal-case">Tweak keyframe pose coordinates</span>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[10.5px] font-mono text-slate-400 pb-2 border-b border-slate-950">
                    {/* Left hand tweak controllers */}
                    <div className="flex justify-between items-center bg-[#020617] p-2 rounded-lg border border-slate-800">
                      <span>Left Hand Left/Right:</span>
                      <div className="flex gap-1.5">
                        <button 
                          id="lh-left"
                          onClick={() => handleJointTweak("leftHand", "x", -5)} 
                          className="bg-slate-900 px-1.5 py-0.5 rounded border border-slate-805 hover:text-white"
                        >
                          -5
                        </button>
                        <button 
                          id="lh-right"
                          onClick={() => handleJointTweak("leftHand", "x", 5)} 
                          className="bg-slate-900 px-1.5 py-0.5 rounded border border-slate-805 hover:text-white"
                        >
                          +5
                        </button>
                      </div>
                    </div>

                    {/* Left hand height controllers */}
                    <div className="flex justify-between items-center bg-[#020617] p-2 rounded-lg border border-slate-800">
                      <span>Left Hand Height:</span>
                      <div className="flex gap-1.5">
                        <button 
                          id="lh-up"
                          onClick={() => handleJointTweak("leftHand", "y", -5)} 
                          className="bg-slate-900 px-1.5 py-0.5 rounded border border-slate-805 hover:text-white"
                        >
                          Up
                        </button>
                        <button 
                          id="lh-down"
                          onClick={() => handleJointTweak("leftHand", "y", 5)} 
                          className="bg-slate-900 px-1.5 py-0.5 rounded border border-slate-805 hover:text-white"
                        >
                          Down
                        </button>
                      </div>
                    </div>

                    {/* Right hand Horizontal */}
                    <div className="flex justify-between items-center bg-[#020617] p-2 rounded-lg border border-slate-800">
                      <span>Right Hand L/R:</span>
                      <div className="flex gap-1.5">
                        <button 
                          id="rh-left"
                          onClick={() => handleJointTweak("rightHand", "x", -5)} 
                          className="bg-slate-900 px-1.5 py-0.5 rounded border border-slate-805 hover:text-white"
                        >
                          -5
                        </button>
                        <button 
                          id="rh-right"
                          onClick={() => handleJointTweak("rightHand", "x", 5)} 
                          className="bg-slate-900 px-1.5 py-0.5 rounded border border-slate-805 hover:text-white"
                        >
                          +5
                        </button>
                      </div>
                    </div>

                    {/* Right hand height controllers */}
                    <div className="flex justify-between items-center bg-[#020617] p-2 rounded-lg border border-slate-800">
                      <span>Right Hand Height:</span>
                      <div className="flex gap-1.5">
                        <button 
                          id="rh-up"
                          onClick={() => handleJointTweak("rightHand", "y", -5)} 
                          className="bg-slate-900 px-1.5 py-0.5 rounded border border-slate-805 hover:text-white"
                        >
                          Up
                        </button>
                        <button 
                          id="rh-down"
                          onClick={() => handleJointTweak("rightHand", "y", 5)} 
                          className="bg-slate-900 px-1.5 py-0.5 rounded border border-slate-805 hover:text-white"
                        >
                          Down
                        </button>
                      </div>
                    </div>

                    {/* Left foot horizontally */}
                    <div className="flex justify-between items-center bg-[#020617] p-2 rounded-lg border border-slate-800 col-span-2 mt-1">
                      <span>Shift Total Body (Pelvis height):</span>
                      <div className="flex gap-1.5">
                        <button 
                          id="pelv-up"
                          onClick={() => {
                            handleJointTweak("pelvis", "y", -5);
                            handleJointTweak("neck", "y", -5);
                            handleJointTweak("head", "y", -5);
                          }} 
                          className="bg-slate-900 text-[10px] px-2.5 py-0.5 rounded border border-slate-805 hover:text-white"
                        >
                          Jump High (-Y)
                        </button>
                        <button 
                          id="pelv-down"
                          onClick={() => {
                            handleJointTweak("pelvis", "y", 5);
                            handleJointTweak("neck", "y", 5);
                            handleJointTweak("head", "y", 5);
                          }} 
                          className="bg-slate-900 text-[10px] px-2.5 py-0.5 rounded border border-slate-805 hover:text-white"
                        >
                          Crouch Down (+Y)
                        </button>
                      </div>
                    </div>

                  </div>
                  <div className="mt-2 text-[10.5px] text-slate-500 italic">
                    Note: Poses are stored locally in state. Tweak endpoints do not request server keys so you can perfect choreographies with lightning reaction speeds.
                  </div>
                </motion.div>
              )}

            </div>

          </div>

        </div>

      </main>

      {/* Primary Footer */}
      <footer className="mt-auto border-t border-slate-850 bg-slate-950 p-4 text-center text-slate-500 text-xs">
        <p>YouTube Dance Moves Generator &middot; Fully Custom Interactive Choreography Dashboard</p>
      </footer>
    </div>
  );
}
