export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
}
