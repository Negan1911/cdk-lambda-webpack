import _ from 'lodash'
import BbPromise from 'bluebird'
import { splitLines, safeJsonParse, spawnProcess, SpawnError } from '../utils'

type NPMPackagerOptions = {
  noInstall?: boolean
}

export class NPM {
  static get lockfileName() {
    return 'package-lock.json';
  }

  static get copyPackageSectionNames() {
    return [];
  }

  static get mustCopyModules() {
    return true;
  }

  static getProdDependencies(cwd: string, depth?: number) {
    // Get first level dependency graph
    const command = /^win/.test(process.platform) ? 'npm.cmd' : 'npm';
    const args = [
      'ls',
      '-prod', // Only prod dependencies
      '-json',
      `-depth=${depth || 1}`
    ];

    const ignoredNpmErrors = [
      { npmError: 'code ELSPROBLEMS', log: false }, // npm >= 7
      { npmError: 'extraneous', log: false },
      { npmError: 'missing', log: false },
      { npmError: 'peer dep missing', log: true }
    ];

    return spawnProcess(command, args, {
      cwd: cwd
    })
      .catch(err => {
        if (err instanceof SpawnError) {
          // Only exit with an error if we have critical npm errors for 2nd level inside
          // ignoring any extra output from npm >= 7
          const lines = _.split(err.stderr, '\n');
          const errors = _.takeWhile(lines, line => line !== '{');
          const failed = _.reduce(
            errors,
            (failed, error) => {
              if (failed) {
                return true;
              }
              return (
                !_.isEmpty(error) &&
                !_.some(ignoredNpmErrors, ignoredError => _.startsWith(error, `npm ERR! ${ignoredError.npmError}`))
              );
            },
            false
          );

          if (!failed && !_.isEmpty(err.stdout)) {
            return BbPromise.resolve({ stdout: err.stdout });
          }
        }

        return BbPromise.reject(err);
      })
      .then(processOutput => processOutput.stdout)
      .then(depJson => BbPromise.try(() => depJson ? JSON.parse(depJson) : undefined));
  }

  static _rebaseFileReferences(pathToPackageRoot: string, moduleVersion: string) {
    if (/^file:[^/]{2}/.test(moduleVersion)) {
      const filePath = _.replace(moduleVersion, /^file:/, '');
      return _.replace(`file:${pathToPackageRoot}/${filePath}`, /\\/g, '/');
    }

    return moduleVersion;
  }

  /**
   * We should not be modifying 'package-lock.json'
   * because this file should be treated as internal to npm.
   *
   * Rebase package-lock is a temporary workaround and must be
   * removed as soon as https://github.com/npm/npm/issues/19183 gets fixed.
   */
  static rebaseLockfile(pathToPackageRoot: string, lockfile: any) {
    if (lockfile.version) {
      lockfile.version = NPM._rebaseFileReferences(pathToPackageRoot, lockfile.version);
    }

    if (lockfile.dependencies) {
      _.forIn(lockfile.dependencies, lockedDependency => {
        NPM.rebaseLockfile(pathToPackageRoot, lockedDependency);
      });
    }

    return lockfile;
  }

  static install(cwd: string, packagerOptions?: NPMPackagerOptions) {
    if (packagerOptions?.noInstall) {
      return BbPromise.resolve();
    }

    const command = /^win/.test(process.platform) ? 'npm.cmd' : 'npm';
    const args = ['install'];

    return spawnProcess(command, args, { cwd }).return();
  }

  static prune(cwd: string) {
    const command = /^win/.test(process.platform) ? 'npm.cmd' : 'npm';
    const args = ['prune'];

    return spawnProcess(command, args, { cwd }).return();
  }

  static runScripts(cwd: string, scriptNames: string[]) {
    const command = /^win/.test(process.platform) ? 'npm.cmd' : 'npm';
    return BbPromise.mapSeries(scriptNames, scriptName => {
      const args = [ 'run', scriptName ];

      return spawnProcess(command, args, { cwd });
    }).return();
  }
}