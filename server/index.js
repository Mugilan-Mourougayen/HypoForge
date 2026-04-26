import express from 'express';
import { query } from './db.js';
import { runPipeline } from './pipeline.js';

const app = express();
const port = Number(process.env.PORT || 3001);

app.use(express.json());

function normalize(row) {
  return {
    id: Number(row.id),
    timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : row.timestamp,
    question: row.question,
    domain: row.domain,
    sections: row.sections || {},
    overallRating: row.overall_rating || 0,
    overallComment: row.overall_comment || '',
  };
}

// ─── Full Claude + Tavily pipeline ────────────────────────────────────────

app.post('/api/pipeline', async (req, res) => {
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (!tavilyKey) return res.status(500).json({ error: 'Missing TAVILY_API_KEY environment variable' });

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
});

// ─── Tavily pass-through (kept for direct search use) ─────────────────────

app.post('/api/search', async (req, res) => {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing TAVILY_API_KEY environment variable' });
  }

  const { query: searchQuery, maxResults = 5, depth = 'advanced' } = req.body || {};
  if (!searchQuery || typeof searchQuery !== 'string') {
    return res.status(400).json({ error: 'A query string is required' });
  }

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query: searchQuery,
        max_results: maxResults,
        search_depth: depth,
        include_answer: true,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.detail || data?.error || `Tavily request failed with status ${response.status}`,
      });
    }

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unexpected server error',
    });
  }
});

app.get('/api/feedback', async (req, res) => {
  try {
    const domain = typeof req.query.domain === 'string' ? req.query.domain.trim() : '';
    const parsedLimit = Number.parseInt(String(req.query.limit || '50'), 10);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 50;

    const result = domain
      ? await query(
          `SELECT id, timestamp, question, domain, sections, overall_rating, overall_comment
           FROM feedback_reviews
           WHERE domain = $1
           ORDER BY timestamp DESC
           LIMIT $2`,
          [domain, limit],
        )
      : await query(
          `SELECT id, timestamp, question, domain, sections, overall_rating, overall_comment
           FROM feedback_reviews
           ORDER BY timestamp DESC
           LIMIT $1`,
          [limit],
        );

    return res.status(200).json({ feedback: result.rows.map(normalize) });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unexpected server error',
    });
  }
});

app.post('/api/feedback', async (req, res) => {
  const body = req.body || {};
  if (!body.question || !body.domain) {
    return res.status(400).json({ error: 'question and domain are required' });
  }

  try {
    const result = await query(
      `INSERT INTO feedback_reviews (timestamp, question, domain, sections, overall_rating, overall_comment)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       RETURNING id, timestamp, question, domain, sections, overall_rating, overall_comment`,
      [
        body.timestamp || new Date().toISOString(),
        body.question,
        body.domain,
        JSON.stringify(body.sections || {}),
        Number.isFinite(body.overallRating) ? body.overallRating : 0,
        body.overallComment || '',
      ],
    );

    return res.status(201).json({ feedback: normalize(result.rows[0]) });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unexpected server error',
    });
  }
});

app.delete('/api/feedback', async (_req, res) => {
  try {
    await query('DELETE FROM feedback_reviews');
    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unexpected server error',
    });
  }
});

app.delete('/api/feedback/:id', async (req, res) => {
  const id = Number.parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'Invalid feedback id' });
  }

  try {
    const result = await query('DELETE FROM feedback_reviews WHERE id = $1', [id]);
    if (!result.rowCount) {
      return res.status(404).json({ error: 'Feedback entry not found' });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unexpected server error',
    });
  }
});

app.listen(port, () => {
  console.log(`API server listening on http://localhost:${port}`);
});
