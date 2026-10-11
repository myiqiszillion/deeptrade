interface SchemaMeta { schema: string; rtype?: number; level?: string; description?: string; datasets: string[] }

const SCHEMAS: SchemaMeta[] = [
  { schema: 'trades', rtype: 22, level: 'L1', description: 'Trades', datasets: ['OPRA.PILLAR','EQUS.MINI','GLBX.MDP3'] },
  { schema: 'mbo', rtype: 22, level: 'L3', description: 'Market by order', datasets: ['OPRA.PILLAR','GLBX.MDP3'] },
  { schema: 'mbp-1', level: 'L1', description: 'Top of book', datasets: ['OPRA.PILLAR','EQUS.MINI','GLBX.MDP3'] },
  { schema: 'mbp-10', level: 'L2', description: '10-level book', datasets: ['GLBX.MDP3'] },
  { schema: 'tbbo', level: 'L1', datasets: ['OPRA.PILLAR','EQUS.MINI','GLBX.MDP3'] },
  { schema: 'bbo-1s', level: 'L1', datasets: ['OPRA.PILLAR','EQUS.MINI'] },
  { schema: 'bbo-1m', level: 'L1', datasets: ['OPRA.PILLAR','EQUS.MINI'] },
  { schema: 'ohlcv-1s', level: 'L1', datasets: ['OPRA.PILLAR','EQUS.MINI','GLBX.MDP3'] },
  { schema: 'ohlcv-1m', level: 'L1', datasets: ['OPRA.PILLAR','EQUS.MINI','GLBX.MDP3'] },
  { schema: 'ohlcv-1h', level: 'L1', datasets: ['GLBX.MDP3','EQUS.MINI'] },
  { schema: 'ohlcv-1d', level: 'L1', datasets: ['EQUS.MINI','GLBX.MDP3'] },
  { schema: 'definition', rtype: 12, description: 'Instrument definitions', datasets: ['OPRA.PILLAR','EQUS.MINI','GLBX.MDP3'] },
  { schema: 'statistics', rtype: 13, datasets: ['OPRA.PILLAR','GLBX.MDP3'] },
  { schema: 'status', rtype: 14, datasets: ['OPRA.PILLAR','GLBX.MDP3'] },
];

export function listSchemas(): SchemaMeta[] { return SCHEMAS; }
