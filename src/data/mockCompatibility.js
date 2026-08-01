/* Backs the two tables in ui_mastercontext.md Section 5.9 Tab 4.

   mockCompatibility: one row per donor blood group, holding the recipient
   blood groups that row can donate to. Rendering both axes of the documented
   8x8 grid means checking whether a recipient group is in compatibleWith.
   Values are the standard ABO/Rh donation rules.

   mockHlaAlleles: the HLA Allele Reference CRUD table
   (Allele Code (.mono), Locus, Description). */

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

export const mockCompatibility = [
  { bloodGroup: 'A+', compatibleWith: ['A+', 'AB+'] },
  { bloodGroup: 'A-', compatibleWith: ['A+', 'A-', 'AB+', 'AB-'] },
  { bloodGroup: 'B+', compatibleWith: ['B+', 'AB+'] },
  { bloodGroup: 'B-', compatibleWith: ['B+', 'B-', 'AB+', 'AB-'] },
  { bloodGroup: 'AB+', compatibleWith: ['AB+'] },
  { bloodGroup: 'AB-', compatibleWith: ['AB+', 'AB-'] },
  { bloodGroup: 'O+', compatibleWith: ['A+', 'B+', 'AB+', 'O+'] },
  {
    bloodGroup: 'O-',
    compatibleWith: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
  },
];

export const mockHlaAlleles = [
  { code: 'A*01:01', locus: 'A', description: 'Common HLA-A allele, high frequency in North India' },
  { code: 'A*02:01', locus: 'A', description: 'Most frequently reported HLA-A allele worldwide' },
  { code: 'A*03:01', locus: 'A', description: 'HLA-A allele associated with Caucasian and North Indian donors' },
  { code: 'A*11:01', locus: 'A', description: 'High frequency HLA-A allele in South and East Asia' },
  { code: 'A*24:02', locus: 'A', description: 'Common HLA-A allele across Asian populations' },
  { code: 'A*33:03', locus: 'A', description: 'HLA-A allele common in South Indian donors' },
  { code: 'B*07:02', locus: 'B', description: 'Common HLA-B allele, part of the B7 serological group' },
  { code: 'B*08:01', locus: 'B', description: 'HLA-B allele of the ancestral 8.1 haplotype' },
  { code: 'B*15:01', locus: 'B', description: 'HLA-B allele of the B62 serological group' },
  { code: 'B*27:05', locus: 'B', description: 'HLA-B allele screened for in pre-transplant workups' },
  { code: 'B*35:01', locus: 'B', description: 'Widely distributed HLA-B allele' },
  { code: 'B*40:01', locus: 'B', description: 'HLA-B allele of the B60 serological group' },
  { code: 'B*44:02', locus: 'B', description: 'HLA-B allele of the B44 serological group' },
  { code: 'B*51:01', locus: 'B', description: 'HLA-B allele common in Central and West Asia' },
  { code: 'B*57:01', locus: 'B', description: 'HLA-B allele relevant to drug hypersensitivity screening' },
  { code: 'B*58:01', locus: 'B', description: 'HLA-B allele common in South Asian and African donors' },
  { code: 'DRB1*01:01', locus: 'DR', description: 'HLA-DR allele of the DR1 serological group' },
  { code: 'DRB1*03:01', locus: 'DR', description: 'HLA-DR allele of the DR17 serological group' },
  { code: 'DRB1*04:01', locus: 'DR', description: 'HLA-DR allele of the DR4 serological group' },
  { code: 'DRB1*07:01', locus: 'DR', description: 'Frequently reported HLA-DR allele in Indian donors' },
  { code: 'DRB1*11:01', locus: 'DR', description: 'HLA-DR allele of the DR11 serological group' },
  { code: 'DRB1*13:01', locus: 'DR', description: 'HLA-DR allele of the DR13 serological group' },
  { code: 'DRB1*15:01', locus: 'DR', description: 'HLA-DR allele of the DR15 serological group' },
];

export default mockCompatibility;
