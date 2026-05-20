const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

const DEFAULT_MODULES = [
  { module_id: 'PDPL-AWARENESS', title: 'PDPL Data Protection Awareness', description: 'Understanding Saudi Arabia\'s Personal Data Protection Law (PDPL) and your obligations as a Datalake employee handling client data.', category: 'Compliance', mandatory: true },
  { module_id: 'CODE-OF-CONDUCT', title: 'Code of Conduct', description: 'Professional standards, ethics guidelines, and expected behavior for all Datalake staff augmentation engineers.', category: 'HR Policy', mandatory: true },
  { module_id: 'INFO-SEC', title: 'Information Security', description: 'Cybersecurity best practices, password policies, data classification, and incident reporting procedures.', category: 'Security', mandatory: true },
  { module_id: 'ANTI-BRIBERY', title: 'Anti-Bribery & Anti-Corruption', description: 'Understanding anti-bribery laws, gift policies, conflict of interest reporting, and whistleblower protections.', category: 'Compliance', mandatory: true },
  { module_id: 'WORKPLACE-SAFETY', title: 'Workplace Health & Safety', description: 'Emergency procedures, first aid, ergonomics, and workplace hazard awareness for client site deployments.', category: 'Safety', mandatory: true },
  { module_id: 'CLIENT-CONDUCT', title: 'Client Site Conduct', description: 'Professional behavior expectations when deployed at client sites, confidentiality protocols, and client communication guidelines.', category: 'Professional', mandatory: true },
];

async function seed() {
  for (const mod of DEFAULT_MODULES) {
    await db.collection('training_modules').doc(mod.module_id).set(mod);
    console.log(`Added ${mod.module_id}`);
  }
  console.log('Seeded successfully!');
  process.exit(0);
}

seed().catch(err => {
  console.error('Error seeding:', err);
  process.exit(1);
});
