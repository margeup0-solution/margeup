/* MargeUp - Configuration globale client
   Paramètres d'environnement publics et injectables. */
window.MARGEUP_CONFIG = {
  // Supabase (Projet de test)
  supabase: {
    url: (typeof process !== 'undefined' && process.env && (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL)) || 'https://ecizebjvbtbwpedivaoz.supabase.co',
    anonKey: (typeof process !== 'undefined' && process.env && (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY)) || 'sb_publishable_c9DnYXPDFSk3mLcA7AsBAQ_tdmkqNLd',
    publishableKey: (typeof process !== 'undefined' && process.env && (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY)) || 'sb_publishable_c9DnYXPDFSk3mLcA7AsBAQ_tdmkqNLd'
  },
  // Paiement manuel (Wave / Orange Money)
  pay: {
    wave: '',
    om: '',
    num: (typeof process !== 'undefined' && process.env && process.env.MERCHANT_PAYMENT_NUMBER) || '78 332 62 39'
  },
  // Contact officiel Sénégal
  contact: {
    tel: '771906476',
    email: 'margeup0@gmail.com'
  }
};
