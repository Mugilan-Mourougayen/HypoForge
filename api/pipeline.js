import { runPipeline } from '../server/pipeline.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const tavilyKey = process.env.TAVILY_API_KEY;
  if (!tavilyKey) {
    return res.status(500).json({ error: 'Missing TAVILY_API_KEY environment variable' });
  }

  const { raw, budget = 'medium', timeline_mode = 'standard' } = req.body || {};
  if (!raw || typeof raw !== 'string' || raw.trim().length < 20) {
    return res.status(400).json({ error: 'Please enter a more complete scientific hypothesis.' });
  }

  try {
    const plan = await runPipeline(raw.trim(), tavilyKey, budget, timeline_mode);
    return res.status(200).json(plan);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Pipeline failed' });
  }
}
