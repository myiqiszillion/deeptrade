import assert from 'node:assert/strict';
import { resolveDatabentoConfig, databentoConfigured, missingKeyReason } from '../../src/databento/config.js';

export async function runDatabentoConfigTests(): Promise<void> {
  console.log('[unit/databentoConfig.test] Running Databento config unit tests...');

  // defaults without env
  {
    const cfg = resolveDatabentoConfig({} as any);
    assert.equal(cfg.opraDataset, 'OPRA.PILLAR');
    assert.equal(cfg.equitiesDataset, 'DBEQ.BASIC');
    assert.equal(cfg.cmeDataset, 'GLBX.MDP3');
    assert.equal(cfg.costCapUsd, 50);
    assert.equal(cfg.histBaseUrl, 'https://hist.databento.com/v0');
    assert.equal(databentoConfigured({} as any), false);
    assert.ok(missingKeyReason().includes('DATABENTO_API_KEY'));
  }

  // overrides
  {
    const cfg = resolveDatabentoConfig({
      DATABENTO_API_KEY: '  key123  ',
      DATABENTO_OPRA_DATASET: 'OPRA.PILLAR',
      DATABENTO_EQUITIES_DATASET: 'XNAS.ITCH',
      DATABENTO_CME_DATASET: 'GLBX.MDP3',
      DATABENTO_COST_CAP_USD: '25',
      DATABENTO_HIST_URL: 'https://hist.databento.com/v0/',
      DATABENTO_SYMBOLS: 'SPY, ES , SPY',
    } as any);
    assert.equal(cfg.apiKey, 'key123');
    assert.equal(cfg.equitiesDataset, 'XNAS.ITCH');
    assert.equal(cfg.costCapUsd, 25);
    assert.equal(cfg.histBaseUrl, 'https://hist.databento.com/v0');
    assert.deepEqual(cfg.symbols, ['SPY', 'ES']);
    assert.equal(databentoConfigured({ DATABENTO_API_KEY: 'key123' } as any), true);
  }

  // invalid cost cap falls back
  {
    const cfg = resolveDatabentoConfig({ DATABENTO_COST_CAP_USD: 'not-a-number' } as any);
    assert.equal(cfg.costCapUsd, 50);
  }

  console.log('  [PASS] All Databento config unit tests passed.');
}
