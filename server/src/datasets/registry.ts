import { listDatasets, getDataset, loadCapabilities } from './capabilities.js';

export const datasetRegistry = {
  list: listDatasets,
  get: getDataset,
  load: loadCapabilities,
};
