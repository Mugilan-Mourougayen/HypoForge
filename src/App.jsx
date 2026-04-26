import { useEffect, useRef, useState } from 'react';

// ─── Sample hypotheses ─────────────────────────────────────────────────────

const SAMPLES = [
  {
    label: '🩸 Paper biosensor for CRP detection',
    q: 'A paper-based electrochemical biosensor functionalized with anti-CRP antibodies will detect C-reactive protein in whole blood at concentrations below 0.5 mg/L within 10 minutes, matching laboratory ELISA sensitivity without requiring sample preprocessing.',
    budget: 'medium',
    timeline: 'standard',
  },
  {
    label: '🦠 Probiotic gut permeability (mice)',
    q: 'Supplementing C57BL/6 mice with Lactobacillus rhamnosus GG for 4 weeks will reduce intestinal permeability by at least 30% compared to controls, measured by FITC-dextran assay, due to upregulation of tight junction proteins claudin-1 and occludin.',
    budget: 'medium',
    timeline: 'standard',
  },
  {
    label: '🧊 Trehalose cryoprotectant for HeLa cells',
    q: 'Replacing sucrose with trehalose as a cryoprotectant in the freezing medium will increase post-thaw viability of HeLa cells by at least 15 percentage points compared to the standard DMSO protocol, due to trehalose membrane stabilization at low temperatures.',
    budget: 'low',
    timeline: 'sprint',
  },
  {
    label: '🌿 Sporomusa CO₂ fixation bioreactor',
    q: 'Introducing Sporomusa ovata into a bioelectrochemical system at a cathode potential of -400mV vs SHE will fix CO2 into acetate at a rate of at least 150 mmol/L/day, outperforming current biocatalytic carbon capture benchmarks by at least 20%.',
    budget: 'high',
    timeline: 'comprehensive',
  },
];

// ─── Review dimensions (from reference/schemas.py ReviewDimension enum) ───

const REVIEW_DIMENSIONS = [
  { key: 'scientific_validity', label: 'Scientific Validity', icon: '🔬',
    hint: 'Is the hypothesis logically sound? Are the proposed methods appropriate to test the stated claim?' },
  { key: 'operational_feasibility', label: 'Operational Feasibility', icon: '🏗️',
    hint: 'Can this actually be executed in a real lab with the described resources and timeline?' },
  { key: 'resource_realism', label: 'Resource Realism', icon: '💰',
    hint: 'Are the reagent choices, costs, and equipment availability realistic and well-sourced?' },
  { key: 'statistical_adequacy', label: 'Statistical Adequacy', icon: '📊',
    hint: 'Are sample sizes justified? Are the statistical tests appropriate for the data structure?' },
  { key: 'safety_compliance', label: 'Safety & Compliance', icon: '⚠️',
    hint: 'Are relevant safety, ethical, and regulatory requirements identified and addressed?' },
];

// ─── Loading steps ─────────────────────────────────────────────────────────

const LOADING_STEPS = [
  { icon: '🔬', label: 'Parsing hypothesis structure' },
  { icon: '🔍', label: 'Literature QC — novelty check' },
  { icon: '📚', label: 'Protocol grounding — fetching methods' },
  { icon: '🧪', label: 'Synthesizing experiment plan' },
  { icon: '🧬', label: 'Grounding reagents & finalising' },
];

// ─── API helper ────────────────────────────────────────────────────────────

async function apiJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

// ─── Budget helpers ────────────────────────────────────────────────────────

const CATEGORY_LABELS = {
  reagents: 'Reagents',
  consumables: 'Consumables',
  equipment_rental: 'Equipment rental',
  personnel: 'Personnel',
  services: 'Services',
  shipping: 'Shipping',
  buffer: 'Contingency buffer',
  other: 'Other',
};

function groupBudget(budget) {
  const groups = {};
  for (const item of budget) {
    const cat = item.category || 'other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(item);
  }
  return groups;
}

// ─── Novelty display helpers ───────────────────────────────────────────────

const NOVELTY_CONFIG = {
  not_found: { cls: 'novel', label: '● Novel', badge: 'not_found', desc: 'No identical studies found in the literature.' },
  similar_work_exists: { cls: 'similar', label: '◐ Similar work', badge: 'similar', desc: 'Related studies exist but this hypothesis is not an exact match.' },
  exact_match_found: { cls: 'exact', label: '✕ Exact match', badge: 'exact', desc: 'A published study tests essentially this same hypothesis.' },
};

// ─── App ───────────────────────────────────────────────────────────────────

function App() {
  const [page, setPage] = useState('plan');
  const [question, setQuestion] = useState('');
  const [budget, setBudget] = useState('medium');
  const [timeline, setTimeline] = useState('standard');
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [error, setError] = useState('');
  const [plan, setPlan] = useState(null);
  const [feedbackList, setFeedbackList] = useState([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [reviewState, setReviewState] = useState({});
  const [activeSection, setActiveSection] = useState('secQC');
  const loadingTimer = useRef(null);

  useEffect(() => { loadFeedback(); }, []);

  async function loadFeedback() {
    setFeedbackLoading(true);
    try {
      const data = await apiJson('/api/feedback?limit=50');
      setFeedbackList(data.feedback || []);
    } catch (err) {
      setError(err.message || 'Could not load saved reviews.');
    } finally {
      setFeedbackLoading(false);
    }
  }

  function fillSample(sample) {
    setQuestion(sample.q);
    setBudget(sample.budget);
    setTimeline(sample.timeline);
  }

  async function runPlan() {
    if (question.trim().length < 20) {
      setError('Please enter a more complete scientific hypothesis.');
      return;
    }
    setLoading(true);
    setLoadingStep(0);
    setError('');

    let step = 0;
    loadingTimer.current = setInterval(() => {
      step = Math.min(step + 1, LOADING_STEPS.length - 1);
      setLoadingStep(step);
    }, 4000);

    try {
      const result = await apiJson('/api/pipeline', {
        method: 'POST',
        body: JSON.stringify({ raw: question, budget, timeline_mode: timeline }),
      });
      setPlan(result);
      setReviewState({});
      setActiveSection('secQC');
      setPage('results');
    } catch (err) {
      setError(err.message || 'Could not generate the plan.');
    } finally {
      clearInterval(loadingTimer.current);
      setLoading(false);
    }
  }

  function scrollToSection(id) {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function updateDimension(key, patch) {
    setReviewState(cur => ({ ...cur, [key]: { ...(cur[key] || {}), ...patch } }));
  }

  async function saveReview() {
    if (!plan) return;
    const sections = {};
    for (const dim of REVIEW_DIMENSIONS) {
      const s = reviewState[dim.key];
      if (s?.annotation || s?.correction || s?.rating || s?.approved !== undefined) {
        sections[dim.key] = {
          label: dim.label,
          approved: s.approved !== false,
          rating: s.rating || 0,
          annotation: s.annotation || '',
          correction: s.correction || '',
        };
      }
    }
    try {
      await apiJson('/api/feedback', {
        method: 'POST',
        body: JSON.stringify({
          timestamp: new Date().toISOString(),
          question: plan.hypothesis?.raw || '',
          domain: plan.hypothesis?.domain || '',
          sections,
          overallRating: Number(reviewState.overallRating || 0),
          overallComment: reviewState.overallComment || '',
        }),
      });
      await loadFeedback();
      setPage('feedback');
    } catch (err) {
      setError(err.message || 'Could not save review.');
    }
  }

  async function deleteFeedback(id) {
    try {
      await apiJson(`/api/feedback/${id}`, { method: 'DELETE' });
      await loadFeedback();
    } catch (err) {
      setError(err.message || 'Could not delete review.');
    }
  }

  async function clearFeedback() {
    try {
      await apiJson('/api/feedback', { method: 'DELETE' });
      await loadFeedback();
    } catch (err) {
      setError(err.message || 'Could not clear reviews.');
    }
  }

  // Derived plan values
  const noveltySignal = plan?.novelty?.signal || 'not_found';
  const noveltyCfg = NOVELTY_CONFIG[noveltySignal] || NOVELTY_CONFIG.not_found;
  const budgetGroups = plan ? groupBudget(plan.budget || []) : {};
  const equipNeeded = plan?.equipment?.filter(e => !e.assumed_available) || [];

  return (
    <div>
      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <header>
        <div className="logo">
          <div className="logo-dot" />
          HypoForge
        </div>
        <nav className="nav-tabs">
          <button className={`nav-tab${page === 'plan' ? ' active' : ''}`} onClick={() => setPage('plan')}>
            ⚗️ New Plan
          </button>
          <button className={`nav-tab${page === 'results' ? ' active' : ''}`} onClick={() => setPage('results')} disabled={!plan}>
            📋 Protocol
          </button>
          <button className={`nav-tab${page === 'review' ? ' active' : ''}`} onClick={() => setPage('review')} disabled={!plan}>
            🔬 Review
          </button>
          <button className={`nav-tab${page === 'feedback' ? ' active' : ''}`} onClick={() => setPage('feedback')}>
            🧠 Learning Loop
          </button>
        </nav>
        <div className="header-badge">Powered by Tavily</div>
      </header>

      {/* ─── Loading overlay ─────────────────────────────────────────────── */}
      {loading && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
          <div className="loading-title">Generating Protocol…</div>
          <ul className="loading-steps">
            {LOADING_STEPS.map((s, i) => (
              <li key={i} className={`lstep${i === loadingStep ? ' active' : i < loadingStep ? ' done' : ''}`}>
                <span className="lstep-icon">{s.icon}</span>
                {s.label}
              </li>
            ))}
          </ul>
        </div>
      )}

      <main>
        {error && <div className="err-box">{error} <button className="err-close" onClick={() => setError('')}>×</button></div>}

        {/* ═══ PLAN PAGE ══════════════════════════════════════════════════ */}
        {page === 'plan' && (
          <div>
            <div className="page-header">
              <div className="page-title">From Hypothesis to Runnable Experiment</div>
              <div className="page-sub">
                Enter a scientific hypothesis. HypoForge parses it with built-in rules, QCs it against real literature via Tavily, then generates a complete operationally-realistic protocol — grounded in published methods and reagent catalogs.
              </div>
            </div>

            <div className="card">
              <div className="card-title">Scientific Hypothesis</div>
              <div className="hypo-helper">
                <strong>What makes a strong hypothesis?</strong> Name a specific intervention, state a measurable outcome with a threshold, give a mechanistic reason, and imply a clear control.
              </div>
              <label>Try a sample hypothesis <span className="hint">click to auto-fill</span></label>
              <div className="hypo-chips">
                {SAMPLES.map((s, i) => (
                  <button key={i} className="hypo-chip" onClick={() => fillSample(s)}>{s.label}</button>
                ))}
              </div>
              <label>Enter your hypothesis</label>
              <textarea
                value={question}
                onChange={e => setQuestion(e.target.value)}
                placeholder="State your hypothesis precisely — include intervention, measurable outcome with threshold, mechanism, and control condition…"
              />
            </div>

            <div className="card">
              <div className="card-title">Experiment Parameters</div>
              <div className="grid-3">
                <div>
                  <label>Budget Range</label>
                  <select value={budget} onChange={e => setBudget(e.target.value)}>
                    <option value="low">Constrained ($500–$2k)</option>
                    <option value="medium">Standard ($2k–$10k)</option>
                    <option value="high">Well-funded ($10k–$50k)</option>
                    <option value="unlimited">Core Facility (uncapped)</option>
                  </select>
                </div>
                <div>
                  <label>Timeline</label>
                  <select value={timeline} onChange={e => setTimeline(e.target.value)}>
                    <option value="sprint">Sprint (2–4 weeks)</option>
                    <option value="standard">Standard (2–3 months)</option>
                    <option value="comprehensive">Comprehensive (6+ months)</option>
                  </select>
                </div>
                <div className="plan-info-box">
                  <div className="plan-info-label">Pipeline</div>
                  <div className="plan-info-text">Regex parsing → Tavily literature + protocol search → Template synthesis with reagent grounding</div>
                </div>
              </div>
              <button className="run-btn" onClick={runPlan} disabled={loading}>
                ⚡ Run Literature QC + Generate Protocol
              </button>
            </div>
          </div>
        )}

        {/* ═══ RESULTS PAGE ═══════════════════════════════════════════════ */}
        {page === 'results' && plan && (
          <div>
            <div className="export-row">
              <button className="export-btn new-btn" onClick={() => setPage('plan')}>+ New Plan</button>
              <button className="export-btn" onClick={() => setPage('review')}>🔬 Review this Plan</button>
              {plan.total_duration_days > 0 && (
                <span className="duration-badge">⏱ {Math.round(plan.total_duration_days)} days critical path</span>
              )}
              {plan.total_cost_usd > 0 && (
                <span className="duration-badge">${Math.round(plan.total_cost_usd).toLocaleString()} estimated</span>
              )}
            </div>

            <div className="results-grid">
              {/* Sidebar */}
              <div className="sidebar">
                <div className="sidebar-title">Plan Sections</div>
                {[
                  { id: 'secQC', icon: '🔍', label: 'Literature QC' },
                  { id: 'secHypo', icon: '🔬', label: 'Hypothesis' },
                  { id: 'secPapers', icon: '📚', label: 'References' },
                ].map(({ id, icon, label }) => (
                  <button key={id} className={`sidebar-link${activeSection === id ? ' active' : ''}`} onClick={() => scrollToSection(id)}>
                    <span className="sl-icon">{icon}</span> {label}
                  </button>
                ))}
                <div className="sidebar-divider" />
                {[
                  { id: 'secProtocol', icon: '🧪', label: 'Protocol' },
                  { id: 'secEquipment', icon: '⚙️', label: `Equipment${equipNeeded.length ? ` (${equipNeeded.length} to source)` : ''}` },
                  { id: 'secMaterials', icon: '🧬', label: 'Reagents' },
                  { id: 'secBudget', icon: '💰', label: 'Budget' },
                  { id: 'secTimeline', icon: '📅', label: 'Timeline' },
                  { id: 'secValidation', icon: '✅', label: 'Validation' },
                ].map(({ id, icon, label }) => (
                  <button key={id} className={`sidebar-link${activeSection === id ? ' active' : ''}`} onClick={() => scrollToSection(id)}>
                    <span className="sl-icon">{icon}</span> {label}
                  </button>
                ))}
              </div>

              {/* Content */}
              <div>
                {/* Literature QC */}
                <div className="rcard" id="secQC">
                  <div className="rcard-header">
                    <div className="rcard-title"><span className="rcard-icon">🔍</span> Literature Quality Control</div>
                    <span className={`qc-badge ${noveltyCfg.cls}`}>{noveltyCfg.label}</span>
                  </div>
                  <div className={`novelty-bar ${noveltyCfg.cls}`}>
                    <div>
                      <div className={`novelty-signal ${noveltyCfg.cls}`}>{noveltyCfg.desc}</div>
                      <div className="novelty-desc" style={{ marginTop: 6 }}>{plan.novelty?.rationale}</div>
                    </div>
                  </div>
                  {plan.novelty?.references?.length > 0 && (
                    <div>
                      <div className="section-sep">Top references</div>
                      {plan.novelty.references.map((ref, i) => (
                        <div key={i} className="paper-item">
                          <div className="paper-title">{ref.title}</div>
                          {ref.snippet && <div className="paper-snippet">{ref.snippet}</div>}
                          {ref.url && <a href={ref.url} target="_blank" rel="noreferrer" className="paper-link">Open →</a>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Hypothesis Decomposition */}
                <div className="rcard" id="secHypo">
                  <div className="rcard-header">
                    <div className="rcard-title"><span className="rcard-icon">🔬</span> Hypothesis Decomposition</div>
                    {plan.hypothesis?.domain && <span className="domain-badge">{plan.hypothesis.domain.replace('_', ' ')}</span>}
                  </div>
                  <div className="var-grid">
                    <div className="var-block">
                      <div className="var-label">Intervention</div>
                      <div className="var-value">{plan.hypothesis?.intervention || '—'}</div>
                    </div>
                    <div className="var-block">
                      <div className="var-label">Outcome</div>
                      <div className="var-value">{plan.hypothesis?.outcome || '—'}</div>
                    </div>
                    <div className="var-block">
                      <div className="var-label">Sample System</div>
                      <div className="var-value">{plan.hypothesis?.sample_system || '—'}</div>
                    </div>
                  </div>
                  {plan.hypothesis?.threshold && (
                    <div className="var-block var-full">
                      <div className="var-label">Measurable Threshold</div>
                      <div className="var-value">{plan.hypothesis.threshold}</div>
                    </div>
                  )}
                  {plan.hypothesis?.mechanism && (
                    <div className="var-block var-full">
                      <div className="var-label">Proposed Mechanism</div>
                      <div className="var-value">{plan.hypothesis.mechanism}</div>
                    </div>
                  )}
                  {plan.hypothesis?.control && (
                    <div className="var-block var-full" style={{ marginBottom: 0 }}>
                      <div className="var-label">Control Condition</div>
                      <div className="var-value">{plan.hypothesis.control}</div>
                    </div>
                  )}
                </div>

                {/* References */}
                <div className="rcard" id="secPapers">
                  <div className="rcard-header">
                    <div className="rcard-title"><span className="rcard-icon">📚</span> Literature References</div>
                    <span className="paper-count">{plan.citations?.length || 0} retrieved</span>
                  </div>
                  {plan.citations?.length === 0 ? (
                    <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>No references returned for this query.</p>
                  ) : (
                    (plan.citations || []).map((paper, i) => (
                      <div key={i} className="paper-item">
                        <div className="paper-title">{paper.title}</div>
                        {paper.snippet && <div className="paper-snippet">{paper.snippet}</div>}
                        {paper.url && <a href={paper.url} target="_blank" rel="noreferrer" className="paper-link">Open source →</a>}
                      </div>
                    ))
                  )}
                </div>

                {/* Protocol Steps */}
                <div className="rcard" id="secProtocol">
                  <div className="rcard-header">
                    <div className="rcard-title"><span className="rcard-icon">🧪</span> Protocol Steps</div>
                    <span className="paper-count">{plan.protocol_steps?.length || 0} steps</span>
                  </div>
                  {(plan.protocol_steps || []).map(step => (
                    <div key={step.step_number} className="pstep">
                      <div className="pstep-num">{step.step_number}</div>
                      <div className="pstep-body">
                        <div className="pstep-title">{step.title}</div>
                        <div className="pstep-desc">{step.description}</div>
                        <div className="pstep-time">⏱ {step.duration_minutes} min</div>
                        {step.parameters && Object.keys(step.parameters).length > 0 && (
                          <div className="param-row">
                            {Object.entries(step.parameters).map(([k, v]) => (
                              <span key={k} className="param-tag">{k}: {String(v)}</span>
                            ))}
                          </div>
                        )}
                        {step.citation && (
                          <a href={step.citation} target="_blank" rel="noreferrer" className="step-cite">Protocol source →</a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Equipment */}
                <div className="rcard" id="secEquipment">
                  <div className="rcard-header">
                    <div className="rcard-title"><span className="rcard-icon">⚙️</span> Equipment</div>
                    {equipNeeded.length > 0 && (
                      <span className="qc-badge exact">{equipNeeded.length} to source</span>
                    )}
                  </div>
                  {(plan.equipment || []).map(eq => (
                    <div key={eq.name} className="equip-item">
                      <div>
                        <div className="equip-name">{eq.name}</div>
                        <div className="equip-purpose">{eq.purpose}</div>
                      </div>
                      <span className={`avail-badge ${eq.assumed_available ? 'available' : 'required'}`}>
                        {eq.assumed_available ? '✓ Standard' : '⚠ Source required'}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Reagents */}
                <div className="rcard" id="secMaterials">
                  <div className="rcard-header">
                    <div className="rcard-title"><span className="rcard-icon">🧬</span> Reagents & Supply Chain</div>
                    <span className="paper-count">
                      {(plan.reagents || []).filter(r => r.grounded).length} / {plan.reagents?.length || 0} catalog-verified
                    </span>
                  </div>
                  <table className="mat-table">
                    <thead>
                      <tr>
                        <th>Reagent</th>
                        <th>Supplier / Cat #</th>
                        <th>Qty</th>
                        <th>Est. Cost</th>
                        <th>Lead</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(plan.reagents || []).map(item => (
                        <tr key={item.name}>
                          <td>
                            <div className="mat-name">{item.name}</div>
                            <div className="mat-role">{item.role}</div>
                          </td>
                          <td>
                            {item.grounded
                              ? <span className="grounding-badge grounded">✓ Verified</span>
                              : <span className="grounding-badge ungrounded">Unverified</span>}
                            {item.catalog_number && (
                              <div className="mat-cat">{item.supplier} {item.catalog_number}</div>
                            )}
                          </td>
                          <td style={{ fontSize: '0.78rem', color: 'var(--ink2)' }}>{item.quantity}</td>
                          <td className="mat-price">
                            {item.unit_cost_usd != null ? `$${item.unit_cost_usd.toFixed(0)}` : '—'}
                          </td>
                          <td style={{ fontSize: '0.72rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                            {item.lead_time_days != null ? `${item.lead_time_days}d` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Budget */}
                <div className="rcard" id="secBudget">
                  <div className="rcard-header">
                    <div className="rcard-title"><span className="rcard-icon">💰</span> Budget Estimate</div>
                    {plan.total_cost_usd > 0 && (
                      <span className="total-cost-badge">${Math.round(plan.total_cost_usd).toLocaleString()} total</span>
                    )}
                  </div>
                  {Object.entries(budgetGroups).map(([cat, items]) => (
                    <div key={cat}>
                      <div className="budget-cat-header">{CATEGORY_LABELS[cat] || cat}</div>
                      <div className="budget-grid">
                        {items.map(item => (
                          <div key={item.item} className={`budget-item${item.category === 'buffer' ? ' budget-buffer' : ''}`}>
                            <div>
                              <div className="budget-label">{item.item}</div>
                              {item.notes && <div className="budget-notes">{item.notes}</div>}
                            </div>
                            <span className="budget-amount">${item.cost_usd?.toFixed(0)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {plan.total_cost_usd > 0 && (
                    <div className="budget-item budget-total" style={{ marginTop: 12 }}>
                      <span className="budget-label">Total</span>
                      <span className="budget-amount">${Math.round(plan.total_cost_usd).toLocaleString()}</span>
                    </div>
                  )}
                </div>

                {/* Timeline */}
                <div className="rcard" id="secTimeline">
                  <div className="rcard-header">
                    <div className="rcard-title"><span className="rcard-icon">📅</span> Timeline</div>
                    {plan.total_duration_days > 0 && (
                      <span className="paper-count">{Math.round(plan.total_duration_days)} days critical path</span>
                    )}
                  </div>
                  <div className="timeline">
                    {(plan.timeline || []).map((phase, i) => (
                      <div key={phase.name} className="tl-item">
                        <div className={`tl-dot${i === 0 ? ' done-dot' : ''}`} />
                        <div className="tl-phase">{phase.name}</div>
                        <div className="tl-title">{phase.duration_days} days — {phase.description?.split('.')[0]}</div>
                        <div className="tl-desc">{phase.description}</div>
                        {phase.depends_on?.length > 0 && (
                          <div className="tl-dep">After: {phase.depends_on.join(', ')}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Validation */}
                <div className="rcard" id="secValidation">
                  <div className="rcard-header">
                    <div className="rcard-title"><span className="rcard-icon">✅</span> Validation Criteria</div>
                  </div>
                  {(plan.validation || []).map((crit, i) => (
                    <div key={i} className="val-item">
                      <div className="val-icon">🎯</div>
                      <div>
                        <div className="val-title">{crit.metric}</div>
                        <div className="val-desc">{crit.measurement_method}</div>
                        <div className="val-target">Target: <strong>{crit.target_value}</strong></div>
                        <div className="val-tags">
                          {crit.statistical_test && <span className="tag">{crit.statistical_test}</span>}
                          {crit.n_required && <span className="tag">n = {crit.n_required}</span>}
                        </div>
                        {crit.power_justification && (
                          <div className="val-power">{crit.power_justification}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══ REVIEW PAGE ════════════════════════════════════════════════ */}
        {page === 'review' && plan && (
          <div>
            <div className="page-header">
              <div className="page-title">Scientific Review</div>
              <div className="page-sub">Rate each dimension of the generated protocol. Rejected cards with corrections feed the learning loop.</div>
            </div>

            <div className="review-section">
              <div className="rs-header">
                <div className="rs-title">🔬 Hypothesis under review</div>
              </div>
              <div className="rs-body">
                <div className="review-hypo">{plan.hypothesis?.raw}</div>
              </div>
            </div>

            {REVIEW_DIMENSIONS.map(dim => {
              const s = reviewState[dim.key] || {};
              return (
                <div key={dim.key} className="review-section">
                  <div className="rs-header">
                    <div className="rs-title">{dim.icon} {dim.label}</div>
                    <div className="rs-approve-row">
                      <button
                        className={`approve-btn${s.approved !== false ? ' approved' : ''}`}
                        onClick={() => updateDimension(dim.key, { approved: true })}
                      >✓ Approve</button>
                      <button
                        className={`reject-btn${s.approved === false ? ' rejected' : ''}`}
                        onClick={() => updateDimension(dim.key, { approved: false })}
                      >✕ Reject</button>
                    </div>
                  </div>
                  <div className="rs-body">
                    <div className="dim-hint">{dim.hint}</div>
                    <div className="star-row">
                      <span className="star-label">Rating</span>
                      <div className="stars">
                        {[1, 2, 3, 4, 5].map(n => (
                          <button key={n} className={`star${(s.rating || 0) >= n ? ' filled' : ''}`} onClick={() => updateDimension(dim.key, { rating: n })}>★</button>
                        ))}
                      </div>
                    </div>
                    <span className="annotation-label">Annotation</span>
                    <textarea className="annotation-box" placeholder="Notes on this dimension…"
                      value={s.annotation || ''} onChange={e => updateDimension(dim.key, { annotation: e.target.value })} />
                    {s.approved === false && (
                      <>
                        <span className="annotation-label correction-label">Correction (required for rejection)</span>
                        <textarea className="annotation-box correction-box" placeholder="What should change and how…"
                          value={s.correction || ''} onChange={e => updateDimension(dim.key, { correction: e.target.value })} />
                      </>
                    )}
                  </div>
                </div>
              );
            })}

            <div className="review-section">
              <div className="rs-header">
                <div className="rs-title">🌟 Overall Assessment</div>
              </div>
              <div className="rs-body">
                <div className="star-row">
                  <span className="star-label">Overall rating</span>
                  <div className="stars">
                    {[1, 2, 3, 4, 5].map(n => (
                      <button key={n} className={`star${(reviewState.overallRating || 0) >= n ? ' filled' : ''}`}
                        onClick={() => setReviewState(cur => ({ ...cur, overallRating: n }))}>★</button>
                    ))}
                  </div>
                </div>
                <span className="annotation-label">Overall comment</span>
                <textarea className="annotation-box" placeholder="Overall impression, strengths, and suggestions…"
                  value={reviewState.overallComment || ''}
                  onChange={e => setReviewState(cur => ({ ...cur, overallComment: e.target.value }))} />
                <div className="actions">
                  <button className="export-btn" onClick={() => setPage('results')}>← Back to Protocol</button>
                  <button className="submit-review-btn" onClick={saveReview}>Save Review to DB</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══ FEEDBACK / LEARNING LOOP PAGE ══════════════════════════════ */}
        {page === 'feedback' && (
          <div>
            <div className="fb-header">
              <div className="fb-header-text">
                <h2>🧠 Learning Loop</h2>
                <p>{feedbackLoading ? 'Loading…' : `${feedbackList.length} review${feedbackList.length !== 1 ? 's' : ''} stored`}</p>
              </div>
              {feedbackList.length > 0 && (
                <button className="clear-btn" onClick={clearFeedback}>Clear all</button>
              )}
            </div>

            {!feedbackLoading && feedbackList.length === 0 ? (
              <div className="fb-empty">
                <div className="fb-empty-icon">🧪</div>
                <p>No saved reviews yet. Generate a plan and submit a review to populate the learning loop.</p>
              </div>
            ) : (
              feedbackList.map(item => {
                const sectionCount = Object.keys(item.sections || {}).length;
                const rejections = Object.values(item.sections || {}).filter(s => s.approved === false).length;
                return (
                  <div key={item.id} className="fb-item">
                    <div className="fb-meta">
                      <span className="fb-date">{new Date(item.timestamp).toLocaleDateString()}</span>
                      <span className="fb-domain-tag">{item.domain?.replace('_', ' ')}</span>
                      {item.overallRating > 0 && <span className="fb-rating-tag">★ {item.overallRating}/5</span>}
                      {rejections > 0 && <span className="fb-reject-tag">{rejections} rejection{rejections > 1 ? 's' : ''}</span>}
                    </div>
                    <div className="fb-question">{item.question}</div>
                    {item.overallComment && <div className="fb-comment">{item.overallComment}</div>}
                    {sectionCount > 0 && (
                      <div className="fb-dims">
                        {Object.entries(item.sections).map(([key, val]) => {
                          const dim = REVIEW_DIMENSIONS.find(d => d.key === key);
                          return (
                            <span key={key} className={`fb-dim-chip ${val.approved === false ? 'rejected' : 'approved'}`}>
                              {dim?.icon} {dim?.label || key}
                            </span>
                          );
                        })}
                      </div>
                    )}
                    <div className="fb-footer">
                      <span />
                      <button className="delete-btn" onClick={() => deleteFeedback(item.id)}>Delete</button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
