// api/analyze.js
// Minimal Vercel serverless that proxies a prompt to OpenAI Responses API.
// Returns the model's JSON output as-is (expects the model to return JSON).

// Allow browser requests (CORS)
const allowCors = fn => async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  return fn(req, res);
};
async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed - POST only" });
  }

  try {
    const { videoUrl, players } = req.body ?? {};

    if (!videoUrl || !Array.isArray(players) || players.length === 0) {
      return res.status(400).json({ error: "Missing required fields: videoUrl, players" });
    }

    // Basic domain restriction (safety)
    if (!videoUrl.includes("youtube.com") && !videoUrl.includes("youtu.be")) {
      return res.status(400).json({ error: "Only YouTube URLs supported for MVP" });
    }

    const playersCSV = players.join(",");
    const prompt = `
You are a basketball scouting assistant.
Video: ${videoUrl}
Players: ${playersCSV}

Return ONLY valid JSON following this schema:

{
  "videoId": "<youtube id>",
  "players": [
    {
      "number": <integer>,
      "summary": "<1-2 sentence summary>",
      "strengths": ["..."],
      "weaknesses": ["..."],
      "iq": <1-10>,
      "athleticism": <1-10>,
      "motor": <1-10>,
      "coachability": <1-10>,
      "examples":[{"time":"mm:ss","note":"short note referencing visible play"}]
    }
  ],
  "promptVersion": "mvp-v1"
}
`;

    const openaiResp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-5.2",
        input: prompt,
        max_output_tokens: 800
      }),
    });

    if (!openaiResp.ok) {
      const errTxt = await openaiResp.text();
      return res.status(502).json({ error: "OpenAI error", details: errTxt });
    }

    const data = await openaiResp.json();

    const text =
      data.output_text ||
      (data.output && data.output[0] && (data.output[0].content?.[0]?.text ?? data.output[0].content)) ||
      JSON.stringify(data);

    try {
      const parsed = JSON.parse(typeof text === "string" ? text.trim() : text);
      res.setHeader("Content-Type", "application/json");
      return res.status(200).json(parsed);
    } catch (parseErr) {
      return res.status(200).json({ raw: text, warning: "Failed to parse model output as JSON" });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
export default allowCors(handler);
