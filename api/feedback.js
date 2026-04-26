import { query } from '../server/db.js';

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

export default async function handler(req, res) {
  // ─── GET /api/feedback ─────────────────────────────────────────────────
  if (req.method === 'GET') {
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
  }

  // ─── POST /api/feedback ────────────────────────────────────────────────
  if (req.method === 'POST') {
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
  }

  // ─── DELETE /api/feedback (clear all) ─────────────────────────────────
  if (req.method === 'DELETE') {
    try {
      await query('DELETE FROM feedback_reviews');
      return res.status(200).json({ ok: true });
    } catch (error) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Unexpected server error',
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
