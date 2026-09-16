// Agents Office v2 — roster + design tokens (ported from v1 command-centre.html)

// Nominal.so tokens (locked design language, 30 Jul 2026)
export const TOKENS = {
  cream: '#FDFFF8',
  ink: '#151414',
  grey: '#5A5A5A',
  hairline: 'rgba(21,20,20,0.12)',
};

// Dept mapping: Support→mint, Sales→butter, Marketing→coral, Finance→periwinkle,
// Operations→violet, Brain→sage.
// NOTE (17 Aug 2026): the old 'ops' pod split in two. The accounting half kept the pod,
// the periwinkle palette and the key 'fin' (now FINANCE); Proposals + Intel moved out into
// a new 'ops' pod (OPERATIONS) alongside Legal Review, Compliance and Internal Reporting.
// V3.1 (5 Sep 2026, AJ): SUPPORT → EMAILS (same mint slot), new DELIVERY pod (sky) on the top axis.
export const DEPT_KEYS = ['emails', 'sales', 'marketing', 'ops', 'fin', 'delivery', 'creative', 'success', 'risk', 'growth', 'exec',
  'eng', 'data', 'pmo', 'people', 'legal', 'support', 'procure', 'expand', 'product'];
export const DEPTS = {
  emails:    { name: 'EMAILS',           short: 'EMAILS',  chip: '#3FA98A', ink: '#16624E', floor: '#E7F1ED' },
  delivery:  { name: 'DELIVERY',         short: 'DELIVERY', chip: '#5B95C7', ink: '#265B84', floor: '#E6EEF5' },
  sales:     { name: 'SALES',            short: 'SALES',   chip: '#C2A24F', ink: '#7C6318', floor: '#F3EFE2' },
  marketing: { name: 'MARKETING',        short: 'MARKETING', chip: '#C56F6F', ink: '#8E3F3F', floor: '#F4E8E7' },
  fin:       { name: 'FINANCE',          short: 'FINANCE', chip: '#6E79C4', ink: '#3D4691', floor: '#E9EAF4' },
  ops:       { name: 'OPERATIONS',       short: 'OPERATIONS', chip: '#8F73B8', ink: '#5A3B85', floor: '#EDE8F3' },
  // V4 (AI agency expansion): five new pods — production, retention, risk, growth, and the officer tier.
  creative:  { name: 'CREATIVE',         short: 'CREATIVE', chip: '#D2914F', ink: '#8A5620', floor: '#F6EDE2' },
  success:   { name: 'CLIENT SUCCESS',   short: 'SUCCESS', chip: '#489E96', ink: '#1D6B64', floor: '#E5F0EE' },
  risk:      { name: 'RISK & COMPLIANCE', short: 'RISK',   chip: '#C25B45', ink: '#8A3421', floor: '#F5E7E3' },
  growth:    { name: 'STRATEGY & GROWTH', short: 'GROWTH', chip: '#8CAB52', ink: '#566E26', floor: '#EDF2E3' },
  exec:      { name: 'EXECUTIVE',        short: 'EXECUTIVE', chip: '#B8901F', ink: '#7A5A10', floor: '#F3ECDC' },
  // V5 (full-scale firm): the capability pods — any project type, any size.
  eng:       { name: 'ENGINEERING',      short: 'ENGINEERING', chip: '#5A82B6', ink: '#274A77', floor: '#E7ECF4' },
  data:      { name: 'DATA & AI',        short: 'DATA & AI', chip: '#3E96AE', ink: '#125A6E', floor: '#E4EFF2' },
  pmo:       { name: 'PROGRAM OFFICE',   short: 'PROGRAM', chip: '#8792A1', ink: '#4E5765', floor: '#EDEFF2' },
  people:    { name: 'PEOPLE & TALENT',  short: 'PEOPLE', chip: '#C4799A', ink: '#8A3F60', floor: '#F4E8ED' },
  legal:     { name: 'LEGAL',            short: 'LEGAL', chip: '#55648F', ink: '#2E3A5C', floor: '#E8EAF1' },
  support:   { name: 'CLIENT SUPPORT',   short: 'SUPPORT', chip: '#A8896C', ink: '#6B4F36', floor: '#F1EBE4' },
  procure:   { name: 'PROCUREMENT',      short: 'PROCUREMENT', chip: '#B4737C', ink: '#7B3C45', floor: '#F3E8EA' },
  expand:    { name: 'EXPANSION',        short: 'EXPANSION', chip: '#5A9E68', ink: '#2C6A38', floor: '#E6F0E8' },
  product:   { name: 'PRODUCT & R&D',    short: 'PRODUCT', chip: '#A067A8', ink: '#6B3573', floor: '#F0E8F2' },
  brain:     { name: 'THE BRAIN',        short: 'THE BRAIN', chip: '#9FB4A4', ink: '#3F6B4C', floor: '#E7EDE7' },
};

// 35 agents (V3.4, 7 Sep 2026: every department has a lead). grid = [col,row] desk slot on the department plinth.
export const AGENTS = [
  // EMAILS (5) — replaced Customer Support, 5 Sep 2026
  { id: 'elead', name: 'EMAILS LEAD',         dept: 'emails',    lead: true,  grid: [0.5, 0], hair: '#2b2b2b', skin: '#E8B98E' },
  { id: 'cmail', name: 'CLIENT EMAILS',       dept: 'emails',    grid: [0, 1], hair: '#3b2b1d', skin: '#F0C9A0' },
  { id: 'imail', name: 'INTERNAL EMAILS',     dept: 'emails',    grid: [1, 1], hair: '#111111', skin: '#C68B59' },
  { id: 'vmail', name: 'VENDOR EMAILS',       dept: 'emails',    grid: [0, 2], hair: '#7a3b12', skin: '#F5D5B0' },
  { id: 'kmail', name: 'CONTRACTOR EMAILS',   dept: 'emails',    grid: [1, 2], hair: '#4a2a10', skin: '#D89F70' },
  // SALES (6) — Sales Lead at the head; Proposals moved in from Operations, Outreach retired
  { id: 'lexi',  name: 'SALES LEAD',          dept: 'sales',     lead: true,  grid: [0.5, 0], hair: '#5a2d0c', skin: '#F0C9A0' },
  { id: 'enzo',  name: 'LEAD ENRICHER',       dept: 'sales',     grid: [0, 1], hair: '#1c1c2e', skin: '#E0A878' },
  { id: 'ilm',   name: 'INBOUND LEADS MANAGER', dept: 'sales',   grid: [1, 1], hair: '#26140a', skin: '#F5D5B0' },
  { id: 'pros',  name: 'PROSPECTOR',          dept: 'sales',     grid: [0, 2], hair: '#2a1a0e', skin: '#E8B98E' },
  { id: 'piper', name: 'PROPOSALS',           dept: 'sales',     grid: [1, 2], hair: '#2d1a0a', skin: '#F0C9A0' },
  { id: 'folo',  name: 'FOLLOW UPS',          dept: 'sales',     grid: [0.5, 3], hair: '#171717', skin: '#F5D5B0' },
  // MARKETING (7) — Marketing Lead at the head since 7 Sep 2026
  { id: 'mlead', name: 'MARKETING LEAD',      dept: 'marketing', lead: true,  grid: [0.5, 0], hair: '#2a1a0e', skin: '#E0A878' },
  { id: 'riley', name: 'RESEARCH',            dept: 'marketing', grid: [0, 1], hair: '#8a4a1f', skin: '#F5D5B0' },
  { id: 'newt',  name: 'NEWSLETTER',          dept: 'marketing', grid: [1, 1], hair: '#26140a', skin: '#D89F70' },
  { id: 'gfx',   name: 'GRAPHICS DESIGNER',   dept: 'marketing', grid: [0, 2], hair: '#141414', skin: '#F0C9A0' },
  { id: 'ada',   name: 'META ADS',            dept: 'marketing', grid: [1, 2], hair: '#3d2814', skin: '#C68B59' },
  { id: 'iggy',  name: 'INSTAGRAM ORGANIC',   dept: 'marketing', grid: [0, 3], hair: '#552200', skin: '#E8B98E' },
  { id: 'vid',   name: 'VIDEO EDITOR',        dept: 'marketing', grid: [1, 3], hair: '#1b1b24', skin: '#D9A97E' },
  // OPERATIONS (6) — Operations Lead at the head since 7 Sep 2026; Internal Dashboards joins; Proposals moved to Sales
  { id: 'olead', name: 'OPERATIONS LEAD',     dept: 'ops',       lead: true,  grid: [0.5, 0], hair: '#111111', skin: '#F0C9A0' },
  { id: 'scout', name: 'INTEL',               dept: 'ops',       grid: [0, 1], hair: '#101820', skin: '#B07850' },
  { id: 'legal', name: 'LEGAL REVIEW',        dept: 'ops',       grid: [1, 1], hair: '#20242e', skin: '#F0C9A0' },
  { id: 'comply', name: 'COMPLIANCE CHECKER', dept: 'ops',       grid: [0, 2], hair: '#5a3a1a', skin: '#C68B59' },
  { id: 'report', name: 'INTERNAL REPORTING', dept: 'ops',       grid: [1, 2], hair: '#2e2118', skin: '#E8B98E' },
  { id: 'dash',  name: 'INTERNAL DASHBOARDS', dept: 'ops',       grid: [0.5, 3], hair: '#0d0d0d', skin: '#9C6B43' },
  // FINANCE (4) — the accounting team; Accounting Lead at the head
  { id: 'alead', name: 'ACCOUNTING LEAD',     dept: 'fin',       lead: true,  grid: [0.5, 0], hair: '#1f1f1f', skin: '#E0A878' },
  { id: 'invo',  name: 'INVOICING',           dept: 'fin',       grid: [0, 1], hair: '#4a2a10', skin: '#F5D5B0' },
  { id: 'apay',  name: 'ACCOUNTS PAYABLE',    dept: 'fin',       grid: [1, 1], hair: '#0a0a0a', skin: '#8A5A32' },
  { id: 'recon', name: 'RECONCILIATION',      dept: 'fin',       grid: [0.5, 2], hair: '#33221a', skin: '#E8B98E' },
  // DELIVERY (7) — new pod, 5 Sep 2026; Onboarder moved in from Sales
  { id: 'dlead', name: 'DELIVERY LEAD',       dept: 'delivery',  lead: true,  grid: [0.5, 0], hair: '#1f1f1f', skin: '#F0C9A0' },
  { id: 'pco',   name: 'PROJECT CO-ORDINATOR', dept: 'delivery', grid: [0, 1], hair: '#3d2814', skin: '#E8B98E' },
  { id: 'qa',    name: 'QUALITY ASSURANCE CHECKER', dept: 'delivery', grid: [1, 1], hair: '#101820', skin: '#C68B59' },
  { id: 'crep',  name: 'CLIENT REPORTS',      dept: 'delivery',  grid: [0, 2], hair: '#6b3410', skin: '#F5D5B0' },
  { id: 'cass',  name: 'CLIENT ASSETS',       dept: 'delivery',  grid: [1, 2], hair: '#141414', skin: '#D9A97E' },
  { id: 'dasst', name: 'DESIGNER ASSISTANT',  dept: 'delivery',  grid: [0, 3], hair: '#552200', skin: '#F0C9A0' },
  { id: 'ona',   name: 'ONBOARDER',           dept: 'delivery',  grid: [1, 3], hair: '#0d0d0d', skin: '#9C6B43' },
  // CREATIVE (6) — new pod, V4: production capacity beyond Marketing's one designer + one editor
  { id: 'clead', name: 'CREATIVE LEAD',       dept: 'creative',  lead: true,  grid: [0.5, 0], hair: '#241a12', skin: '#E8B98E' },
  { id: 'brnd',  name: 'BRAND DESIGNER',      dept: 'creative',  grid: [0, 1], hair: '#5a2d0c', skin: '#F0C9A0' },
  { id: 'mote',  name: 'MOTION DESIGNER',     dept: 'creative',  grid: [1, 1], hair: '#101820', skin: '#C68B59' },
  { id: 'copy',  name: 'COPYWRITER',          dept: 'creative',  grid: [0, 2], hair: '#6b3410', skin: '#F5D5B0' },
  { id: 'ugc',   name: 'UGC PRODUCER',        dept: 'creative',  grid: [1, 2], hair: '#3d2814', skin: '#D9A97E' },
  { id: 'alib',  name: 'ASSET LIBRARIAN',     dept: 'creative',  grid: [0.5, 3], hair: '#141414', skin: '#9C6B43' },
  // CLIENT SUCCESS (6) — new pod, V4: owns the relationship after Delivery ships
  { id: 'cslead', name: 'CLIENT SUCCESS LEAD', dept: 'success',  lead: true,  grid: [0.5, 0], hair: '#2a1a0e', skin: '#F0C9A0' },
  { id: 'acct',  name: 'ACCOUNT MANAGER',     dept: 'success',   grid: [0, 1], hair: '#4a2a10', skin: '#E8B98E' },
  { id: 'renew', name: 'RENEWALS',            dept: 'success',   grid: [1, 1], hair: '#111111', skin: '#C68B59' },
  { id: 'upsel', name: 'UPSELL SPECIALIST',   dept: 'success',   grid: [0, 2], hair: '#7a3b12', skin: '#F5D5B0' },
  { id: 'qbr',   name: 'QBR ANALYST',         dept: 'success',   grid: [1, 2], hair: '#26140a', skin: '#D89F70' },
  { id: 'fdbk',  name: 'CLIENT FEEDBACK',     dept: 'success',   grid: [0.5, 3], hair: '#552200', skin: '#E0A878' },
  // RISK & COMPLIANCE (6) — new pod, V4: the standing risk register across the whole agency
  { id: 'rlead', name: 'RISK LEAD',           dept: 'risk',      lead: true,  grid: [0.5, 0], hair: '#1f1f1f', skin: '#E0A878' },
  { id: 'crisk', name: 'CONTRACT RISK',       dept: 'risk',      grid: [0, 1], hair: '#20242e', skin: '#F0C9A0' },
  { id: 'conc',  name: 'CLIENT CONCENTRATION RISK', dept: 'risk', grid: [1, 1], hair: '#5a3a1a', skin: '#C68B59' },
  { id: 'frisk', name: 'FINANCIAL RISK',      dept: 'risk',      grid: [0, 2], hair: '#101820', skin: '#B07850' },
  { id: 'drisk', name: 'DATA & SECURITY RISK', dept: 'risk',     grid: [1, 2], hair: '#0a0a0a', skin: '#8A5A32' },
  { id: 'vrisk', name: 'VENDOR RISK',         dept: 'risk',      grid: [0.5, 3], hair: '#2e2118', skin: '#E8B98E' },
  // STRATEGY & GROWTH (6) — new pod, V4: the self-improving loop + business-KPI tracking
  { id: 'glead', name: 'GROWTH LEAD',         dept: 'growth',    lead: true,  grid: [0.5, 0], hair: '#111111', skin: '#F0C9A0' },
  { id: 'kpi',   name: 'KPI ANALYST',         dept: 'growth',    grid: [0, 1], hair: '#3d2814', skin: '#E8B98E' },
  { id: 'improve', name: 'PROCESS IMPROVEMENT', dept: 'growth',  grid: [1, 1], hair: '#101820', skin: '#C68B59' },
  { id: 'winlog', name: 'WIN & CASE STUDY TRACKER', dept: 'growth', grid: [0, 2], hair: '#6b3410', skin: '#F5D5B0' },
  { id: 'okr',   name: 'INITIATIVE TRACKER',  dept: 'growth',    grid: [1, 2], hair: '#141414', skin: '#D9A97E' },
  { id: 'bench', name: 'MARKET BENCHMARKING', dept: 'growth',    grid: [0.5, 3], hair: '#552200', skin: '#F0C9A0' },
  // EXECUTIVE (6) — new pod, V4: the officer tier overseeing every department; never takes outbound actions itself
  { id: 'ceo',   name: 'CEO',                 dept: 'exec',      lead: true,  grid: [0.5, 0], hair: '#1f1f1f', skin: '#E0A878' },
  { id: 'coo',   name: 'COO',                 dept: 'exec',      grid: [0, 1], hair: '#2a1a0e', skin: '#F0C9A0' },
  { id: 'cro',   name: 'CRO',                 dept: 'exec',      grid: [1, 1], hair: '#4a2a10', skin: '#E8B98E' },
  { id: 'cfo',   name: 'CFO',                 dept: 'exec',      grid: [0, 2], hair: '#111111', skin: '#C68B59' },
  { id: 'cgo',   name: 'CGO',                 dept: 'exec',      grid: [1, 2], hair: '#7a3b12', skin: '#F5D5B0' },
  { id: 'cos',   name: 'CHIEF OF STAFF',      dept: 'exec',      grid: [0.5, 3], hair: '#26140a', skin: '#D89F70' },
  // ENGINEERING (6) — V5: builds anything the work needs, at any scale
  { id: 'englead', name: 'ENGINEERING LEAD',  dept: 'eng',       lead: true,  grid: [0.5, 0], hair: '#1c1c2e', skin: '#E0A878' },
  { id: 'arch',  name: 'SOLUTION ARCHITECT',  dept: 'eng',       grid: [0, 1], hair: '#101820', skin: '#C68B59' },
  { id: 'webdev', name: 'WEB DEVELOPER',      dept: 'eng',       grid: [1, 1], hair: '#3d2814', skin: '#F0C9A0' },
  { id: 'appdev', name: 'APP DEVELOPER',      dept: 'eng',       grid: [0, 2], hair: '#4a2a10', skin: '#E8B98E' },
  { id: 'devops', name: 'DEVOPS',             dept: 'eng',       grid: [1, 2], hair: '#0a0a0a', skin: '#8A5A32' },
  { id: 'qaeng', name: 'QA ENGINEER',         dept: 'eng',       grid: [0.5, 3], hair: '#552200', skin: '#F5D5B0' },
  // DATA & AI (6) — V5
  { id: 'datlead', name: 'DATA LEAD',         dept: 'data',      lead: true,  grid: [0.5, 0], hair: '#111111', skin: '#F0C9A0' },
  { id: 'dataeng', name: 'DATA ENGINEER',     dept: 'data',      grid: [0, 1], hair: '#26140a', skin: '#D89F70' },
  { id: 'analyst', name: 'DATA ANALYST',      dept: 'data',      grid: [1, 1], hair: '#7a3b12', skin: '#E8B98E' },
  { id: 'mleng', name: 'ML ENGINEER',         dept: 'data',      grid: [0, 2], hair: '#141414', skin: '#C68B59' },
  { id: 'bi',    name: 'BI DEVELOPER',        dept: 'data',      grid: [1, 2], hair: '#5a2d0c', skin: '#F5D5B0' },
  { id: 'datagov', name: 'DATA GOVERNANCE',   dept: 'data',      grid: [0.5, 3], hair: '#20242e', skin: '#9C6B43' },
  // PROGRAM OFFICE (6) — V5: portfolio-level governance above single projects
  { id: 'pmolead', name: 'PROGRAM OFFICE LEAD', dept: 'pmo',     lead: true,  grid: [0.5, 0], hair: '#1f1f1f', skin: '#E8B98E' },
  { id: 'portfol', name: 'PORTFOLIO MANAGER',  dept: 'pmo',      grid: [0, 1], hair: '#2a1a0e', skin: '#F0C9A0' },
  { id: 'resource', name: 'RESOURCE PLANNER',  dept: 'pmo',      grid: [1, 1], hair: '#6b3410', skin: '#D9A97E' },
  { id: 'depend', name: 'DEPENDENCY MANAGER',  dept: 'pmo',      grid: [0, 2], hair: '#101820', skin: '#B07850' },
  { id: 'method', name: 'METHODOLOGY & STANDARDS', dept: 'pmo',  grid: [1, 2], hair: '#4a2a10', skin: '#F5D5B0' },
  { id: 'status', name: 'STATUS REPORTING',    dept: 'pmo',      grid: [0.5, 3], hair: '#2e2118', skin: '#E0A878' },
  // PEOPLE & TALENT (6) — V5: the capacity behind any scale
  { id: 'plead', name: 'PEOPLE LEAD',         dept: 'people',    lead: true,  grid: [0.5, 0], hair: '#241a12', skin: '#F0C9A0' },
  { id: 'recruit', name: 'RECRUITER',         dept: 'people',    grid: [0, 1], hair: '#552200', skin: '#E8B98E' },
  { id: 'freelance', name: 'CONTRACTOR MANAGER', dept: 'people', grid: [1, 1], hair: '#111111', skin: '#C68B59' },
  { id: 'hronb', name: 'PEOPLE ONBOARDING',   dept: 'people',    grid: [0, 2], hair: '#3d2814', skin: '#F5D5B0' },
  { id: 'train', name: 'TRAINING & ENABLEMENT', dept: 'people',  grid: [1, 2], hair: '#5a3a1a', skin: '#D89F70' },
  { id: 'capacity', name: 'CAPACITY PLANNER', dept: 'people',    grid: [0.5, 3], hair: '#0d0d0d', skin: '#9C6B43' },
  // LEGAL (6) — V5: its own pod, above Operations' day-to-day checks
  { id: 'llead', name: 'LEGAL LEAD',          dept: 'legal',     lead: true,  grid: [0.5, 0], hair: '#20242e', skin: '#E0A878' },
  { id: 'contr', name: 'CONTRACTS COUNSEL',   dept: 'legal',     grid: [0, 1], hair: '#101820', skin: '#F0C9A0' },
  { id: 'ip',    name: 'IP & TRADEMARKS',     dept: 'legal',     grid: [1, 1], hair: '#1f1f1f', skin: '#C68B59' },
  { id: 'dispute', name: 'DISPUTES',          dept: 'legal',     grid: [0, 2], hair: '#0a0a0a', skin: '#8A5A32' },
  { id: 'corp',  name: 'CORPORATE & ENTITY',  dept: 'legal',     grid: [1, 2], hair: '#2e2118', skin: '#E8B98E' },
  { id: 'privacy', name: 'PRIVACY COUNSEL',   dept: 'legal',     grid: [0.5, 3], hair: '#4a2a10', skin: '#F5D5B0' },
  // CLIENT SUPPORT (6) — V5: the service desk behind everything shipped
  { id: 'suplead', name: 'SUPPORT LEAD',      dept: 'support',   lead: true,  grid: [0.5, 0], hair: '#2a1a0e', skin: '#E8B98E' },
  { id: 'tier1', name: 'FIRST RESPONSE',      dept: 'support',   grid: [0, 1], hair: '#6b3410', skin: '#F5D5B0' },
  { id: 'tier2', name: 'TECHNICAL SUPPORT',   dept: 'support',   grid: [1, 1], hair: '#101820', skin: '#C68B59' },
  { id: 'sla',   name: 'SLA MONITOR',         dept: 'support',   grid: [0, 2], hair: '#141414', skin: '#D9A97E' },
  { id: 'kb',    name: 'KNOWLEDGE BASE',      dept: 'support',   grid: [1, 2], hair: '#7a3b12', skin: '#F0C9A0' },
  { id: 'incid', name: 'INCIDENT MANAGER',    dept: 'support',   grid: [0.5, 3], hair: '#0d0d0d', skin: '#9C6B43' },
  // PROCUREMENT (6) — V5: the supply side of scale
  { id: 'prolead', name: 'PROCUREMENT LEAD',  dept: 'procure',   lead: true,  grid: [0.5, 0], hair: '#1f1f1f', skin: '#F0C9A0' },
  { id: 'source', name: 'SOURCING',           dept: 'procure',   grid: [0, 1], hair: '#4a2a10', skin: '#E8B98E' },
  { id: 'subcon', name: 'SUBCONTRACTOR MANAGER', dept: 'procure', grid: [1, 1], hair: '#111111', skin: '#C68B59' },
  { id: 'supplier', name: 'SUPPLIER QUALITY', dept: 'procure',   grid: [0, 2], hair: '#26140a', skin: '#F5D5B0' },
  { id: 'cost',  name: 'COST CONTROL',        dept: 'procure',   grid: [1, 2], hair: '#5a3a1a', skin: '#D89F70' },
  { id: 'renewv', name: 'VENDOR RENEWALS',    dept: 'procure',   grid: [0.5, 3], hair: '#2e2118', skin: '#E0A878' },
  // EXPANSION (6) — V5: new markets, verticals, alliances
  { id: 'exlead', name: 'EXPANSION LEAD',     dept: 'expand',    lead: true,  grid: [0.5, 0], hair: '#2d1a0a', skin: '#E8B98E' },
  { id: 'market', name: 'NEW MARKETS',        dept: 'expand',    grid: [0, 1], hair: '#3d2814', skin: '#F0C9A0' },
  { id: 'vertical', name: 'VERTICAL STRATEGY', dept: 'expand',   grid: [1, 1], hair: '#101820', skin: '#C68B59' },
  { id: 'alliance', name: 'ALLIANCES',        dept: 'expand',    grid: [0, 2], hair: '#552200', skin: '#F5D5B0' },
  { id: 'channel', name: 'CHANNEL PARTNERS',  dept: 'expand',    grid: [1, 2], hair: '#141414', skin: '#D9A97E' },
  { id: 'ma',    name: 'M&A ANALYST',         dept: 'expand',    grid: [0.5, 3], hair: '#0a0a0a', skin: '#8A5A32' },
  // PRODUCT & R&D (6) — V5: turning what we do well into what we sell repeatedly
  { id: 'prlead', name: 'PRODUCT LEAD',       dept: 'product',   lead: true,  grid: [0.5, 0], hair: '#241a12', skin: '#F0C9A0' },
  { id: 'prodz', name: 'PRODUCTISED SERVICES', dept: 'product',  grid: [0, 1], hair: '#5a2d0c', skin: '#E8B98E' },
  { id: 'rnd',   name: 'R&D',                 dept: 'product',   grid: [1, 1], hair: '#1c1c2e', skin: '#C68B59' },
  { id: 'intool', name: 'INTERNAL TOOLING',   dept: 'product',   grid: [0, 2], hair: '#111111', skin: '#F5D5B0' },
  { id: 'uxr',   name: 'UX RESEARCH',         dept: 'product',   grid: [1, 2], hair: '#7a3b12', skin: '#D89F70' },
  { id: 'roadmap', name: 'ROADMAP',           dept: 'product',   grid: [0.5, 3], hair: '#26140a', skin: '#E0A878' },
];

// Plinth placement in world XZ. Brain central; departments well separated (AJ: not too close at zoom-out).
// V6: a tiered radial campus, not a flat grid. The Brain is a raised core; the EXECUTIVE deck
// floats above and in front of it; the client-facing engine rings the core at ground level; the
// capability and governance departments step DOWN onto a wider outer ring. `y` is the tier height.
export const LAYOUT = {
  brain:      { pos: [0, 0], y: 4, w: 18, d: 18 },   // the raised core
  exec:       { pos: [0, -62], y: 13, w: 22, d: 26 },   // the officer deck, above and out front
  sales:      { pos: [24, -41.6], y: 0, w: 20, d: 24 },   // inner ring — the client engine
  marketing:  { pos: [47.3, -8.3], y: 0, w: 20, d: 24 },   // inner ring — the client engine
  creative:   { pos: [36.8, 30.9], y: 0, w: 20, d: 24 },   // inner ring — the client engine
  emails:     { pos: [0, 48], y: 0, w: 20, d: 24 },   // inner ring — the client engine
  delivery:   { pos: [-36.8, 30.9], y: 0, w: 20, d: 24 },   // inner ring — the client engine
  success:    { pos: [-47.3, -8.3], y: 0, w: 20, d: 24 },   // inner ring — the client engine
  ops:        { pos: [28.4, -87.5], y: -5, w: 20, d: 24 },   // outer ring — capability & governance
  fin:        { pos: [61.6, -68.4], y: -5, w: 20, d: 24 },   // outer ring — capability & governance
  risk:       { pos: [84, -37.4], y: -5, w: 20, d: 24 },   // outer ring — capability & governance
  growth:     { pos: [92, 0], y: -5, w: 20, d: 24 },   // outer ring — capability & governance
  eng:        { pos: [84, 37.4], y: -5, w: 20, d: 24 },   // outer ring — capability & governance
  data:       { pos: [61.6, 68.4], y: -5, w: 20, d: 24 },   // outer ring — capability & governance
  pmo:        { pos: [28.4, 87.5], y: -5, w: 20, d: 24 },   // outer ring — capability & governance
  people:     { pos: [-9.6, 91.5], y: -5, w: 20, d: 24 },   // outer ring — capability & governance
  legal:      { pos: [-46, 79.7], y: -5, w: 20, d: 24 },   // outer ring — capability & governance
  support:    { pos: [-74.4, 54.1], y: -5, w: 20, d: 24 },   // outer ring — capability & governance
  procure:    { pos: [-90, 19.1], y: -5, w: 20, d: 24 },   // outer ring — capability & governance
  expand:     { pos: [-90, -19.1], y: -5, w: 20, d: 24 },   // outer ring — capability & governance
  product:    { pos: [-74.4, -54.1], y: -5, w: 20, d: 24 },   // outer ring — capability & governance
};

// Department billboard metrics (v1 rule #5: live metrics float above each dept,
// values tick green on change, "Waiting Approval" pulses amber when > 0).
export const BILLBOARDS = {
  emails:    [{ id: 'emails',    label: 'EMAILS SENT',      val: 128 }],
  delivery:  [{ id: 'reports',   label: 'REPORTS SENT',     val: 9 }],
  sales:     [{ id: 'leads',     label: 'LEADS ENRICHED',   val: 47 },
              { id: 'callhrs',   label: 'CALL HRS ROUTED',  val: 9.5, fmt: v => v.toFixed(1) + 'h', step: 0.4 }],
  marketing: [{ id: 'adspend',   label: 'AD SPEND TODAY',   val: 684, fmt: v => '$' + Math.round(v).toLocaleString('en-NZ'), step: 12 }],
  ops:       [{ id: 'proposals', label: 'PROPOSALS SENT',   val: 6 }],
  fin:       [{ id: 'invoices',  label: 'INVOICES ISSUED', val: 23 }],
  creative:  [{ id: 'assets',    label: 'ASSETS SHIPPED',   val: 14 }],
  success:   [{ id: 'renewals',  label: 'RENEWALS SECURED', val: 5 }],
  risk:      [{ id: 'flags',     label: 'OPEN RISK FLAGS',  val: 2 }],
  growth:    [{ id: 'reports',   label: 'IMPROVEMENT REPORTS', val: 3 }],
  exec:      [{ id: 'synth',     label: 'WEEKLY SYNTHESES',  val: 6 }],
  eng:       [{ id: 'deploys',   label: 'DEPLOYS THIS WEEK', val: 11 }],
  data:      [{ id: 'pipelines', label: 'PIPELINES GREEN',   val: 8 }],
  pmo:       [{ id: 'programs',  label: 'PROGRAMS ON TRACK', val: 6 }],
  people:    [{ id: 'bench',     label: 'BENCH AVAILABLE',   val: 4 }],
  legal:     [{ id: 'contracts', label: 'CONTRACTS OPEN',    val: 3 }],
  support:   [{ id: 'tickets',   label: 'TICKETS RESOLVED',  val: 31 }],
  procure:   [{ id: 'vendors',   label: 'VENDORS ACTIVE',    val: 12 }],
  expand:    [{ id: 'markets',   label: 'MARKETS IN PLAY',   val: 2 }],
  product:   [{ id: 'launches',  label: 'OFFERS LIVE',       val: 5 }],
  brain:     [{ id: 'notes',     label: 'NOTES INDEXED',    val: 1204, fmt: v => Math.round(v).toLocaleString('en-NZ') }],
};

// Approval asks (agent requests → AJ decides; v1 flavour).
// Per-agent first so the ask matches who's asking; dept pool is the fallback.
export const APPROVAL_ASKS = {
  emails:    ['Send the price-increase notice to 120 clients — draft attached', 'Reply to the contractor dispute thread — draft attached'],
  delivery:  ['Ship the September report pack to 14 clients', 'Release the brand assets to the client portal'],
  sales:     ['Send re-engagement SMS to 214 cold leads', 'Move 8 enterprise leads to SPENCER’s queue'],
  marketing: ['Launch 4 Meta ad variants — $120/day budget', 'Publish reel “cold call maths” to Instagram'],
  ops:       ['Send proposal PDF to Ridgeline Property Group', 'Sign off the amended MSA for Kea Logistics — 2 clauses flagged'],
  fin:       ['Invoice #218 doesn’t match the contract — hold for review?', 'Write off $180 of unmatched card fees'],
  creative:  ['Ship the new brand video cut to the client portal', 'Publish the refreshed brand kit to every active client'],
  success:   ['Send the renewal offer to Harbourside Ltd — 3% increase', 'Send the QBR deck to Kea Logistics'],
  risk:      ['Flag the Ridgeline contract clause to legal — liability cap missing', 'Pause new work for a client past 90 days concentration risk'],
  growth:    ['Publish this week’s Improvement Report to every lead', 'Adjust ROSTER-wide brief per the process-improvement recommendation'],
  exec:      ['Approve the CEO’s weekly all-hands report for circulation', 'Escalate a stalled client to the owner — no movement in 14 days'],
  eng:       ['Deploy the {co} build to production', 'Take the staging environment down for the migration'],
  data:      ['Grant the client read access to the reporting warehouse', 'Run the back-fill across 2 years of history'],
  pmo:       ['Re-plan the programme — 3 projects slip a week', 'Move two people off {co} onto the new programme'],
  people:    ['Make the offer to the senior developer', 'Sign the contractor for 3 months at the quoted rate'],
  legal:     ['Sign off the amended MSA for Kea Logistics — 2 clauses flagged', 'Send the cease-and-desist on the trademark use'],
  support:   ['Publish the incident post-mortem to affected clients', 'Credit the SLA breach on the {co} account'],
  procure:   ['Sign the new subcontractor agreement', 'Switch hosting vendors — 30 days notice on the old one'],
  expand:    ['Open the Australian market — first hires and entity', 'Sign the alliance agreement with the reseller'],
  product:   ['Launch the productised audit offer at $2,400', 'Retire the legacy retainer tier — 4 clients to migrate'],
};
export const APPROVAL_BY_AGENT = {
  cmail: 'Send the price-increase notice to 120 clients — draft attached',
  vmail: 'Accept the vendor’s revised SLA — 2 changes flagged',
  crep:  'Send the September report pack to 14 clients — 2 flagged for a call',
  qa:    'Sign off the website handover — 2 minor issues noted',
  dlead: 'Extend the Ridgeline project by a week — the client asked',
  apay:  'Contractor invoice #218 is $350 over the contract rate — hold payment and query?',
  piper: 'Send the Ridgeline Property Group proposal — 12 seats, Growth plan',
  iggy:  'Publish reel “the 10am rule” to Instagram — script attached',
  vid:   'Ship the 45-sec demo cut — captions burned in, v2 attached',
  ada:   'Scale “cold call anxiety” creative to $180/day — CPA $29',
  mlead: 'Approve the October content plan — 12 reels, 2 newsletters, 1 ad refresh',
  olead: 'Sign off the Q4 operations checklist — 3 vendor renewals inside',
  newt:  'Send the August newsletter to 3,400 subscribers — draft v3 attached',
  scout: 'Green-light the CallForge comparison play — memo attached',
  enzo:  'Buy 500 FullEnrich credits — current batch runs out tomorrow',
};

// Fake terminal lines for the desk screens (per-dept flavour), matching v1's chat voice.
export const WORKLINES = {
  emails: [
    '▸ drafting reply — client scope question',
    '▸ vendor thread: SLA revision summarised',
    '▸ 14 internal emails triaged · 3 for AJ',
    '▸ contractor invoice query answered',
  ],
  delivery: [
    '▸ client report: September pack 9/14',
    '▸ QA pass: website handover · 2 notes',
    '▸ asset library synced → client portal',
    '▸ project plan: 3 milestones moved',
  ],
  sales: [
    '▸ enriching lead — Summit HVAC',
    '▸ routed 6 leads → ARWIN (4.2h queued)',
    '▸ 32 prospects verified · 91% valid',
    '▸ onboarding text sent — Bay Plumbing',
  ],
  marketing: [
    '▸ drafting reel hook v3 — "cold call maths"',
    '▸ meta ads: 4 variants → review',
    '▸ newsletter block 2/5 written',
    '▸ brand-kit export: story + square',
    '▸ rendering reel v2 — captions + b-roll',
  ],
  ops: [
    '▸ proposal PDF built — Ridgeline Group',
    '▸ competitor scan: DialAxis pricing page',
    '▸ MSA clause 7.2 flagged — liability cap',
    '▸ WorkSafe AU page changed · diffing',
    '▸ weekly board pack: 4/6 sections done',
  ],
  fin: [
    '▸ reconciling 14 payments · 2 flagged',
    '▸ invoice #218 vs contract — rate variance flagged',
    '▸ invoice issued — Summit HVAC $840',
    '▸ reminder 2/3 sent — Alpine Freight',
  ],
  creative: [
    '▸ brand kit export: story + square — Ridgeline',
    '▸ motion cut v2 — captions + b-roll',
    '▸ ad copy 4 variants → review',
    '▸ UGC brief sent — Q4 refresh',
  ],
  success: [
    '▸ renewal offer drafted — Harbourside Ltd',
    '▸ QBR deck 3/4 sections done — Kea Logistics',
    '▸ NPS survey sent — 14 responses so far',
    '▸ upsell flagged — Summit HVAC, +2 seats',
  ],
  risk: [
    '▸ contract clause flagged — liability cap missing',
    '▸ client concentration check: 3 accounts >20% revenue',
    '▸ vendor SLA review — 1 lapsed',
    '▸ risk register updated — 2 open flags',
  ],
  growth: [
    '▸ improvement report drafted — 3 agents, tone corrections',
    '▸ KPI note updated — pipeline velocity',
    '▸ win logged — Bay Plumbing case study',
    '▸ initiative tracker: 2/5 on track',
  ],
  exec: [
    '▸ COO synthesis filed — delivery on track',
    '▸ CFO flagged invoice #218 for review',
    '▸ weekly all-hands report drafted',
    '▸ chief of staff: pipeline sweep — 1 stalled client',
  ],
  eng: [
    '▸ build passing — 11 deploys this week',
    '▸ migration dry-run on staging',
    '▸ code review: 3 PRs open',
    '▸ load test: 4k concurrent, p95 240ms',
  ],
  data: [
    '▸ pipeline green — 8/8 sources',
    '▸ model retrain: churn v3',
    '▸ warehouse back-fill 62%',
    '▸ dashboard refreshed — client reporting',
  ],
  pmo: [
    '▸ portfolio health: 6 programmes on track',
    '▸ dependency flagged — design blocks build',
    '▸ resource plan: 4 people free next sprint',
    '▸ status pack 3/6 sections',
  ],
  people: [
    '▸ 3 candidates screened — senior dev',
    '▸ contractor onboarded — 2 day start',
    '▸ capacity model updated for Q4',
    '▸ training path drafted — new starters',
  ],
  legal: [
    '▸ MSA clause 7.2 flagged — liability cap',
    '▸ trademark watch: 1 similar filing',
    '▸ contractor agreement redlined',
    '▸ privacy review — new connector',
  ],
  support: [
    '▸ 31 tickets resolved · 2 escalated',
    '▸ SLA watch: all within target',
    '▸ incident closed — post-mortem drafted',
    '▸ knowledge base: 4 articles updated',
  ],
  procure: [
    '▸ 3 quotes in for the hosting renewal',
    '▸ subcontractor vetted — insurance checked',
    '▸ cost variance flagged — 8% over',
    '▸ vendor renewal calendar updated',
  ],
  expand: [
    '▸ market scan: AU metro demand',
    '▸ vertical brief — dental groups',
    '▸ alliance call notes filed',
    '▸ channel partner pipeline: 4 live',
  ],
  product: [
    '▸ productised audit — pricing modelled',
    '▸ internal tool: brief intake automated',
    '▸ UX interviews 5/8 done',
    '▸ roadmap re-cut for Q4',
  ],
  brain: [
    '▸ indexing vault — 1,204 notes',
    '▸ answering INTEL query — churn cohort',
    '▸ meeting scheduled: enzo × tess',
  ],
};
