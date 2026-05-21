// import-employees-v2.js — FROM ZOHO PAYROLL (SOURCE OF TRUTH)
// This OVERWRITES the previous import with corrected data
// Run: cd functions && node import-employees-v2.js

const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

const employees = [
  {
    employee_id: 'DLSA1001', full_name: 'Mohammed Alqumri', full_name_ar: 'محمد القمري',
    email: 'm.alqumri@datalake.sa', personal_email: 'm.alqumri@hotmail.com',
    phone: '+966567740999', gender: 'Male', nationality: 'Saudi Arabia', date_of_birth: '1989-10-08',
    department: 'Executive Management', department_ar: 'الإدارة التنفيذية',
    job_title: 'Partner / CEO', job_title_ar: 'شريك اعمال',
    type: 'internal', employment_type: 'Permanent', contract_type: 'Unlimited Contract',
    contract_start: '2025-02-01', iqama_national_id: '1066619345',
    work_location: 'Head Office Riyadh', employment_status: 'active',
    role_id: 'ceo', onboarding_complete: true, training_complete: true, pdpl_consent: true
  },
  {
    employee_id: 'DLSA1002', full_name: 'Enas Saeed Ahmed', full_name_ar: 'إيناس سعيد عسيري',
    email: 'enas.saeed@datalake.sa', personal_email: 'enassaeed1991@gmail.com',
    phone: '+966590995590', gender: 'Female', nationality: 'Saudi Arabia', date_of_birth: '1991-03-27',
    department: 'Business Development', department_ar: 'تطوير الأعمال',
    job_title: 'Business Manager', job_title_ar: 'مدير اعمال',
    type: 'internal', employment_type: 'Permanent', contract_type: 'Unlimited Contract',
    contract_start: '2025-05-01', iqama_national_id: '1071702201',
    work_location: 'Head Office Riyadh', employment_status: 'terminated',
    role_id: 'hr', onboarding_complete: false, training_complete: false, pdpl_consent: false
  },
  {
    employee_id: 'DLSA1003', full_name: 'Adel Almukhtar', full_name_ar: 'عادل المختار',
    email: '', personal_email: '',
    phone: '', gender: 'Male', nationality: 'Saudi Arabia', date_of_birth: '1996-11-20',
    department: 'Business Development', department_ar: 'تطوير الأعمال',
    job_title: 'Business Manager', job_title_ar: 'مدير الأعمال',
    type: 'internal', employment_type: 'Permanent', contract_type: 'Limited Contract',
    contract_start: '2025-03-01', iqama_national_id: '',
    work_location: 'Head Office Riyadh', employment_status: 'terminated',
    role_id: 'hr', onboarding_complete: false, training_complete: false, pdpl_consent: false
  },
  {
    employee_id: 'DLSA1005', full_name: 'Ayhem Ashraf Ali Ramadan', full_name_ar: 'أيهم أشرف علي أحمد رمضان',
    email: 'ayh.ashraf@datalake.sa', personal_email: '',
    phone: '+966544317848', gender: 'Male', nationality: 'Egypt', date_of_birth: '1993-09-29',
    department: 'Data Management', department_ar: 'إدارة البيانات',
    job_title: 'Data Architect', job_title_ar: 'معمـاري بيانـات',
    type: 'deployed', employment_type: 'Permanent', contract_type: 'Limited Contract',
    contract_start: '2025-06-15', iqama_national_id: '',
    work_location: 'Head Office Riyadh', employment_status: 'terminated',
    role_id: 'engineer', onboarding_complete: false, training_complete: false, pdpl_consent: false
  },
  {
    employee_id: 'DLSA1006', full_name: 'Mahmoud Abdelghany', full_name_ar: 'محمود عبد الغني',
    email: 'mah.abdelghany@datalake.sa', personal_email: '',
    phone: '', gender: 'Male', nationality: 'Egypt', date_of_birth: '1992-10-31',
    department: 'Data Management', department_ar: 'إدارة البيانات',
    job_title: 'Data Protection Engineer', job_title_ar: 'مهندس حماية البيانات',
    type: 'deployed', employment_type: 'Permanent', contract_type: 'Limited Contract',
    contract_start: '2025-06-15', iqama_national_id: '',
    work_location: 'Head Office Riyadh', employment_status: 'active',
    assigned_project: 'Emkan Finance - Data Warehouse',
    role_id: 'engineer', onboarding_complete: true, training_complete: false, pdpl_consent: true
  },
  {
    employee_id: 'DLSA1007', full_name: 'Mohamed Dahas', full_name_ar: 'محمد دحاس',
    email: 'moh.dahas@datalake.sa', personal_email: '',
    phone: '+21655210254', gender: 'Male', nationality: 'Tunisia', date_of_birth: '1988-05-04',
    department: 'Data Management', department_ar: 'إدارة البيانات',
    job_title: 'Data Engineer', job_title_ar: 'مهندس بيانات',
    type: 'deployed', employment_type: 'Permanent', contract_type: 'Limited Contract',
    contract_start: '2025-06-15', iqama_national_id: '',
    work_location: 'Head Office Riyadh', employment_status: 'active',
    assigned_project: 'Emkan Finance - Data Warehouse',
    role_id: 'engineer', onboarding_complete: true, training_complete: false, pdpl_consent: true
  },
  {
    employee_id: 'DLSA1008', full_name: 'Mahmoud Reda', full_name_ar: 'محمود رضا',
    email: 'mah.reda@datalake.sa', personal_email: '',
    phone: '+201281943442', gender: 'Male', nationality: 'Egypt', date_of_birth: '1997-04-05',
    department: 'Data Management', department_ar: 'إدارة البيانات',
    job_title: 'BI Engineer', job_title_ar: 'مهندس ذكاء الأعمال',
    type: 'deployed', employment_type: 'Permanent', contract_type: 'Limited Contract',
    contract_start: '2025-06-15', iqama_national_id: '',
    work_location: 'Head Office Riyadh', employment_status: 'terminated',
    role_id: 'engineer', onboarding_complete: false, training_complete: false, pdpl_consent: false
  },
  {
    employee_id: 'DLSA1009', full_name: 'Marwen Benalayat', full_name_ar: 'مروان بن عليات',
    email: 'mar.benalayat@datalake.sa', personal_email: '',
    phone: '+21625315460', gender: 'Male', nationality: 'Tunisia', date_of_birth: '1993-09-19',
    department: 'Data Management', department_ar: 'إدارة البيانات',
    job_title: 'Data Engineer', job_title_ar: 'مهندس بيانات',
    type: 'deployed', employment_type: 'Permanent', contract_type: 'Limited Contract',
    contract_start: '2025-09-01', iqama_national_id: '',
    work_location: 'Head Office Riyadh', employment_status: 'active',
    assigned_project: 'Emkan Finance - Data Warehouse',
    role_id: 'engineer', onboarding_complete: true, training_complete: false, pdpl_consent: true
  },
  {
    employee_id: 'DLSA1010', full_name: 'Salaheddine Gragba', full_name_ar: 'صلاح الدين القراقبة',
    email: 'saleh.gragba@datalake.sa', personal_email: '',
    phone: '+21650198329', gender: 'Male', nationality: 'Tunisia', date_of_birth: '1989-02-05',
    department: 'Data Engineering', department_ar: 'هندسة البيانات',
    job_title: 'Data Scientist', job_title_ar: 'عالم بيانات',
    type: 'deployed', employment_type: 'Permanent', contract_type: 'Limited Contract',
    contract_start: '2025-08-01', iqama_national_id: '0000452042',
    work_location: 'Head Office Riyadh', employment_status: 'active',
    assigned_project: 'Emkan Finance - Data Warehouse',
    role_id: 'engineer', onboarding_complete: true, training_complete: false, pdpl_consent: true
  },
  {
    employee_id: 'DLSA1011', full_name: 'Khaled Mohamd Hamd', full_name_ar: 'خالد محمد حمد',
    email: 'khaled.mohamed13798@gmail.com', personal_email: '',
    phone: '+201146885220', gender: 'Male', nationality: 'Egypt', date_of_birth: '1998-07-13',
    department: 'Finance & Accounting', department_ar: 'المالية والمحاسبة',
    job_title: 'Accountant', job_title_ar: 'محاسب',
    type: 'internal', employment_type: 'Permanent', contract_type: 'Limited Contract',
    contract_start: '2025-11-01', iqama_national_id: '',
    work_location: 'Head Office Riyadh', employment_status: 'active',
    role_id: 'finance', onboarding_complete: true, training_complete: false, pdpl_consent: true
  },
  {
    employee_id: 'DLSA1012', full_name: 'Marwan ibn alTahir Ayyub', full_name_ar: 'مروان بن الطاهر أيوب',
    email: 'mar.ayoub@datalake.sa', personal_email: '',
    phone: '', gender: 'Male', nationality: 'Tunisia', date_of_birth: '1991-05-10',
    department: 'Business Intelligence', department_ar: 'ذكاء الأعمال',
    job_title: 'BI Engineer', job_title_ar: 'مهندس ذكاء الأعمال',
    type: 'deployed', employment_type: 'Permanent', contract_type: 'Limited Contract',
    contract_start: '2026-01-01', iqama_national_id: '',
    work_location: 'Head Office Riyadh', employment_status: 'active',
    assigned_project: 'Emkan Finance - Data Warehouse',
    role_id: 'engineer', onboarding_complete: true, training_complete: false, pdpl_consent: true
  }
];

// Auto-numbering: track the highest ID for future use
const COUNTER_DOC = 'counters/employee_id';

async function importAll() {
  let maxId = 0;
  let count = 0;

  for (const emp of employees) {
    // Track highest employee number
    const num = parseInt(emp.employee_id.replace('DLSA', ''));
    if (num > maxId) maxId = num;

    // Write to employees collection (merge to preserve any existing data)
    await db.collection('employees').doc(emp.employee_id).set({
      ...emp,
      updated_at: new Date(),
      updated_by: 'import-v2-zoho-payroll',
      source: 'zoho_payroll_export'
    }, { merge: true });

    // Write to users collection (for auth/RBAC) — only if email exists and not terminated
    if (emp.email && emp.employment_status !== 'terminated') {
      await db.collection('users').doc(emp.email.toLowerCase()).set({
        email: emp.email.toLowerCase(),
        display_name: emp.full_name,
        role_id: emp.role_id,
        employee_id: emp.employee_id,
        status: 'active',
        updated_at: new Date()
      }, { merge: true });
    }

    // If terminated, disable their user account
    if (emp.employment_status === 'terminated' && emp.email) {
      await db.collection('users').doc(emp.email.toLowerCase()).set({
        status: 'disabled',
        disabled_at: new Date(),
        disabled_reason: 'Exited per Zoho Payroll'
      }, { merge: true });
    }

    count++;
    console.log(`${emp.employment_status === 'terminated' ? '❌' : '✅'} ${emp.employee_id}: ${emp.full_name} (${emp.role_id}) — ${emp.employment_status}`);
  }

  // Set the auto-increment counter for future employee IDs
  await db.doc(COUNTER_DOC).set({
    last_id: maxId,
    prefix: 'DLSA',
    updated_at: new Date()
  });
  console.log(`\n📊 Counter set: next employee ID will be DLSA${maxId + 1}`);
  console.log(`\n✅ Done — ${count} employees imported from Zoho Payroll`);
  process.exit();
}

importAll().catch(err => { console.error('Import failed:', err); process.exit(1); });
