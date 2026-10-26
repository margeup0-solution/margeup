/* MargeUp - Configuration globale client
   Ce fichier contient les paramètres d'environnement non-secrets injectables. */
window.MARGEUP_CONFIG = {
  // Numéro de paiement marchand Wave / Orange Money (configurable)
  pay: {
    wave: '',
    om: '',
    num: (typeof process !== 'undefined' && process.env && process.env.MERCHANT_PAYMENT_NUMBER) || ''
  },
  // Coordonnées de contact
  contact: {
    tel: '771906476',
    email: 'margeup0@gmail.com'
  }
};
