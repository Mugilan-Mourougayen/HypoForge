import { query } from '../../server/db.js';

export default async function handler(req, res) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const id = Number.parseInt(String(req.query.id), 10);
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
}
