/* MargeUp - logique de l'application (v4)
   Données : enregistrées dans le navigateur (localStorage) pour l'instant.
   Quand Supabase sera branché, seules les fonctions load() et save() changeront. */

/* ---------- RÉGLAGES ---------- */
// Sécurité : empreinte SHA-256 pour éviter l'exposition en clair du code secret dans le script client
const MAINT_SALT = 'margeup_salt_2026';
async function _hashMaint(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(MAINT_SALT + '|' + (s || '').trim()));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
let _MAINT_TARGET = null;
_hashMaint('783326239').then(h => { _MAINT_TARGET = h; });
const PAY = { wave: '', om: '', num: '78 332 62 39' };
const CONTACT = { tel: '771906476', email: 'margeup0@gmail.com' };
const TRIAL_DAYS = 15;
const KEY = 'safebtp.v3', KA = 'safebtp.admin.v3';

/* ---------- GESTION DU CODE DE VÉRIFICATION PAR E-MAIL ---------- */
let verificationCode = null;
let pendingCompanyData = null;
let verificationExpiry = null;

// Exposition globale pour tests et inspection
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'verificationCode', {
    get() { return verificationCode; },
    set(v) { verificationCode = v; },
    configurable: true
  });
}
const PHASES = [['terr','Terrassement et fondations'],['gros','Gros œuvre (élévation)'],['dalle','Dalles et toiture'],['maco','Maçonnerie et enduits'],['elec','Électricité et plomberie'],['fin','Carrelage et peinture'],['rec','Finitions et réception']];
const TYPE_IMG = { tracteur: 'images/engins.jpg', toupie: 'images/engins.jpg', benne: 'images/engins.jpg' }; // une seule photo d'engins pour l'instant : ajoutez shacman.jpg / toupie.jpg puis changez ici
const ROLE_LABEL = { magasinier: 'Magasinier', transport: 'Transport', chantier: 'Chef de chantier' };
const GATED = ['ceo','magasinier','transport','chantier'];
const INPUT = 'w-full bg-white border border-slate-300 rounded-xl p-2.5 text-sm text-slate-900 focus:outline-none focus:border-orange-500';

/* ---------- OUTILS ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fm = n => Math.round(n).toLocaleString('fr-FR');
const uid = () => Math.random().toString(36).slice(2, 9);
function day(n) { const d = new Date(); d.setDate(d.getDate() + (n || 0)); return d.toISOString().slice(0, 10); }
function addDays(iso, n) { const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
const fr = d => d ? d.split('-').reverse().join('/') : '—';
const daysLeft = iso => Math.round((new Date(iso + 'T12:00') - new Date(day() + 'T12:00')) / 864e5);
function toast(t) {
  let e = $('toast');
  if (!e) { e = document.createElement('div'); e.id = 'toast'; e.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-800 border border-slate-700 text-white text-xs font-semibold px-4 py-2.5 rounded-xl z-[70] hidden'; document.body.appendChild(e); }
  e.textContent = t; e.classList.remove('hidden'); clearTimeout(e._t); e._t = setTimeout(() => e.classList.add('hidden'), 3200);
}

/* ---------- GESTION DES UNITÉS & CONVERSIONS QUINCAILLERIE ---------- */
// Règle d'or sénégalaise BTP : 1 tonne de ciment = 20 sacs de 50 kg
function isCementOrTonne(item) {
  if (!item) return false;
  const n = (item.name || '').toLowerCase();
  const u = (item.unit || '').toLowerCase();
  const c = (item.cat || '').toLowerCase();
  return n.includes('ciment') || u.includes('tonne') || c.includes('ciment') || item.uom_ratio === 20;
}

function formatMaterialQty(itemOrQty, unitName) {
  let qty = typeof itemOrQty === 'object' ? (itemOrQty.qty || 0) : Number(itemOrQty || 0);
  let u = typeof itemOrQty === 'object' ? (itemOrQty.unit || '').toLowerCase() : (unitName || '').toLowerCase();
  let name = typeof itemOrQty === 'object' ? (itemOrQty.name || '').toLowerCase() : '';

  const isTonneOrSac = u.includes('tonne') || u.includes('sac') || name.includes('ciment');
  if (!isTonneOrSac) {
    return fm(qty) + ' ' + (typeof itemOrQty === 'object' ? esc(itemOrQty.unit || 'unités') : (unitName || ''));
  }

  // 1 tonne = 20 sacs de 50 kg
  let totalSacs = 0;
  if (u.includes('tonne')) {
    totalSacs = Math.round(qty * 20 * 100) / 100;
  } else {
    totalSacs = Math.round(qty * 100) / 100;
  }

  const tonnes = Math.floor(totalSacs / 20);
  const sacs = Math.round((totalSacs % 20) * 10) / 10;

  if (tonnes > 0 && sacs > 0) {
    return tonnes + ' tonne' + (tonnes > 1 ? 's' : '') + ' et ' + sacs + ' sac' + (sacs > 1 ? 's' : '') + ' (' + fm(totalSacs) + ' sacs)';
  } else if (tonnes > 0 && sacs === 0) {
    return fm(tonnes) + ' tonne' + (tonnes > 1 ? 's' : '') + ' (' + fm(totalSacs) + ' sacs)';
  } else {
    return sacs + ' sac' + (sacs > 1 ? 's' : '');
  }
}


/* ---------- DONNÉES ---------- */
function defaultReviews() {
  return [
    {
      id: 'rev-1',
      author: 'Mamadou Ndiaye',
      role: 'Directeur Général',
      company: 'Sahel BTP & Génie Civil',
      city: 'Dakar / Diamniadio',
      rating: 5,
      date: day(-3),
      tag: 'Flotte & Carburant',
      text: "Grâce à MargeUp, nous avons enfin une visibilité en direct sur la consommation de nos camions bennes et le nombre de tours quotidiens entre la carrière de Bargny et nos chantiers. Plus aucune triche sur le carburant, nous avons économisé près de 2,3 millions FCFA dès le premier mois."
    },
    {
      id: 'rev-2',
      author: 'Fatou Bintou Diop',
      role: 'Gérante Propriétaire',
      company: 'Quincaillerie Moderne du Rail',
      city: 'Thiès',
      rating: 5,
      date: day(-8),
      tag: 'Quincaillerie & Vente',
      text: "Le double guichet B2C/B2B et l’impression des reçus thermiques ont changé notre quotidien. Le stock de ciment et fer à béton est à jour en direct, sans inventaire de fin de mois douloureux. Mes magasiniers l'adorent."
    },
    {
      id: 'rev-3',
      author: 'Cheikh Oumar Tall',
      role: 'Responsable Flotte & Logistique',
      company: 'Trans-Sénégal Express',
      city: 'Rufisque',
      rating: 5,
      date: day(-15),
      tag: 'Transport & Rotations',
      text: "Le suivi des voyages avec les lieux précis de départ et de déchargement a complètement transformé notre contrôle. Le classement des chauffeurs avec prime au mérite a motivé toute l'équipe et diminué les pannes évitables."
    },
    {
      id: 'rev-4',
      author: 'Ing. Awa Sarr',
      role: 'Directrice des Travaux',
      company: 'Consortium Teranga Bâtiment',
      city: 'Diamniadio',
      rating: 5,
      date: day(-22),
      tag: 'BTP & Gros Œuvre',
      text: "L'anticipation automatique des retards sur le gros œuvre et l'imputation directe des dépenses au bon chantier permettent de piloter la vraie marge nette. Un ERP vraiment adapté à nos réalités au Sénégal."
    }
  ];
}

function seed() {
  return {
    co: null, trial: null, sub: null, demo: true, roles: {}, team: [], seq: 3,
    reviews: defaultReviews(),
    depots: [{ id: 'd1', nom: 'Quincaillerie principale' }],
    sales: [
      { id: 'v3', num: 'FAC-2026-0003', depot: 'd1', date: day(-1), stype: 'detail', kind: 'particulier', client: { nom: 'Client comptoir Dangote', tel: '' }, pay: 'Espèces', lines: [{ item: 1, name: 'Ciment Dangote CPJ 42.5', unit: 'sacs', qty: 2, pu: 4250 }], total: 8500 },
      { id: 'v1', num: 'FAC-2026-0001', depot: 'd1', date: day(-2), stype: 'detail', kind: 'particulier', client: { nom: 'Client comptoir', tel: '' }, pay: 'Espèces', lines: [{ item: 1, name: 'Ciment Dangote CPJ 42.5', unit: 'sacs', qty: 5, pu: 4500 }], total: 22500 },
      { id: 'v2', num: 'FAC-2026-0002', depot: 'd1', date: day(-2), stype: 'gros', kind: 'entreprise', client: { nom: 'Entreprise Sow et Frères', tel: '771234567' }, pay: 'Wave', lines: [{ item: 1, name: 'Ciment Dangote CPJ 42.5 (3 tonnes / 60 sacs)', unit: 'sacs', qty: 60, pu: 3800 }, { item: 3, name: 'Tuyaux PEHD Pression Ø110mm', unit: 'mètres', qty: 50, pu: 7000 }], total: 578000 }
    ],
    chantiers: [
      { id: 'lycee', nom: 'Chantier Lycée', budget: 95000000 },
      { id: 'brt', nom: 'Chantier BRT Dakar - Section 3', budget: 120000000 },
      { id: 'diamniadio', nom: 'Chantier Tour Diamniadio', budget: 150000000 },
      { id: 'thies', nom: 'Chantier Autoroute Thiès-Touba', budget: 85000000 }
    ],
    inventory: [
      { id: 1, name: 'Ciment Dangote CPJ 42.5', cat: 'Cimenterie', qty: 24, unit: 'tonne', price: 4250, priceGros: 3800, depot: 'd1', lastChantier: 'lycee', sale_unit: 'sac 50kg', uom_ratio: 20, seuil: 5 },
      { id: 2, name: 'Fer à Béton FeE500 Ø12mm', cat: 'Acierie', qty: 45, unit: 'tonnes', price: 480000, priceGros: 460000, depot: 'd1', lastChantier: 'Tour Diamniadio', sale_unit: 'barre 6m', uom_ratio: 1, seuil: 5 },
      { id: 3, name: 'Tuyaux PEHD Pression Ø110mm', cat: 'Plomberie/PEHD', qty: 180, unit: 'mètres', price: 7500, priceGros: 7000, depot: 'd1', lastChantier: 'BRT Dakar', seuil: 20 },
      { id: 4, name: 'Sable de Dune (Camion 16m3)', cat: 'Agrégats', qty: 25, unit: 'camions', price: 90000, priceGros: 85000, depot: 'd1', lastChantier: 'Thiès Autoroute', seuil: 3 }
    ],
    pannes: [
      { id: 1, date: day(-3), vehicle: 'Shacman X3000 (DK-8891-BG)', driver: 'Modou Diop', diag: 'Fissure durite de refroidissement + Surchauffe', severity: 'Moyenne', status: 'En Réparation', cost: 185000 },
      { id: 2, date: day(-6), vehicle: 'Toupie Mercedes Arocs (DK-4102-BH)', driver: 'Ibrahima Sarr', diag: 'Usure plaquettes de frein avant', severity: 'Faible', status: 'Terminé', cost: 95000 },
      { id: 3, date: day(-2), vehicle: 'Camion Benne Volvo FMX (DK-1029-BF)', driver: 'Alioune Badara', diag: "Panne d'injecteur Diesel", severity: 'Critique', status: 'En Attente Pièce', cost: 650000 }
    ],
    expenses: [
      { id: 1, chantier: 'lycee', date: day(-1), title: 'Livraison 24 tonnes Ciment Dangote', source: 'Quincaillerie principale', cat: 'Matériaux', amount: 9120000 },
      { id: 2, chantier: 'brt', date: day(-2), title: 'Carburant Gazole Toupie Shacman', source: 'Station Shell Diamniadio', cat: 'Carburant', amount: 350000 },
      { id: 3, chantier: 'brt', date: day(-4), title: 'Achat Extérieur Raccords PEHD Ø110', source: 'Fournisseur Extérieur Comptoir', cat: 'Matériaux', amount: 480000 },
      { id: 4, chantier: 'diamniadio', date: day(-5), title: 'Fer à béton 20 tonnes', source: 'Quincaillerie Maison Diamniadio', cat: 'Matériaux', amount: 9600000 },
      { id: 5, chantier: 'diamniadio', date: day(-7), title: 'Paie équipe coffrage', source: 'Main d’œuvre', cat: 'Main d’œuvre', amount: 4200000 },
      { id: 6, chantier: 'thies', date: day(-3), title: 'Gazole engins de terrassement', source: 'Station Total Thiès', cat: 'Carburant', amount: 1250000 }
    ],
    fleet: [
      { id: 1, name: 'Shacman X3000', plate: 'DK-8891-BG', status: 'En Mission', driver: 'Modou Diop', type: 'tracteur',
        carb: [{ d: day(-2), l: 180, amount: 144000, km: null, station: 'Shell Diamniadio' }, { d: day(-9), l: 200, amount: 160000, km: null, station: 'Shell Diamniadio' }],
        trips: [
          { d: day(-2), voyages: 6, km: 540, depart: 'Carrière Bargny', arrivee: 'Chantier Tour Diamniadio', obs: 'Sable de dune 0/4' },
          { d: day(-9), voyages: 7, km: 610, depart: 'Port Autonome de Dakar', arrivee: 'Chantier BRT Dakar', obs: 'Fer à béton Ø12' }
        ]
      },
      { id: 2, name: 'Mercedes Arocs Toupie', plate: 'DK-4102-BH', status: 'Disponible', driver: 'Ibrahima Sarr', type: 'toupie',
        carb: [{ d: day(-4), l: 150, amount: 120000, km: null, station: 'Total Rufisque' }],
        trips: [
          { d: day(-4), voyages: 5, km: 380, depart: 'Centrale à béton Rufisque', arrivee: 'Chantier Lycée', obs: 'Béton prêt à l’emploi B25' }
        ]
      },
      { id: 3, name: 'Volvo FMX Benne', plate: 'DK-1029-BF', status: 'En Panne', driver: 'Alioune Badara', type: 'benne',
        carb: [{ d: day(-3), l: 220, amount: 176000, km: null, station: 'Total Thiès' }, { d: day(-8), l: 180, amount: 144000, km: null, station: 'Total Thiès' }],
        trips: [
          { d: day(-3), voyages: 8, km: 420, depart: 'Carrière Pout', arrivee: 'Chantier Autoroute Thiès', obs: 'Basalte concassé' },
          { d: day(-8), voyages: 6, km: 350, depart: 'Carrière Sindia', arrivee: 'Chantier Tour Diamniadio', obs: 'Tout-venant compacté' }
        ]
      }
    ],
    batiments: [
      { id: 'b1', chantier: 'brt', nom: 'Bâtiment A, R+2', niveaux: 3, niveauActuel: 2, ingenieur: 'Ing. Mamadou Gueye', resp: 'Chef Diallo', debut: day(-60), prevision: day(75), livraison: day(90), note: 'Coulage de la dalle du R+2 prévu dans deux semaines', ph: { terr: 100, gros: 80, dalle: 40, maco: 10, elec: 0, fin: 0, rec: 0 } },
      { id: 'b2', chantier: 'diamniadio', nom: 'Tour principale, R+8', niveaux: 9, niveauActuel: 5, ingenieur: 'Ing. Awa Sarr', resp: 'Chef Fall', debut: day(-120), prevision: day(60), livraison: day(-10), note: 'Retard de livraison du fer : planning à revoir', ph: { terr: 100, gros: 95, dalle: 70, maco: 40, elec: 20, fin: 0, rec: 0 } },
      { id: 'b3', chantier: 'lycee', nom: 'Bâtiment Classes, R+1', niveaux: 2, niveauActuel: 1, ingenieur: 'Ing. Awa Sarr', resp: 'Chef Sow', debut: day(-20), prevision: day(180), livraison: day(200), note: 'Pose des fondations terminée, élévation en cours', ph: { terr: 100, gros: 50, dalle: 0, maco: 0, elec: 0, fin: 0, rec: 0 } }
    ]
  };
}
/* ---------- PERSISTANCE ROBUSTE (IndexedDB + localStorage + Export de secours) ---------- */
const DB_NAME = 'margeup_db', DB_STORE = 'appstate', DB_VERSION = 1;
let _idb = null;

function _openIDB() {
  return new Promise((resolve) => {
    if (!window.indexedDB) return resolve(null);
    if (_idb) return resolve(_idb);
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => { e.target.result.createObjectStore(DB_STORE); };
      req.onsuccess = e => { _idb = e.target.result; resolve(_idb); };
      req.onerror = () => resolve(null);
    } catch (e) { resolve(null); }
  });
}

function _idbGet(key) {
  return new Promise(async resolve => {
    try {
      const db = await _openIDB();
      if (!db) return resolve(null);
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch (e) { resolve(null); }
  });
}

function _idbSet(key, val) {
  return new Promise(async resolve => {
    try {
      const db = await _openIDB();
      if (!db) return resolve(false);
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(val, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch (e) { resolve(false); }
  });
}

function _normalize(s) {
  if (!s || !s.inventory) return null;
  s.roles = s.roles || {};
  s.team = s.team || [];
  s.depots = (s.depots && s.depots.length) ? s.depots : [{ id: 'd1', nom: 'Quincaillerie principale' }];
  s.inventory.forEach(i => { i.depot = i.depot || s.depots[0].id; if (i.priceGros == null) i.priceGros = i.price; });
  s.sales = s.sales || [];
  s.fleet = s.fleet || [];
  s.fleet.forEach(f => {
    (f.trips || []).forEach(t => {
      t.depart = t.depart || '';
      t.arrivee = t.arrivee || '';
      t.obs = t.obs || '';
    });
  });
  s.pannes = s.pannes || [];
  s.expenses = s.expenses || [];
  s.chantiers = s.chantiers || [];
  s.batiments = s.batiments || [];
  s.reviews = (s.reviews && s.reviews.length) ? s.reviews : defaultReviews();
  s.seq = s.seq || s.sales.length;
  return s;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = _normalize(JSON.parse(raw));
      if (s) return s;
    }
  } catch (e) {}
  return seed();
}

async function syncFromIndexedDB() {
  try {
    const saved = await _idbGet(KEY);
    if (saved && _normalize(saved)) {
      // Si IndexedDB contient plus de données ou si localStorage a été effacé
      if (!localStorage.getItem(KEY) || (saved.sales && saved.sales.length > (S.sales || []).length)) {
        Object.assign(S, saved);
        try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
        renderAll();
        console.log('[MargeUp] Données restaurées avec succès depuis IndexedDB');
      }
    }
  } catch (e) { console.warn(e); }
}

function save() {
  try {
    const json = JSON.stringify(S);
    // 1. Sauvegarde instantanée localStorage
    localStorage.setItem(KEY, json);
    // 2. Sauvegarde résiliente IndexedDB (résiste aux nettoyages de cache simples)
    _idbSet(KEY, JSON.parse(json)).catch(() => {});
  } catch (e) {
    toast('Enregistrement impossible sur cet appareil');
  }
}

// Outils d'export / import de sauvegarde d'urgence
function exportBackup() {
  const data = JSON.stringify(S, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'margeup-sauvegarde-' + day() + '.json';
  a.click();
  toast('Sauvegarde téléchargée sur votre appareil !');
}

function importBackup() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json';
  inp.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const parsed = _normalize(JSON.parse(evt.target.result));
        if (parsed) {
          S = parsed;
          save();
          renderAll();
          toast('Données restaurées avec succès !');
        } else {
          toast('Fichier de sauvegarde invalide.');
        }
      } catch (err) {
        toast('Erreur de lecture du fichier.');
      }
    };
    reader.readAsText(file);
  };
  inp.click();
}
let S = load(), selChantier = null, calc = null, payMe = 'w', c1 = null, c2 = null, curRole = 'ceo', pendingRole = null, curUser = null, selDepot = null;
const scoped = (type, list) => (!curUser || curUser.scope.type !== type || curUser.scope.id === 'all') ? list : list.filter(x => String(x.id) === String(curUser.scope.id));
const scopeChantiers = () => scoped('chantier', S.chantiers), scopeDepots = () => scoped('depot', S.depots), scopeFleet = () => scoped('truck', S.fleet);
const scopeLabel = m => m.scope.type === 'chantier' ? 'Admin du chantier ' + ((S.chantiers.find(c => c.id === m.scope.id) || {}).nom || '?').replace('Chantier ', '') : m.scope.type === 'depot' ? 'Admin de ' + ((S.depots.find(d => d.id === m.scope.id) || {}).nom || '?') : m.scope.id === 'all' ? 'Admin de toute la flotte' : 'Admin du camion ' + ((S.fleet.find(f => String(f.id) === String(m.scope.id)) || {}).plate || '?');
const scopedPannes = () => (curUser && curUser.scope.type === 'truck' && curUser.scope.id !== 'all') ? S.pannes.filter(p => { const f = S.fleet.find(x => String(x.id) === String(curUser.scope.id)); return f && (p.vehicle || '').includes(f.plate); }) : S.pannes;

/* ---------- ESSAI GRATUIT ET ABONNEMENT ---------- */
function access() {
  if (S.sub && S.sub.until >= day() && !S.sub.susp) return 'sub';
  if (S.sub && S.sub.susp) return 'susp';
  if (S.trial && S.trial.end >= day()) return 'trial';
  if (S.trial || S.sub) return 'expired';
  return 'visitor';
}
const canUse = () => ['trial', 'sub', 'visitor'].includes(access());

function renderBanner() {
  const a = access(), b = $('statusBanner'); let h = '';
  const btn = (S.co && curRole !== 'ceo') ? '' : '<button onclick="subscribeNow()" class="bg-orange-500 hover:bg-orange-600 text-white font-bold px-3 py-1.5 rounded-lg text-xs">S’abonner</button>';
  if (a === 'visitor') h = `<div class="bg-blue-500/10 border-b border-blue-500/30 text-blue-800"><div class="max-w-7xl mx-auto px-4 py-2 text-xs flex flex-wrap items-center justify-between gap-2"><span><i class="fa-solid fa-eye"></i> Mode visiteur : explorez toutes les fonctions avec des données d’exemple, sans inscription.</span><button onclick="openCompanyModal()" class="bg-orange-500 hover:bg-orange-600 text-white font-bold px-3 py-1.5 rounded-lg text-xs">Créer mon espace : 15 jours gratuits</button></div></div>`;
  if (a === 'trial') { const n = daysLeft(S.trial.end); h = `<div class="bg-emerald-500/10 border-b border-emerald-500/30 text-emerald-700"><div class="max-w-7xl mx-auto px-4 py-2 text-xs flex flex-wrap items-center justify-between gap-2"><span><i class="fa-solid fa-gift"></i> Essai gratuit : ${n === 0 ? 'dernier jour' : n + ' jour' + (n > 1 ? 's' : '') + ' restant' + (n > 1 ? 's' : '')}. Toutes les fonctions sont ouvertes.</span>${btn}</div></div>`; }
  if (a === 'expired') h = `<div class="bg-rose-500/10 border-b border-rose-500/30 text-rose-700"><div class="max-w-7xl mx-auto px-4 py-2 text-xs flex flex-wrap items-center justify-between gap-2"><span><i class="fa-solid fa-lock"></i> Votre essai gratuit est terminé. Abonnez-vous pour rouvrir vos modules. Vos données sont conservées.</span>${btn}</div></div>`;
  if (a === 'susp') h = `<div class="bg-rose-500/10 border-b border-rose-500/30 text-rose-700"><div class="max-w-7xl mx-auto px-4 py-2 text-xs"><i class="fa-solid fa-ban"></i> Abonnement suspendu. Contactez MargeUp.</div></div>`;
  if (a === 'sub') h = `<div class="bg-slate-100 border-b border-slate-200 text-slate-600"><div class="max-w-7xl mx-auto px-4 py-2 text-xs"><i class="fa-solid fa-circle-check text-emerald-600"></i> Abonnement actif jusqu’au ${fr(S.sub.until)}${S.sub.status === 'verif' ? ' <span class="text-amber-600">· paiement en cours de vérification</span>' : ''}</div></div>`;
  b.innerHTML = h;
}

function fillLock() {
  const a = access();
  $('lock-title').textContent = a === 'susp' ? 'Abonnement suspendu' : a === 'none' ? 'Créez votre espace pour commencer' : 'Votre essai gratuit est terminé';
  $('lock-msg').textContent = a === 'none' ? 'Donnez le nom de votre entreprise pour démarrer vos 15 jours d’essai gratuit.' : 'Abonnez-vous pour rouvrir camions, quincaillerie, chantiers et tableau de bord. Toutes vos données sont conservées.';
  $('lock-btn').onclick = a === 'none' ? () => openCompanyModal(true) : subscribeNow;
  $('lock-btn').textContent = a === 'none' ? 'Démarrer mon essai gratuit' : 'S’abonner maintenant';
}

/* ---------- NAVIGATION ET RÔLES ---------- */
function switchTab(tabId) {
  if (tabId === 'tarifs' && S.co && curRole !== 'ceo') { toast('Les tarifs sont réservés au patron (rôle CEO).'); return; }
  let view = tabId;
  if (GATED.includes(tabId) && !canUse()) { view = 'locked'; fillLock(); }
  document.querySelectorAll('main > section').forEach(s => s.classList.add('hidden'));
  $('view-' + view).classList.remove('hidden');
  document.querySelectorAll('.nav-tab').forEach(b => { b.classList.remove('bg-orange-500', 'text-white'); b.classList.add('text-slate-500'); });
  const ab = $('tab-' + tabId);
  if (ab) { ab.classList.add('bg-orange-500', 'text-white'); ab.classList.remove('text-slate-500'); }
}
function switchRoleAndTab(role) { goModule(role); }
function goModule(role) { if (curRole === 'ceo' || curRole === role) switchTab(role); else requestRole(role, () => switchTab(role)); }
function changeRole(role) {
  document.querySelectorAll('.role-restricted').forEach(b => b.classList.toggle('hidden', !(role === 'ceo' || b.classList.contains('role-' + role))));
  const employe = !!S.co && role !== 'ceo'; // les tarifs sont réservés au patron (les visiteurs les voient)
  document.querySelectorAll('.ceo-only').forEach(b => b.classList.toggle('hidden', employe));
  const cur = document.querySelector('main > section:not(.hidden)');
  if (cur && (employe && cur.id === 'view-tarifs' || !['view-accueil', 'view-tarifs', 'view-partenaires'].includes(cur.id))) switchTab(role === 'ceo' || employe && cur.id === 'view-tarifs' ? 'accueil' : role);
}
function hashPw(s, salt) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57; const t = 'safebtp|' + salt + '|' + s;
  for (let i = 0, ch; i < t.length; i++) { ch = t.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
function enterRole(role) {
  curRole = role; try { sessionStorage.setItem('safebtp.role', role); } catch (e) {}
  if (role === 'ceo') { curUser = null; try { sessionStorage.setItem('safebtp.user', ''); } catch (e) {} }
  $('roleSelector').value = role; changeRole(role); renderAll();
}
function requestRole(role, cb) {
  const rs = $('roleSelector');
  if (role === 'ceo' || role === curRole || !S.co || isSA()) { enterRole(role); if (cb) cb(); return; } // le patron et les visiteurs n'ont pas de mot de passe
  rs.value = curRole;
  const M = S.team.filter(m => m.role === role);
  if (!M.length && !S.roles[role]) return openModal('<h3 class="text-base font-bold text-slate-900">Aucun membre pour ce rôle</h3><p class="text-xs text-slate-600">Le patron doit d’abord ajouter un membre (nom, e-mail, téléphone) pour le rôle ' + ROLE_LABEL[role] + ' avec le bouton « Équipe ».</p><div class="flex justify-end"><button onclick="closeModal()" class="px-4 py-2 rounded-xl text-xs bg-slate-100 text-slate-600">Fermer</button></div>');
  pendingRole = { role, cb };
  openModal(formWrap('Connexion : ' + ROLE_LABEL[role], 'rolepw', `<input type="hidden" name="role" value="${role}">` + (M.length ? sel('Votre nom', 'member', M.map(m => [m.id, m.nom + ' · ' + scopeLabel(m)])) : '') + fld('Mot de passe', 'pw', 'password', 'required autocomplete="off"') + '<div id="pwErr" class="text-xs text-rose-600"></div>', 'Entrer'));
}

/* ---------- FENÊTRES (MODAL) ---------- */
function openModal(html) { $('modalBox').innerHTML = html; $('modal').classList.remove('hidden'); }
function closeModal() { $('modal').classList.add('hidden'); }
const fld = (l, n, t = 'text', a = '') => `<label class="block text-xs font-semibold text-slate-500">${l}<input name="${n}" type="${t}" ${a} class="${INPUT} mt-1"></label>`;
const sel = (l, n, o) => `<label class="block text-xs font-semibold text-slate-500">${l}<select name="${n}" class="${INPUT} mt-1">${o.map(x => `<option value="${esc(x[0])}">${esc(x[1])}</option>`).join('')}</select></label>`;
const formWrap = (title, f, body, ok, cancel = true) => `<h3 class="text-base font-bold text-slate-900">${title}</h3><form data-f="${f}" class="space-y-3">${body}<div class="flex justify-end gap-2 pt-2">${cancel ? '<button type="button" onclick="closeModal()" class="px-4 py-2 rounded-xl text-xs bg-slate-100 text-slate-600">Annuler</button>' : ''}<button class="px-4 py-2 rounded-xl text-xs bg-orange-500 text-white font-bold">${ok}</button></div></form>`;

/* ---------- ENTREPRISE & VÉRIFICATION EMAIL ---------- */
function generateVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function sendVerificationEmail(email) {
  verificationCode = generateVerificationCode();
  verificationExpiry = Date.now() + 15 * 60 * 1000; // Valide 15 minutes
  if (typeof window !== 'undefined') window.verificationCode = verificationCode;
  console.log(`[MargeUp Auth] Code de vérification généré pour ${email} : ${verificationCode}`);
  return verificationCode;
}

function openCompanyModal(forceOpen, prefill) {
  if (S.co && curRole !== 'ceo') return toast('Réservé au patron : repassez au rôle CEO.');
  const c = prefill || S.co || {};

  const verifiedBadge = (S.co && S.co.emailVerified) ? `
    <div class="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs px-3 py-2 rounded-xl flex items-center justify-between">
      <div class="flex items-center gap-2">
        <i class="fa-solid fa-circle-check text-emerald-600 text-sm"></i>
        <span>E-mail vérifié : <b class="font-bold text-slate-900">${esc(S.co.email)}</b></span>
      </div>
      <span class="text-[10px] text-emerald-700 bg-emerald-100 font-bold px-2 py-0.5 rounded-full">Actif</span>
    </div>` : '';

  const subtitle = S.co
    ? 'Modifiez les informations de votre entreprise. Une modification d’e-mail nécessite une confirmation par code de sécurité.'
    : 'Créez votre espace : vos 15 jours d’essai gratuit démarrent dès validation de votre adresse e-mail par code de sécurité.';

  const body = `
    <img src="images/chantier.jpg" alt="" class="w-full h-28 object-cover rounded-xl">
    ${verifiedBadge}
    <p class="text-xs text-slate-600">${subtitle}</p>
    ${fld('Nom de l’entreprise *', 'nom', 'text', `required value="${esc(c.nom || '')}" placeholder="Ex. Sénégal Pavage SARL"`)}
    ${fld('Nom et prénom du patron (CEO) *', 'resp', 'text', `required value="${esc(c.resp || '')}" placeholder="Ex. Moussa Diop"`)}
    <div class="grid grid-cols-2 gap-3">
      ${fld('E-mail *', 'email', 'email', `required value="${esc(c.email || '')}" placeholder="contact@entreprise.sn"`)}
      ${fld('Téléphone *', 'tel', 'tel', `required minlength="9" value="${esc(c.tel || '')}" placeholder="77 000 00 00"`)}
    </div>
    ${fld('Ville', 'ville', 'text', `value="${esc(c.ville || '')}" placeholder="Ex. Dakar, Thiès, Touba"`)}
    ${S.co ? '<button type="button" onclick="openTeamModal()" class="w-full bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs font-bold py-2.5 rounded-xl border border-slate-300"><i class="fa-solid fa-users"></i> Gérer mon équipe et les admins</button>' : ''}
  `;

  openModal(formWrap(
    S.co ? 'Mon entreprise' : 'Créer mon espace · Étape 1/2',
    'co',
    body,
    S.co ? 'Enregistrer les modifications' : 'Continuer vers la vérification e-mail <i class="fa-solid fa-arrow-right ml-1"></i>'
  ));
}

function openVerificationModal() {
  if (!pendingCompanyData) return openCompanyModal();

  const code = verificationCode || sendVerificationEmail(pendingCompanyData.email);

  openModal(`
    <div class="space-y-4">
      <div class="text-center space-y-1.5">
        <div class="w-14 h-14 bg-orange-500/10 text-orange-600 rounded-2xl flex items-center justify-center text-2xl mx-auto ring-8 ring-orange-500/5">
          <i class="fa-solid fa-envelope-circle-check"></i>
        </div>
        <div class="inline-flex items-center gap-1.5 bg-orange-500/10 text-orange-700 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase">
          Étape 2/2 · Sécurité
        </div>
        <h3 class="text-lg font-black text-slate-900">Vérification de votre e-mail</h3>
        <p class="text-xs text-slate-600 max-w-sm mx-auto">
          Un code de sécurité à 6 chiffres a été envoyé à l’adresse :<br>
          <span class="font-bold text-slate-900 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200 inline-block mt-1">${esc(pendingCompanyData.email)}</span>
        </p>
      </div>

      <!-- BANNIÈRE SIMULATION LOCALE / VISIBILITÉ DIRECTE -->
      <div class="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-3.5 space-y-2 text-xs">
        <div class="flex items-center justify-between">
          <span class="font-bold text-blue-900 flex items-center gap-1.5">
            <i class="fa-solid fa-flask-vial text-blue-600"></i> Mode Test Local & Aperçu
          </span>
          <span class="text-[10px] bg-blue-600 text-white font-bold px-2 py-0.5 rounded-full">Simulation active</span>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-2 bg-white/90 p-2.5 rounded-xl border border-blue-100 shadow-xs">
          <div>
            <div class="text-[11px] text-slate-500 font-medium">Code généré pour test :</div>
            <div id="simulatedCodeText" class="font-mono font-black text-xl text-blue-700 tracking-wider">${code}</div>
          </div>
          <button type="button" onclick="autoFillVerificationCode()" class="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-3 py-2 rounded-xl transition flex items-center gap-1.5 shadow-sm cursor-pointer">
            <i class="fa-solid fa-wand-magic-sparkles"></i> Remplir automatiquement
          </button>
        </div>
        <p class="text-[11px] text-blue-800 leading-tight">
          Ce code simule l'e-mail de confirmation reçu par le client pour tester le flux en local sans délai.
        </p>
      </div>

      <form data-f="verifyEmail" class="space-y-4">
        <div>
          <label class="block text-xs font-semibold text-slate-700 text-center mb-2">
            Entrez les 6 chiffres du code :
          </label>
          <div class="flex justify-center">
            <input type="text" id="emailCodeInput" name="code" required maxlength="6" pattern="[0-9]{6}" autocomplete="one-time-code" placeholder="------" class="text-center font-mono text-2xl tracking-[0.35em] font-black w-56 py-2.5 px-3 bg-white border-2 border-slate-300 rounded-xl focus:border-orange-500 focus:outline-none focus:ring-4 focus:ring-orange-500/10 text-slate-900 shadow-inner">
          </div>
          <div id="verifyCodeErr" class="text-xs text-rose-600 text-center font-semibold mt-2 min-h-[16px]"></div>
        </div>

        <div class="space-y-2 pt-1">
          <button type="submit" class="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl text-xs flex items-center justify-center gap-2 shadow-md transition cursor-pointer">
            <i class="fa-solid fa-circle-check"></i> Confirmer le code et activer mon espace
          </button>
          
          <div class="flex justify-between items-center pt-2 text-xs border-t border-slate-200">
            <button type="button" onclick="resendVerificationCode()" class="text-orange-600 hover:text-orange-700 font-bold flex items-center gap-1.5 cursor-pointer">
              <i class="fa-solid fa-rotate-right"></i> Renvoyer un code
            </button>
            <button type="button" onclick="backToCompanyForm()" class="text-slate-600 hover:text-slate-900 flex items-center gap-1 cursor-pointer">
              <i class="fa-solid fa-arrow-left"></i> Modifier les infos
            </button>
          </div>
        </div>
      </form>
    </div>
  `);

  setTimeout(() => {
    const inp = $('emailCodeInput');
    if (inp) inp.focus();
  }, 100);
}

function autoFillVerificationCode() {
  const inp = $('emailCodeInput');
  if (inp && verificationCode) {
    inp.value = verificationCode;
    inp.focus();
    if ($('verifyCodeErr')) $('verifyCodeErr').textContent = '';
  }
}

function resendVerificationCode() {
  if (!pendingCompanyData) return;
  const newCode = sendVerificationEmail(pendingCompanyData.email);
  const disp = $('simulatedCodeText');
  if (disp) disp.textContent = newCode;
  const inp = $('emailCodeInput');
  if (inp) inp.value = '';
  if ($('verifyCodeErr')) $('verifyCodeErr').textContent = '';
  toast('Nouveau code envoyé à ' + pendingCompanyData.email + ' : ' + newCode);
}

function backToCompanyForm() {
  openCompanyModal(false, pendingCompanyData);
}

/* ---------- CALCULATEUR DE TARIFS & PACKS ---------- */
let billingCycle = 'monthly'; // 'monthly' ou 'annual'
const PACK_PRICES = {
  b2c: 39900,
  hybrid: 69900,
  truck: 9900
};
let quincQty = { b2c: 1, hybrid: 1 };
let selectedTrucksCount = 1;

function setBillingCycle(c) {
  billingCycle = c;
  const isAnn = c === 'annual';
  const bm = $('btn-billing-monthly'), ba = $('btn-billing-annual');
  if (bm && ba) {
    bm.className = isAnn ? 'px-4 py-1.5 rounded-full text-xs font-bold transition text-slate-600 hover:text-slate-900 cursor-pointer' : 'px-4 py-1.5 rounded-full text-xs font-bold transition bg-orange-500 text-white cursor-pointer';
    ba.className = isAnn ? 'px-4 py-1.5 rounded-full text-xs font-bold transition bg-orange-500 text-white cursor-pointer' : 'px-4 py-1.5 rounded-full text-xs font-bold transition text-slate-600 hover:text-slate-900 cursor-pointer';
  }
  updateAllPricingDisplay();
}

function updateQuincPricing(type) {
  const inp = $('quinc-' + type + '-qty');
  if (inp) {
    quincQty[type] = Math.max(1, parseInt(inp.value) || 1);
  }
  updateAllPricingDisplay();
}

function updateTruckPricing(val) {
  selectedTrucksCount = Math.max(1, parseInt(val) || 1);
  updateAllPricingDisplay();
}

function updateAllPricingDisplay() {
  const isAnn = billingCycle === 'annual';
  // Facteur annuel : 10 mois payés pour 12 mois
  const annFactor = 10 / 12;

  // 1. Quincaillerie B2C
  const qB2C = quincQty.b2c || 1;
  const discB2C = qB2C >= 2 ? 0.10 : 0; // -10% dès 2 quincailleries
  const unitB2C = (PACK_PRICES.b2c * (1 - discB2C)) * (isAnn ? annFactor : 1);
  const totalB2CMonthly = unitB2C * qB2C;
  if ($('price-b2c')) $('price-b2c').innerText = fm(totalB2CMonthly);
  if ($('cycle-b2c')) $('cycle-b2c').innerText = isAnn ? '/mois (facturé à l’année)' : '/mois';
  const noticeB2C = $('disc-notice-b2c');
  if (noticeB2C) noticeB2C.classList.toggle('hidden', qB2C < 2);

  // 2. Quincaillerie Hybride
  const qHyb = quincQty.hybrid || 1;
  const discHyb = qHyb >= 2 ? 0.10 : 0; // -10% dès 2 quincailleries
  const unitHyb = (PACK_PRICES.hybrid * (1 - discHyb)) * (isAnn ? annFactor : 1);
  const totalHybMonthly = unitHyb * qHyb;
  if ($('price-hybrid')) $('price-hybrid').innerText = fm(totalHybMonthly);
  if ($('cycle-hybrid')) $('cycle-hybrid').innerText = isAnn ? '/mois (facturé à l’année)' : '/mois';
  const noticeHyb = $('disc-notice-hybrid');
  if (noticeHyb) noticeHyb.classList.toggle('hidden', qHyb < 2);

  // 3. Flotte Camions
  const trkUnit = PACK_PRICES.truck * (isAnn ? annFactor : 1);
  const trkTotal = trkUnit * selectedTrucksCount;
  if ($('price-truck')) $('price-truck').innerText = fm(trkUnit);
  if ($('cycle-truck')) $('cycle-truck').innerText = isAnn ? '/ camion / mois (annuel)' : '/ camion / mois';
  if ($('truck-count-display')) $('truck-count-display').innerText = selectedTrucksCount + (selectedTrucksCount > 1 ? ' camions' : ' camion');
  if ($('truck-total-display')) $('truck-total-display').innerText = fm(trkTotal) + ' FCFA' + (isAnn ? ' /mois' : '');
}

function updatePricingCalculator() {
  updateAllPricingDisplay();
}

function chooseQuincPack(planCode, basePrice, planLabel) {
  const isAnn = billingCycle === 'annual';
  const type = planCode === 'b2c_retail' ? 'b2c' : 'hybrid';
  const qty = quincQty[type] || 1;
  const disc = qty >= 2 ? 0.10 : 0; // Remise 10%
  const monthlyGross = basePrice * qty;
  const monthlyNet = Math.round(monthlyGross * (1 - disc));
  const totalToPay = isAnn ? monthlyNet * 10 : monthlyNet;

  calc = {
    planCode,
    planLabel: planLabel + ' (' + qty + ' dépôt' + (qty > 1 ? 's' : '') + ')',
    qty,
    discPercent: disc * 100,
    isAnnual: isAnn,
    total: totalToPay
  };
  payMe = 'w';

  openModal(`<div class="border-b border-slate-200 pb-3">
    <div class="inline-flex items-center space-x-1.5 bg-orange-500/10 text-orange-700 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase mb-1">
      <i class="fa-solid fa-store text-orange-600"></i><span>Abonnement MargeUp</span>
    </div>
    <h3 class="text-lg font-black text-slate-900">Souscrire au ${esc(planLabel)}</h3>
    <p class="text-xs text-slate-500">${qty} point(s) de vente · ${isAnn ? 'Facturation annuelle (-2 mois offerts : 10 mois payés pour 12)' : 'Facturation mensuelle sans engagement'}</p>
  </div>
  <div class="space-y-3 pt-3">
    <div class="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-1.5 text-xs">
      <div class="flex justify-between">
        <span class="text-slate-600">Nombre de quincailleries :</span>
        <b class="text-slate-900">${qty}</b>
      </div>
      ${disc > 0 ? `<div class="flex justify-between text-emerald-700 font-bold">
        <span>Remise Réseau Multi-points (-10%) :</span>
        <span>-${fm(monthlyGross * 0.10)} FCFA / mois</span>
      </div>` : ''}
      <div class="flex justify-between items-center text-sm font-black pt-1 border-t border-slate-200">
        <span class="text-slate-800">Total net à régler :</span>
        <span class="text-orange-600 text-lg">${fm(totalToPay)} FCFA ${isAnn ? '<span class="text-xs font-normal text-slate-500">pour 12 mois</span>' : '<span class="text-xs font-normal text-slate-500">/ mois</span>'}</span>
      </div>
    </div>

    <p class="text-xs text-slate-700">Réglez votre abonnement par Wave ou Orange Money :</p>
    <div class="grid grid-cols-2 gap-3">
      <button type="button" onclick="payWith('w')" class="p-3.5 rounded-xl border-2 border-cyan-400 bg-cyan-400/10 text-slate-900 text-sm font-black flex items-center justify-center gap-2 cursor-pointer hover:bg-cyan-400/20">
        <span class="w-2.5 h-2.5 rounded-full bg-cyan-400"></span> Wave
      </button>
      <button type="button" onclick="payWith('o')" class="p-3.5 rounded-xl border-2 border-orange-500 bg-orange-500/10 text-slate-900 text-sm font-black flex items-center justify-center gap-2 cursor-pointer hover:bg-orange-500/20">
        <span class="w-2.5 h-2.5 rounded-full bg-orange-500"></span> Orange Money
      </button>
    </div>
    <p class="text-[11px] text-slate-500 pt-1">Après le paiement, renseignez votre numéro et la référence reçue par SMS :</p>
    <form data-f="pay" class="space-y-3">
      ${fld('Numéro qui a payé', 'phone', 'tel', 'required placeholder="77 000 00 00"')}
      ${fld('Référence de transaction (reçue par SMS)', 'ref', 'text', 'required minlength="6" placeholder="Ex. TX123456789"')}
      <div class="flex justify-end gap-2 pt-2">
        <button type="button" onclick="closeModal()" class="px-4 py-2 rounded-xl text-xs bg-slate-100 text-slate-600 cursor-pointer">Annuler</button>
        <button class="px-4 py-2 rounded-xl text-xs bg-orange-500 hover:bg-orange-600 text-white font-bold cursor-pointer shadow-md shadow-orange-500/30">Activer mon abonnement</button>
      </div>
    </form>
  </div>`);
}

function chooseTruckPack() {
  const isAnn = billingCycle === 'annual';
  const unit = PACK_PRICES.truck;
  const monthlyTotal = unit * selectedTrucksCount;
  const totalToPay = isAnn ? monthlyTotal * 10 : monthlyTotal; // -2 mois offerts si annuel

  calc = {
    planCode: 'fleet_custom',
    planLabel: 'Flotte (' + selectedTrucksCount + ' camion' + (selectedTrucksCount > 1 ? 's' : '') + ')',
    camions: selectedTrucksCount,
    isAnnual: isAnn,
    total: totalToPay
  };
  payMe = 'w';

  openModal(`<div class="border-b border-slate-200 pb-3">
    <div class="inline-flex items-center space-x-1.5 bg-amber-500/10 text-amber-700 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase mb-1">
      <i class="fa-solid fa-truck text-amber-600"></i><span>Abonnement Flotte Camions</span>
    </div>
    <h3 class="text-lg font-black text-slate-900">Abonnement Parc : ${selectedTrucksCount} camion(s)</h3>
    <p class="text-xs text-slate-500">${isAnn ? 'Facturation annuelle (-2 mois offerts : payez 10 mois pour 12)' : 'Facturation mensuelle sans engagement'}</p>
  </div>
  <div class="space-y-3 pt-3">
    <div class="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-1 text-xs">
      <div class="flex justify-between">
        <span class="text-slate-600">Tarif unitaire :</span>
        <b class="text-slate-900">${fm(unit)} FCFA / camion / mois</b>
      </div>
      <div class="flex justify-between">
        <span class="text-slate-600">Véhicules couverts :</span>
        <b class="text-slate-900">${selectedTrucksCount} camion(s)</b>
      </div>
      <div class="flex justify-between items-center text-sm font-black pt-1 border-t border-slate-200">
        <span class="text-slate-800">Total net à régler :</span>
        <span class="text-amber-700 text-lg">${fm(totalToPay)} FCFA ${isAnn ? '<span class="text-xs font-normal text-slate-500">pour 12 mois</span>' : '<span class="text-xs font-normal text-slate-500">/ mois</span>'}</span>
      </div>
    </div>

    <p class="text-xs text-slate-700">Réglez votre abonnement par Wave ou Orange Money :</p>
    <div class="grid grid-cols-2 gap-3">
      <button type="button" onclick="payWith('w')" class="p-3.5 rounded-xl border-2 border-cyan-400 bg-cyan-400/10 text-slate-900 text-sm font-black flex items-center justify-center gap-2 cursor-pointer hover:bg-cyan-400/20">
        <span class="w-2.5 h-2.5 rounded-full bg-cyan-400"></span> Wave
      </button>
      <button type="button" onclick="payWith('o')" class="p-3.5 rounded-xl border-2 border-orange-500 bg-orange-500/10 text-slate-900 text-sm font-black flex items-center justify-center gap-2 cursor-pointer hover:bg-orange-500/20">
        <span class="w-2.5 h-2.5 rounded-full bg-orange-500"></span> Orange Money
      </button>
    </div>
    <p class="text-[11px] text-slate-500 pt-1">Après le paiement, renseignez votre numéro et la référence reçue par SMS :</p>
    <form data-f="pay" class="space-y-3">
      ${fld('Numéro qui a payé', 'phone', 'tel', 'required placeholder="77 000 00 00"')}
      ${fld('Référence de transaction (reçue par SMS)', 'ref', 'text', 'required minlength="6" placeholder="Ex. TX123456789"')}
      <div class="flex justify-end gap-2 pt-2">
        <button type="button" onclick="closeModal()" class="px-4 py-2 rounded-xl text-xs bg-slate-100 text-slate-600 cursor-pointer">Annuler</button>
        <button class="px-4 py-2 rounded-xl text-xs bg-slate-900 hover:bg-slate-800 text-white font-bold cursor-pointer">Activer mon parc flotte</button>
      </div>
    </form>
  </div>`);
}

function subscribeNow() {
  chooseQuincPack('hybrid_b2b_b2c', 69900, 'Complet Hybride B2B + B2C');
}
function payWith(m) { payMe = m; openPayApp(); }
function copyNum() { try { navigator.clipboard.writeText(PAY.num); return true; } catch (e) { return false; } }
function openPayApp() {
  const l = payMe === 'w' ? PAY.wave : PAY.om, nom = payMe === 'w' ? 'Wave' : 'Orange Money';
  if (l) return window.open(l.replace('{amount}', Math.round(calc.total)).replace('{num}', PAY.num.replace(/\D/g, '')), '_blank');
  toast(copyNum() ? 'Le numéro du marchand est copié. Ouvrez ' + nom + ', choisissez Envoyer, collez-le et saisissez ' + fm(calc.total) + ' FCFA.' : 'Ouvrez ' + nom + ' puis contactez MargeUp pour finaliser le paiement.');
}

/* ---------- QUINCAILLERIE ---------- */
function renderInventory() {
  const D = scopeDepots();
  if (!D.find(d => d.id === selDepot)) selDepot = D.length ? D[0].id : null;
  $('depot-select').innerHTML = D.map(d => `<option value="${esc(d.id)}" ${d.id === selDepot ? 'selected' : ''}>${esc(d.nom)}</option>`).join('');
  const q = ($('stock-search').value || '').toLowerCase(), tb = $('inventory-table-body');
  const L = S.inventory.filter(i => i.depot === selDepot && (!q || (i.name + ' ' + i.cat).toLowerCase().includes(q)));
  tb.innerHTML = L.length ? L.map(i => {
    const isTonne = isCementOrTonne(i);
    const formattedQty = formatMaterialQty(i);
    let priceDisplay = '';
    if (isTonne) {
      priceDisplay = `<div><b class="text-slate-900">${fm(i.price)} FCFA</b> <span class="text-[11px] text-slate-500">/ sac</span></div>
        <div class="text-[10px] text-slate-500 font-medium">Tonne (20 sacs) : ${fm(i.price * 20)} FCFA</div>
        <div class="text-[10px] text-purple-700 font-medium">Gros : ${fm(i.priceGros || i.price)} FCFA/sac (${fm((i.priceGros || i.price) * 20)} F/t)</div>`;
    } else {
      priceDisplay = `<div><b class="text-slate-900">${fm(i.price)} FCFA</b></div><div class="text-[10px] text-slate-500">Gros : ${fm(i.priceGros || i.price)} FCFA</div>`;
    }
    return `<tr class="hover:bg-slate-50">
      <td class="p-4">
        <div class="font-bold text-slate-900">${esc(i.name)}</div>
        ${isTonne ? '<span class="inline-flex items-center gap-1 text-[10px] bg-amber-50 text-amber-800 font-bold px-2 py-0.5 rounded-full border border-amber-200 mt-0.5"><i class="fa-solid fa-scale-balanced text-[9px]"></i> 1 tonne = 20 sacs</span>' : ''}
      </td>
      <td class="p-4"><span class="bg-purple-500/10 text-purple-700 px-2 py-0.5 rounded border border-purple-500/20 text-[11px]">${esc(i.cat)}</span></td>
      <td class="p-4 font-bold ${i.qty <= (i.seuil || 0) ? 'text-amber-700' : 'text-emerald-700'}">
        <div class="text-sm font-black">${formattedQty}</div>
      </td>
      <td class="p-4">${priceDisplay}</td>
      <td class="p-4 text-slate-600">${esc(i.lastChantier || '—')}</td>
      <td class="p-4 text-right">
        <button onclick="openDispatchModal(${i.id})" class="bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg shadow-sm">
          Expédier vers Chantier
        </button>
      </td>
    </tr>`;
  }).join('')
    : '<tr><td colspan="6" class="p-6 text-center text-slate-500">Aucun article. Cliquez sur « Entrée en Stock / Nouvel Article ».</td></tr>';
  renderSales();
}
function setDepot(id) { selDepot = id; renderInventory(); }
function openDepotModal() {
  if (access() === 'sub' && S.depots.length >= S.sub.quinc) return toast('Votre abonnement couvre ' + S.sub.quinc + ' quincaillerie(s). Augmentez-le pour en ajouter.');
  openModal(formWrap('Nouvelle quincaillerie', 'depot', fld('Nom de la quincaillerie ou du dépôt', 'nom', 'text', 'required placeholder="Quincaillerie Rufisque"'), 'Créer'));
}
function openStockModal() {
  openModal(formWrap('Entrée en stock / Nouvel arrivage', 'stock',
    fld('Nom de l’article *', 'name', 'text', 'required placeholder="Ex. Ciment Dangote CPJ 42.5"') +
    '<div class="grid grid-cols-2 gap-3">' +
      fld('Catégorie', 'cat', 'text', 'placeholder="Ex. Cimenterie, Plomberie..."') +
      sel('Unité de référence', 'unit', [
        ['tonne', 'Tonnes (1 t = 20 sacs)'],
        ['sacs', 'Sacs de 50 kg'],
        ['mètres', 'Mètres (m)'],
        ['camions', 'Camions'],
        ['unités', 'Unités / Pièces']
      ]) +
    '</div>' +
    '<div class="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-xs text-amber-900 space-y-1">' +
      '<div class="font-bold flex items-center gap-1.5"><i class="fa-solid fa-scale-balanced text-amber-600"></i> Règle de conversion MargeUp : 1 tonne = 20 sacs (50 kg)</div>' +
      '<div>Pour le ciment, vous pouvez saisir en tonnes ou en sacs. L\'addition s\'effectuera toujours de façon exacte sans mélange erroné.</div>' +
    '</div>' +
    '<div class="grid grid-cols-2 gap-3">' +
      fld('Quantité reçue *', 'qty', 'number', 'required min="0.01" step="any" placeholder="Ex. 24 ou 500"') +
      sel('Unité saisie pour cet arrivage *', 'input_unit', [
        ['tonne', 'Tonnes (1 t = 20 sacs)'],
        ['sacs', 'Sacs de 50 kg (20 sacs = 1 t)'],
        ['unités', 'Même unité que l\'article']
      ]) +
    '</div>' +
    '<div class="grid grid-cols-2 gap-3">' +
      fld('Prix détail (FCFA / unité ou sac)', 'price', 'number', 'min="0" placeholder="Ex. 4250"') +
      fld('Prix gros (FCFA / unité ou sac)', 'priceGros', 'number', 'min="0" placeholder="Ex. 3800"') +
    '</div>' +
    '<p class="text-[11px] text-slate-500">Pour le ciment : 1 sac = 4 250 F (soit 1 tonne = 20 sacs = 85 000 F).</p>',
    'Enregistrer'));
}
function openDispatchModal(id) {
  const i = S.inventory.find(x => x.id == id); if (!i) return;
  if (!S.chantiers.length) return toast('Créez d’abord un chantier');
  const isTonne = isCementOrTonne(i);
  openModal(formWrap('Expédier vers Chantier : ' + esc(i.name), 'dispatch',
    `<input type="hidden" name="id" value="${i.id}">
     <div class="bg-purple-50 border border-purple-200 rounded-xl p-3 text-xs space-y-1">
       <div>Stock disponible actuel : <b class="text-purple-900">${formatMaterialQty(i)}</b></div>
       ${isTonne ? '<div class="text-[11px] text-purple-700 font-medium">Conversion automatique : 1 tonne = 20 sacs (50 kg)</div>' : ''}
     </div>` +
    sel('Chantier de destination', 'chantier', S.chantiers.map(c => [c.id, c.nom])) +
    (isTonne ? `
      <div class="grid grid-cols-2 gap-3">
        ${fld('Quantité à expédier', 'qty', 'number', 'required min="0.01" step="any" placeholder="Ex. 10"')}
        ${sel('Unité de sortie', 'dispatch_unit', [
          ['sacs', 'Sacs de 50 kg'],
          ['tonnes', 'Tonnes complètes']
        ])}
      </div>` : fld('Quantité à sortir (' + esc(i.unit) + ')', 'qty', 'number', `required min="0.01" max="${i.qty}" step="any"`)) +
    '<div id="dispErr" class="text-xs text-rose-600"></div>', 'Valider la sortie'));
}

/* ---------- FLOTTE ET PANNES ---------- */
function renderPannes() {
  const m = day().slice(0, 7), n = scopedPannes().filter(p => (p.date || '').startsWith(m)).length;
  $('pannes-count').textContent = n + ' panne' + (n > 1 ? 's' : '') + ' ce mois';
  $('pannes-table-body').innerHTML = scopedPannes().length ? scopedPannes().map(p => {
    let b = 'bg-amber-500/20 text-amber-600 border-amber-500/30'; if (p.severity === 'Critique') b = 'bg-rose-500/20 text-rose-600 border-rose-500/30'; if (p.severity === 'Faible') b = 'bg-slate-100 text-slate-600 border-slate-300';
    return `<tr class="hover:bg-slate-50"><td class="p-3 font-bold text-slate-900">${esc(p.vehicle)}</td><td class="p-3 text-slate-500">${esc(p.driver)}</td><td class="p-3 text-slate-600">${esc(p.diag)}</td><td class="p-3"><span class="px-2 py-0.5 rounded border text-[10px] font-bold ${b}">${esc(p.severity)}</span></td><td class="p-3 font-semibold text-amber-600">${esc(p.status)}</td><td class="p-3 font-bold text-slate-900">${fm(p.cost)} FCFA</td></tr>`;
  }).join('') : '<tr><td colspan="6" class="p-6 text-center text-slate-500">Aucune panne enregistrée.</td></tr>';
}
function carbStats0(f) { const m = day().slice(0, 7), c = f.carb || [], M = c.filter(x => (x.d || '').startsWith(m)); return { l: M.reduce((s, x) => s + x.l, 0), a: M.reduce((s, x) => s + (x.amount || 0), 0), last: c[0] }; }
function carbStats(f) {
  const m = day().slice(0, 7), c = f.carb || [], M = c.filter(x => (x.d || '').startsWith(m)), T = (f.trips || []).filter(x => (x.d || '').startsWith(m));
  return { l: M.reduce((s, x) => s + x.l, 0), a: M.reduce((s, x) => s + (x.amount || 0), 0), last: c[0], km: T.reduce((s, x) => s + (x.km || 0), 0), v: T.reduce((s, x) => s + (x.voyages || 0), 0), lastTrip: (f.trips || [])[0] };
}
function renderFleet() {
  $('fleet-cards-container').innerHTML = scopeFleet().length ? scopeFleet().map(f => `
    <div class="bg-slate-50 border border-slate-200 p-4 rounded-xl space-y-3">
      <img src="${TYPE_IMG[f.type] || TYPE_IMG.benne}" alt="${esc(f.name)}" loading="lazy" class="w-full h-28 object-cover rounded-lg">
      <div class="flex justify-between items-start gap-2"><div><div class="font-bold text-slate-900 text-sm">${esc(f.name)}</div><div class="text-[11px] text-slate-500">${esc(f.plate)} • Chauffeur: ${esc(f.driver)}</div></div>
      <span class="text-[10px] bg-slate-100 border border-slate-300 ${f.status === 'En Panne' ? 'text-rose-600' : 'text-amber-600'} px-2 py-0.5 rounded-full font-bold">${esc(f.status)}</span></div>
      ${(() => {
        const s = carbStats(f);
        return `<div class="bg-slate-100 rounded-lg p-2.5 text-[11px] text-slate-700 space-y-1.5">
          <div class="flex justify-between gap-2"><span class="text-slate-600">Carburant ce mois</span><b class="text-amber-700">${fm(s.l)} L · ${fm(s.a)} FCFA</b></div>
          <div class="flex justify-between gap-2"><span class="text-slate-600">Voyages · distance</span><b class="text-slate-900">${s.v} tour${s.v > 1 ? 's' : ''} · ${fm(s.km)} km</b></div>
          ${s.last ? `<div class="text-slate-600">Dernier plein : ${fr(s.last.d)}, ${fm(s.last.l)} L</div>` : '<div class="text-slate-500">Aucun plein enregistré</div>'}
          ${s.lastTrip ? `
            <div class="pt-1.5 border-t border-slate-200 text-slate-700">
              <span class="text-[10px] text-amber-800 font-bold uppercase block">Dernier trajet (${s.lastTrip.voyages || 1} tour${(s.lastTrip.voyages || 1) > 1 ? 's' : ''}) :</span>
              <div class="font-semibold text-slate-900 flex items-center gap-1.5 truncate mt-0.5" title="${esc(s.lastTrip.depart || '—')} ➔ ${esc(s.lastTrip.arrivee || '—')}">
                <i class="fa-solid fa-location-dot text-amber-600 text-[10px]"></i>
                <span class="truncate">${esc(s.lastTrip.depart || 'Départ non précisé')}</span>
                <i class="fa-solid fa-arrow-right text-[9px] text-slate-400 shrink-0"></i>
                <span class="truncate">${esc(s.lastTrip.arrivee || 'Arrivée non précisée')}</span>
              </div>
            </div>` : ''}
        </div>`;
      })()}
      <div class="flex flex-wrap gap-2">
        <button onclick="openFuelModal(${f.id})" class="flex-1 bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-bold py-1.5 rounded-lg">Plein carburant</button>
        <button onclick="openTripModal(${f.id})" class="flex-1 bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold py-1.5 rounded-lg flex items-center justify-center gap-1">
          <i class="fa-solid fa-route text-[10px] text-amber-400"></i> Tours & Lieux
        </button>
        <button onclick="openTruckTripsModal(${f.id})" class="px-2.5 py-1.5 text-[11px] bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold rounded-lg" title="Historique complet des tours de ce camion">
          <i class="fa-solid fa-list-check"></i>
        </button>
        <button onclick="delTruck(${f.id})" class="px-2 text-[11px] bg-slate-100 hover:bg-rose-100 hover:text-rose-600 text-slate-500 rounded-lg" title="Retirer de la flotte">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    </div>`).join('') : '<div class="md:col-span-3 text-center text-slate-500 text-xs p-6">Aucun camion. Cliquez sur « Ajouter un camion ».</div>';
}
function openTruckModal() {
  if (access() === 'sub' && S.fleet.length >= S.sub.trucks) return toast('Votre abonnement couvre ' + S.sub.trucks + ' camion(s). Augmentez-le pour en ajouter.');
  openModal(formWrap('Nouveau camion', 'truck',
    '<div class="grid grid-cols-2 gap-3">' + sel('Type de véhicule', 'type', [['tracteur', 'Tracteur / camion routier'], ['toupie', 'Toupie à béton'], ['benne', 'Camion benne / engin']]) + fld('Modèle', 'name', 'text', 'required placeholder="Shacman X3000"') + fld('Immatriculation', 'plate', 'text', 'required placeholder="DK-0000-AA"') + fld('Chauffeur', 'driver', 'text', 'required') + '</div>', 'Enregistrer'));
}
function delTruck(id) { if (!confirm('Retirer ce camion de la flotte ?')) return; S.fleet = S.fleet.filter(f => f.id != id); save(); renderAll(); }
function openFuelModal(id) {
  const f = S.fleet.find(x => x.id == id); if (!f) return;
  openModal(formWrap('Plein de carburant : ' + esc(f.name), 'fuel', `<input type="hidden" name="id" value="${f.id}">` +
    '<div class="grid grid-cols-2 gap-3">' + fld('Litres mis', 'l', 'number', 'required min="0" step="any"') + fld('Montant payé (FCFA)', 'amount', 'number', 'min="0"') + fld('Compteur kilométrique (facultatif)', 'km', 'number', 'min="0"') + fld('Station (facultatif)', 'station') + '</div>' +
    (S.chantiers.length ? sel('Ajouter aux dépenses du chantier (facultatif)', 'chantier', [['', 'Ne pas imputer']].concat(S.chantiers.map(c => [c.id, c.nom]))) : ''), 'Enregistrer le plein'));
}
function openTripModal(id) {
  const f = S.fleet.find(x => x.id == id); if (!f) return;
  const departSuggestions = ['Carrière Bargny', 'Carrière Sindia', 'Carrière Pout', 'Port Autonome de Dakar', 'Centrale à béton Rufisque', 'Dépôt principal'].concat(S.chantiers.map(c => c.nom.replace(/^Chantier\s*/i, '')));
  const arriveeSuggestions = S.chantiers.map(c => c.nom).concat(['Dakar Plateau', 'Diamniadio Ville Nouvelle', 'Thiès', 'Mbour', 'Lac Rose', 'Rufisque']);

  const departOpts = Array.from(new Set(departSuggestions)).map(s => `<option value="${esc(s)}"></option>`).join('');
  const arriveeOpts = Array.from(new Set(arriveeSuggestions)).map(s => `<option value="${esc(s)}"></option>`).join('');

  openModal(formWrap('Saisir voyages & lieux : ' + esc(f.name), 'trip',
    `<input type="hidden" name="id" value="${f.id}">
     <div class="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-xs text-amber-900 flex justify-between items-center">
       <div>Véhicule : <b>${esc(f.name)}</b> (${esc(f.plate)})</div>
       <div>Chauffeur : <b>${esc(f.driver)}</b></div>
     </div>
     <div class="grid grid-cols-2 gap-3">
       ${fld('Date *', 'd', 'date', `required value="${day()}"`)}
       ${fld('Nombre de voyages (tours) *', 'voyages', 'number', 'required min="1" value="1"')}
     </div>
     <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
       <label class="block text-xs font-semibold text-slate-500">
         Lieu de départ (chargement) *
         <input name="depart" list="list-depart" required placeholder="Ex. Carrière Bargny, Port Dakar..." class="${INPUT} mt-1">
         <datalist id="list-depart">${departOpts}</datalist>
       </label>
       <label class="block text-xs font-semibold text-slate-500">
         Lieu d'arrivée (destination / chantier) *
         <input name="arrivee" list="list-arrivee" required placeholder="Ex. Chantier Tour Diamniadio, Dakar..." class="${INPUT} mt-1">
         <datalist id="list-arrivee">${arriveeOpts}</datalist>
       </label>
     </div>
     <div class="grid grid-cols-2 gap-3">
       ${fld('Distance totale (km)', 'km', 'number', 'min="0" step="any" placeholder="Ex. 140"')}
       ${fld('Marchandise / Observations (facultatif)', 'obs', 'text', 'placeholder="Ex. Sable 0/4, Fer Ø12, Béton B25..."')}
     </div>`,
    'Enregistrer le voyage'));
}
function driverStats(period) {
  const m = day().slice(0, 7), inP = d => period === 'all' || (d || '').startsWith(m), map = {};
  scopeFleet().forEach(f => {
    const k = (f.driver || '—').trim(), s = map[k] = map[k] || { name: k, trucks: [], l: 0, a: 0, km: 0, v: 0, pannes: 0 };
    s.trucks.push(f.name);
    (f.carb || []).filter(x => inP(x.d)).forEach(x => { s.l += x.l; s.a += x.amount || 0; });
    (f.trips || []).filter(x => inP(x.d)).forEach(x => { s.km += x.km || 0; s.v += x.voyages || 0; });
  });
  S.pannes.forEach(p => { const s = map[(p.driver || '').trim()]; if (s && inP(p.date)) s.pannes++; });
  return Object.values(map).map(s => Object.assign(s, { l100: s.km > 0 ? s.l / s.km * 100 : null, lv: s.v > 0 ? s.l / s.v : null, has: s.l > 0 || s.km > 0 || s.v > 0 }));
}
function renderDrivers() {
  const per = $('rank-period').value || 'month', mode = $('rank-sort').value || 'score', D = driverStats(per);
  const wk = D.filter(x => x.l100 !== null), avg = wk.length ? wk.reduce((s, x) => s + x.l100, 0) / wk.length : null;
  D.forEach(x => { x.score = Math.max(0, Math.round(100 - 10 * x.pannes - (x.l100 !== null && avg ? Math.max(0, (x.l100 / avg - 1) * 100) : 0))); });
  const big = 1e9, key = { score: x => -x.score, l100: x => x.l100 === null ? big : x.l100, lv: x => x.lv === null ? big : x.lv }[mode];
  D.sort((x, y) => (y.has - x.has) || (key(x) - key(y)) || ((x.l100 === null ? big : x.l100) - (y.l100 === null ? big : y.l100)));
  const f1 = v => v === null ? '—' : v.toFixed(1).replace('.', ','), best = D.find(x => x.has && (mode === 'score' || key(x) < big));
  $('driver-best').innerHTML = best ? `<div class="bg-amber-500/10 border border-amber-500/40 rounded-xl p-4 flex flex-wrap items-center gap-3"><i class="fa-solid fa-trophy text-amber-600 text-2xl"></i><div class="flex-1 min-w-0"><div class="text-xs text-amber-800 font-semibold">Meilleur chauffeur à primer</div><div class="text-lg font-black text-slate-900">${esc(best.name)}</div><div class="text-[11px] text-slate-700">${fm(best.l)} L pour ${fm(best.km)} km et ${best.v} voyage(s) · ${f1(best.l100)} L/100 km · ${f1(best.lv)} L/voyage · ${best.pannes} panne(s)</div></div><div class="text-2xl font-black text-amber-700">${best.score}<span class="text-xs font-normal text-slate-600">/100</span></div></div>` : '<div class="text-xs text-slate-600">Saisissez des pleins et des voyages pour désigner le meilleur chauffeur.</div>';
  $('driver-table-body').innerHTML = D.length ? D.map((x, i) => `<tr class="hover:bg-slate-50 ${best && x === best ? 'bg-amber-500/5' : ''}"><td class="p-3 font-black text-slate-700">${x.has ? i + 1 : '—'}</td><td class="p-3"><div class="font-bold text-slate-900">${esc(x.name)}</div><div class="text-[10px] text-slate-600">${esc(x.trucks.join(', '))}</div></td><td class="p-3 text-slate-700">${fm(x.l)} L<div class="text-[10px] text-slate-600">${fm(x.a)} FCFA</div></td><td class="p-3 text-slate-700">${fm(x.km)} km</td><td class="p-3 text-slate-700">${x.v}</td><td class="p-3 font-bold text-slate-900">${f1(x.l100)}</td><td class="p-3 font-bold text-slate-900">${f1(x.lv)}</td><td class="p-3 ${x.pannes ? 'text-rose-700' : 'text-slate-700'}">${x.pannes}</td><td class="p-3 font-black ${x.score >= 80 ? 'text-emerald-700' : x.score >= 60 ? 'text-amber-700' : 'text-rose-700'}">${x.score}</td><td class="p-3">${best && x === best ? '<span class="text-[10px] bg-amber-500 text-slate-950 px-2 py-0.5 rounded-full font-bold">À primer</span>' : ''}</td></tr>`).join('') : '<tr><td colspan="10" class="p-6 text-center text-slate-600">Aucun chauffeur. Ajoutez un camion avec son chauffeur.</td></tr>';
}
function openPanneModal() {
  if (!S.fleet.length) return toast('Ajoutez d’abord un camion');
  openModal(formWrap('Signaler une panne', 'panne', sel('Camion', 'fid', scopeFleet().map(f => [f.id, f.name + ' (' + f.plate + ')'])) + fld('Diagnostic / motif', 'diag', 'text', 'required') +
    '<div class="grid grid-cols-2 gap-3">' + sel('Gravité', 'sev', [['Faible', 'Faible'], ['Moyenne', 'Moyenne'], ['Critique', 'Critique']]) + sel('Statut', 'st', [['En Réparation', 'En réparation'], ['En Attente Pièce', 'En attente de pièce'], ['Terminé', 'Terminé']]) + '</div>' + fld('Coût estimé (FCFA)', 'cost', 'number', 'min="0" value="0"'), 'Enregistrer la panne'));
}

/* ---------- CHANTIERS, DÉPENSES, BÂTIMENTS ---------- */
const spent = cid => S.expenses.filter(e => e.chantier === cid).reduce((s, e) => s + e.amount, 0);
const batPct = b => Math.round(PHASES.reduce((s, p) => s + (b.ph[p[0]] || 0), 0) / PHASES.length);
function batTime(b) {
  const p = batPct(b);
  let leftTxt = 'Date non renseignée', leftBad = false;
  if (b.prevision) { const l = daysLeft(b.prevision); leftBad = l < 0 && p < 100; leftTxt = p >= 100 ? 'Terminé' : l < 0 ? Math.abs(l) + ' jour(s) de retard' : l === 0 ? 'Dernier jour' : l + ' jour(s) restant(s)'; }
  let proj = null, projTxt = 'Pas assez de données', warn = false;
  if (p >= 100) projTxt = 'Terminé';
  else if (b.debut && p > 0) {
    const el = -daysLeft(b.debut);
    if (el > 0) { proj = addDays(b.debut, Math.round(el / (p / 100))); const ec = b.prevision ? Math.round((new Date(proj + 'T12:00') - new Date(b.prevision + 'T12:00')) / 864e5) : 0; warn = ec > 0; projTxt = !b.prevision ? 'Sans prévision à comparer' : ec > 0 ? '≈ ' + ec + ' jour(s) après la prévision' : 'Dans les temps'; }
  }
  const late = p < 100 && (b.prevision ? daysLeft(b.prevision) < 0 : !!(b.livraison && b.livraison < day()));
  return { leftTxt, leftBad, proj, projTxt, warn, late };
}
function renderChantiers() {
  const sl = $('selectedChantierFilter');
  if (!scopeChantiers().length) { sl.innerHTML = '<option>Aucun chantier</option>'; selChantier = null; } else {
    if (!scopeChantiers().find(c => c.id === selChantier)) selChantier = scopeChantiers()[0].id;
    sl.innerHTML = scopeChantiers().map(c => `<option value="${esc(c.id)}" ${c.id === selChantier ? 'selected' : ''}>${esc(c.nom)}</option>`).join('');
  }
  const c = S.chantiers.find(x => x.id === selChantier);
  const L = S.expenses.filter(e => e.chantier === selChantier);
  $('expenses-table-body').innerHTML = L.length ? L.map(e => `<tr class="hover:bg-slate-50"><td class="p-3 text-slate-500">${fr(e.date)}</td><td class="p-3 font-bold text-slate-900">${esc(e.title)}<div class="text-[10px] text-slate-500">${esc(e.cat || '')}</div></td><td class="p-3"><span class="text-[11px] text-purple-600 bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/20">${esc(e.source)}</span></td><td class="p-3 font-bold text-orange-600">${fm(e.amount)} FCFA</td><td class="p-3"><button onclick="delExpense(${e.id})" class="text-[10px] text-slate-500 hover:text-rose-600">Supprimer</button></td></tr>`).join('') : '<tr><td colspan="5" class="p-6 text-center text-slate-500">Aucune dépense pour ce chantier.</td></tr>';
  const sp = c ? spent(c.id) : 0, bud = c ? c.budget : 0, pc = bud ? Math.min(100, Math.round(sp / bud * 100)) : 0;
  $('budget-box').innerHTML = c ? `<div class="flex justify-between font-bold"><span class="text-slate-500">Budget alloué:</span><span class="text-slate-900">${fm(bud)} FCFA</span></div><div class="flex justify-between font-bold"><span class="text-slate-500">Total dépensé:</span><span class="text-orange-600">${fm(sp)} FCFA</span></div><div class="flex justify-between font-bold"><span class="text-slate-500">Reste:</span><span class="${bud - sp < 0 ? 'text-rose-600' : 'text-emerald-600'}">${fm(bud - sp)} FCFA</span></div><div class="w-full bg-slate-100 rounded-full h-2"><div class="${pc >= 90 ? 'bg-rose-500' : 'bg-orange-500'} h-2 rounded-full" style="width:${pc}%"></div></div><span class="text-[10px] text-slate-500">${pc}% du budget consommé</span>` : '<span class="text-slate-500">Créez un chantier pour suivre son budget.</span>';
  if (S.co && curRole !== 'ceo') $('budget-box').innerHTML = '<div class="text-slate-600">Le budget et les marges sont visibles uniquement par la direction.</div>';
  const B = S.batiments.filter(b => b.chantier === selChantier);
  $('batiments-grid').innerHTML = B.length ? B.map(b => {
    const p = batPct(b), t = batTime(b);
    const badge = p >= 100 ? '<span class="text-[10px] bg-emerald-500/20 text-emerald-700 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold">Terminé</span>' : t.late ? '<span class="text-[10px] bg-rose-500/20 text-rose-700 border border-rose-500/30 px-2 py-0.5 rounded-full font-bold whitespace-nowrap">En retard</span>' : '';
    return `<div class="bg-slate-50 border ${t.late ? 'border-rose-500/40' : 'border-slate-200'} rounded-xl overflow-hidden"><img src="images/immeubles.jpg" alt="" loading="lazy" class="w-full h-20 object-cover"><div class="p-4 space-y-3">
      <div class="flex justify-between items-start gap-2"><div class="space-y-0.5"><div class="font-bold text-slate-900 text-sm">${esc(b.nom)}</div><div class="text-[11px] text-slate-600">Niveau en cours : <b class="text-slate-900">${b.niveauActuel == null ? '—' : b.niveauActuel} / ${b.niveaux || '?'}</b></div><div class="text-[11px] text-slate-600">Ingénieur chargé : <b class="text-slate-900">${esc(b.ingenieur || '—')}</b></div><div class="text-[11px] text-slate-600">Chef de chantier : ${esc(b.resp || '—')}</div></div>${badge}</div>
      <div><div class="flex justify-between text-[11px] font-semibold mb-1"><span class="text-slate-600">Avancement global</span><span class="text-orange-700">${p}%</span></div><div class="w-full bg-slate-100 rounded-full h-2.5"><div class="bg-orange-500 h-2.5 rounded-full" style="width:${p}%"></div></div></div>
      <div class="grid grid-cols-7 gap-1">${PHASES.map(ph => `<div title="${esc(ph[1])} : ${b.ph[ph[0]] || 0}%" class="h-1.5 rounded bg-slate-100 overflow-hidden"><div class="h-full bg-emerald-500" style="width:${b.ph[ph[0]] || 0}%"></div></div>`).join('')}</div>
      <div class="grid grid-cols-2 gap-2 text-[11px]">
        <div class="bg-slate-100 rounded-lg p-2"><div class="text-slate-600">Prévision de l’ingénieur</div><div class="text-slate-900 font-bold">${fr(b.prevision)}</div><div class="font-semibold ${t.leftBad ? 'text-rose-700' : 'text-emerald-700'}">${t.leftTxt}</div></div>
        <div class="bg-slate-100 rounded-lg p-2"><div class="text-slate-600">Projection selon l’avancement</div><div class="text-slate-900 font-bold">${t.proj ? fr(t.proj) : '—'}</div><div class="font-semibold ${t.warn ? 'text-rose-700' : 'text-emerald-700'}">${t.projTxt}</div></div>
      </div>
      ${b.note ? `<div class="text-[11px] text-slate-700 bg-white rounded-lg p-2"><i class="fa-solid fa-comment-dots text-orange-600"></i> ${esc(b.note)}</div>` : ''}
      <div class="text-[10px] text-slate-500">Début : ${fr(b.debut)} · Livraison contractuelle : ${fr(b.livraison)}</div>
      <div class="flex gap-2"><button onclick="openBatUpdate('${b.id}')" class="flex-1 bg-orange-500 hover:bg-orange-600 text-white text-[11px] font-bold py-1.5 rounded-lg">Mettre à jour l’avancement</button><button onclick="openBatModal('${b.id}')" class="px-2.5 text-[11px] bg-slate-200 text-slate-900 rounded-lg">Modifier</button><button onclick="delBat('${b.id}')" class="px-2.5 text-[11px] bg-slate-100 text-slate-600 rounded-lg">Retirer</button></div></div></div>`;
  }).join('') : '<div class="md:col-span-2 xl:col-span-3 text-center text-slate-500 text-xs p-6">Aucun bâtiment pour ce chantier. Cliquez sur « Ajouter un bâtiment ».</div>';
  if (c && B.length) {
    const avg = Math.round(B.reduce((s, b) => s + batPct(b), 0) / B.length), fins = B.map(b => b.prevision).filter(Boolean).sort(), last = fins[fins.length - 1], dl = last ? daysLeft(last) : 0;
    $('budget-box').innerHTML += `<div class="border-t border-slate-300 pt-2 mt-2 space-y-1"><div class="flex justify-between font-bold"><span class="text-slate-600">Avancement moyen des bâtiments :</span><span class="text-slate-900">${avg}%</span></div>${last ? `<div class="flex justify-between font-bold"><span class="text-slate-600">Fin prévue (ingénieur) :</span><span class="${dl < 0 ? 'text-rose-700' : 'text-slate-900'}">${fr(last)} · ${dl < 0 ? Math.abs(dl) + ' j de retard' : dl + ' j restants'}</span></div>` : ''}</div>`;
  }
}
function openChantierModal() {
  if (access() === 'sub' && S.chantiers.length >= S.sub.chantiers) return toast('Votre abonnement couvre ' + S.sub.chantiers + ' chantier(s). Augmentez-le pour en ajouter.');
  openModal(formWrap('Nouveau chantier', 'chantier', fld('Nom du chantier', 'nom', 'text', 'required placeholder="Chantier Lycée de Mbao"') + fld('Budget alloué (FCFA)', 'budget', 'number', 'required min="0"'), 'Créer le chantier'));
}
function openExpenseModal() {
  if (!S.chantiers.length) return toast('Créez d’abord un chantier');
  openModal(formWrap('Ajouter une dépense', 'expense', sel('Chantier', 'chantier', scopeChantiers().map(c => [c.id, c.nom])).replace(`value="${esc(selChantier)}"`, `value="${esc(selChantier)}" selected`) + fld('Désignation', 'title', 'text', 'required placeholder="100 sacs de ciment"') +
    '<div class="grid grid-cols-2 gap-3">' + sel('Catégorie', 'cat', [['Matériaux', 'Matériaux'], ['Carburant', 'Carburant'], ['Main d’œuvre', 'Main d’œuvre'], ['Autres', 'Autres']]) + fld('Montant (FCFA)', 'amount', 'number', 'required min="0"') + '</div>' + fld('Provenance (quincaillerie, fournisseur…)', 'source', 'text', 'placeholder="Fournisseur extérieur"'), 'Enregistrer la dépense'));
}
function delExpense(id) { if (!confirm('Supprimer cette dépense ?')) return; S.expenses = S.expenses.filter(e => e.id != id); save(); renderAll(); }
function openBatModal(id) {
  if (!S.chantiers.length) return toast('Créez d’abord un chantier');
  const b = S.batiments.find(x => x.id === id) || {};
  openModal(formWrap(id ? 'Modifier le bâtiment' : 'Nouveau bâtiment', 'bat',
    `<input type="hidden" name="id" value="${esc(b.id || '')}"><input type="hidden" name="chantier" value="${esc(b.chantier || selChantier)}">` +
    fld('Nom du bâtiment', 'nom', 'text', `required value="${esc(b.nom || '')}" placeholder="Bâtiment B, R+3"`) +
    '<div class="grid grid-cols-2 gap-3">' +
    fld('Nombre de niveaux (R+2 = 3)', 'niveaux', 'number', `min="1" value="${b.niveaux || ''}"`) +
    fld('Niveau en cours de construction', 'niveauActuel', 'number', `min="0" value="${b.niveauActuel == null ? '' : b.niveauActuel}"`) +
    fld('Ingénieur chargé', 'ingenieur', 'text', `value="${esc(b.ingenieur || '')}"`) +
    fld('Chef de chantier', 'resp', 'text', `value="${esc(b.resp || '')}"`) +
    fld('Date de début', 'debut', 'date', `value="${b.debut || ''}"`) +
    fld('Prévision de l’ingénieur (fin)', 'prevision', 'date', `value="${b.prevision || ''}"`) + '</div>' +
    fld('Livraison contractuelle', 'livraison', 'date', `value="${b.livraison || ''}"`) +
    fld('Observation de l’ingénieur (facultatif)', 'note', 'text', `value="${esc(b.note || '')}" placeholder="Ex. fin du gros œuvre avant la saison des pluies"`),
    id ? 'Enregistrer' : 'Ajouter le bâtiment'));
}
function openBatUpdate(id) {
  const b = S.batiments.find(x => x.id === id); if (!b) return;
  openModal(`<h3 class="text-base font-bold text-slate-900">${esc(b.nom)}</h3><p class="text-xs text-slate-500">Indiquez l’avancement de chaque étape (0 à 100 %).</p><form data-f="batup" class="space-y-3"><input type="hidden" name="id" value="${b.id}">${fld('Niveau en cours de construction (sur ' + (b.niveaux || '?') + ' niveaux)', 'niveauActuel', 'number', `min="0" value="${b.niveauActuel == null ? '' : b.niveauActuel}"`)}` +
    PHASES.map(p => `<label class="block text-xs font-semibold text-slate-600"><span class="flex justify-between"><span>${p[1]}</span><span class="text-orange-600">${b.ph[p[0]] || 0} %</span></span><input type="range" name="${p[0]}" min="0" max="100" step="5" value="${b.ph[p[0]] || 0}" oninput="this.previousElementSibling.lastElementChild.textContent=this.value+' %'" class="w-full accent-orange-500"></label>`).join('') +
    '<div class="flex justify-end gap-2 pt-2"><button type="button" onclick="closeModal()" class="px-4 py-2 rounded-xl text-xs bg-slate-100 text-slate-600">Annuler</button><button class="px-4 py-2 rounded-xl text-xs bg-orange-500 text-white font-bold">Enregistrer</button></div></form>');
}
function delBat(id) { if (!confirm('Retirer ce bâtiment ?')) return; S.batiments = S.batiments.filter(b => b.id !== id); save(); renderAll(); }
function renderChantierExpenses() { selChantier = $('selectedChantierFilter').value; renderChantiers(); }

/* ---------- TABLEAU DE BORD CEO ---------- */
function renderCeo() {
  const budget = S.chantiers.reduce((s, c) => s + c.budget, 0), dep = S.expenses.reduce((s, e) => s + e.amount, 0);
  const m = day().slice(0, 7), maint = S.pannes.filter(p => (p.date || '').startsWith(m)).reduce((s, p) => s + p.cost, 0), np = S.pannes.filter(p => (p.date || '').startsWith(m)).length;
  const reste = budget - dep;
  const ventesMois = S.sales.filter(s => (s.date || '').startsWith(m)).reduce((s, x) => s + x.total, 0);
  const nbFactures = S.sales.filter(s => (s.date || '').startsWith(m)).length;

  // 1. KPI Cards Épurées & Visuelles avec Icônes Parlantes
  const kpiCard = (icon, iconBg, iconColor, label, value, suffix, valueColor, sub) =>
    `<div class="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 hover:shadow-md transition">
      <div class="flex items-center gap-3">
        <span class="w-12 h-12 rounded-2xl ${iconBg} ${iconColor} flex items-center justify-center text-xl shadow-sm">
          <i class="${icon}"></i>
        </span>
        <span class="text-xs font-bold text-slate-500 uppercase tracking-wide">${label}</span>
      </div>
      <div class="text-2xl sm:text-3xl font-black ${valueColor}">${value} <span class="text-xs font-normal text-slate-500">${suffix}</span></div>
      <div class="text-xs text-slate-500">${sub}</div>
    </div>`;

  $('ceo-kpis').innerHTML =
    kpiCard('fa-solid fa-wallet', 'bg-blue-500/15', 'text-blue-600', 'Budget Total Chantiers', fm(budget), 'FCFA', 'text-slate-900', '<i class="fa-solid fa-building text-blue-500"></i> ' + S.chantiers.length + ' chantier' + (S.chantiers.length > 1 ? 's' : '')) +
    kpiCard('fa-solid fa-arrow-trend-down', 'bg-rose-500/15', 'text-rose-600', 'Dépenses Engagées', fm(dep), 'FCFA', 'text-rose-600', (budget ? '<div class="w-full bg-slate-100 rounded-full h-1.5 mt-1"><div class="bg-rose-500 h-1.5 rounded-full" style="width:' + Math.min(100, Math.round(dep / budget * 100)) + '%"></div></div><span class="text-[10px]">' + Math.round(dep / budget * 100) + '% du budget consommé</span>' : '—')) +
    kpiCard('fa-solid fa-piggy-bank', 'bg-emerald-500/15', 'text-emerald-600', 'Reste à Dépenser', fm(reste), 'FCFA', reste < 0 ? 'text-rose-600' : 'text-emerald-600', reste < 0 ? '<span class="text-rose-600 font-bold"><i class="fa-solid fa-triangle-exclamation"></i> Attention : dépassement</span>' : '<i class="fa-solid fa-check-circle text-emerald-500"></i> Dans les limites du budget') +
    kpiCard('fa-solid fa-wrench', 'bg-amber-500/15', 'text-amber-600', 'Entretien Flotte (Mois)', fm(maint), 'FCFA', 'text-amber-600', '<i class="fa-solid fa-truck text-amber-500"></i> ' + np + ' panne' + (np > 1 ? 's' : '') + ' enregistrée' + (np > 1 ? 's' : ''));

  // 2. Santé des Chantiers (Suivi visuel direct)
  const healthEl = $('ceo-chantiers-health');
  if (healthEl) {
    if (S.chantiers.length) {
      healthEl.innerHTML = S.chantiers.map(c => {
        const sp = spent(c.id);
        const pc = c.budget ? Math.min(100, Math.round(sp / c.budget * 100)) : 0;
        const over = sp > c.budget;
        const barColor = pc >= 90 ? 'bg-rose-500' : pc >= 70 ? 'bg-amber-500' : 'bg-emerald-500';
        const badge = over
          ? '<span class="inline-flex items-center gap-1 bg-rose-50 text-rose-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-rose-200"><i class="fa-solid fa-circle-exclamation"></i> Dépassement</span>'
          : pc >= 90
          ? '<span class="inline-flex items-center gap-1 bg-amber-50 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-200"><i class="fa-solid fa-triangle-exclamation"></i> Budget à 90%</span>'
          : '<span class="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-200"><i class="fa-solid fa-circle-check"></i> Dans le budget</span>';

        return `<div class="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
          <div class="flex items-center justify-between gap-2">
            <div class="font-bold text-slate-900 text-sm truncate">${esc(c.nom.replace('Chantier ', ''))}</div>
            ${badge}
          </div>
          <div class="w-full bg-slate-200 rounded-full h-2.5">
            <div class="${barColor} h-2.5 rounded-full transition-all" style="width:${pc}%"></div>
          </div>
          <div class="flex justify-between items-center text-[11px] text-slate-600 pt-0.5">
            <span>Dépensé : <b class="text-slate-900">${fm(sp)}</b> FCFA</span>
            <span>Reste : <b class="${c.budget - sp < 0 ? 'text-rose-600' : 'text-emerald-700'}">${fm(c.budget - sp)}</b> FCFA</span>
          </div>
        </div>`;
      }).join('');
    } else {
      healthEl.innerHTML = '<div class="text-center text-xs text-slate-500 py-6"><i class="fa-solid fa-building text-slate-400 text-2xl mb-2"></i><br>Aucun chantier actif. Cliquez sur « Nouveau chantier » pour démarrer le suivi.</div>';
    }
  }

  // 3. Vue Rapide de l'Entreprise (Flotte, Carburant, Stock, Ventes)
  const quickEl = $('ceo-quick-view');
  if (quickEl) {
    const fleetTotal = S.fleet.length;
    const enPanne = S.fleet.filter(f => f.status === 'En Panne').length;
    const carbMois = S.fleet.reduce((s, f) => s + (f.carb || []).filter(x => (x.d || '').startsWith(m)).reduce((a, x) => a + (x.amount || 0), 0), 0);
    const stockItems = S.inventory.length;
    const lowStock = S.inventory.filter(i => i.qty <= (i.seuil || 0)).length;

    const qRow = (icon, iconBg, label, val, sub) =>
      `<div class="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3">
        <span class="w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center text-lg shrink-0">${icon}</span>
        <div class="flex-1 min-w-0">
          <div class="text-xs text-slate-500 font-semibold">${label}</div>
          <div class="text-base font-black text-slate-900">${val}</div>
        </div>
        <div class="text-[11px] text-slate-500 text-right shrink-0">${sub}</div>
      </div>`;

    quickEl.innerHTML =
      qRow('<i class="fa-solid fa-truck text-amber-600"></i>', 'bg-amber-500/15', 'Flotte Camions', fleetTotal + ' véhicule' + (fleetTotal > 1 ? 's' : ''), enPanne > 0 ? '<span class="text-rose-600 font-bold">' + enPanne + ' en panne</span>' : '<span class="text-emerald-700 font-bold"><i class="fa-solid fa-check"></i> Opérationnels</span>') +
      qRow('<i class="fa-solid fa-gas-pump text-orange-600"></i>', 'bg-orange-500/15', 'Gazole ce mois', fm(carbMois) + ' FCFA', 'Consommation globale') +
      qRow('<i class="fa-solid fa-boxes-stacked text-purple-600"></i>', 'bg-purple-500/15', 'Articles en Stock', stockItems + ' référence' + (stockItems > 1 ? 's' : ''), lowStock > 0 ? '<span class="text-amber-700 font-bold">' + lowStock + ' en alerte stock</span>' : '<span class="text-emerald-700 font-bold">Stocks suffisants</span>') +
      qRow('<i class="fa-solid fa-cash-register text-emerald-600"></i>', 'bg-emerald-500/15', 'Ventes du Mois', fm(ventesMois) + ' FCFA', nbFactures + ' facture' + (nbFactures > 1 ? 's' : '') + ' émise' + (nbFactures > 1 ? 's' : ''));
  }

  // 4. Alertes et Points d'Attention Immédiats
  const alertsEl = $('ceo-alerts');
  if (alertsEl) {
    const alerts = [];
    S.chantiers.forEach(c => {
      const sp = spent(c.id);
      if (sp > c.budget) alerts.push({ icon: 'fa-solid fa-circle-exclamation', color: 'text-rose-600', bg: 'bg-rose-50 border-rose-200', text: '<b>Chantier ' + esc(c.nom) + '</b> : budget dépassé de <b class="text-rose-700">' + fm(sp - c.budget) + ' FCFA</b>.' });
      else if (c.budget && sp / c.budget >= 0.9) alerts.push({ icon: 'fa-solid fa-triangle-exclamation', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200', text: '<b>Chantier ' + esc(c.nom) + '</b> : <b class="text-amber-700">' + Math.round(sp / c.budget * 100) + '%</b> du budget alloué a déjà été dépensé.' });
    });
    S.batiments.forEach(b => {
      const t = batTime(b);
      if (t.late) alerts.push({ icon: 'fa-solid fa-clock', color: 'text-rose-600', bg: 'bg-rose-50 border-rose-200', text: '<b>Bâtiment ' + esc(b.nom) + '</b> : retard constaté (' + t.leftTxt + ').' });
    });
    const unresolvedPannes = S.pannes.filter(p => p.status !== 'Terminé');
    if (unresolvedPannes.length) alerts.push({ icon: 'fa-solid fa-wrench', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200', text: '<b>' + unresolvedPannes.length + ' camion' + (unresolvedPannes.length > 1 ? 's' : '') + ' en panne</b> : réparation requise pour relancer les rotations.' });
    const lowItems = S.inventory.filter(i => i.qty <= (i.seuil || 0));
    if (lowItems.length) alerts.push({ icon: 'fa-solid fa-boxes-stacked', color: 'text-purple-600', bg: 'bg-purple-50 border-purple-200', text: '<b>Stock faible</b> sur ' + lowItems.slice(0, 3).map(i => esc(i.name)).join(', ') + (lowItems.length > 3 ? '…' : '') + '.' });

    if (alerts.length) {
      alertsEl.innerHTML = alerts.map(a => `<div class="flex items-start gap-3 ${a.bg} border rounded-xl p-3 text-xs">
        <i class="${a.icon} ${a.color} mt-0.5 text-sm"></i>
        <span class="text-slate-800">${a.text}</span>
      </div>`).join('');
    } else {
      alertsEl.innerHTML = '<div class="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-xs"><i class="fa-solid fa-circle-check text-emerald-600 text-lg"></i><span class="text-emerald-800 font-bold">Situation excellente : tous les chantiers sont dans les clous et la flotte est opérationnelle.</span></div>';
    }
  }
}

/* ---------- VOYAGES, LIEUX & ROTATIONS FLOTTE ---------- */
function openQuickTripModal() {
  const fl = scopeFleet();
  if (!fl.length) return toast('Ajoutez d’abord un camion à votre flotte.');
  if (fl.length === 1) return openTripModal(fl[0].id);
  openModal(`<h3 class="text-base font-bold text-slate-900">Choisir le camion pour le voyage</h3>
    <p class="text-xs text-slate-600 mb-3">Sélectionnez le camion pour lequel vous saisissez des tours et les lieux de rotation.</p>
    <div class="space-y-2">
      ${fl.map(f => `
        <button onclick="closeModal(); openTripModal(${f.id})" class="w-full text-left p-3 rounded-xl border border-slate-200 hover:border-amber-500 hover:bg-amber-50 transition flex justify-between items-center cursor-pointer">
          <div>
            <div class="font-bold text-slate-900 text-sm">${esc(f.name)} (${esc(f.plate)})</div>
            <div class="text-xs text-slate-500">Chauffeur : ${esc(f.driver)}</div>
          </div>
          <i class="fa-solid fa-arrow-right text-amber-600"></i>
        </button>`).join('')}
    </div>
    <div class="flex justify-end pt-3">
      <button onclick="closeModal()" class="px-4 py-2 rounded-xl text-xs bg-slate-100 text-slate-600 cursor-pointer">Fermer</button>
    </div>`);
}

function openTruckTripsModal(id) {
  const f = S.fleet.find(x => x.id == id); if (!f) return;
  const trips = f.trips || [];
  openModal(`
    <div class="flex justify-between items-center border-b border-slate-200 pb-3">
      <div>
        <h3 class="text-base font-bold text-slate-900">Historique des voyages : ${esc(f.name)}</h3>
        <p class="text-xs text-slate-500">${esc(f.plate)} • Chauffeur : ${esc(f.driver)}</p>
      </div>
      <button onclick="closeModal(); openTripModal(${f.id})" class="bg-amber-600 hover:bg-amber-500 text-white font-bold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 cursor-pointer">
        <i class="fa-solid fa-plus"></i> Saisir un tour
      </button>
    </div>
    <div class="max-h-96 overflow-y-auto space-y-2.5 my-3 custom-scrollbar pr-1">
      ${trips.length ? trips.map((t, idx) => `
        <div class="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs space-y-1.5">
          <div class="flex justify-between items-center">
            <span class="font-bold text-slate-900">${fr(t.d)}</span>
            <span class="bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded-full text-[10px]">${t.voyages || 1} tour${(t.voyages || 1) > 1 ? 's' : ''} · ${fm(t.km || 0)} km</span>
          </div>
          <div class="flex items-center gap-1.5 text-slate-800 font-medium">
            <i class="fa-solid fa-location-dot text-amber-600 text-[10px]"></i>
            <span>${esc(t.depart || 'Lieu départ non précisé')}</span>
            <i class="fa-solid fa-arrow-right text-[10px] text-slate-400"></i>
            <span>${esc(t.arrivee || 'Lieu arrivée non précisé')}</span>
          </div>
          ${t.obs ? `<div class="text-[11px] text-slate-500 italic bg-white p-1.5 rounded border border-slate-100">${esc(t.obs)}</div>` : ''}
          <div class="flex justify-end pt-1">
            <button onclick="delTrip(${f.id}, ${idx})" class="text-[11px] text-rose-600 hover:underline cursor-pointer">Supprimer ce voyage</button>
          </div>
        </div>
      `).join('') : '<div class="text-center text-xs text-slate-500 py-6">Aucun voyage enregistré pour ce camion.</div>'}
    </div>
    <div class="flex justify-end pt-2 border-t border-slate-200">
      <button onclick="closeModal()" class="px-4 py-2 rounded-xl text-xs bg-slate-100 text-slate-600 cursor-pointer">Fermer</button>
    </div>
  `);
}

function delTrip(truckId, idx) {
  if (!confirm('Voulez-vous supprimer ce voyage / rotation ?')) return;
  const f = S.fleet.find(x => x.id == truckId);
  if (!f || !f.trips) return;
  f.trips.splice(idx, 1);
  save();
  renderAll();
  closeModal();
  toast('Voyage supprimé');
}

function renderTripsJournal() {
  const selFilter = $('filter-trips-truck');
  const fl = scopeFleet();
  if (selFilter) {
    const curVal = selFilter.value || 'all';
    selFilter.innerHTML = '<option value="all">Tous les camions</option>' + fl.map(f => `<option value="${f.id}" ${String(curVal) === String(f.id) ? 'selected' : ''}>${esc(f.name)} (${esc(f.plate)})</option>`).join('');
  }
  const filterVal = selFilter ? selFilter.value : 'all';
  const targetFleet = filterVal === 'all' ? fl : fl.filter(f => String(f.id) === String(filterVal));

  const allTrips = [];
  targetFleet.forEach(f => {
    (f.trips || []).forEach((t, idx) => {
      allTrips.push({
        truckId: f.id,
        truckName: f.name,
        truckPlate: f.plate,
        driver: f.driver,
        tripIdx: idx,
        d: t.d || '',
        voyages: t.voyages || 1,
        km: t.km || 0,
        depart: t.depart || '—',
        arrivee: t.arrivee || '—',
        obs: t.obs || ''
      });
    });
  });

  allTrips.sort((a, b) => (b.d || '').localeCompare(a.d || ''));

  const tbody = $('trips-journal-body');
  if (!tbody) return;
  tbody.innerHTML = allTrips.length ? allTrips.map(t => `
    <tr class="hover:bg-slate-50 transition">
      <td class="p-3 font-semibold text-slate-900 whitespace-nowrap">${fr(t.d)}</td>
      <td class="p-3">
        <div class="font-bold text-slate-900">${esc(t.truckName)}</div>
        <div class="text-[10px] text-slate-500">${esc(t.truckPlate)}</div>
      </td>
      <td class="p-3 font-medium text-slate-700">${esc(t.driver)}</td>
      <td class="p-3">
        <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
          ${t.voyages} tour${t.voyages > 1 ? 's' : ''}
        </span>
      </td>
      <td class="p-3">
        <div class="flex items-center gap-1.5 font-medium text-slate-900">
          <i class="fa-solid fa-location-dot text-amber-600 text-[10px]"></i>
          <span>${esc(t.depart)}</span>
        </div>
      </td>
      <td class="p-3">
        <div class="flex items-center gap-1.5 font-medium text-slate-900">
          <i class="fa-solid fa-flag-checkered text-emerald-600 text-[10px]"></i>
          <span>${esc(t.arrivee)}</span>
        </div>
      </td>
      <td class="p-3 text-slate-700 whitespace-nowrap">${t.km ? fm(t.km) + ' km' : '—'}</td>
      <td class="p-3 text-slate-500 italic max-w-xs truncate">${esc(t.obs || '—')}</td>
      <td class="p-3 text-right">
        <button onclick="delTrip(${t.truckId}, ${t.tripIdx})" class="text-slate-400 hover:text-rose-600 transition p-1 cursor-pointer" title="Supprimer ce voyage">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </td>
    </tr>
  `).join('') : '<tr><td colspan="9" class="p-6 text-center text-slate-500">Aucun voyage enregistré. Cliquez sur « Saisir un voyage / tour » pour enregistrer les rotations et les lieux.</td></tr>';
}

/* ---------- AVIS DES UTILISATEURS ---------- */
function renderReviews() {
  const container = $('reviews-container');
  if (!container) return;
  const list = S.reviews || [];
  if (!list.length) {
    container.innerHTML = '<div class="col-span-2 text-center text-xs text-slate-500 p-6">Aucun avis pour le moment. Soyez le premier à donner votre avis !</div>';
    return;
  }
  container.innerHTML = list.map(r => {
    const initials = (r.author || 'M').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const stars = Array.from({ length: 5 }, (_, i) => `<i class="fa-solid fa-star ${i < (r.rating || 5) ? 'text-amber-400' : 'text-slate-200'}"></i>`).join('');
    return `
      <div class="bg-white border border-slate-200 rounded-2xl p-5 space-y-3.5 hover:shadow-md transition">
        <div class="flex items-start justify-between gap-3">
          <div class="flex items-center space-x-3">
            <div class="w-11 h-11 rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 text-white font-black text-sm flex items-center justify-center shadow-md shadow-orange-500/20 shrink-0">
              ${initials}
            </div>
            <div>
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-bold text-slate-900 text-sm">${esc(r.author)}</span>
                <span class="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-200">
                  <i class="fa-solid fa-circle-check text-[9px]"></i> Client vérifié
                </span>
              </div>
              <div class="text-xs text-slate-500">${esc(r.role)} • <span class="text-slate-700 font-semibold">${esc(r.company)}</span></div>
            </div>
          </div>
          <div class="flex items-center text-xs space-x-0.5 shrink-0">
            ${stars}
          </div>
        </div>

        <p class="text-xs text-slate-700 leading-relaxed italic bg-slate-50/70 p-3 rounded-xl border border-slate-100">
          « ${esc(r.text)} »
        </p>

        <div class="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-100">
          <span class="flex items-center gap-1 text-slate-600 font-medium">
            <i class="fa-solid fa-location-dot text-orange-500"></i> ${esc(r.city || 'Sénégal')}
          </span>
          <span class="bg-orange-50 text-orange-700 font-bold px-2 py-0.5 rounded-full text-[10px] border border-orange-200/50">
            ${esc(r.tag || 'BTP & Transport')}
          </span>
          <span>${fr(r.date)}</span>
        </div>
      </div>
    `;
  }).join('');
}

function openReviewModal() {
  openModal(formWrap('Partager votre avis d’utilisateur MargeUp', 'review',
    `<p class="text-xs text-slate-600">Votre retour d'expérience aide les entrepreneurs du BTP, transporteurs et quincaillers au Sénégal.</p>
     <div class="grid grid-cols-2 gap-3">
       ${fld('Votre nom & prénom *', 'author', 'text', 'required placeholder="Ex. Cheikh Oumar Diop"')}
       ${fld('Entreprise / Société *', 'company', 'text', 'required placeholder="Ex. Touba BTP SARL"')}
     </div>
     <div class="grid grid-cols-2 gap-3">
       ${fld('Votre fonction / poste *', 'role', 'text', 'required placeholder="Ex. Directeur des Travaux, Gérant..."')}
       ${sel('Ville / Région *', 'city', [
         ['Dakar', 'Dakar'],
         ['Diamniadio', 'Diamniadio'],
         ['Thiès', 'Thiès'],
         ['Rufisque', 'Rufisque'],
         ['Mbour', 'Mbour'],
         ['Saint-Louis', 'Saint-Louis'],
         ['Kaolack', 'Kaolack'],
         ['Ziguinchor', 'Ziguinchor'],
         ['Autre région', 'Autre région']
       ])}
     </div>
     <div class="grid grid-cols-2 gap-3">
       ${sel('Note globale *', 'rating', [
         ['5', '⭐⭐⭐⭐⭐ (5/5 Excellent)'],
         ['4', '⭐⭐⭐⭐ (4/5 Très bon)'],
         ['3', '⭐⭐⭐ (3/5 Bon)'],
         ['2', '⭐⭐ (2/5 Moyen)'],
         ['1', '⭐ (1/5 À améliorer)']
       ])}
       ${sel('Module principal utilisé', 'tag', [
         ['Flotte & Carburant', 'Flotte & Carburant'],
         ['Transport & Rotations', 'Transport & Rotations'],
         ['Quincaillerie & Vente', 'Quincaillerie & Vente'],
         ['Chantiers & BTP', 'Chantiers & BTP'],
         ['Direction & Marges', 'Direction & Marges']
       ])}
     </div>
     <label class="block text-xs font-semibold text-slate-500">
       Votre avis / retour d'expérience *
       <textarea name="text" required rows="3" placeholder="Racontez comment MargeUp vous aide à contrôler vos camions, vos matériaux ou vos marges..." class="${INPUT} mt-1"></textarea>
     </label>`,
    'Publier mon avis'));
}

/* ---------- AFFICHAGE GÉNÉRAL ---------- */
function renderDemoBar() {
  $('demoBar').innerHTML = S.demo ? '<div class="mb-6 bg-amber-500/10 border border-amber-500/30 text-amber-700 rounded-xl p-3 text-xs flex flex-wrap items-center justify-between gap-2"><span><i class="fa-solid fa-flask"></i> Vous voyez des données d’exemple.</span><button onclick="clearDemo()" class="bg-amber-500 text-slate-950 font-bold px-3 py-1.5 rounded-lg">Remplir mes propres données</button></div>' : '';
}
function clearDemo() {
  if (!confirm('Effacer les données d’exemple et commencer avec les vôtres ?')) return;
  Object.assign(S, { demo: false, inventory: [], sales: [], pannes: [], expenses: [], fleet: [], chantiers: [], batiments: [], seq: 0 }); save(); renderAll();
}
function renderAll() {
  $('coBtn').innerHTML = '<i class="fa-solid fa-building text-orange-600"></i> ' + esc(S.co ? S.co.nom : 'Créer mon espace');
  renderBanner(); renderDemoBar(); renderInventory(); renderPannes(); renderFleet(); renderTripsJournal(); renderDrivers(); renderChantiers(); renderCeo(); renderContact(); renderReviews();
}

/* ---------- FORMULAIRES ---------- */
const FORMS = {
  review(d) {
    const author = (d.author || '').trim(), company = (d.company || '').trim(), text = (d.text || '').trim();
    if (!author || !company || !text) { toast('Nom, entreprise et avis obligatoires.'); return; }
    (S.reviews = S.reviews || []).unshift({
      id: 'rev-' + uid(),
      author,
      company,
      role: (d.role || 'Utilisateur').trim(),
      city: d.city || 'Sénégal',
      rating: +d.rating || 5,
      tag: d.tag || 'BTP & Transport',
      text,
      date: day()
    });
    save(); closeModal(); renderAll(); toast('Merci pour votre avis ! Votre témoignage a été publié.');
  },
  member(d) {
    const nom = (d.nom || '').trim(), email = (d.email || '').trim().toLowerCase(), tel = (d.tel || '').trim(), parts = String(d.scope).split(':'), type = parts[0], sid = parts[1];
    if (!nom || !/^\S+@\S+\.\S+$/.test(email) || tel.replace(/\D/g, '').length < 9) { $('memErr').textContent = 'Nom, e-mail et téléphone valides sont obligatoires.'; return; }
    if ((d.pw || '').length < 4) { $('memErr').textContent = 'Mot de passe : 4 caractères minimum.'; return; }
    if (S.team.some(m => m.email === email)) { $('memErr').textContent = 'Cet e-mail est déjà utilisé par un membre.'; return; }
    const mid = 'm' + uid();
    S.team.push({ id: mid, nom, email, tel, role: type === 'chantier' ? 'chantier' : type === 'depot' ? 'magasinier' : 'transport', scope: { type, id: sid }, pw: hashPw(d.pw, mid) });
    save(); renderAll(); openTeamModal(); toast('Membre ajouté');
  },
  depot(d) { const x = { id: 'd' + uid(), nom: d.nom.trim() }; S.depots.push(x); selDepot = x.id; save(); closeModal(); renderAll(); toast('Quincaillerie créée'); },
  sale(d) {
    const ids = [].concat(d['item[]'] || []), qs = [].concat(d['qty[]'] || []), ps = [].concat(d['pu[]'] || []), lines = [], need = {};
    for (let k = 0; k < ids.length; k++) {
      const it = S.inventory.find(x => x.id == ids[k]), q = +qs[k], pu = +ps[k];
      if (!it || !(q > 0)) continue;
      const isTonne = isCementOrTonne(it);
      // Pour le ciment géré en tonnes et vendu en sacs : 20 sacs = 1 tonne
      const neededInStockUnit = isTonne ? (q / 20) : q;
      need[it.id] = (need[it.id] || 0) + neededInStockUnit;
      lines.push({ item: it.id, name: it.name, unit: isTonne ? 'sacs (50kg)' : it.unit, qty: q, pu });
    }
    if (!lines.length) { $('saleErr').textContent = 'Ajoutez au moins un article.'; return; }
    if (d.kind === 'entreprise' && !(d.cnom || '').trim()) { $('saleErr').textContent = 'Le nom de l’entreprise cliente est obligatoire.'; return; }
    for (const id in need) {
      const it = S.inventory.find(x => x.id == id);
      if (need[id] > it.qty) {
        $('saleErr').textContent = 'Stock insuffisant pour ' + it.name + ' : il reste ' + formatMaterialQty(it) + '.';
        return;
      }
    }
    lines.forEach(l => {
      const it = S.inventory.find(x => x.id == l.item);
      const isTonne = isCementOrTonne(it);
      const deducted = isTonne ? (l.qty / 20) : l.qty;
      it.qty = Math.max(0, it.qty - deducted);
    });
    const total = lines.reduce((s, l) => s + l.qty * l.pu, 0);
    const sale = { id: 'v' + uid(), num: 'FAC-' + day().slice(0, 4) + '-' + String(++S.seq).padStart(4, '0'), depot: selDepot, date: day(), stype: d.stype, kind: d.kind, client: { nom: (d.cnom || '').trim() || 'Client comptoir', tel: d.ctel || '' }, pay: d.pay, lines, total };
    S.sales.unshift(sale); save(); renderAll(); openInvoice(sale.id);
  },
  co(d) {
    const nom = (d.nom || '').trim();
    const resp = (d.resp || '').trim();
    const email = (d.email || '').trim().toLowerCase();
    const tel = (d.tel || '').trim();
    const ville = (d.ville || '').trim();

    if (!nom || !resp || !/^\S+@\S+\.\S+$/.test(email) || tel.replace(/\D/g, '').length < 9) {
      return toast('Le nom, l’e-mail et le téléphone du patron sont obligatoires (min 9 chiffres).');
    }

    // Si l'entreprise existe déjà et que l'e-mail n'a pas changé, mise à jour directe sans re-vérification
    if (S.co && S.co.email && S.co.email.toLowerCase() === email) {
      S.co.nom = nom;
      S.co.resp = resp;
      S.co.tel = tel;
      S.co.ville = ville;
      save();
      closeModal();
      renderAll();
      return toast('Informations de l’entreprise mises à jour.');
    }

    // Sinon (création d'espace OU changement d'adresse e-mail), on déclenche le flux de vérification par code
    const id = (S.co && S.co.id) || uid();
    pendingCompanyData = {
      id,
      nom,
      resp,
      email,
      tel,
      ville,
      since: (S.co && S.co.since) || day()
    };
    sendVerificationEmail(email);
    openVerificationModal();
    toast('Code de vérification généré : ' + verificationCode);
  },
  verifyEmail(d) {
    const code = (d.code || ($('emailCodeInput') ? $('emailCodeInput').value : '')).trim();
    const errBox = $('verifyCodeErr');

    if (!verificationCode || !pendingCompanyData) {
      if (errBox) errBox.textContent = 'Session expirée. Veuillez recommencer la saisie.';
      return toast('Session de vérification expirée.');
    }

    if (verificationExpiry && Date.now() > verificationExpiry) {
      if (errBox) errBox.textContent = 'Ce code a expiré. Cliquez sur « Renvoyer un code ».';
      return toast('Code de vérification expiré.');
    }

    if (code !== verificationCode) {
      if (errBox) errBox.textContent = 'Code incorrect. Veuillez saisir les 6 chiffres affichés.';
      return toast('Code de vérification incorrect');
    }

    // Code valide et vérifié avec succès !
    const first = !S.co;
    S.co = {
      ...pendingCompanyData,
      emailVerified: true,
      verifiedAt: day()
    };

    if (!S.trial && !S.sub) {
      S.trial = { start: day(), end: addDays(day(), TRIAL_DAYS) };
    }

    verificationCode = null;
    pendingCompanyData = null;
    verificationExpiry = null;
    if (typeof window !== 'undefined') window.verificationCode = null;

    save();
    closeModal();
    renderAll();
    toast(first ? '🎉 Bienvenue ! E-mail vérifié et essai gratuit de ' + TRIAL_DAYS + ' jours activé.' : '✅ E-mail vérifié et entreprise mise à jour avec succès.');
  },
  rolepw(d) {
    let ok = false, user = null;
    if (d.member) { user = S.team.find(m => m.id === d.member); ok = !!user && hashPw(d.pw, user.id) === user.pw; }
    else ok = hashPw(d.pw, S.co.id) === S.roles[d.role];
    if (!ok) { $('pwErr').textContent = 'Mot de passe incorrect.'; return; }
    curUser = user; try { sessionStorage.setItem('safebtp.user', user ? user.id : ''); } catch (e) {}
    closeModal(); enterRole(d.role); const cb = pendingRole && pendingRole.cb; pendingRole = null; if (cb) cb();
  },
  stock(d) {
    let q = +d.qty;
    const inputUnit = (d.input_unit || d.unit || 'unités').toLowerCase();
    const nm = d.name.trim().toLowerCase();
    let ex = S.inventory.find(i => i.depot === selDepot && i.name.toLowerCase() === nm);

    if (ex) {
      const exUnit = (ex.unit || '').toLowerCase();
      const exIsTonne = exUnit.includes('tonne') || isCementOrTonne(ex);
      let addQty = q;
      // Conversion 1 tonne = 20 sacs
      if (exIsTonne && inputUnit.includes('sac')) {
        addQty = q / 20; // 20 sacs = 1 tonne
      } else if (exUnit.includes('sac') && inputUnit.includes('tonne')) {
        addQty = q * 20; // 1 tonne = 20 sacs
      }
      ex.qty += addQty;
      if (+d.price) ex.price = +d.price;
      if (+d.priceGros) ex.priceGros = +d.priceGros;
    } else {
      let finalUnit = d.unit || 'unités';
      let finalQty = q;
      if (finalUnit === 'tonne' && inputUnit.includes('sac')) {
        finalQty = q / 20;
      } else if (finalUnit === 'sacs' && inputUnit.includes('tonne')) {
        finalQty = q * 20;
      }
      S.inventory.push({
        id: Date.now(),
        depot: selDepot,
        name: d.name.trim(),
        cat: d.cat || 'Divers',
        qty: finalQty,
        unit: finalUnit,
        uom_ratio: (finalUnit === 'tonne' || isCementOrTonne({ name: d.name, unit: finalUnit })) ? 20 : 1,
        sale_unit: finalUnit === 'tonne' ? 'sac 50kg' : finalUnit,
        price: +d.price || 0,
        priceGros: +d.priceGros || +d.price || 0,
        lastChantier: ''
      });
    }
    save(); closeModal(); renderAll(); toast('Stock mis à jour avec conversion exacte');
  },
  dispatch(d) {
    const i = S.inventory.find(x => x.id == d.id), q = +d.qty, c = S.chantiers.find(x => x.id === d.chantier);
    if (!i || !c) return;
    const isTonne = isCementOrTonne(i);
    const dispUnit = (d.dispatch_unit || i.unit || '').toLowerCase();
    
    let deductedInStockUnit = q;
    let label = '';
    let expAmount = 0;

    if (isTonne && dispUnit.includes('sac')) {
      deductedInStockUnit = q / 20; // 20 sacs = 1 tonne
      label = fm(q) + ' sac' + (q > 1 ? 's' : '') + ' de 50 kg (' + (deductedInStockUnit >= 1 ? fm(deductedInStockUnit) + ' t' : q + ' sacs') + ')';
      expAmount = q * (i.price || 0);
    } else if (isTonne && dispUnit.includes('tonne')) {
      deductedInStockUnit = q;
      label = fm(q) + ' tonne' + (q > 1 ? 's' : '') + ' (' + fm(q * 20) + ' sacs)';
      expAmount = (q * 20) * (i.price || 0);
    } else {
      deductedInStockUnit = q;
      label = fm(q) + ' ' + esc(i.unit);
      expAmount = q * (i.price || 0);
    }

    if (deductedInStockUnit > i.qty) {
      $('dispErr').textContent = 'Stock insuffisant : il reste ' + formatMaterialQty(i) + '.';
      return;
    }
    i.qty -= deductedInStockUnit;
    i.lastChantier = c.nom.replace('Chantier ', '');
    S.expenses.push({ id: Date.now(), chantier: c.id, date: day(), title: label + ' ' + i.name, source: 'Quincaillerie principale', cat: 'Matériaux', amount: expAmount });
    save(); renderAll();
    openModal(`<div id="bon" class="font-mono text-xs space-y-1"><div class="text-center font-bold border-b border-slate-300 pb-2 text-slate-900">${esc(S.co ? S.co.nom : 'MARGEUP')} · BON DE SORTIE</div><div class="flex justify-between"><span>Date</span><span>${fr(day())}</span></div><div class="flex justify-between"><span>Chantier</span><span>${esc(c.nom)}</span></div><div class="flex justify-between"><span>Article</span><span>${esc(i.name)}</span></div><div class="flex justify-between font-bold"><span>Quantité</span><span>${esc(label)}</span></div><div class="flex justify-between font-bold"><span>Valeur</span><span>${fm(expAmount)} FCFA</span></div></div><p class="text-[11px] text-emerald-600">La dépense a été ajoutée au chantier.</p><div class="flex justify-end gap-2"><button onclick="closeModal()" class="px-4 py-2 rounded-xl text-xs bg-slate-100 text-slate-600">Fermer</button><button onclick="window.print()" class="px-4 py-2 rounded-xl text-xs bg-purple-600 text-white font-bold">Imprimer</button></div>`);
  },
  trip(d) {
    const f = S.fleet.find(x => x.id == d.id);
    if (!f) return;
    (f.trips = f.trips || []).unshift({
      d: d.d || day(),
      voyages: +d.voyages || 1,
      km: +d.km || 0,
      depart: (d.depart || '').trim(),
      arrivee: (d.arrivee || '').trim(),
      obs: (d.obs || '').trim()
    });
    save(); closeModal(); renderAll(); toast('Voyage, rotation et lieux enregistrés');
  },
  truck(d) { S.fleet.push({ id: Date.now(), name: d.name, plate: d.plate, driver: d.driver, type: d.type || 'benne', status: 'Disponible', carb: [] }); save(); closeModal(); renderAll(); toast('Camion ajouté'); },
  fuel(d) {
    const f = S.fleet.find(x => x.id == d.id), l = +d.l, amount = +d.amount || 0;
    (f.carb = f.carb || []).unshift({ d: day(), l, amount, km: d.km ? +d.km : null, station: d.station || '' });
    if (d.chantier && amount) S.expenses.unshift({ id: Date.now(), chantier: d.chantier, date: day(), title: 'Carburant ' + f.name + ' (' + f.plate + ') : ' + fm(l) + ' L', source: d.station || 'Station', cat: 'Carburant', amount });
    save(); closeModal(); renderAll(); toast(d.chantier && amount ? 'Plein enregistré et ajouté aux dépenses du chantier' : 'Plein enregistré');
  },
  panne(d) {
    const f = S.fleet.find(x => x.id == d.fid);
    S.pannes.unshift({ id: Date.now(), date: day(), vehicle: f.name + ' (' + f.plate + ')', driver: f.driver, diag: d.diag, severity: d.sev, status: d.st, cost: +d.cost || 0 });
    if (d.st !== 'Terminé') f.status = 'En Panne';
    save(); closeModal(); renderAll(); toast('Panne enregistrée');
  },
  chantier(d) { const c = { id: 'c' + uid(), nom: d.nom.trim(), budget: +d.budget }; S.chantiers.push(c); selChantier = c.id; save(); closeModal(); renderAll(); toast('Chantier créé'); },
  expense(d) { S.expenses.unshift({ id: Date.now(), chantier: d.chantier, date: day(), title: d.title, source: d.source || 'Non précisé', cat: d.cat, amount: +d.amount }); selChantier = d.chantier; save(); closeModal(); renderAll(); toast('Dépense enregistrée'); },
  bat(d) {
    let b = S.batiments.find(x => x.id === d.id);
    if (!b) { const ph = {}; PHASES.forEach(p => ph[p[0]] = 0); b = { id: 'b' + uid(), chantier: d.chantier, ph }; S.batiments.push(b); }
    Object.assign(b, { nom: d.nom.trim(), niveaux: +d.niveaux || 0, niveauActuel: d.niveauActuel === '' ? 0 : +d.niveauActuel, ingenieur: d.ingenieur, resp: d.resp, debut: d.debut, prevision: d.prevision, livraison: d.livraison, note: d.note });
    save(); closeModal(); renderAll(); toast('Bâtiment enregistré');
  },
  batup(d) { const b = S.batiments.find(x => x.id === d.id); PHASES.forEach(p => b.ph[p[0]] = +d[p[0]]); if (d.niveauActuel !== undefined && d.niveauActuel !== '') b.niveauActuel = +d.niveauActuel; save(); closeModal(); renderAll(); toast('Avancement mis à jour : ' + batPct(b) + '%'); },
  pay(d) {
    const until = addDays(day(), calc.isAnnual ? 365 : 30);
    S.sub = { trucks: calc.camions, chantiers: calc.chantiers, quinc: calc.quinc, annual: calc.isAnnual, amount: Math.round(calc.total), method: payMe === 'w' ? 'Wave' : 'Orange Money', phone: d.phone, ref: d.ref, date: day(), until, status: 'verif' };
    save(); closeModal(); renderAll(); switchTab('accueil'); toast('Abonnement activé. Paiement en cours de vérification.');
  },
  contact(d) {
    const nom = (d.nom || '').trim(), tel = (d.tel || '').trim(), msg = (d.message || '').trim(), obj = d.objet || 'Demande de renseignement';
    if (!nom || tel.length < 9 || !msg) return toast('Veuillez renseigner votre nom, téléphone et message.');
    closeModal();
    toast('Merci ' + nom + ' ! Votre message a bien été envoyé. Notre équipe vous recontacte rapidement.');
    const waText = encodeURIComponent(`Bonjour MargeUp,\nJe suis ${nom} (Tél: ${tel}).\nObjet: ${obj}\nMessage: ${msg}`);
    const num = CONTACT.tel.replace(/\D/g, '');
    setTimeout(() => {
      if (confirm('Souhaitez-vous également ouvrir WhatsApp pour échanger directement avec notre conseiller ?')) {
        window.open('https://wa.me/221' + num + '?text=' + waText, '_blank');
      }
    }, 400);
  }
};

/* ---------- CONSOLE ADMINISTRATEUR ---------- */
function openMaint() { $('maintModal').classList.remove('hidden'); }
function closeMaint() { $('maintModal').classList.add('hidden'); }
async function verifyMaint() {
  const entered = $('maintCodeInput').value;
  const hash = await _hashMaint(entered);
  if (hash === _MAINT_TARGET) {
    $('maintCodeInput').value = '';
    closeMaint();
    try { sessionStorage.setItem('safebtp.sa', '1'); } catch (e) {}
    enterRole('ceo');
    openAdmin();
  } else {
    toast('Code incorrect');
  }
}
function adminList() {
  let A; try { A = JSON.parse(localStorage.getItem(KA)); } catch (e) {}
  if (!A) {
    const E = (id, nom, resp, tel, ville, c, h, q, ann, me, ref, until, trialEnd, st) => ({ id, nom, resp, tel, ville, camions: c, chantiers: h, quinc: q, annual: ann, me, ref, until, trialEnd, st });
    A = [E('e1', 'Sénégal Pavage SARL', 'Ibrahima Ba', '77 123 45 67', 'Dakar', 12, 3, 1, 1, 'Wave', 'TX84731920', day(325), day(-30), 'actif'), E('e2', 'Baobab Construction', 'Awa Diop', '78 234 56 78', 'Thiès', 6, 2, 1, 0, 'Orange Money', 'OM55120943', day(18), day(-20), 'actif'), E('e3', 'Quincaillerie Teranga', 'Moussa Sy', '76 345 67 89', 'Kaolack', 0, 0, 2, 0, 'Wave', 'TX90018834', day(29), day(-5), 'verif'), E('e4', 'Touba Hydraulique', 'Cheikh Mbacké', '77 456 78 90', 'Touba', 4, 1, 0, 0, '', '', '', day(9), 'essai'), E('e5', 'Mbao Transport BTP', 'Fatou Ndiaye', '70 567 89 01', 'Rufisque', 0, 0, 0, 0, '', '', '', day(-3), 'essai'), E('e6', 'Ndiaye et Frères', 'Ousmane Ndiaye', '77 678 90 12', 'Saint-Louis', 3, 1, 0, 0, 'Wave', 'TX66019287', day(-40), day(-70), 'susp')];
    try { localStorage.setItem(KA, JSON.stringify(A)); } catch (e) {}
  }
  return A;
}
function saveAdmin(A) { try { localStorage.setItem(KA, JSON.stringify(A)); } catch (e) {} }
function localRow() {
  if (!S.co) return null; const a = access(), s = S.sub;
  return { id: 'local', local: 1, nom: S.co.nom, resp: S.co.resp, tel: S.co.tel, email: S.co.email, ville: S.co.ville, camions: s ? s.trucks : 0, chantiers: s ? s.chantiers : 0, quinc: s ? s.quinc : 0, annual: s ? s.annual : 0, me: s ? s.method : '', ref: s ? s.ref : '', until: s ? s.until : '', trialEnd: S.trial ? S.trial.end : '', st: a === 'sub' ? (s.status === 'verif' ? 'verif' : 'actif') : a === 'susp' ? 'susp' : a === 'expired' ? 'expire' : 'essai' };
}
function adminStatus(e) {
  if (e.st === 'susp') return ['Suspendu', 'bg-rose-500/20 text-rose-600 border-rose-500/30'];
  if ((e.st === 'actif' || e.st === 'verif') && e.until < day()) return ['Expiré', 'bg-rose-500/20 text-rose-600 border-rose-500/30'];
  if (e.st === 'actif') return ['Abonné actif', 'bg-emerald-500/20 text-emerald-600 border-emerald-500/30'];
  if (e.st === 'verif') return ['Paiement à vérifier', 'bg-amber-500/20 text-amber-600 border-amber-500/30'];
  if (e.trialEnd && e.trialEnd >= day()) return ['Essai · ' + daysLeft(e.trialEnd) + ' j', 'bg-blue-500/20 text-blue-600 border-blue-500/30'];
  return ['Essai terminé', 'bg-slate-200 text-slate-600 border-slate-400'];
}
const monthly = e => e.camions * 15000 + e.chantiers * 50000 + e.quinc * 35000;
function allCompanies() { const l = localRow(); return (l ? [l] : []).concat(adminList()); }
function openAdmin() { $('adminPanel').classList.remove('hidden'); renderAdmin(); }
function closeAdmin() { $('adminPanel').classList.add('hidden'); }
function renderAdmin() {
  const L = allCompanies(), q = ($('adm-q') ? $('adm-q').value : '').toLowerCase(), f = $('adm-f') ? $('adm-f').value : '';
  const stt = e => adminStatus(e)[0];
  const k = [['Entreprises', L.length, 'text-slate-900'], ['Essais en cours', L.filter(e => stt(e).startsWith('Essai ·')).length, 'text-blue-600'], ['Abonnés actifs', L.filter(e => stt(e) === 'Abonné actif').length, 'text-emerald-600'], ['À vérifier', L.filter(e => stt(e) === 'Paiement à vérifier').length, 'text-amber-600'], ['Revenu mensuel estimé', fm(L.filter(e => stt(e) === 'Abonné actif').reduce((s, e) => s + monthly(e), 0)) + ' F', 'text-orange-600']];
  const R = L.filter(e => (!q || [e.nom, e.resp, e.tel, e.ville, e.ref].join(' ').toLowerCase().includes(q)) && (!f || stt(e).startsWith(f)));
  $('adminPanel').innerHTML = `<div class="max-w-7xl mx-auto p-4 sm:p-6 space-y-5">
    <div class="flex items-center justify-between"><h2 class="text-xl font-black text-slate-900 flex items-center gap-3"><img src="images/logo-256.png" alt="" class="w-9 h-9 rounded-lg"><span>Console administrateur MargeUp</span></h2><button onclick="closeAdmin()" class="bg-slate-100 text-slate-600 px-3 py-2 rounded-xl text-xs font-bold">Fermer</button></div>
    <p class="text-[11px] text-amber-700 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2">Pour l’instant, cette liste contient des entreprises d’exemple et l’entreprise créée sur cet appareil. Avec Supabase, elle affichera toutes vos vraies entreprises.</p>
    <div class="grid grid-cols-2 lg:grid-cols-5 gap-3">${k.map(x => `<div class="bg-slate-50 border border-slate-200 rounded-xl p-4"><div class="text-[11px] text-slate-500">${x[0]}</div><div class="text-xl font-black ${x[2]}">${x[1]}</div></div>`).join('')}</div>
    <div class="flex flex-wrap gap-2"><input id="adm-q" oninput="renderAdmin()" value="${esc(q)}" placeholder="Rechercher une entreprise, une ville, un numéro…" class="${INPUT} flex-1 min-w-[200px]"><select id="adm-f" onchange="renderAdmin()" class="${INPUT} w-auto"><option value="">Tous les statuts</option>${['Essai ·', 'Abonné actif', 'Paiement à vérifier', 'Essai terminé', 'Expiré', 'Suspendu'].map(s => `<option value="${s}" ${s === f ? 'selected' : ''}>${s.replace(' ·', '')}</option>`).join('')}</select></div>
    <div class="bg-slate-50 border border-slate-200 rounded-2xl overflow-x-auto"><table class="w-full text-left text-xs"><thead class="bg-white text-slate-500 uppercase"><tr><th class="p-3">Entreprise</th><th class="p-3">Forfait</th><th class="p-3">Mensuel</th><th class="p-3">Fin</th><th class="p-3">Statut</th></tr></thead><tbody class="divide-y divide-slate-200">${R.map(e => { const s = adminStatus(e); return `<tr class="hover:bg-slate-50 cursor-pointer" onclick="adminDetail('${e.id}')"><td class="p-3"><div class="font-bold text-slate-900">${esc(e.nom)} ${e.local ? '<span class="text-[10px] bg-orange-500/20 text-orange-600 px-1.5 py-0.5 rounded">Cet appareil</span>' : ''}</div><div class="text-slate-500">${esc(e.resp || '—')} · ${esc(e.ville || '—')} · ${esc(e.tel || '—')}</div></td><td class="p-3 text-slate-600">${e.camions} camion(s), ${e.chantiers} chantier(s), ${e.quinc} dépôt(s)</td><td class="p-3 text-slate-900">${fm(monthly(e))} F</td><td class="p-3 text-slate-600">${fr(e.until || e.trialEnd)}</td><td class="p-3"><span class="px-2 py-0.5 rounded border text-[10px] font-bold ${s[1]}">${s[0]}</span></td></tr>`; }).join('') || '<tr><td colspan="5" class="p-6 text-center text-slate-500">Aucune entreprise.</td></tr>'}</tbody></table></div>
    <button onclick="adminCsv()" class="bg-slate-100 text-slate-600 px-3 py-2 rounded-xl text-xs font-bold">Exporter la liste (CSV)</button></div>`;
}
function adminDetail(id) {
  const e = allCompanies().find(x => x.id === id); if (!e) return; const s = adminStatus(e);
  const b = (a, t, c) => `<button onclick="adminAct('${id}','${a}')" class="px-3 py-2 rounded-xl text-xs font-bold ${c}">${t}</button>`;
  openModal(`<h3 class="text-base font-bold text-slate-900">${esc(e.nom)}</h3><div class="text-xs text-slate-600 space-y-1"><div>Responsable : ${esc(e.resp || '—')} · ${esc(e.tel || '—')} · ${esc(e.ville || '—')}</div><div>Forfait : ${e.camions} camion(s), ${e.chantiers} chantier(s), ${e.quinc} dépôt(s) · ${fm(monthly(e))} F par mois</div><div>Paiement : ${esc(e.me || '—')} · Référence ${esc(e.ref || '—')}</div><div>Fin d’abonnement : ${fr(e.until)} · Fin d’essai : ${fr(e.trialEnd)}</div><div>Statut : <b>${s[0]}</b></div></div><div class="flex flex-wrap gap-2 pt-2">${b('ok', 'Valider le paiement', 'bg-emerald-600 text-white')}${b('ext', 'Prolonger de 30 jours', 'bg-slate-200 text-slate-900')}${b('trial', 'Essai +15 jours', 'bg-blue-600 text-white')}${b('susp', 'Suspendre', 'bg-rose-600 text-white')}${b('react', 'Réactiver', 'bg-slate-200 text-slate-900')}</div><div class="flex justify-end"><button onclick="closeModal()" class="px-4 py-2 rounded-xl text-xs bg-slate-100 text-slate-600">Fermer</button></div>`);
}
function adminAct(id, a) {
  const A = adminList(), e = id === 'local' ? null : A.find(x => x.id === id);
  if (id === 'local') {
    if (a === 'ok' && S.sub) { S.sub.status = 'ok'; delete S.sub.susp; }
    if (a === 'susp') { if (S.sub) S.sub.susp = 1; else if (S.trial) S.trial.end = day(-1); }
    if (a === 'react' && S.sub) delete S.sub.susp;
    if (a === 'ext' && S.sub) S.sub.until = addDays(S.sub.until > day() ? S.sub.until : day(), 30);
    if (a === 'trial' && S.trial) S.trial.end = addDays(S.trial.end > day() ? S.trial.end : day(), 15);
    save(); renderAll();
  } else if (e) {
    if (a === 'ok') e.st = 'actif';
    if (a === 'susp') e.st = 'susp';
    if (a === 'react') e.st = e.until ? 'actif' : 'essai';
    if (a === 'ext') e.until = addDays(e.until > day() ? e.until : day(), 30);
    if (a === 'trial') e.trialEnd = addDays(e.trialEnd > day() ? e.trialEnd : day(), 15);
    saveAdmin(A);
  }
  closeModal(); renderAdmin(); toast('Action effectuée');
}
function adminCsv() {
  const rows = [['Entreprise', 'Responsable', 'Téléphone', 'Ville', 'Camions', 'Chantiers', 'Dépôts', 'Moyen', 'Référence', 'Fin abonnement', 'Fin essai', 'Statut']].concat(allCompanies().map(e => [e.nom, e.resp, e.tel, e.ville, e.camions, e.chantiers, e.quinc, e.me, e.ref, e.until, e.trialEnd, adminStatus(e)[0]]));
  const csv = rows.map(r => r.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(';')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' })); a.download = 'entreprises-margeup.csv'; a.click();
}


/* ---------- VENTES (DÉTAIL ET GROS) ET FACTURES ---------- */
const PAYS = ['Espèces', 'Wave', 'Orange Money', 'Crédit'];
function openSaleModal() {
  if (!S.inventory.some(i => i.depot === selDepot)) return toast('Ajoutez d’abord des articles à cette quincaillerie');
  const dp = S.depots.find(d => d.id === selDepot) || {};
  openModal(`<h3 class="text-base font-bold text-slate-900">Nouvelle vente · ${esc(dp.nom || '')}</h3><form data-f="sale" class="space-y-3">
    <div class="grid grid-cols-2 gap-3">${sel('Type de vente', 'stype', [['detail', 'Détail'], ['gros', 'Gros']]).replace('<select', '<select onchange="saleType()"')}${sel('Type de client', 'kind', [['particulier', 'Particulier (population)'], ['entreprise', 'Entreprise']])}${fld('Nom du client', 'cnom', 'text', 'placeholder="Client comptoir"')}${fld('Téléphone (facultatif)', 'ctel', 'tel')}</div>
    ${sel('Paiement', 'pay', PAYS.map(p => [p, p]))}
    <div id="saleRows" class="space-y-2"></div>
    <button type="button" onclick="addSaleRow()" class="text-xs text-orange-700 font-bold">+ Ajouter un article</button>
    <div class="flex justify-between text-sm font-bold text-slate-900 border-t border-slate-200 pt-2"><span>Total</span><span id="saleTotal">0 FCFA</span></div>
    <div id="saleErr" class="text-xs text-rose-600"></div>
    <div class="flex justify-end gap-2 pt-2"><button type="button" onclick="closeModal()" class="px-4 py-2 rounded-xl text-xs bg-slate-100 text-slate-600">Annuler</button><button class="px-4 py-2 rounded-xl text-xs bg-orange-500 text-white font-bold">Valider et éditer la facture</button></div></form>`);
  addSaleRow();
}
function addSaleRow() {
  const I = S.inventory.filter(i => i.depot === selDepot);
  $('saleRows').insertAdjacentHTML('beforeend', `<div class="sale-row grid grid-cols-12 gap-2 items-end"><label class="col-span-12 sm:col-span-6 text-[11px] text-slate-600">Article<select name="item[]" onchange="saleFill(this)" class="${INPUT} mt-1">${I.map(i => `<option value="${i.id}">${esc(i.name)} (${formatMaterialQty(i)})</option>`).join('')}</select></label><label class="col-span-5 sm:col-span-2 text-[11px] text-slate-600">Quantité (sacs/unités)<input name="qty[]" type="number" min="0.01" step="any" required value="1" oninput="saleCalc()" class="${INPUT} mt-1"></label><label class="col-span-7 sm:col-span-4 text-[11px] text-slate-600">Prix unitaire (FCFA)<input name="pu[]" type="number" min="0" required oninput="saleCalc()" class="${INPUT} mt-1"></label></div>`);
  saleFill($('saleRows').lastElementChild.querySelector('select'));
}
function saleFill(se) {
  const i = S.inventory.find(x => x.id == se.value), t = document.querySelector('#modalBox [name=stype]').value, row = se.closest('.sale-row');
  row.querySelector('[name="pu[]"]').value = i ? (t === 'gros' ? (i.priceGros || i.price) : i.price) : 0; saleCalc();
}
function saleType() { document.querySelectorAll('#saleRows select').forEach(saleFill); }
function saleCalc() { let t = 0; document.querySelectorAll('#saleRows .sale-row').forEach(r => { t += (+r.querySelector('[name="qty[]"]').value || 0) * (+r.querySelector('[name="pu[]"]').value || 0); }); $('saleTotal').textContent = fm(t) + ' FCFA'; }
function renderSales() {
  const L = S.sales.filter(s => s.depot === selDepot), td = day(), T = L.filter(s => s.date === td), sum = f => T.filter(f).reduce((x, s) => x + s.total, 0);
  $('sales-kpis').innerHTML = [['Ventes du jour', sum(() => true), 'text-slate-900'], ['Dont détail', sum(s => s.stype === 'detail'), 'text-emerald-700'], ['Dont gros', sum(s => s.stype === 'gros'), 'text-amber-700']].map(k => `<div class="bg-slate-50 border border-slate-200 rounded-xl p-4"><div class="text-[11px] text-slate-600">${k[0]}</div><div class="text-xl font-black ${k[2]}">${fm(k[1])} <span class="text-xs font-normal text-slate-500">FCFA</span></div></div>`).join('');
  $('sales-table-body').innerHTML = L.length ? L.slice(0, 30).map(s => `<tr class="hover:bg-slate-50"><td class="p-3 text-slate-600">${fr(s.date)}</td><td class="p-3 font-bold text-slate-900">${esc(s.num)}</td><td class="p-3 text-slate-700">${esc(s.client.nom)}<div class="text-[10px] text-slate-500">${s.kind === 'entreprise' ? 'Entreprise' : 'Particulier'}</div></td><td class="p-3"><span class="text-[10px] px-2 py-0.5 rounded border ${s.stype === 'gros' ? 'bg-amber-500/15 text-amber-700 border-amber-500/30' : 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30'}">${s.stype === 'gros' ? 'Gros' : 'Détail'}</span></td><td class="p-3 font-bold text-orange-700">${fm(s.total)} FCFA</td><td class="p-3 text-slate-600">${esc(s.pay)}</td><td class="p-3"><button onclick="openInvoice('${s.id}')" class="bg-purple-600 hover:bg-purple-500 text-white text-[11px] px-2.5 py-1 rounded-lg">Facture</button></td></tr>`).join('') : '<tr><td colspan="7" class="p-6 text-center text-slate-500">Aucune vente ni facture enregistrée. Cliquez sur « Nouvelle vente » pour créer votre première facture.</td></tr>';
}
function invoiceHtml(s) {
  const co = S.co || { nom: 'MargeUp' }, dp = S.depots.find(d => d.id === s.depot) || {}, th = al => '<th style="text-align:' + al + ';padding:6px;background:#f3f4f6;border-bottom:1px solid #ddd">', td = al => '<td style="text-align:' + al + ';padding:6px;border-bottom:1px solid #eee">';
  return `<div style="font-family:Arial,sans-serif;color:#111;font-size:13px"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap"><div><div style="font-size:18px;font-weight:bold">${esc(co.nom)}</div><div>${esc(dp.nom || '')}</div><div>${esc(co.ville || '')}${co.tel ? ' · ' + esc(co.tel) : ''}</div><div>${esc(co.email || '')}</div></div><div style="text-align:right"><div style="font-size:18px;font-weight:bold">FACTURE</div><div>N° ${esc(s.num)}</div><div>Date : ${fr(s.date)}</div><div>Vente ${s.stype === 'gros' ? 'en gros' : 'au détail'}</div></div></div>
  <div style="margin:14px 0;padding:8px;background:#f9fafb;border-radius:6px"><b>Client :</b> ${esc(s.client.nom)} (${s.kind === 'entreprise' ? 'entreprise' : 'particulier'})${s.client.tel ? ' · ' + esc(s.client.tel) : ''}</div>
  <table style="width:100%;border-collapse:collapse"><tr>${th('left')}Désignation</th>${th('right')}Qté</th>${th('right')}Prix unitaire</th>${th('right')}Montant</th></tr>${s.lines.map(l => `<tr>${td('left')}${esc(l.name)}</td>${td('right')}${fm(l.qty)} ${esc(l.unit)}</td>${td('right')}${fm(l.pu)}</td>${td('right')}${fm(l.qty * l.pu)}</td></tr>`).join('')}</table>
  <div style="text-align:right;font-size:16px;font-weight:bold;margin-top:12px">TOTAL : ${fm(s.total)} FCFA</div><div style="margin-top:6px">Paiement : ${esc(s.pay)}</div><div style="margin-top:16px;color:#555;font-size:11px">Montants en FCFA. Merci de votre confiance.</div></div>`;
}
function openInvoice(id) {
  const s = S.sales.find(x => x.id === id); if (!s) return;
  openModal(`<div id="invoice" style="background:#fff;border-radius:12px;padding:18px;color:#111">${invoiceHtml(s)}</div><div class="flex flex-wrap justify-end gap-2 pt-2"><button onclick="closeModal()" class="px-4 py-2 rounded-xl text-xs bg-slate-100 text-slate-700">Fermer</button><button onclick="shareInvoice('${s.id}')" class="px-4 py-2 rounded-xl text-xs bg-emerald-600 text-white font-bold">Envoyer</button><button onclick="downloadInvoice('${s.id}')" class="px-4 py-2 rounded-xl text-xs bg-amber-500 text-slate-950 font-bold">Télécharger le PDF</button><button onclick="window.print()" class="px-4 py-2 rounded-xl text-xs bg-purple-600 text-white font-bold">Imprimer</button></div>`);
}
function pdfBlob(pages) {
  const enc = t => String(t).replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/œ/g, 'oe').replace(/…/g, '...').replace(/[\u202f\u00a0]/g, ' ').replace(/[^\x20-\xFF]/g, '?').replace(/[\\()]/g, '\\$&');
  const objs = [], add = o => objs.push(o);
  add('<< /Type /Catalog /Pages 2 0 R >>'); add('PAGES');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'); add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids = [];
  pages.forEach(P => {
    const c = P.map(o => 'BT /' + (o.b ? 'F2' : 'F1') + ' ' + (o.s || 10) + ' Tf ' + o.x + ' ' + o.y + ' Td (' + enc(o.t) + ') Tj ET').join('\n');
    add('<< /Length ' + c.length + ' >>\nstream\n' + c + '\nendstream'); const cn = objs.length;
    add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + cn + ' 0 R >>'); kids.push(objs.length + ' 0 R');
  });
  objs[1] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + kids.length + ' >>';
  let out = '%PDF-1.4\n'; const off = [];
  objs.forEach((o, i) => { off.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const x = out.length;
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + off.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + x + '\n%%EOF';
  const u = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) u[i] = out.charCodeAt(i) & 255;
  return new Blob([u], { type: 'application/pdf' });
}
function invoicePdf(s) {
  const co = S.co || { nom: 'MargeUp' }, dp = S.depots.find(d => d.id === s.depot) || {}, pages = [[]]; let P = pages[0], y = 800;
  const t = (x, yy, text, b, sz) => P.push({ x, y: yy, t: text, b, s: sz || 10 });
  t(40, y, co.nom, 1, 18); t(400, y, 'FACTURE', 1, 18); y -= 18;
  t(40, y, dp.nom || '', 0); t(400, y, 'N° ' + s.num, 1, 11); y -= 13;
  t(40, y, [co.ville, co.tel].filter(Boolean).join(' - '), 0); t(400, y, 'Date : ' + fr(s.date), 0); y -= 13;
  t(40, y, co.email || '', 0); t(400, y, 'Vente ' + (s.stype === 'gros' ? 'en gros' : 'au détail'), 0); y -= 28;
  t(40, y, 'Client : ' + s.client.nom + ' (' + (s.kind === 'entreprise' ? 'entreprise' : 'particulier') + ')' + (s.client.tel ? ' - ' + s.client.tel : ''), 1, 11); y -= 28;
  t(40, y, 'Désignation', 1); t(310, y, 'Quantité', 1); t(400, y, 'Prix unitaire', 1); t(490, y, 'Montant', 1); y -= 18;
  s.lines.forEach(l => { if (y < 90) { P = []; pages.push(P); y = 800; } t(40, y, String(l.name).slice(0, 44), 0); t(310, y, fm(l.qty) + ' ' + l.unit, 0); t(400, y, fm(l.pu), 0); t(490, y, fm(l.qty * l.pu), 0); y -= 15; });
  y -= 12; if (y < 90) { P = []; pages.push(P); y = 800; }
  t(380, y, 'TOTAL : ' + fm(s.total) + ' FCFA', 1, 13); y -= 24; t(40, y, 'Paiement : ' + s.pay, 0); y -= 40; t(40, y, 'Montants en FCFA. Merci de votre confiance.', 0, 9);
  return pdfBlob(pages);
}
function downloadInvoice(id) {
  const s = S.sales.find(x => x.id === id); if (!s) return;
  const a = document.createElement('a'); a.href = URL.createObjectURL(invoicePdf(s)); a.download = 'facture-' + s.num + '.pdf'; a.click();
}
function shareInvoice(id) {
  const s = S.sales.find(x => x.id === id); if (!s) return;
  const msg = (S.co ? S.co.nom : 'MargeUp') + ' : facture ' + s.num + ' du ' + fr(s.date) + ', total ' + fm(s.total) + ' FCFA. Merci de votre confiance.';
  try {
    const f = new File([invoicePdf(s)], 'facture-' + s.num + '.pdf', { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [f] })) return navigator.share({ files: [f], title: 'Facture ' + s.num, text: msg }).catch(() => {});
  } catch (e) {}
  let ph = String(s.client.tel || '').replace(/\D/g, ''); if (ph.length === 9) ph = '221' + ph;
  window.open('https://wa.me/' + ph + '?text=' + encodeURIComponent(msg), '_blank'); toast('Téléchargez le PDF puis joignez-le au message WhatsApp.');
}

/* ---------- ÉQUIPE : ADMINS PAR CHANTIER, QUINCAILLERIE ET CAMION ---------- */
function openTeamModal() {
  if (!S.co) return openCompanyModal();
  if (curRole !== 'ceo') return toast('Réservé au patron : repassez au rôle CEO.');
  openModal(`<h3 class="text-base font-bold text-slate-900">Mon équipe</h3><p class="text-xs text-slate-600">Un admin par chantier, par quincaillerie et par camion (ou pour toute la flotte). Nom, e-mail et téléphone sont obligatoires.</p>
  <div class="space-y-2">${S.team.length ? S.team.map(m => `<div class="bg-slate-100 rounded-xl p-3 flex justify-between gap-2 items-start"><div class="text-xs"><div class="font-bold text-slate-900">${esc(m.nom)}</div><div class="text-slate-700">${esc(scopeLabel(m))}</div><div class="text-slate-500">${esc(m.email)} · ${esc(m.tel)}</div></div><button onclick="delMember('${m.id}')" class="text-[11px] text-slate-700 bg-slate-200 px-2 py-1 rounded-lg">Retirer</button></div>`).join('') : '<div class="text-xs text-slate-500 text-center p-4">Aucun membre pour l’instant.</div>'}</div>
  <div class="flex justify-end gap-2"><button onclick="closeModal()" class="px-4 py-2 rounded-xl text-xs bg-slate-100 text-slate-600">Fermer</button><button onclick="openMemberModal()" class="px-4 py-2 rounded-xl text-xs bg-orange-500 text-white font-bold">Ajouter un membre</button></div>`);
}
function openMemberModal() {
  const opts = S.chantiers.map(c => ['chantier:' + c.id, 'Admin du chantier : ' + c.nom.replace('Chantier ', '')]).concat(S.depots.map(d => ['depot:' + d.id, 'Admin de la quincaillerie : ' + d.nom]), [['truck:all', 'Admin de toute la flotte']], S.fleet.map(f => ['truck:' + f.id, 'Admin du camion : ' + f.name + ' (' + f.plate + ')']));
  openModal(formWrap('Ajouter un membre', 'member', fld('Nom et prénom *', 'nom', 'text', 'required') + '<div class="grid grid-cols-2 gap-3">' + fld('E-mail *', 'email', 'email', 'required') + fld('Téléphone *', 'tel', 'tel', 'required minlength="9"') + '</div>' + sel('Rôle et responsabilité *', 'scope', opts) + fld('Mot de passe de connexion * (4 caractères minimum)', 'pw', 'password', 'required minlength="4" autocomplete="new-password"') + '<div id="memErr" class="text-xs text-rose-600"></div>', 'Ajouter'));
}
function delMember(id) { if (!confirm('Retirer ce membre ?')) return; S.team = S.team.filter(m => m.id !== id); save(); openTeamModal(); }
function openContactModal(prefillSubject = '') {
  openModal(formWrap('Nous contacter', 'contact',
    `<p class="text-xs text-slate-500 mb-2">Notre équipe basée au Sénégal vous répond dans les plus brefs délais.</p>` +
    fld('Nom et prénom *', 'nom', 'text', 'required placeholder="Ex. Ousmane Ndiaye"') +
    '<div class="grid grid-cols-2 gap-3">' +
      fld('Téléphone (WhatsApp) *', 'tel', 'tel', 'required minlength="9" placeholder="77 000 00 00"') +
      fld('E-mail (facultatif)', 'email', 'email', 'placeholder="contact@entreprise.sn"') +
    '</div>' +
    sel('Votre secteur ou besoin', 'objet', [
      ['Pack B2C Détail (39 900 FCFA/mois)', 'Pack B2C Détail (39 900 FCFA/mois)'],
      ['Complet Hybride B2B + B2C (69 900 FCFA/mois)', 'Complet Hybride B2B + B2C (69 900 FCFA/mois)'],
      ['Flotte Camions & Registre Pannes (9 900 FCFA/camion)', 'Flotte Camions & Registre Pannes (9 900 FCFA/camion)'],
      ['Démonstration personnalisée', 'Démonstration personnalisée'],
      ['Autre question', 'Autre question']
    ]) +
    `<label class="block text-xs font-semibold text-slate-500">Votre message *
      <textarea name="message" required rows="3" class="${INPUT} mt-1" placeholder="Indiquez ici vos questions ou le nombre de quincailleries / camions à paramétrer..."></textarea>
    </label>`,
    'Envoyer ma demande'
  ));
  if (prefillSubject) {
    const s = document.querySelector('#modalBox select[name="objet"]');
    if (s) s.value = prefillSubject;
  }
}

function renderContact() {
  const el = $('contact-box'); if (!el) return;
  const t = CONTACT.tel.replace(/\D/g, ''), disp = t.replace(/(\d{2})(\d{3})(\d{2})(\d{2})/, '$1 $2 $3 $4');
  el.innerHTML = `<div class="flex flex-col lg:flex-row items-center justify-between gap-6">
    <div class="space-y-3 text-center lg:text-left">
      <div class="inline-flex items-center space-x-2 bg-orange-500/20 text-orange-400 border border-orange-500/30 px-3 py-0.5 rounded-full text-xs font-bold">
        <i class="fa-solid fa-headset"></i>
        <span>Équipe Dédiée au Sénégal</span>
      </div>
      <h2 class="text-xl sm:text-2xl font-black text-white">Une question ? Besoin d’une démonstration ?</h2>
      <p class="text-xs text-slate-300 max-w-xl leading-relaxed">
        Notre équipe basée à Dakar vous accompagne pour paramétrer vos quincailleries, chantiers et camions. Contactez-nous par e-mail ou WhatsApp :
      </p>
      <div class="flex flex-wrap items-center justify-center lg:justify-start gap-2 pt-1">
        <a href="mailto:${CONTACT.email}" class="inline-flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-orange-400 hover:text-orange-300 px-3.5 py-2 rounded-xl text-xs font-bold border border-slate-600 transition shadow-sm cursor-pointer" title="Nous écrire par e-mail">
          <i class="fa-solid fa-envelope text-sm"></i>
          <span class="underline">${CONTACT.email}</span>
        </a>
        <a href="https://wa.me/221${t}?text=Bonjour%20MargeUp,%20je%20souhaite%20des%20informations%20sur%20l'application" target="_blank" rel="noopener" class="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-2 rounded-xl text-xs font-bold transition shadow-sm cursor-pointer" title="Rejoindre directement sur WhatsApp">
          <i class="fa-brands fa-whatsapp text-sm text-emerald-200"></i>
          <span>Rejoindre sur WhatsApp</span>
        </a>
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-center gap-3">
      <a href="https://wa.me/221${t}?text=Bonjour%20MargeUp,%20je%20souhaite%20des%20informations%20sur%20l'application" target="_blank" rel="noopener" class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-3 rounded-xl text-xs flex items-center space-x-2 transition shadow-lg shadow-emerald-600/30 cursor-pointer">
        <i class="fa-brands fa-whatsapp text-base"></i>
        <span>WhatsApp Direct</span>
      </a>
      <button type="button" onclick="openContactModal()" class="bg-orange-500 hover:bg-orange-600 text-white font-bold px-4 py-3 rounded-xl text-xs flex items-center space-x-2 shadow-lg shadow-orange-500/30 transition cursor-pointer">
        <i class="fa-solid fa-paper-plane"></i>
        <span>Formulaire</span>
      </button>
      <a href="tel:+221${t}" class="bg-slate-800 hover:bg-slate-700 text-white border border-slate-600 font-bold px-4 py-3 rounded-xl text-xs flex items-center space-x-2 transition">
        <i class="fa-solid fa-phone"></i>
        <span>${disp}</span>
      </a>
    </div>
  </div>`;
}


/* ---------- DIRECTION EN CONSULTATION SEULE (les saisies de l'équipe font foi) ---------- */
const FIELD_FORMS = ['stock', 'dispatch', 'sale', 'fuel', 'trip', 'panne', 'expense', 'bat', 'batup'];
const ro = () => !!S.co && curRole === 'ceo';
function roNotice() { toast('La direction consulte seulement : les saisies sont faites par l’équipe (magasinier, transport, chef de chantier) pour garantir la transparence. Ajoutez des membres avec « Équipe ».'); }
['openStockModal', 'openDispatchModal', 'openSaleModal', 'openFuelModal', 'openTripModal', 'openPanneModal', 'openExpenseModal', 'delExpense', 'openBatModal', 'openBatUpdate', 'delBat', 'delTruck'].forEach(n => {
  const f = window[n]; if (typeof f === 'function') window[n] = function () { if (ro()) return roNotice(); return f.apply(this, arguments); };
});

/* ---------- ACCÈS MAINTENANCE (invisible : 7 clics rapides sur le logo, ou adresse se terminant par #maintenance) ---------- */
const isSA = () => { try { return sessionStorage.getItem('safebtp.sa') === '1'; } catch (e) { return false; } };
let _lc = 0, _lt = null;
function brandTap() { _lc++; clearTimeout(_lt); _lt = setTimeout(() => { _lc = 0; }, 2500); if (_lc >= 7) { _lc = 0; openMaint(); } }

/* ---------- DÉMARRAGE ---------- */
document.addEventListener('submit', e => { const f = e.target.dataset && e.target.dataset.f; if (f && FORMS[f]) { e.preventDefault(); if (ro() && FIELD_FORMS.includes(f)) return roNotice(); const d = {}; new FormData(e.target).forEach((v, k) => { if (k.slice(-2) === '[]') (d[k] = d[k] || []).push(v); else d[k] = v; }); FORMS[f](d); } });
window.onload = async function () {
  try { const r = sessionStorage.getItem('safebtp.role'), mu = S.team.find(m => m.id === sessionStorage.getItem('safebtp.user')); if (r && r !== 'ceo' && ((mu && mu.role === r) || !S.co)) { curRole = r; curUser = mu || null; } } catch (e) {}
  $('roleSelector').value = curRole;
  changeRole(curRole); updatePricingCalculator(); renderAll();
  if (typeof location !== 'undefined' && location.hash === '#maintenance') openMaint();
  // Restauration d'arrière-plan résiliente depuis IndexedDB
  await syncFromIndexedDB();
};
