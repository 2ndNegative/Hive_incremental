// Job definitions.
//
//   outputs   produced per assigned worker per second
//   inputs    consumed per assigned worker per second
//   mult      which multiplier channel scales this job's outputs
//   slots     null = unlimited, otherwise capacity comes from buildings
//   needsPower  true if the job's workplace runs on the grid (throttled by
//               a power deficit)

export const JOBS = {
  unemployed: {
    id: 'unemployed',
    name: 'Idle',
    desc: 'Workers with nothing assigned. They consume nothing and produce nothing.',
    unlock: () => true,
    slots: null,
    assignable: false,
  },
  gatherer: {
    id: 'gatherer',
    name: 'Gatherer',
    desc: 'Collects loose matter by hand.',
    unlock: () => true,
    outputs: { matter: 0.5 },
    mult: 'gatherer',
    slots: null,
    assignable: true,
    feedOrder: 0,
  },
  scholar: {
    id: 'scholar',
    name: 'Scholar',
    desc: 'Studies and records findings, generating knowledge.',
    unlock: () => true,
    outputs: { knowledge: 0.2 },
    mult: 'scholar',
    slots: null,
    assignable: true,
    feedOrder: 0,
  },
  smelter: {
    id: 'smelter',
    name: 'Smelter',
    desc: 'Works a foundry, converting matter into alloy.',
    unlock: (state) => state.tech.metallurgy,
    inputs: { matter: 1.2 },
    outputs: { alloy: 0.25 },
    mult: 'smelter',
    slots: 'smelter', // capacity provided by buildings' jobSlots
    assignable: true,
    needsPower: true,
    feedOrder: 3, // fed after generators
  },
};

export const JOB_ORDER = ['unemployed', 'gatherer', 'scholar', 'smelter'];
