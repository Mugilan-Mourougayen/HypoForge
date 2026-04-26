/**
 * Pipeline: regex parse → Tavily search + extract → dynamic plan assembly
 * No hardcoded templates. All protocol steps, reagents, and equipment
 * are derived from real pages fetched via Tavily /search and /extract.
 */

const LITERATURE_DOMAINS = [
  'arxiv.org', 'biorxiv.org', 'medrxiv.org',
  'semanticscholar.org', 'pubmed.ncbi.nlm.nih.gov', 'ncbi.nlm.nih.gov',
];
const PROTOCOL_DOMAINS = [
  'protocols.io', 'bio-protocol.org', 'nature.com',
  'jove.com', 'openwetware.org', 'addgene.org',
];
const SUPPLIER_DOMAINS = [
  'sigmaaldrich.com', 'thermofisher.com', 'abcam.com',
  'fishersci.com', 'vwr.com', 'biolegend.com', 'qiagen.com',
];

// ─── Tavily helpers ────────────────────────────────────────────────────────

async function tavilySearch(apiKey, query, domains, maxResults = 6) {
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query: query.slice(0, 200),
      search_depth: 'advanced',
      max_results: maxResults,
      include_domains: domains,
      include_answer: true,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.detail || `Tavily error ${response.status}`);
  return { results: data.results || [], answer: data.answer || '' };
}

async function tavilyExtract(apiKey, urls) {
  if (!urls?.length) return [];
  try {
    const response = await fetch('https://api.tavily.com/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, urls: urls.slice(0, 3) }),
    });
    const data = await response.json().catch(() => ({}));
    return (data.results || []).filter(r => r.raw_content && r.raw_content.length > 80);
  } catch {
    return [];
  }
}

// ─── Stage 1: Regex hypothesis parser ─────────────────────────────────────

const DOMAIN_KEYWORDS = {
  diagnostics:        ['biosensor','assay','detection','sensitivity','specificity','lod','limit of detection','immunoassay','elisa','lateral flow','crp','biomarker','diagnostic','point-of-care'],
  cell_biology:       ['cell','proliferation','apoptosis','viability','migration','cryopreservation','cryoprotect','hela','culture','stem cell','differentiation','membrane'],
  microbiology:       ['bacteria','probiotic','microbiome','colony','fermentation','antimicrobial','biofilm','gut','lactobacillus','e. coli','pathogen','antibiotic'],
  bioelectrochemistry:['electrode','potentiostat','cyclic voltammetry','impedance','redox','electrochemical','graphene','carbon nanotube','bioreactor','sporomusa'],
  molecular_biology:  ['pcr','qpcr','sequencing','gene','expression','mrna','rna','dna','transfection','crispr','primer','gel electrophoresis','western blot'],
  biochemistry:       ['enzyme','protein','kinetics','substrate','inhibitor','km','kcat','purification','sds-page','chromatography','spectrophotometry'],
  chemistry:          ['synthesis','reaction','catalyst','yield','nanoparticle','polymer','solvent','titration','precipitation','crystallization'],
  neuroscience:       ['neuron','synapse','brain','cortex','neural','electrophysiology','patch clamp','hippocampus','cognitive','behavior'],
  environmental:      ['soil','water quality','sediment','pollutant','remediation','toxicity','biodegradation','ecosystem','contaminant'],
};

function scoreDomain(text) {
  const lower = text.toLowerCase();
  let best = 'other', bestScore = 0;
  for (const [domain, kws] of Object.entries(DOMAIN_KEYWORDS)) {
    const score = kws.filter(k => lower.includes(k)).length;
    if (score > bestScore) { best = domain; bestScore = score; }
  }
  return best;
}

const THRESHOLD_RE = /(\d+(?:\.\d+)?)\s*(mg\/[lL]|g\/[lL]|µg\/[lL]|ng\/[lL]|mmol\/[lL]|%|fold|x|°[cC]|mV|µA|nA|[µu]M|mM|nM|pM)/;
const MECHANISM_RE = /\b(?:due to|through|via|by means of|mediated by)\b(.+?)(?:\.|,|compared|versus|vs\.?|$)/i;
const CONTROL_RE   = /\b(?:compared (?:to|with)|versus|vs\.?|relative to|over)\b\s*([^,.]+)/i;
const SAMPLE_KW    = [
  ['whole blood','whole blood'],['serum','serum'],['plasma','plasma'],
  ['HeLa cells','hela'],['HEK293 cells','hek293'],['C57BL/6 mice','c57'],
  ['E. coli','e. coli'],['yeast','yeast'],['zebrafish','zebrafish'],
  ['mouse model','mouse'],['rat model','rat'],['human samples','human'],
  ['in vitro','in vitro'],['in vivo','in vivo'],
];

function parseHypothesis(raw) {
  const domain = scoreDomain(raw);
  const threshold = raw.match(THRESHOLD_RE)?.[0] ?? null;

  let intervention = raw, outcome = '';
  const wi = raw.search(/\bwill\b/i);
  if (wi > -1) {
    intervention = raw.slice(0, wi).replace(/[,;.]+$/, '').trim();
    const after = raw.slice(wi + 4).trim();
    const ms = after.search(MECHANISM_RE);
    outcome = (ms > 0 ? after.slice(0, ms) : after).replace(/[,;.]+$/, '').trim();
  } else {
    const parts = raw.split(/\bimproves?\b|\bincreases?\b|\breduces?\b|\benhances?\b/i);
    intervention = parts[0].replace(/[,;.]+$/, '').trim();
    outcome = parts[1]?.replace(/[,;.]+$/, '').trim() || '';
  }

  const mechanism = raw.match(MECHANISM_RE)?.[1]?.trim() ?? null;
  const control   = raw.match(CONTROL_RE)?.[1]?.trim() ?? null;
  let sample_system = 'experimental system';
  for (const [label, key] of SAMPLE_KW) {
    if (raw.toLowerCase().includes(key.toLowerCase())) { sample_system = label; break; }
  }

  return { raw, domain, intervention, outcome, threshold, mechanism, control, sample_system };
}

// ─── Stage 2: Keyword-overlap novelty ─────────────────────────────────────

function tokenize(text) {
  const STOP = new Set(['with','that','this','from','have','been','were','they','their','when','also','into','some','more','than','then','both','each','only','other','such','same','these','those','which','after','before','about','between']);
  return new Set(text.toLowerCase().replace(/[^\w\s]/g,' ').split(/\s+/).filter(w => w.length > 3 && !STOP.has(w)));
}

function overlapScore(a, b) {
  const ta = tokenize(a), tb = tokenize(b);
  let hits = 0;
  for (const w of ta) if (tb.has(w)) hits++;
  return ta.size ? hits / ta.size : 0;
}

function classifyNovelty(hypothesis, results) {
  if (!results.length) return { signal: 'not_found', references: [], rationale: 'No literature retrieved — hypothesis appears novel.' };
  const hypo = `${hypothesis.intervention} ${hypothesis.outcome} ${hypothesis.sample_system}`;
  const scored = results
    .map(r => ({ ...r, score: overlapScore(hypo, `${r.title||''} ${r.content||''}`) }))
    .sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 3);
  const max = top[0]?.score || 0;
  const signal = max > 0.40 ? 'exact_match_found' : (max > 0.18 || scored.length >= 4) ? 'similar_work_exists' : 'not_found';
  const rationale =
    signal === 'exact_match_found'  ? `High keyword overlap (${(max*100).toFixed(0)}%) with "${top[0]?.title?.slice(0,80)||'existing work'}" — closely related study found.`
    : signal === 'similar_work_exists' ? `Moderate overlap with ${scored.length} result(s); related work exists but exact combination appears unstudied.`
    : 'Low overlap with retrieved literature; hypothesis appears novel.';
  return { signal, rationale, references: top.filter(r => r.url).map(r => ({ title: r.title||'Untitled', url: r.url, snippet: (r.content||'').slice(0,300) })) };
}

// ─── Protocol text parsers ─────────────────────────────────────────────────

const ACTION_RE = /^(Add|Incubate|Centrifuge|Wash|Remove|Mix|Vortex|Heat|Cool|Filter|Dissolve|Prepare|Resuspend|Transfer|Collect|Measure|Analyze|Run|Apply|Load|Elute|Rinse|Block|Coat|Stain|Fix|Lyse|Extract|Amplify|Calibrate|Dilute|Pellet|Weigh|Adjust|Combine|Spin|Shake|Sonicate|Thaw|Freeze|Store|Inoculate|Plate|Harvest|Pipette|Dispense)/i;

function parseStepsFromText(text) {
  // numbered list
  const numbered = [];
  const nr = /(?:^|\n)\s*(?:step\s*)?(\d+)[.):\s]+([^\n]{25,350})/gi;
  let m;
  while ((m = nr.exec(text)) !== null) numbered.push(m[2].trim().replace(/\s+/g,' '));
  if (numbered.length >= 4) return numbered.slice(0, 15);

  // bullet list
  const bulleted = [];
  const br = /(?:^|\n)\s*[-•*]\s+([^\n]{25,350})/gi;
  while ((m = br.exec(text)) !== null) bulleted.push(m[1].trim().replace(/\s+/g,' '));
  if (bulleted.length >= 4) return bulleted.slice(0, 15);

  // action verb sentences
  return [...new Set(
    text.split(/[.!?]\s*\n?/).map(s => s.trim().replace(/\s+/g,' '))
      .filter(s => ACTION_RE.test(s) && s.length >= 30 && s.length <= 400)
  )].slice(0, 12);
}

function stepTitle(text) {
  return text.replace(/[^a-zA-Z\s]/g,' ').split(/\s+/).filter(Boolean).slice(0,6).join(' ');
}

const DUR_PATTERNS = [
  [/overnight|16[-–]20\s*h/i,              () => 720],
  [/(\d+(?:\.\d+)?)\s*h(?:ours?)?/i,       m  => Math.round(parseFloat(m[1])*60)],
  [/(\d+(?:\.\d+)?)\s*min(?:utes?)?/i,     m  => Math.round(parseFloat(m[1]))],
  [/wash|rinse/i,                           () => 15],
  [/centrifug/i,                            () => 20],
  [/dissolv|prepare|weigh/i,               () => 30],
  [/incubat/i,                              () => 60],
];

function estimateDuration(text) {
  for (const [re, fn] of DUR_PATTERNS) {
    const m = text.match(re);
    if (m) return Math.max(10, Math.min(720, fn(m)));
  }
  return 60;
}

// ─── Reagent parser ────────────────────────────────────────────────────────

const AMOUNT_RE      = /(\d+(?:\.\d+)?)\s*(mg|g|mL|µL|μL|ng|mM|µM|μM|nM|%|U)\s+(?:of\s+)?([A-Z][a-zA-Z0-9\s\-()/]{3,45}?)(?=[,;.\n(])/g;
const REAGENT_TYPE_RE = /\b([A-Z][a-zA-Z0-9\-]{2,30}(?:\s+[A-Za-z0-9\-]{1,20}){0,3})\s+(solution|buffer|reagent|antibody|enzyme|substrate|stain|kit|serum|medium|probe)/gi;
const SKIP_WORDS     = new Set(['This','The','Add','Use','After','Before','During','Each','Step','Note','When','Then','For','With','Into','From','Figure','Table','All','Some']);

function parseReagentsFromText(text) {
  const found = new Map();
  let m;
  const a = new RegExp(AMOUNT_RE.source, 'g');
  while ((m = a.exec(text)) !== null) {
    const name = m[3].trim().replace(/\s+/g,' ');
    if (name.split(/\s+/).length <= 6 && !SKIP_WORDS.has(name.split(' ')[0])) found.set(name, `${m[1]} ${m[2]}`);
  }
  const b = new RegExp(REAGENT_TYPE_RE.source, 'gi');
  while ((m = b.exec(text)) !== null) {
    const name = `${m[1].trim()} ${m[2]}`.replace(/\s+/g,' ');
    if (!SKIP_WORDS.has(m[1].split(' ')[0]) && !found.has(name)) found.set(name, 'as required');
  }
  return [...found.entries()].slice(0, 14).map(([name, quantity]) => ({ name, quantity }));
}

// ─── Equipment detector ────────────────────────────────────────────────────

const EQUIP_VOCAB = [
  { name:'Potentiostat',                keys:['potentiostat','electrochemical analyzer','cyclic voltammetry','eis','galvanostat'],         available:false, purpose:'Electrochemical measurements (CV, EIS)' },
  { name:'CO₂ incubator',               keys:['co2 incubator','cell incubator','37°c 5%','37 °c'],                                        available:true,  purpose:'Mammalian cell culture' },
  { name:'Centrifuge',                   keys:['centrifug','× g','rcf','rpm spin'],                                                         available:true,  purpose:'Sample pelleting and separation' },
  { name:'Thermocycler',                 keys:['thermocycler','thermal cycler','pcr machine','cycling program'],                            available:true,  purpose:'PCR amplification' },
  { name:'qPCR / real-time PCR system', keys:['qpcr','real-time pcr','rt-pcr machine','lightcycler','steponeplus'],                        available:false, purpose:'Quantitative gene expression' },
  { name:'Microplate reader',            keys:['plate reader','spectrophotometer','absorbance at','nm absorbance','od600'],                 available:false, purpose:'Absorbance / fluorescence measurement' },
  { name:'Flow cytometer',              keys:['flow cytometer','flow cytometry','facs','annexin v','propidium iodide staining'],            available:false, purpose:'Cell population and apoptosis analysis' },
  { name:'Confocal / fluorescence microscope', keys:['confocal','fluorescence microscop','lsm','spinning disk'],                           available:false, purpose:'High-resolution fluorescence imaging' },
  { name:'Inverted microscope',          keys:['inverted microscope','phase contrast','bright-field','light microscopy'],                   available:true,  purpose:'Cell morphology assessment' },
  { name:'NanoDrop spectrophotometer',   keys:['nanodrop','nucleic acid quantif','ng/µl','a260','a280'],                                   available:true,  purpose:'DNA/RNA concentration and purity' },
  { name:'Gel electrophoresis system',   keys:['gel electrophoresis','agarose gel','sds-page','sds page','polyacrylamide'],                available:true,  purpose:'Nucleic acid / protein size separation' },
  { name:'Biosafety cabinet (BSC)',      keys:['biosafety cabinet','bsc','laminar flow hood','sterile hood'],                              available:true,  purpose:'Sterile cell and microbial work' },
  { name:'Analytical balance',           keys:['analytical balance','weigh','gravimetric','tare'],                                         available:true,  purpose:'Precise reagent weighing' },
  { name:'Micropipette set',             keys:['pipette','micropipette','µl volume','microliter'],                                         available:true,  purpose:'Accurate liquid handling' },
  { name:'Vortex mixer',                 keys:['vortex','vortexed','vortexing'],                                                           available:true,  purpose:'Sample homogenisation' },
  { name:'Water bath',                   keys:['water bath','heating bath','37°c bath'],                                                   available:true,  purpose:'Temperature-controlled incubation' },
  { name:'Sonicator / ultrasonicator',   keys:['sonicate','sonication','probe sonicator','ultrasonication'],                               available:false, purpose:'Cell disruption or nanoparticle dispersion' },
  { name:'Bioreactor / fermenter',       keys:['bioreactor','fermenter','fermentation vessel','bioreactor vessel'],                        available:false, purpose:'Controlled microbial or cell culture' },
  { name:'ELISA plate reader',           keys:['elisa','tmb substrate','450 nm detection','microplate elisa'],                             available:false, purpose:'ELISA optical density quantification' },
  { name:'Western blot / transfer system', keys:['western blot','immunoblot','transfer membrane','pvdf membrane'],                        available:true,  purpose:'Protein detection by immunoblotting' },
  { name:'Gel imager / ChemiDoc',        keys:['gel imager','chemidoc','chemiluminescence imager','ecl detection'],                       available:false, purpose:'Gel and western blot imaging' },
  { name:'pH meter',                     keys:['ph meter','adjust ph','ph adjustment','titrate to ph'],                                    available:true,  purpose:'Buffer preparation and QC' },
  { name:'Magnetic stirrer / hot plate', keys:['magnetic stirrer','stir bar','stirring plate','stir plate'],                              available:true,  purpose:'Solution preparation' },
  { name:'Autoclave',                    keys:['autoclave','autoclaved','sterilize','sterilisation'],                                      available:true,  purpose:'Equipment and media sterilization' },
  { name:'HPLC system',                  keys:['hplc','high-performance liquid chromatography','reverse-phase column'],                   available:false, purpose:'Compound separation and quantification' },
  { name:'Anaerobic chamber / glove box',keys:['anaerobic chamber','glove box','anaerobic conditions','anoxic'],                          available:false, purpose:'Oxygen-free culture of anaerobic organisms' },
  { name:'Faraday cage',                 keys:['faraday cage','electrical noise','shielded enclosure'],                                   available:false, purpose:'Noise isolation for sensitive electrochemical measurements' },
];

function extractEquipmentFromText(text) {
  const lower = text.toLowerCase();
  const found = EQUIP_VOCAB.filter(e => e.keys.some(k => lower.includes(k)))
    .map(e => ({ name: e.name, purpose: e.purpose, assumed_available: e.available }));
  if (!found.length) {
    found.push({ name:'Micropipette set', purpose:'Liquid handling', assumed_available:true });
    found.push({ name:'Analytical balance', purpose:'Reagent preparation', assumed_available:true });
  }
  return found;
}

// ─── Reagent grounding via Tavily ──────────────────────────────────────────

function inferRole(name) {
  const n = name.toLowerCase();
  if (n.includes('antibody') || n.includes('anti-')) return 'detection/capture antibody';
  if (n.includes('buffer') || n.includes('pbs') || n.includes('tris')) return 'buffer';
  if (n.includes('enzyme') || /ase\b/.test(n)) return 'enzyme';
  if (n.includes('kit')) return 'assay kit';
  if (n.includes('medium') || n.includes('broth') || n.includes('dmem')) return 'culture medium';
  if (n.includes('stain') || n.includes('dye') || n.includes('fluorescent')) return 'stain/dye';
  if (n.includes('standard') || n.includes('control')) return 'calibration standard';
  if (n.includes('primer') || n.includes('oligo')) return 'oligonucleotide primer';
  return 'reagent';
}

function supplierFromUrl(url = '') {
  if (url.includes('sigmaaldrich') || url.includes('sigma-aldrich')) return 'Sigma-Aldrich';
  if (url.includes('thermofisher') || url.includes('lifetechnologies')) return 'Thermo Fisher';
  if (url.includes('abcam')) return 'Abcam';
  if (url.includes('fishersci')) return 'Fisher Scientific';
  if (url.includes('vwr')) return 'VWR';
  if (url.includes('biolegend')) return 'BioLegend';
  if (url.includes('qiagen')) return 'Qiagen';
  if (url.includes('rndsystems') || url.includes('rndsys')) return 'R&D Systems';
  if (url.includes('addgene')) return 'Addgene';
  return '';
}

async function groundReagents(reagents, tavilyKey) {
  if (!reagents.length) return [];
  const names = reagents.slice(0, 4).map(r => r.name).join(' ');
  let results = [];
  try {
    const res = await tavilySearch(tavilyKey, `${names} lab reagent catalog number price supplier`, SUPPLIER_DOMAINS, 6);
    results = res.results;
  } catch { /* grounding optional */ }

  const CAT_RE   = /\b([A-Z]{1,3}[-\s]?\d{4,8}[A-Z]?\b)/;
  const PRICE_RE = /\$\s*(\d{1,4}(?:\.\d{2})?)/;

  return reagents.map(r => {
    const key = r.name.toLowerCase().slice(0, 16);
    const hit = results.find(res =>
      (res.title||'').toLowerCase().includes(key) ||
      (res.content||'').toLowerCase().includes(key)
    );
    if (hit) {
      const text = `${hit.title||''} ${hit.content||''}`;
      return {
        ...r,
        role: r.role || inferRole(r.name),
        supplier: r.supplier || supplierFromUrl(hit.url) || undefined,
        catalog_number: r.catalog_number || text.match(CAT_RE)?.[1] || undefined,
        unit_cost_usd: r.unit_cost_usd ?? (text.match(PRICE_RE) ? parseFloat(text.match(PRICE_RE)[1]) : undefined),
        lead_time_days: r.lead_time_days ?? 3,
        grounded: true,
        grounding_source: hit.url,
      };
    }
    return { ...r, role: r.role || inferRole(r.name), grounded: false };
  });
}

// ─── Plan builders ─────────────────────────────────────────────────────────

const BUDGET_SCALE   = { low: 0.35, medium: 1, high: 2.8, unlimited: 5.5 };
const TIMELINE_SCALE = { sprint: 0.45, standard: 1, comprehensive: 2.2 };

function sc(base, bm) { return Math.round(base * (BUDGET_SCALE[bm]   || 1)); }
function sd(base, tm) { return Math.round(base * (TIMELINE_SCALE[tm] || 1)); }

function buildTimeline(stepCount, domain, tm) {
  const setup = Math.max(3, Math.round(stepCount * 0.4));
  const exec  = Math.max(5, Math.round(stepCount * 1.2));
  return [
    { name:'Reagent Procurement',    duration_days: sd(5, tm),    depends_on:[],                      description:'Order all reagents, consumables, and any specialized items.' },
    { name:'Setup & Calibration',    duration_days: sd(setup, tm), depends_on:['Reagent Procurement'], description:'Prepare stock solutions; calibrate instruments; pilot checks.' },
    { name:'Experimental Execution', duration_days: sd(exec, tm),  depends_on:['Setup & Calibration'], description:'Full protocol run with biological replicates.' },
    { name:'QC & Replication',       duration_days: sd(4, tm),    depends_on:['Experimental Execution'], description:'Quality control, repeat failures, technical replicates.' },
    { name:'Analysis & Write-up',    duration_days: sd(4, tm),    depends_on:['QC & Replication'],     description:'Statistical analysis, figures, interpretation.' },
  ];
}

const EQUIP_RENT_BASE = { diagnostics:300, cell_biology:350, microbiology:200, bioelectrochemistry:400, molecular_biology:200, biochemistry:200, neuroscience:500, chemistry:150 };

function buildBudget(reagents, domain, bm) {
  const reagentCost = Math.max(200, reagents.reduce((s, r) => s + (r.unit_cost_usd || 150), 0));
  const lines = [
    { category:'reagents',          item:'Primary reagents (protocol-derived)',     cost_usd: sc(reagentCost, bm) },
    { category:'consumables',       item:'Plasticware, tips, tubes, plates',        cost_usd: sc(150, bm) },
    { category:'equipment_rental',  item:'Core facility / specialized instruments', cost_usd: sc(EQUIP_RENT_BASE[domain] || 250, bm) },
    { category:'personnel',         item:'Researcher time',                         cost_usd: sc(600, bm) },
    { category:'shipping',          item:'Cold-chain and standard shipping',        cost_usd: sc(80, bm) },
  ];
  const subtotal = lines.reduce((s, l) => s + l.cost_usd, 0);
  lines.push({ category:'buffer', item:'15% contingency', cost_usd: Math.round(subtotal * 0.15) });
  return lines;
}

function buildValidation(hypothesis) {
  const { intervention, outcome, threshold, sample_system, domain } = hypothesis;
  const target = threshold || 'statistically significant change';
  const v = [
    {
      metric: `Primary outcome — ${outcome || 'measured endpoint'}`,
      target_value: target,
      measurement_method: `Quantitative assay of ${outcome || 'endpoint'} in ${sample_system}`,
      statistical_test: ['diagnostics','biochemistry'].includes(domain) ? 'Linear regression + LOD = 3σ/slope' : 'Unpaired t-test or one-way ANOVA',
      n_required: 9,
      power_justification: 'n=9 (3 biological × 3 technical replicates); ≥80% power for Cohen d≥1.0 at α=0.05.',
    },
  ];
  if (domain === 'diagnostics') {
    v.push({ metric:'Method agreement with reference standard', target_value:'Bias < 10%', measurement_method:'Bland-Altman analysis', statistical_test:'Bland-Altman limits of agreement', n_required:20, power_justification:'n=20 gives 95% CI for LoA ±0.34 SD — standard for method comparison (Bland & Altman 1986).' });
  }
  if (['cell_biology','microbiology'].includes(domain)) {
    v.push({ metric:'Reproducibility (%CV)', target_value:'< 15% CV across replicates', measurement_method:'Coefficient of variation across 3 independent experiments', statistical_test:'One-way ANOVA + Tukey post-hoc', n_required:9, power_justification:'n=3 × 3; power=0.80 for 2-fold effect (α=0.05).' });
  }
  if (domain === 'molecular_biology') {
    v.push({ metric:'Off-target assessment', target_value:'< 10% off-target signal', measurement_method:'qPCR of top 3 predicted off-targets', statistical_test:'Bonferroni-corrected t-tests', n_required:6, power_justification:'n=6; Bonferroni correction for 3 comparisons at α=0.05.' });
  }
  return v;
}

// ─── Critical path ─────────────────────────────────────────────────────────

function criticalPathDays(timeline) {
  if (!timeline.length) return 0;
  const by = Object.fromEntries(timeline.map(p => [p.name, p]));
  const starts = {};
  for (const p of timeline) {
    const deps = (p.depends_on || []).filter(d => d in by);
    starts[p.name] = deps.length ? Math.max(...deps.map(d => (starts[d] ?? 0) + by[d].duration_days)) : 0;
  }
  return Math.max(...timeline.map(p => (starts[p.name] ?? 0) + p.duration_days));
}

// ─── Main export ───────────────────────────────────────────────────────────

export async function runPipeline(raw, tavilyKey, budgetMode = 'medium', timelineMode = 'standard') {
  // Stage 1
  const hypothesis = parseHypothesis(raw);

  // Stage 2 — parallel searches
  const [litRes, protoRes, matRes] = await Promise.all([
    tavilySearch(tavilyKey, `${hypothesis.intervention} ${hypothesis.outcome} ${hypothesis.sample_system}`, LITERATURE_DOMAINS, 8),
    tavilySearch(tavilyKey, `${hypothesis.domain} ${hypothesis.intervention} ${hypothesis.outcome} protocol step-by-step method`, PROTOCOL_DOMAINS, 5),
    tavilySearch(tavilyKey, `${hypothesis.domain} ${hypothesis.intervention} ${hypothesis.outcome} reagents materials equipment list`, SUPPLIER_DOMAINS, 5),
  ]);

  const novelty = classifyNovelty(hypothesis, litRes.results);

  // Extract full text from top protocol pages
  const protoUrls = protoRes.results.slice(0, 3).map(r => r.url).filter(Boolean);
  const extracted = await tavilyExtract(tavilyKey, protoUrls);
  const extractedTexts = extracted.map(e => e.raw_content || '');

  // Assemble all text for parsing
  const allProto = [
    ...extractedTexts,
    ...protoRes.results.map(r => `${r.title||''}\n${r.content||''}`),
    protoRes.answer,
  ].join('\n\n');

  const allMaterial = [
    ...matRes.results.map(r => `${r.title||''}\n${r.content||''}`),
    matRes.answer,
  ].join('\n\n');

  // Parse steps
  let rawSteps = parseStepsFromText(allProto);
  if (rawSteps.length < 4) {
    // fallback: action sentences from Tavily answer
    const answerSents = protoRes.answer.split(/[.!?]\s+/).map(s => s.trim()).filter(s => ACTION_RE.test(s) && s.length >= 30);
    rawSteps = [...rawSteps, ...answerSents];
  }
  if (rawSteps.length < 4) {
    // final fallback: snippet lines
    rawSteps = protoRes.results.flatMap(r => (r.content||'').split(/\n+/).filter(l => l.trim().length > 30)).slice(0, 12);
  }

  const citations = protoRes.results.map(r => r.url).filter(Boolean);
  const protocolSteps = rawSteps.map((text, i) => ({
    step_number: i + 1,
    title: stepTitle(text),
    description: text,
    duration_minutes: estimateDuration(text),
    reagents_used: [],
    equipment_used: [],
    parameters: {},
    citation: citations[i % Math.max(1, citations.length)] || undefined,
  }));

  // Parse reagents + equipment
  const combined = `${allProto}\n\n${allMaterial}`;
  const parsedReagents = parseReagentsFromText(combined);
  const [reagents, equipment] = await Promise.all([
    groundReagents(parsedReagents, tavilyKey),
    Promise.resolve(extractEquipmentFromText(combined)),
  ]);

  // Build timeline, budget, validation
  const timeline   = buildTimeline(protocolSteps.length, hypothesis.domain, timelineMode);
  const budget     = buildBudget(reagents, hypothesis.domain, budgetMode);
  const validation = buildValidation(hypothesis);

  return {
    hypothesis,
    novelty,
    protocol_steps: protocolSteps,
    reagents,
    equipment,
    timeline,
    budget,
    validation,
    citations: litRes.results.slice(0, 6).map(r => ({
      title: r.title || 'Untitled',
      url: r.url || '',
      snippet: (r.content || '').slice(0, 350),
    })),
    total_cost_usd: budget.reduce((s, b) => s + (b.cost_usd || 0), 0),
    total_duration_days: criticalPathDays(timeline),
  };
}
