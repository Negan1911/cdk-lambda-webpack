import _ from 'lodash'
import BbPromise from 'bluebird'
import { splitLines, safeJsonParse, spawnProcess, SpawnError } from '../utils'

type YarnPackagerOptions = {
  noInstall?: boolean,
  noFrozenLockfile?: boolean
  ignoreScripts?: boolean
  networkConcurrency?: number
}

export class Yarn {
  static get lockfileName() {
    return 'yarn.lock';
  }

  static get copyPackageSectionNames() {
    return ['resolutions'];
  }

  static get mustCopyModules() {
    return false;
  }

  static getProdDependencies(cwd: string, depth?: number) {
    const command = /^win/.test(process.platform) ? 'yarn.cmd' : 'yarn';
    const args = [ 'list', `--depth=${depth || 1}`, '--json', '--production' ];

    // If we need to ignore some errors add them here
    const ignoredYarnErrors: any[] = [];

    return spawnProcess(command, args, {
      cwd: cwd
    })
      .catch(err => {
        console.log('ERR CWD: ', cwd)
        console.log('ERR: ', err)
        if (err instanceof SpawnError) {
          // Only exit with an error if we have critical npm errors for 2nd level inside
          const errors = _.split(err.stderr, '\n');
          const failed = _.reduce(
            errors,
            (failed, error) => {
              if (failed) {
                return true;
              }
              return (
                !_.isEmpty(error) &&
                !_.some(ignoredYarnErrors, ignoredError => _.startsWith(error, `npm ERR! ${ignoredError.npmError}`))
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
      .then(stdout =>
        BbPromise.try(() => {
          const lines = splitLines(stdout);
          const parsedLines = _.map(lines, safeJsonParse);
          return _.find(parsedLines, line => line && line.type === 'tree');
        })
      )
      .then(parsedTree => {
        const convertTrees = (trees: any[]) =>
          _.reduce(
            trees,
            (__: Record<string, unknown>, tree) => {
              const splitModule = _.split(tree.name, '@');
              // If we have a scoped module we have to re-add the @
              if (_.startsWith(tree.name, '@')) {
                splitModule.splice(0, 1);
                splitModule[0] = '@' + splitModule[0];
              }

              __[_.first(splitModule) as string] = {
                version: _.join(_.tail(splitModule), '@'),
                dependencies: convertTrees(tree.children)
              };
              return __;
            },
            {}
          );

        const trees = _.get(parsedTree, 'data.trees', []);
        const result = {
          problems: [],
          dependencies: convertTrees(trees)
        };
        return result;
      });
  }

  static rebaseLockfile(pathToPackageRoot: string, lockfile: string) {
    const fileVersionMatcher = /[^"/]@(?:file:)?((?:\.\/|\.\.\/).*?)[":,]/gm;
    const replacements = [];
    let match;

    // Detect all references and create replacement line strings
    while ((match = fileVersionMatcher.exec(lockfile)) !== null) {
      replacements.push({
        oldRef: match[1],
        newRef: _.replace(`${pathToPackageRoot}/${match[1]}`, /\\/g, '/')
      });
    }

    // Replace all lines in lockfile
    return _.reduce(replacements, (__, replacement) => _.replace(__, replacement.oldRef, replacement.newRef), lockfile);
  }

  static install(cwd: string, packagerOptions?: YarnPackagerOptions) {
    if (packagerOptions?.noInstall) {
      return BbPromise.resolve();
    }

    const command = /^win/.test(process.platform) ? 'yarn.cmd' : 'yarn';
    const args = [ 'install', '--non-interactive' ];

    // Convert supported packagerOptions
    if (!packagerOptions?.noFrozenLockfile) {
      args.push('--frozen-lockfile');
    }
    if (packagerOptions?.ignoreScripts) {
      args.push('--ignore-scripts');
    }
    if (packagerOptions?.networkConcurrency) {
      args.push(`--network-concurrency ${packagerOptions.networkConcurrency}`);
    }

    return BbPromise.resolve(spawnProcess(command, args, { cwd })).return();
  }

  // "Yarn install" prunes automatically
  static prune(cwd: string, packagerOptions: YarnPackagerOptions = {}) {
    return Yarn.install(cwd, packagerOptions);
  }

  static runScripts(cwd: string, scriptNames: string[]) {
    const command = /^win/.test(process.platform) ? 'yarn.cmd' : 'yarn';
    return BbPromise.mapSeries(scriptNames, scriptName => {
      const args = [ 'run', scriptName ];

      return spawnProcess(command, args, { cwd });
    }).return();
  }
}