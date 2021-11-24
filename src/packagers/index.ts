import _ from 'lodash'
import { NPM } from './npm'
import { Yarn } from './yarn'

const registeredPackagers = { npm: NPM, yarn: Yarn };

export function get(packagerId: 'npm' | 'yarn') {
  if (!_.has(registeredPackagers, packagerId)) {
    const message = `Could not find packager '${packagerId}'`;
    throw new Error(message);
  }

  return registeredPackagers[packagerId];
}