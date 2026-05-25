import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import fs from "fs";
import { exec } from "child_process";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Enable JSON parsing
app.use(express.json());

// Serve the generated output directory statically
app.use('/output', express.static(path.join(process.cwd(), 'output')));

// Initialize Gemini SDK with telemetry header
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// JSON Database persistent file path
const CACHE_DB_PATH = path.join(process.cwd(), "cached_routines.json");

interface CachedRoutineEntry {
  id: string;
  video?: {
    id: string;
    title: string;
    description: string;
    thumbnailUrl: string;
    channelTitle: string;
    publishedAt: string;
  };
  routine: any;
  savedAt: string;
}

// Helper to load current database
function readCachedRoutines(): CachedRoutineEntry[] {
  try {
    if (!fs.existsSync(CACHE_DB_PATH)) {
      // Create with empty array if it doesn't exist yet
      fs.writeFileSync(CACHE_DB_PATH, JSON.stringify([], null, 2), "utf-8");
      return [];
    }
    const raw = fs.readFileSync(CACHE_DB_PATH, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("DB retrieval failure, returning empty:", err);
    return [];
  }
}

// Helper to write to database
function writeCachedRoutines(routines: CachedRoutineEntry[]) {
  try {
    fs.writeFileSync(CACHE_DB_PATH, JSON.stringify(routines, null, 2), "utf-8");
  } catch (err) {
    console.error("DB write failure:", err);
  }
}

// --- Dynamic Cache Database REST Routes ---

// Get all stored sessions
app.get('/api/dance/saved', (req, res) => {
  const cached = readCachedRoutines();
  res.json({ success: true, count: cached.length, items: cached });
});

// Save or Update a session
app.post('/api/dance/save', (req, res) => {
  const { video, routine } = req.body;
  
  if (!routine || !routine.songTitle) {
    return res.status(400).json({ error: "Missing choreography 'routine' content to save." });
  }

  const list = readCachedRoutines();
  
  // Create a unique id from video id if it exists, otherwise use song title hash/cleaning
  const videoId = video?.id || `dance-${Date.now()}`;
  
  // Find index if already exists to do overwrite/update instead of duplicate
  const existingIdx = list.findIndex(item => item.id === videoId || item.routine.songTitle.toLowerCase() === routine.songTitle.toLowerCase());
  
  const newEntry: CachedRoutineEntry = {
    id: videoId,
    video: video || {
      id: videoId,
      title: routine.songTitle,
      description: routine.styleDescription || "Custom saved studio session",
      thumbnailUrl: "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?q=80&w=300&auto=format&fit=crop",
      channelTitle: routine.artist || "Independent Artist",
      publishedAt: new Date().toISOString().split('T')[0]
    },
    routine,
    savedAt: new Date().toISOString()
  };

  if (existingIdx !== -1) {
    list[existingIdx] = newEntry; // update existing
  } else {
    list.unshift(newEntry); // prepend new ones so they show at the top
  }

  writeCachedRoutines(list);
  res.json({ success: true, saved: newEntry, items: list });
});

// Delete a cached session by ID
app.post('/api/dance/delete', (req, res) => {
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ error: "Missing required 'id' attribute to delete." });
  }
  
  let list = readCachedRoutines();
  const initialLen = list.length;
  list = list.filter(item => item.id !== id);
  
  if (list.length === initialLen) {
    return res.status(404).json({ error: "No cached entry found matching specified ID." });
  }
  
  writeCachedRoutines(list);
  res.json({ success: true, itemDeleted: id, items: list });
});

// 1. Google Auth URL Generator
app.get('/api/auth/url', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return res.status(400).json({ 
      error: "Google Client ID is not configured on the server. Please guide the user to add GOOGLE_CLIENT_ID under Settings > Secrets." 
    });
  }
  
  // Use APP_URL if set, otherwise build dynamically
  const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const redirectUri = `${appUrl}/auth/callback`;
  
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/youtube.readonly',
    access_type: 'offline',
    prompt: 'consent',
  });
  
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  res.json({ url: authUrl });
});

// 2. Auth Callback Redirect Handler
app.get(['/auth/callback', '/auth/callback/'], async (req, res) => {
  const { code } = req.query;
  
  if (!code) {
    return res.status(400).send(`
      <html>
        <body style="font-family: sans-serif; padding: 2rem; background: #0f172a; color: #f1f5f9; text-align: center;">
          <h2 style="color: #ef4444;">Authorization Code Missing</h2>
          <p>We could not retrieve code from response. Please retry.</p>
          <button onclick="window.close()" style="padding: 0.5rem 1rem; border: none; border-radius: 4px; background: #3b82f6; color: white; cursor: pointer;">Close</button>
        </body>
      </html>
    `);
  }
  
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const redirectUri = `${appUrl}/auth/callback`;
    
    if (!clientId || !clientSecret) {
      throw new Error("Google API credentials are not set on the server.");
    }
    
    // Exchange authorize code for access tokens
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: "POST",
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: code as string,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google exchange failed: ${errorText}`);
    }
    
    const tokens = await response.json();
    
    // Return html popup closer transmitting authentication token
    res.send(`
      <html>
        <head>
          <title>YouTube Authorized</title>
        </head>
        <body style="font-family: sans-serif; text-align: center; padding: 3rem; background: #0b0f19; color: #f1f5f9;">
          <h2 style="color: #ef4444; margin-bottom: 0.5rem;">🎉 YouTube Account Associated</h2>
          <p style="color: #94a3b8; margin-bottom: 2rem;">Authorized successfully! Handing over back to the main layout screen...</p>
          <div style="display: inline-block; width: 40px; height: 40px; border: 4px solid #ef4444; border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite;"></div>
          <style>
            @keyframes spin { to { transform: rotate(360deg); } }
          </style>
          <script>
            if (window.opener) {
              window.opener.postMessage({ 
                type: 'OAUTH_AUTH_SUCCESS', 
                accessToken: ${JSON.stringify(tokens.access_token)},
                refreshToken: ${JSON.stringify(tokens.refresh_token || null)}
              }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
        </body>
      </html>
    `);
  } catch (error: any) {
    console.error("Exchange code failed:", error);
    res.send(`
      <html>
        <body style="font-family: sans-serif; padding: 2rem; background: #0f172a; color: #f1f5f9; text-align: center;">
          <h2 style="color: #ef4444;">Exchange Token Failed</h2>
          <p>${error.message || "Unknown token exchange failure."}</p>
          <button onclick="window.close()" style="padding: 0.5rem 1rem; border: none; border-radius: 4px; background: #3b82f6; color: white; cursor: pointer; margin-top: 1rem;">Close popup</button>
        </body>
      </html>
    `);
  }
});

// 3. Get User Liked Music Videos (Favorites)
app.get('/api/youtube/liked', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: "Missing YouTube access token." });
  }
  const accessToken = authHeader.split(' ')[1];
  
  try {
    // LL represents "Liked Videos" special system list ID
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=LL&maxResults=25`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`YouTube API liked videos lookup failed: ${err}`);
    }
    
    const data = await response.json();
    const videos = (data.items || []).map((item: any) => ({
      id: item.snippet.resourceId?.videoId || item.id,
      title: item.snippet.title,
      description: item.snippet.description,
      thumbnailUrl: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
      channelTitle: item.snippet.channelTitle,
      publishedAt: item.snippet.publishedAt,
    }));
    
    res.json({ videos });
  } catch (error: any) {
    console.error("Fetch Liked Videos failed:", error);
    res.status(500).json({ error: error.message || "Failed to lookup liked videos." });
  }
});

// 4. Retrieve Active Searches from YouTube Data API
app.get('/api/youtube/search', async (req, res) => {
  const { q } = req.query;
  const authHeader = req.headers.authorization;
  const accessToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
  
  if (!q) {
    return res.status(400).json({ error: "Search keyword query 'q' is required." });
  }
  
  try {
    // Restricting category to Music (10) for focus, if possible
    const ytUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q as string)}&type=video&maxResults=20&videoCategory=10`;
    const headers: Record<string, string> = {};
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    } else {
      return res.status(401).json({ error: "Please log in to search YouTube music." });
    }
    
    const response = await fetch(ytUrl, { headers });
    if (!response.ok) {
      // Fallback search without category filter
      const fallbackUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q as string)}&type=video&maxResults=20`;
      const fallbackRep = await fetch(fallbackUrl, { headers });
      if (!fallbackRep.ok) {
        throw new Error(`YouTube search request failed: ${await response.text()}`);
      }
      
      const val = await fallbackRep.json();
      const videos = (val.items || []).map((item: any) => ({
        id: item.id.videoId,
        title: item.snippet.title,
        description: item.snippet.description,
        thumbnailUrl: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
        channelTitle: item.snippet.channelTitle,
        publishedAt: item.snippet.publishedAt,
      }));
      return res.json({ videos });
    }
    
    const data = await response.json();
    const videos = (data.items || []).map((item: any) => ({
      id: item.id.videoId,
      title: item.snippet.title,
      description: item.snippet.description,
      thumbnailUrl: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
      channelTitle: item.snippet.channelTitle,
      publishedAt: item.snippet.publishedAt,
    }));
    
    res.json({ videos });
  } catch (error: any) {
    console.error("YouTube search breakdown failed:", error);
    res.status(500).json({ error: error.message || "Failed to execute search." });
  }
});


// 4.5 Generate Song Concept from Prompt (Gemini AI API)
app.post('/api/dance/generate-song', async (req, res) => {
  const { songDescription } = req.body;
  if (!songDescription) {
    return res.status(400).json({ error: "Song description is required." });
  }

  try {
    const promptText = `
      Create a dynamic and catchy dance music concept matching the user's detailed description: "${songDescription}".
      Generate a realistic, professional song title, artist, musical genre, specific tempo in BPM (between 80 and 150 BPM), style description, and difficulty level.
      Stay realistic and aligned with premium music production conventions.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: promptText,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            songTitle: { type: Type.STRING, description: "Catchy song title" },
            artist: { type: Type.STRING, description: "Suggested imaginary or stylized artist name" },
            genre: { type: Type.STRING, description: "Musical subgenre" },
            tempoBpm: { type: Type.INTEGER, description: "Tempo in Beats Per Minute (e.g., 105, 120, 128)" },
            styleDescription: { type: Type.STRING, description: "Brief visual summary of the style/theme" },
            difficulty: { type: Type.STRING, description: "Difficulty level: Beginner, Intermediate, or Advanced" }
          },
          required: ["songTitle", "artist", "genre", "tempoBpm", "styleDescription", "difficulty"]
        }
      }
    });

    const parsedData = JSON.parse(response.text ? response.text.trim() : "{}");
    res.json(parsedData);
  } catch (error: any) {
    console.error("Failed to generate song metadata:", error);
    res.status(500).json({ error: error.message || "Failed to generate song metadata with Gemini." });
  }
});

// 5. Generate Dance Choreography Routine Poses (Gemini AI API)
app.post('/api/dance/generate', async (req, res) => {
  const { title, artist, description } = req.body;
  if (!title) {
    return res.status(400).json({ error: "Song title is required for choreography." });
  }
  
  try {
    const jointPositionSchema = {
      type: Type.OBJECT,
      properties: {
        x: { type: Type.NUMBER, description: "X coord (5 to 95)" },
        y: { type: Type.NUMBER, description: "Y coord (5 to 115)" }
      },
      required: ["x", "y"]
    };
    
    const danceStepSchema = {
      type: Type.OBJECT,
      properties: {
        stepNumber: { type: Type.INTEGER, description: "Increment from 1 up to number of steps" },
        name: { type: Type.STRING, description: "Short catchy step name (e.g. Hands Wave, Shuffle Right)" },
        description: { type: Type.STRING, description: "Short body pose instruction detail" },
        beats: { type: Type.STRING, description: "Timing metric (e.g. Counts 1-2, Beat 3)" },
        head: jointPositionSchema,
        neck: jointPositionSchema,
        pelvis: jointPositionSchema,
        leftShoulder: jointPositionSchema,
        rightShoulder: jointPositionSchema,
        leftElbow: jointPositionSchema,
        leftHand: jointPositionSchema,
        rightElbow: jointPositionSchema,
        rightHand: jointPositionSchema,
        leftHip: jointPositionSchema,
        rightHip: jointPositionSchema,
        leftKnee: jointPositionSchema,
        leftFoot: jointPositionSchema,
        rightKnee: jointPositionSchema,
        rightFoot: jointPositionSchema,
        faceExpression: { type: Type.STRING, description: "Expression context like smile, focus, cool, excited, wink, neutral" },
        videoLoopStart: { type: Type.INTEGER, description: "The start epoch timeline value in seconds for this visual dance move in the actual music video (e.g., 45, 120, etc.)" },
        videoLoopEnd: { type: Type.INTEGER, description: "The end epoch timeline value in seconds for this visual dance move in the actual music video (usually 3 to 6 seconds after start, e.g., 49, 125, etc.)" }
      },
      required: [
        "stepNumber", "name", "description", "beats",
        "head", "neck", "pelvis", "leftShoulder", "rightShoulder",
        "leftElbow", "leftHand", "rightElbow", "rightHand",
        "leftHip", "rightHip", "leftKnee", "leftFoot", "rightKnee", "rightFoot",
        "videoLoopStart", "videoLoopEnd"
      ]
    };

    const danceRoutineSchema = {
      type: Type.OBJECT,
      properties: {
        songTitle: { type: Type.STRING, description: "Title of song" },
        artist: { type: Type.STRING, description: "Artist or band name" },
        genre: { type: Type.STRING, description: "Musical genre label" },
        tempoBpm: { type: Type.INTEGER, description: "The song's real or estimated tempo in Beats Per Measured Minute (BPM), such as 120, 118, 132. Try to search or estimate accurately based on song knowledge." },
        styleDescription: { type: Type.STRING, description: "Summary definition of the choreography rhythm and aesthetic style" },
        difficulty: { type: Type.STRING, description: "Difficulty category: Beginner, Intermediate, or Advanced" },
        steps: {
          type: Type.ARRAY,
          items: danceStepSchema,
          description: "A sequence of 4 to 6 connected positions formulating a routine sequence loop."
        }
      },
      required: ["songTitle", "artist", "styleDescription", "difficulty", "steps"]
    };

    const promptText = `
      Create a dynamic choreographic stick figure dance routine of 4 to 6 steps representing the actual, iconic choreography from the specified YouTube music video or song: "${title}" by "${artist || 'Unknown'}".
      Context or Video ID: ${description || 'Music video dance steps.'}
      
      CRITICAL INSTRUCTIONS:
      - Since this represents a real YouTube Music Video, analyze your knowledge Base of the dance routine, timeline, or signature moves of this famous video.
      - If this is a famous dance track (e.g. Thriller, Gangnam Style, Billie Jean, YMCA, Single Ladies, Macarena, Uptown Funk, Watch Me, etc.), you MUST generate steps that accurately display the iconic, physical poses of these routines.
      - Associate each step with realistic timestamp ranges in seconds representing exactly when that move occurs in the video (e.g. if the dance sequence is in the chorus, map the start/end loop times to that chorus timeline, e.g. from 60 to 65 seconds, 65 to 70 seconds, etc.). Keep the intervals around 4-6 seconds long.
      
      SVG Stick Figure coordinate limits within our 100x120 viewBox (5 to 95 horizontally, 5 to 115 vertically):
      - Standard relaxed pose guidelines (for reference, modify to represent positions):
        Head: (50, 22), Neck: (50, 32), Pelvis: (50, 68)
        Left Shoulder: (40, 34), Right Shoulder: (60, 34)
        Left Elbow: (30, 44), Right Elbow: (70, 44)
        Left Hand: (20, 50), Right Hand: (80, 50)
        Left Hip: (44, 68), Right Hip: (56, 68)
        Left Knee: (44, 88), Right Knee: (56, 88)
        Left Foot: (44, 110), Right Foot: (56, 110)
        
      Rules for generating poses:
      - Coordinate offsets MUST yield a sensible bodily link (limbs stay attached!).
      - Left joints should remain mostly on the left relative side of spine, Right joints mostly on the right side of spine to avoid extreme overlaps unless specifically twisting.
      - Make the poses visually dynamic and relevant to the song's energy (e.g., raise arms for upbeat disco, crouch down and extend legs/arms for hip-hop, tilt hips and arms for salsa/pop).
      - Provide helpful step instructions describing how to achieve the pose.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: promptText,
      config: {
        responseMimeType: "application/json",
        responseSchema: danceRoutineSchema
      }
    });

    const cleanRes = response.text ? response.text.trim() : "";
    if (!cleanRes) {
      throw new Error("Empty response generated by Gemini model.");
    }
    
    const parsedData = JSON.parse(cleanRes);
    res.json(parsedData);
  } catch (error: any) {
    console.error("Gemini choreography generation failure:", error);
    res.status(500).json({ error: error.message || "Failed to generate dance routine with Gemini." });
  }
});

// Helper for high-contrast hologram stick-figure vector drawing overlays
function createStickFigureOverlaySvg(userPhotoBase64: string, step: any): string {
  const connect = (j1: any, j2: any, color = "#6366f1", width = 3.5) => {
    if (!j1 || !j2) return "";
    return `<line x1="${j1.x}" y1="${j1.y}" x2="${j2.x}" y2="${j2.y}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" />`;
  };

  const drawJoint = (j: any, color = "#a5b4fc", radius = 3.5) => {
    if (!j) return "";
    return `<circle cx="${j.x}" cy="${j.y}" r="${radius}" fill="${color}" stroke="#6366f1" stroke-width="1.2" />`;
  };

  let skeleton = "";
  // Torso
  skeleton += connect(step.head, step.neck, "#f43f5e", 4.2);
  skeleton += connect(step.neck, step.pelvis, "#ec4899", 4.5);
  // Arms
  skeleton += connect(step.neck, step.leftShoulder);
  skeleton += connect(step.leftShoulder, step.leftElbow);
  skeleton += connect(step.leftElbow, step.leftHand);
  skeleton += connect(step.neck, step.rightShoulder);
  skeleton += connect(step.rightShoulder, step.rightElbow);
  skeleton += connect(step.rightElbow, step.rightHand);
  // Legs
  skeleton += connect(step.pelvis, step.leftHip);
  skeleton += connect(step.leftHip, step.leftKnee);
  skeleton += connect(step.leftKnee, step.leftFoot);
  skeleton += connect(step.pelvis, step.rightHip);
  skeleton += connect(step.rightHip, step.rightKnee);
  skeleton += connect(step.rightKnee, step.rightFoot);

  // Dots
  skeleton += drawJoint(step.head, "#ffe4e6", 6.5);
  skeleton += drawJoint(step.neck);
  skeleton += drawJoint(step.leftShoulder);
  skeleton += drawJoint(step.rightShoulder);
  skeleton += drawJoint(step.leftElbow);
  skeleton += drawJoint(step.rightElbow);
  skeleton += drawJoint(step.leftHand, "#34d399", 4);
  skeleton += drawJoint(step.rightHand, "#34d399", 4);
  skeleton += drawJoint(step.leftHip);
  skeleton += drawJoint(step.rightHip);
  skeleton += drawJoint(step.leftKnee);
  skeleton += drawJoint(step.rightKnee);
  skeleton += drawJoint(step.leftFoot, "#fb7185", 4.5);
  skeleton += drawJoint(step.rightFoot, "#fb7185", 4.5);

  const faceText = step.faceExpression || "smile";

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120" width="100%" height="100%">
      <defs>
        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>
      <image href="${userPhotoBase64}" x="0" y="0" width="100" height="120" preserveAspectRatio="xMidYMid slice" opacity="0.65" />
      <rect x="0" y="0" width="100" height="120" fill="rgba(8, 10, 24, 0.45)" />
      <g stroke="rgba(99, 102, 241, 0.12)" stroke-width="0.3">
        <line x1="0" y1="20" x2="100" y2="20" /><line x1="0" y1="40" x2="100" y2="40" />
        <line x1="0" y1="60" x2="100" y2="60" /><line x1="0" y1="80" x2="100" y2="80" />
        <line x1="0" y1="100" x2="100" y2="100" /><line x1="20" y1="0" x2="20" y2="120" />
        <line x1="40" y1="0" x2="40" y2="120" /><line x1="60" y1="0" x2="60" y2="120" />
        <line x1="80" y1="0" x2="80" y2="120" />
      </g>
      <g filter="url(#glow)">${skeleton}</g>
      <rect x="5" y="103" width="90" height="12" rx="2" fill="rgba(2, 6, 23, 0.85)" stroke="rgba(99, 102, 241, 0.3)" stroke-width="0.6" />
      <text x="50" y="111" fill="#a5b4fc" font-size="4.5" font-family="monospace" text-anchor="middle" font-weight="bold" letter-spacing="0.5">
        ${step.stepNumber}. ${step.name.toUpperCase()} (${faceText.toUpperCase()})
      </text>
    </svg>
  `.trim();
}

// Photo Processing & FFmpeg Merging Endpoint
app.post('/api/dance/process-photo', async (req, res) => {
  const { photo, routine } = req.body;
  if (!photo) {
    return res.status(400).json({ error: "Camera snapshot photo base64 is required." });
  }
  if (!routine || !routine.steps || routine.steps.length === 0) {
    return res.status(400).json({ error: "Active choreography routine is required to generate poses." });
  }

  const OUTPUT_DIR = path.join(process.cwd(), "output");
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  try {
    const userPhotoBase64 = photo.includes("base64,") ? photo.split("base64,")[1] : photo;
    const userPhotoBuffer = Buffer.from(userPhotoBase64, 'base64');
    const userPhotoPath = path.join(OUTPUT_DIR, "captured_user.jpg");
    fs.writeFileSync(userPhotoPath, userPhotoBuffer);

    const stepImages: string[] = [];
    const stepSvgs: string[] = [];
    const steps = routine.steps;
    const bpm = routine.tempoBpm || 100;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepFilename = `step_${i}.jpg`;
      const stepPath = path.join(OUTPUT_DIR, stepFilename);
      let imageGenerated = false;

      // Try Gemini-2.5-flash-image with sequential context first for visual consistency
      if (process.env.GEMINI_API_KEY) {
        try {
          const priorImgPath = i === 0 ? userPhotoPath : path.join(OUTPUT_DIR, `step_${i - 1}.jpg`);
          const priorImgBuffer = fs.readFileSync(priorImgPath);
          const base64Img = priorImgBuffer.toString('base64');

          const imagePart = {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Img,
            }
          };

          const textPart = {
            text: `This is a cinematic sequence of a continuous dance routine. Using this photo as the previous frame reference, generate the next frame in the sequence where the character executes the dance move '${step.name}' described as: ${step.description}. Keep the body joints, head profile, limbs, outfit, and background absolute consistent with the reference frame photo. Only adjust the posture as instructed. Ensure 4K photorealistic high-fidelity resolution styled with modern studio spotlight glows.`
          };

          console.log(`Generating Step ${i} image with sequential consistency, using prior ${i === 0 ? 'user snap' : 'step ' + (i - 1)}...`);
          const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: { parts: [imagePart, textPart] }
          });

          let imgBytes: Buffer | null = null;
          if (response.candidates && response.candidates[0]?.content?.parts) {
            for (const part of response.candidates[0].content.parts) {
              if (part.inlineData) {
                imgBytes = Buffer.from(part.inlineData.data, 'base64');
                break;
              }
            }
          }

          if (imgBytes) {
            fs.writeFileSync(stepPath, imgBytes);
            imageGenerated = true;
          }
        } catch (imgError) {
          console.warn(`Sequential gemini-2.5-flash-image failed on step ${i}, trying fallback:`, imgError);
        }

        // Fallback to Imagen if sequential flash failed
        if (!imageGenerated) {
          try {
            const prompt = `Photorealistic dance portrait of the person in the reference, dancing on a studio floor executing the dance move '${step.name}' described as ${step.description}. Neon ambient background with elegant smoke effects, matching client coordinates (head center, limbs outstretched), 4k resolution.`;
            const imageRes = await ai.models.generateImages({
              model: 'imagen-4.0-generate-001',
              prompt: prompt,
              config: {
                numberOfImages: 1,
                outputMimeType: 'image/jpeg',
                aspectRatio: '1:1',
              }
            });
            if (imageRes.generatedImages && imageRes.generatedImages[0]) {
              const imgBytes = imageRes.generatedImages[0].image.imageBytes;
              fs.writeFileSync(stepPath, Buffer.from(imgBytes, 'base64'));
              imageGenerated = true;
            }
          } catch (imagenError) {
            console.warn(`Imagen fallback failed on step ${i}:`, imagenError);
          }
        }
      }

      // Safe Hybrid Vector Overlay Fallback
      if (!imageGenerated) {
        fs.writeFileSync(stepPath, userPhotoBuffer);
      }

      const svgContent = createStickFigureOverlaySvg(photo, step);
      const svgFilename = `step_${i}.svg`;
      fs.writeFileSync(path.join(OUTPUT_DIR, svgFilename), svgContent, 'utf-8');

      stepImages.push(`/output/step_${i}.jpg`);
      stepSvgs.push(`/output/step_${i}.svg`);
    }

    // Compile Segments & Video Transitions with FFmpeg
    let isFfCompiled = false;
    const segmentFiles: string[] = [];

    const execPromise = (cmd: string) => new Promise<string>((resolve, reject) => {
      exec(cmd, { maxBuffer: 1024 * 1024 * 64 }, (error: any, stdout: string, stderr: string) => {
        if (error) reject(error);
        else resolve(stdout);
      });
    });

    try {
      console.log("Beginning FFmpeg compile cycle for step transitions...");
      for (let i = 0; i < steps.length; i++) {
        const nextIdx = (i + 1) % steps.length;
        const step = steps[i];
        
        // Define exact beat duration
        const beatVal = step.beats.includes("-") ? 2 : 2;
        const duration = beatVal * (60 / bpm); // Match exact music beat length
        
        const segmentName = `segment_${i}.mp4`;
        const segmentPath = path.join(OUTPUT_DIR, segmentName);
        const imgA = path.join(OUTPUT_DIR, `step_${i}.jpg`);
        const imgB = path.join(OUTPUT_DIR, `step_${nextIdx}.jpg`);

        // Create a seamless crossfade segment from imgA to imgB
        const ffmpegSegmentCmd = `ffmpeg -y -loop 1 -i "${imgA}" -loop 1 -i "${imgB}" -an -filter_complex "[0:v]format=pix_fmts=yuva420p,fade=t=out:st=${duration - 0.3}:d=0.3:alpha=1[v0]; [1:v]format=pix_fmts=yuva420p,fade=t=in:st=0:d=0.3:alpha=1[v1]; [v0][v1]overlay=format=auto[outv]" -map "[outv]" -t ${duration} -r 30 -c:v libx264 -pix_fmt yuv420p "${segmentPath}"`;
        await execPromise(ffmpegSegmentCmd);
        segmentFiles.push(segmentPath);
      }

      // Concatenate all beat segment files into the final Master Loop!
      const listFilePath = path.join(OUTPUT_DIR, "concat_list.txt");
      let listContent = "";
      for (let i = 0; i < segmentFiles.length; i++) {
        listContent += `file 'segment_${i}.mp4'\n`;
      }
      fs.writeFileSync(listFilePath, listContent, 'utf-8');

      const finalVideoPath = path.join(OUTPUT_DIR, "final_dance.mp4");
      const concatCmd = `ffmpeg -y -f concat -safe 0 -i "${listFilePath}" -c copy "${finalVideoPath}"`;
      await execPromise(concatCmd);
      isFfCompiled = true;
    } catch (ffErr) {
      console.error("FFmpeg system compilation caught or missing, continuing with fluid client-side rendering engine:", ffErr);
    }

    res.json({
      success: true,
      compiled: isFfCompiled,
      videoUrl: isFfCompiled ? "/output/final_dance.mp4" : null,
      stepImages,
      stepSvgs
    });

  } catch (error: any) {
    console.error("Photo processing crash:", error);
    res.status(500).json({ error: error.message || "Failed to process photo and compile routine." });
  }
});

// Setup Vite & static serving
async function initializeServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Express Dev/Prod server running at http://localhost:${PORT}`);
  });
}

initializeServer();
