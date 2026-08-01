/* Fields — ui_mastercontext.md Section 5.9 Tab 2 columns:
   Region Code (.mono), Region Name, Allocation Policy, Hospital Count.
   hospitalCount matches the hospitals listed in mockHospitals.js. */
export const mockRegions = [
  {
    code: 'RGN-N',
    name: 'North',
    allocationPolicy: 'Local first, then regional within 500 km',
    hospitalCount: 2,
  },
  {
    code: 'RGN-S',
    name: 'South',
    allocationPolicy: 'Local first, then regional within 400 km',
    hospitalCount: 3,
  },
  {
    code: 'RGN-E',
    name: 'East',
    allocationPolicy: 'Regional pool shared with Central',
    hospitalCount: 1,
  },
  {
    code: 'RGN-W',
    name: 'West',
    allocationPolicy: 'Local first, national escalation after 6 hours',
    hospitalCount: 1,
  },
  {
    code: 'RGN-C',
    name: 'Central',
    allocationPolicy: 'Regional pool shared with East',
    hospitalCount: 1,
  },
];

export default mockRegions;
