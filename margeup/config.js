/* MargeUp - Configuration globale client
   Paramètres d'environnement publics et injectables. */
window.MARGEUP_CONFIG = {
  // Supabase (Projet de test)
  supabase: {
    url: (typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_SUPABASE_URL) || '',
    anonKey: (typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) || ''
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
