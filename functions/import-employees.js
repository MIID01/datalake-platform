// import-employees.js — Run from functions/ directory
// Usage: node import-employees.js
// Reads the Emkan employee Excel and imports to Firestore employees + users collections

const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

const employees = [
  {
    employee_id: 'DLSA1001', full_name: 'Mohammed Alqumri', full_name_ar: '', email: 'm.alqumri@datalake.sa',
    phone: '', gender: 'Male', nationality: 'Saudi', date_of_birth: '', department: 'management',
    job_title: 'Partner / CEO', type: 'internal', contract_type: '', salary_usd: 0, salary_sar: 0,
    contract_start: '2025-04-17', contract_end: '', assigned_project: '', passport_number: '',
    passport_expiry: '', iqama_number: '', iqama_expiry: '', bank_iban: '',
    emergency_name: '', emergency_phone: '', emergency_relationship: '',
    visa_required: false, accommodation: false, transportation: '', per_diem: '',
    employment_status: 'active', onboarding_complete: true, training_complete: true, pdpl_consent: true,
    role_id: 'ceo'
  },
  {
    employee_id: 'DLSA1002', full_name: 'Enas Saeed', full_name_ar: '', email: '',
    phone: '', gender: 'Female', nationality: 'Saudi', date_of_birth: '', department: 'management',
    job_title: 'Business Manager', type: 'internal', contract_type: '', salary_usd: 0, salary_sar: 0,
    contract_start: '2025-05-01', contract_end: '', assigned_project: '', passport_number: '',
    passport_expiry: '', iqama_number: '', iqama_expiry: '', bank_iban: '',
    emergency_name: '', emergency_phone: '', emergency_relationship: '',
    visa_required: false, accommodation: false, transportation: '', per_diem: '',
    employment_status: 'active', onboarding_complete: true, training_complete: true, pdpl_consent: true,
    role_id: 'hr'
  },
  {
    employee_id: 'DLSA1003', full_name: 'Khalid Mohammed', full_name_ar: '', email: 'finance@datalake.sa',
    phone: '', gender: 'Male', nationality: 'Egyptian', date_of_birth: '', department: 'finance',
    job_title: 'Accountant', type: 'internal', contract_type: '', salary_usd: 0, salary_sar: 0,
    contract_start: '2025-07-01', contract_end: '', assigned_project: '', passport_number: '',
    passport_expiry: '', iqama_number: '', iqama_expiry: '', bank_iban: '',
    emergency_name: '', emergency_phone: '', emergency_relationship: '',
    visa_required: false, accommodation: false, transportation: '', per_diem: '',
    employment_status: 'active', onboarding_complete: true, training_complete: true, pdpl_consent: true,
    role_id: 'finance'
  },
  {
    employee_id: 'DLSA1005', full_name: 'Ayham Ramadan', full_name_ar: '', email: 'ayh.ashraf@datalake.sa',
    phone: '+966 54 431 7848', gender: 'Male', nationality: 'Egyptian', date_of_birth: '', department: 'engineering',
    job_title: 'Data Architect', type: 'deployed', contract_type: 'Remote contract_KSA', salary_usd: 3600, salary_sar: 13500,
    contract_start: '2025-06-16', contract_end: '', assigned_project: 'Emkan Finance - Data Warehouse', passport_number: '',
    passport_expiry: '', iqama_number: '', iqama_expiry: '', bank_iban: '',
    emergency_name: '', emergency_phone: '', emergency_relationship: '',
    visa_required: true, accommodation: true, transportation: 'Flights', per_diem: '25 USD',
    employment_status: 'active', onboarding_complete: true, training_complete: false, pdpl_consent: true,
    role_id: 'engineer'
  },
  {
    employee_id: 'DLSA1006', full_name: 'Mahmoud Abdelghany', full_name_ar: '', email: 'mah.abdelghany@datalake.sa',
    phone: '+201145988730', gender: 'Male', nationality: 'Egyptian', date_of_birth: '', department: 'engineering',
    job_title: 'Data Protection Engineer', type: 'deployed', contract_type: 'Remote contract_KSA', salary_usd: 3000, salary_sar: 11250,
    contract_start: '2025-06-16', contract_end: '', assigned_project: 'Emkan Finance - Data Warehouse', passport_number: 'A41224704',
    passport_expiry: '', iqama_number: '', iqama_expiry: '', bank_iban: 'EG710010001700000100068157026',
    emergency_name: '', emergency_phone: '', emergency_relationship: '',
    visa_required: true, accommodation: true, transportation: 'Flights', per_diem: '25 USD',
    employment_status: 'active', onboarding_complete: true, training_complete: false, pdpl_consent: true,
    role_id: 'engineer'
  },
  {
    employee_id: 'DLSA1007', full_name: 'Mohamed Dahas', full_name_ar: '', email: 'moh.dahas@datalake.sa',
    phone: '+216 55 210 254', gender: 'Male', nationality: 'Tunisian', date_of_birth: '', department: 'engineering',
    job_title: 'Senior Data Engineer', type: 'deployed', contract_type: 'Remote contract_KSA', salary_usd: 3040, salary_sar: 11400,
    contract_start: '2025-06-16', contract_end: '', assigned_project: 'Emkan Finance - Data Warehouse', passport_number: 'J309764',
    passport_expiry: '', iqama_number: '', iqama_expiry: '', bank_iban: '',
    emergency_name: '', emergency_phone: '', emergency_relationship: '',
    visa_required: true, accommodation: true, transportation: 'Flights', per_diem: '25 USD',
    employment_status: 'active', onboarding_complete: true, training_complete: false, pdpl_consent: true,
    role_id: 'engineer'
  },
  {
    employee_id: 'DLSA1008', full_name: 'Mahmoud Reda', full_name_ar: '', email: 'mah.reda@datalake.sa',
    phone: '201281943442', gender: 'Male', nationality: 'Egyptian', date_of_birth: '', department: 'engineering',
    job_title: 'BI Engineer', type: 'deployed', contract_type: 'Remote contract_KSA', salary_usd: 2000, salary_sar: 7500,
    contract_start: '2025-06-16', contract_end: '', assigned_project: 'Emkan Finance - Data Warehouse', passport_number: '',
    passport_expiry: '', iqama_number: '', iqama_expiry: '', bank_iban: 'EG310025004000000040206187110',
    emergency_name: '', emergency_phone: '', emergency_relationship: '',
    visa_required: true, accommodation: true, transportation: 'Flights', per_diem: '25 USD',
    employment_status: 'active', onboarding_complete: true, training_complete: false, pdpl_consent: true,
    role_id: 'engineer'
  },
  {
    employee_id: 'DLSA1009', full_name: 'Marwen Benalayat', full_name_ar: '', email: 'mar.benalayat@datalake.sa',
    phone: '+216 25 315 460', gender: 'Male', nationality: 'Tunisian', date_of_birth: '', department: 'engineering',
    job_title: 'Data Engineer', type: 'deployed', contract_type: 'Remote contract_KSA', salary_usd: 2318.42, salary_sar: 8694.08,
    contract_start: '2025-09-01', contract_end: '', assigned_project: 'Emkan Finance - Data Warehouse', passport_number: 'J617607',
    passport_expiry: '2025-09-19', iqama_number: '', iqama_expiry: '', bank_iban: '',
    emergency_name: '', emergency_phone: '', emergency_relationship: '',
    visa_required: true, accommodation: true, transportation: 'Flights', per_diem: '25 USD',
    employment_status: 'active', onboarding_complete: true, training_complete: false, pdpl_consent: true,
    role_id: 'engineer'
  },
  {
    employee_id: 'DLSA1010', full_name: 'Salaheddine Gragba', full_name_ar: '', email: 'Saleh.Gragba@datalake.sa',
    phone: '+21650198329', gender: 'Male', nationality: 'Tunisian', date_of_birth: '', department: 'engineering',
    job_title: 'Data Scientist', type: 'deployed', contract_type: 'Remote contract_KSA', salary_usd: 2484, salary_sar: 9315,
    contract_start: '2025-08-01', contract_end: '', assigned_project: 'Emkan Finance - Data Warehouse', passport_number: 'I452042',
    passport_expiry: '', iqama_number: '', iqama_expiry: '', bank_iban: 'TN5901906131111007329062',
    emergency_name: '', emergency_phone: '', emergency_relationship: '',
    visa_required: true, accommodation: true, transportation: 'Flights', per_diem: '25 USD',
    employment_status: 'preboarding', onboarding_complete: false, training_complete: false, pdpl_consent: false,
    role_id: 'engineer'
  },
  {
    employee_id: 'DLSA1012', full_name: 'Marwan Ayoub', full_name_ar: '', email: 'mar.ayoub@datalake.sa',
    phone: '', gender: 'Male', nationality: 'Tunisian', date_of_birth: '', department: 'engineering',
    job_title: 'BI Engineer', type: 'deployed', contract_type: 'Remote contract_KSA', salary_usd: 0, salary_sar: 0,
    contract_start: '', contract_end: '', assigned_project: '', passport_number: '',
    passport_expiry: '', iqama_number: '', iqama_expiry: '', bank_iban: '',
    emergency_name: '', emergency_phone: '', emergency_relationship: '',
    visa_required: false, accommodation: false, transportation: '', per_diem: '',
    employment_status: 'pending', onboarding_complete: false, training_complete: false, pdpl_consent: false,
    role_id: 'engineer'
  },
  {
    employee_id: 'DLSA1013', full_name: 'Alaa Hossameldeen Abdelsameaa Alkattan', full_name_ar: 'علاء حسام الدين عبد السميع القطان',
    email: 'Alaa.Alkattan@datalake.sa', phone: '', gender: 'Male', nationality: 'Egyptian',
    date_of_birth: '1987-12-10', department: 'engineering',
    job_title: 'Electrical Engineer - Business Director', type: 'deployed', contract_type: 'Remote contract_KSA',
    salary_usd: 0, salary_sar: 0, contract_start: '', contract_end: '',
    assigned_project: '', passport_number: 'A37872777', passport_expiry: '',
    iqama_number: '', iqama_expiry: '2031-06-03', bank_iban: '',
    emergency_name: '', emergency_phone: '', emergency_relationship: '',
    visa_required: false, accommodation: false, transportation: '', per_diem: '',
    employment_status: 'pending', onboarding_complete: false, training_complete: false, pdpl_consent: false,
    role_id: 'engineer'
  },
  {
    employee_id: 'DLSA1014', full_name: 'Bassam Abdelsattar Hussein Soliman', full_name_ar: 'بسام عبد الستار حسين سليمان',
    email: 'Bassam.soliman@datalake.sa', phone: '', gender: 'Male', nationality: 'Egyptian',
    date_of_birth: '1989-12-12', department: 'engineering',
    job_title: 'Computer Science / Technical Director', type: 'deployed', contract_type: 'Remote contract_KSA',
    salary_usd: 0, salary_sar: 0, contract_start: '', contract_end: '',
    assigned_project: '', passport_number: 'A38948379', passport_expiry: '',
    iqama_number: '', iqama_expiry: '2031-09-10', bank_iban: '',
    emergency_name: '', emergency_phone: '', emergency_relationship: '',
    visa_required: false, accommodation: false, transportation: '', per_diem: '',
    employment_status: 'pending', onboarding_complete: false, training_complete: false, pdpl_consent: false,
    role_id: 'engineer'
  },
  {
    employee_id: 'DLSA1015', full_name: 'Mohamed Ashraf Mahran Mohamed', full_name_ar: 'محمد اشرف مهران محمد',
    email: 'Moh.ashraf@datalake.sa', phone: '', gender: 'Male', nationality: 'Egyptian',
    date_of_birth: '2002-08-10', department: 'engineering',
    job_title: 'Developer', type: 'deployed', contract_type: 'Remote contract_KSA',
    salary_usd: 0, salary_sar: 0, contract_start: '', contract_end: '',
    assigned_project: '', passport_number: 'A42193364', passport_expiry: '',
    iqama_number: '', iqama_expiry: '2032-07-28', bank_iban: '',
    emergency_name: '', emergency_phone: '', emergency_relationship: '',
    visa_required: false, accommodation: false, transportation: '', per_diem: '',
    employment_status: 'pending', onboarding_complete: false, training_complete: false, pdpl_consent: false,
    role_id: 'engineer'
  },
  {
    employee_id: 'DLSA1016', full_name: 'Mahmoud Aly Mahmoud Aly Metawea', full_name_ar: 'محمود على محمود على مطاوع',
    email: 'Mah.Metawea@datalake.sa', phone: '', gender: 'Male', nationality: 'Egyptian',
    date_of_birth: '1997-09-23', department: 'engineering',
    job_title: 'Software Engineer - Senior Developer', type: 'deployed', contract_type: 'Remote contract_KSA',
    salary_usd: 0, salary_sar: 0, contract_start: '', contract_end: '',
    assigned_project: '', passport_number: 'A29311089', passport_expiry: '',
    iqama_number: '', iqama_expiry: '2028-11-30', bank_iban: '',
    emergency_name: '', emergency_phone: '', emergency_relationship: '',
    visa_required: false, accommodation: false, transportation: '', per_diem: '',
    employment_status: 'pending', onboarding_complete: false, training_complete: false, pdpl_consent: false,
    role_id: 'engineer'
  },
  {
    employee_id: 'DLSA1017', full_name: 'Marwan Mohamed Mohsen Mohamed Mahdy', full_name_ar: '',
    email: 'mohamed.mohsen@datalake.sa', phone: '+201002467699', gender: 'Male', nationality: 'Egyptian',
    date_of_birth: '1996-11-02', department: 'engineering',
    job_title: 'Data Privacy Engineer', type: 'deployed', contract_type: 'Remote contract_KSA',
    salary_usd: 0, salary_sar: 0, contract_start: '2026-05-05', contract_end: '',
    assigned_project: '', passport_number: 'A33447574', passport_expiry: '',
    iqama_number: '', iqama_expiry: '2030-03-11', bank_iban: 'EG470014005000001029911277902',
    emergency_name: '', emergency_phone: '', emergency_relationship: '',
    visa_required: false, accommodation: false, transportation: '', per_diem: '',
    employment_status: 'pending', onboarding_complete: false, training_complete: false, pdpl_consent: false,
    role_id: 'engineer'
  }
];

async function importAll() {
  let count = 0;
  for (const emp of employees) {
    // Write to employees collection
    await db.collection('employees').doc(emp.employee_id).set({
      ...emp,
      created_at: new Date(),
      updated_at: new Date()
    }, { merge: true });

    // Write to users collection (for auth/RBAC) — only if email exists
    if (emp.email) {
      await db.collection('users').doc(emp.email.toLowerCase()).set({
        email: emp.email.toLowerCase(),
        display_name: emp.full_name,
        role_id: emp.role_id,
        employee_id: emp.employee_id,
        status: emp.employment_status === 'active' ? 'active' : 'pending',
        created_at: new Date()
      }, { merge: true });
    }

    count++;
    console.log(`Imported ${emp.employee_id}: ${emp.full_name} (${emp.role_id})`);
  }
  console.log(`\nDone — ${count} employees imported to Firestore`);
  process.exit();
}

importAll().catch(err => { console.error('Import failed:', err); process.exit(1); });
