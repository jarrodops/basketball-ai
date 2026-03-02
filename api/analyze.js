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
    const { videoUrl, players, targetLevel } = req.body ?? {};

    if (!videoUrl || !Array.isArray(players) || players.length === 0) {
      return res.status(400).json({ error: "Missing required fields: videoUrl, players" });
    }

    // Basic domain restriction (safety)
    if (!videoUrl.includes("youtube.com") && !videoUrl.includes("youtu.be")) {
      return res.status(400).json({ error: "Only YouTube URLs supported for MVP" });
    }

    const playersCSV = players.join(",");
    const prompt = `
You are a high-level basketball evaluator writing a real coaching report.

You are NOT writing encouragement fluff and NOT writing a scouting buzzword list.
You are explaining how the player actually plays basketball and what limits their impact.
Be direct and specific, but always include positive/encouraging notes alongside the hard critique.

Video: ${videoUrl}
Players: ${playersCSV}
Target Level: ${targetLevel}

Return ONLY valid JSON (no markdown, no commentary). The JSON must follow the schema exactly and include positive traits, a single highest-priority development focus that unlocks the next level, and a short, actionable training plan for each priority.

OUTPUT FORMAT:

{
  "videoId": "<video id>",
  "targetLevel": "<varsity|college>",
  "players": [
    {
      "number": <jersey number>,
      "coreIdentity": "<short sentence describing the player's identity and how they create value>",

      "impactByGameState": {
        "transition": "<low|moderate|high>",
        "rotatingHalfCourt": "<low|moderate|high>",
        "setHalfCourt": "<low|moderate|high>"
      },

      "offense": {
        "summary": "<brief strengths & tendencies on offense>",
        "scoringInstincts": "<analysis>",
        "creationAbility": "<analysis>",
        "passingProfile": "<analysis>",
        "decisionTiming": "<analysis>",
        "shotSelection": "<analysis>",
        "examples": [{"time":"mm:ss","note":"short play-based observation"}]
      },

      "defense": {
        "summary": "<brief defensive strengths & tendencies>",
        "onBallAggression": <1-10>,
        "helpAndRotations": "<analysis>",
        "rebounding": "<analysis>",
        "footworkAndPositioning": "<analysis>",
        "examples": [{"time":"mm:ss","note":"short play-based observation"}]
      },

      "strengths": ["concrete short strings of things the player already does well"],
      "weaknesses": ["concrete short strings of things that limit impact"],

      "developmentPriority": {
        "priority": 1,
        "name": "<the single most important skill or habit that unlocks the next level>",
        "why": "<one-sentence explanation of why this unlocks the next level>"
      },

      "trainingPlan": [
        {
          "item": "<what to train>",
          "howToTrain": "<specific drills, reps, session frequency>",
          "measurableTarget": "<how to measure progress (e.g., make X out of Y contested finishes, reduce delay to pass to <2s)>",
          "timelineWeeks": <number of weeks suggested>
        }
      ],

      "projection": {
        "currentLevel": "<e.g., JV scorer / situational varsity / low-level college recruit>",
        "ifImproves": "<expected role at target level if the development plan is followed>"
      },

      "positiveNotes": "<encouraging coachable note mentioning a repeatable strength>",
      "summary": "<one-paragraph scouting summary that reads like a coach report>",
      "promptVersion": "dev-pathway-v3"
    }
  ]
}

ADDITIONAL RULES:
- Always produce a full evaluation for each requested player (never return an empty players array).
- For each weakness listed include at least one concrete trainingPlan entry that addresses it.
- Use timestamps when giving examples if the evidence is visible; if not visible, do not invent timestamps — state nothing rather than invent.
- Keep language factual and evidence-based: phrase observations as "based on visible actions" when you claim causality.
- If information is limited, infer tendencies conservatively (e.g., "appears to prefer..." rather than "is a...").
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
        max_output_tokens: 800,
        temperature: 0
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

// Try direct parse first
try {
  const parsed = JSON.parse(typeof text === "string" ? text.trim() : text);
  res.setHeader("Content-Type", "application/json");
  return res.status(200).json(parsed);
} catch (directErr) {
  // If direct parse fails, attempt to extract a JSON substring from the text
  if (typeof text === "string") {
    // Find the first "{" and the last "}" and try to parse the slice.
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first !== -1 && last !== -1 && last > first) {
      const candidate = text.slice(first, last + 1).trim();
      try {
        const parsed = JSON.parse(candidate);
        res.setHeader("Content-Type", "application/json");
        return res.status(200).json(parsed);
      } catch (sliceErr) {
        // fall through to returning raw
      }
    }

    // As a last-ditch attempt, try to find the first balanced JSON-like object using regex
    const match = text.match(/\{[\s\S]*\}/);
    if (match && match[0]) {
      try {
        const parsed = JSON.parse(match[0]);
        res.setHeader("Content-Type", "application/json");
        return res.status(200).json(parsed);
      } catch (regexErr) {
        // fall through
      }
    }
  }

  // If we get here, parsing failed — return raw text for debugging
  return res.status(200).json({ raw: text, warning: "Failed to parse model output as JSON" });
}
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
export default allowCors(handler);
