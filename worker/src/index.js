/**
 * Flowvanta Blueprint Worker
 * Proxies OpenAI calls so the API key never touches the browser.
 * Deploy: wrangler deploy
 * Secret:  wrangler secret put OPENAI_API_KEY
 */

const ALLOWED_ORIGINS = [
  'https://flowvanta.dev',
  'https://www.flowvanta.dev',
  'http://localhost:3000',
  'http://localhost:5500',
];

const SYSTEM_PROMPT = `You are an expert n8n workflow architect at Flowvanta, a company that builds enterprise automation systems.

Given a user's automation requirement, generate a precise, specific n8n workflow blueprint.

Return ONLY valid JSON — no markdown, no explanation, just the JSON object:
{
  "name": "short descriptive workflow name",
  "nodes": [
    {
      "icon": "single relevant emoji",
      "label": "short\\ntitle",
      "type": "wfn-trigger",
      "desc": "one precise sentence describing what this node does"
    }
  ],
  "steps": [
    "Detailed step description explaining exactly what happens at this stage"
  ]
}

NODE TYPE RULES:
- wfn-trigger: first node only — what starts the workflow
- wfn-action: integrations, API calls, data transforms, routing logic
- wfn-ai: anything involving AI/LLM — classification, drafting, enrichment
- wfn-output: the final delivery node — last node only

STRICT RULES:
- Always exactly 1 trigger (first) and 1 output (last)
- Minimum 3 nodes, maximum 6 nodes
- Labels: 2 short words max, use \\n between them
- Steps: one per node, match node order, be specific to the actual use case
- Name: concise, professional, 3-5 words`;

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    let prompt;
    try {
      const body = await request.json();
      prompt = (body.prompt || '').trim();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
      });
    }

    if (!prompt || prompt.length < 8) {
      return new Response(JSON.stringify({ error: 'Prompt too short' }), {
        status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
      });
    }

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        temperature: 0.3,
        max_tokens: 800,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Generate a workflow blueprint for this automation requirement:\n\n"${prompt}"` },
        ],
      }),
    });

    if (!openaiRes.ok) {
      const err = await openaiRes.text();
      return new Response(JSON.stringify({ error: `OpenAI error: ${openaiRes.status}`, detail: err }), {
        status: 502, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
      });
    }

    const data = await openaiRes.json();
    const content = data.choices?.[0]?.message?.content;

    return new Response(content, {
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
    });
  }
};
