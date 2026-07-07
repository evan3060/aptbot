import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Gemini SDK with custom User-Agent for telemetry
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// API endpoint for chat completions
app.post("/api/chat", async (req, res) => {
  try {
    const { message, history = [], systemPrompt, model = "gemini-3.5-flash" } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required." });
    }

    // Determine the actual model name to use
    let modelName = "gemini-3.5-flash";
    if (model === "gemini-3.1-pro-preview" || model === "Claude 3.5 Sonnet") {
      modelName = "gemini-3.1-pro-preview";
    }

    // Format chat history for the GoogleGenAI SDK
    // In @google/genai SDK: contents is an array of Content objects:
    // Content has { role: 'user' | 'model', parts: [{ text: string }] }
    const contents = history.map((h: any) => ({
      role: h.role === "assistant" ? "model" : h.role,
      parts: [{ text: h.content }]
    }));

    // Add current message to contents
    contents.push({
      role: "user",
      parts: [{ text: message }]
    });

    const response = await ai.models.generateContent({
      model: modelName,
      contents: contents,
      config: {
        systemInstruction: systemPrompt || "You are a helpful assistant.",
        temperature: 0.7,
      },
    });

    const text = response.text || "No response generated.";
    res.json({ text });
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    res.status(500).json({
      error: error.message || "An error occurred while generating content.",
      details: error.stack
    });
  }
});

// Start the server
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite middleware mounted in development mode.");
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log("Serving static files in production mode.");
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
