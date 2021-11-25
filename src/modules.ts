import fs from 'fs'
import _ from 'lodash'
import path from 'path'
import fse from 'fs-extra'
import BbPromise from 'bluebird'
import { get } from './packagers'
import { StatsCompilation } from 'webpack'
import { ExtModules, Options } from './utils'

const verbose = true

function rebaseFileReferences(pathToPackageRoot: string, moduleVersion: string) {
  if (/^(?:file:[^/]{2}|\.\/|\.\.\/)/.test(moduleVersion)) {
    const filePath = _.replace(moduleVersion, /^file:/, '');
    return _.replace(
      `${_.startsWith(moduleVersion, 'file:') ? 'file:' : ''}${pathToPackageRoot}/${filePath}`,
      /\\/g,
      '/'
    );
  }

  return moduleVersion;
}

/**
 * Remove a given list of excluded modules from a module list
 */
function removeExcludedModules(modules: string[], packageForceExcludes: string[], log: boolean) {
  // eslint-disable-next-line lodash/prefer-immutable-method
  const excludedModules = _.remove(modules, externalModule => {
    const splitModule = _.split(externalModule, '@');
    // If we have a scoped module we have to re-add the @
    if (_.startsWith(externalModule, '@')) {
      splitModule.splice(0, 1);
      splitModule[0] = '@' + splitModule[0];
    }
    const moduleName = _.first(splitModule);
    return _.includes(packageForceExcludes, moduleName);
  });

  if (log && !_.isEmpty(excludedModules)) {
    console.log(`Excluding external modules: ${_.join(excludedModules, ', ')}`);
  }
}

/**
 * Add the given modules to a package json's dependencies.
 */
function addModulesToPackageJson(externalModules: string[], packageJson: any, pathToPackageRoot: string) {
  _.forEach(externalModules, externalModule => {
    const splitModule = _.split(externalModule, '@');
    // If we have a scoped module we have to re-add the @
    if (_.startsWith(externalModule, '@')) {
      splitModule.splice(0, 1);
      splitModule[0] = '@' + splitModule[0];
    }
    let moduleVersion = _.join(_.tail(splitModule), '@');
    // We have to rebase file references to the target package.json
    moduleVersion = rebaseFileReferences(pathToPackageRoot, moduleVersion);
    packageJson.dependencies = packageJson.dependencies || {};
    packageJson.dependencies[_.first(splitModule) as string] = moduleVersion;
  });
}

/**
 * Resolve the needed versions of production dependencies for external modules.
 */
function getProdModules(externalModules: StatsCompilation[], packagePath: string, nodeModulesRelativeDir: string | undefined, dependencyGraph: any, forceExcludes: string[]) {
  const packageJsonPath = path.join(process.cwd(), packagePath);
  const packageJson = require(packageJsonPath);
  const prodModules: string[] = [];

  // only process the module stated in dependencies section
  if (!packageJson.dependencies) {
    return [];
  }

  // Get versions of all transient modules
  _.forEach(externalModules, module => {
    let moduleVersion = packageJson.dependencies[module.external];

    if (moduleVersion) {
      prodModules.push(`${module.external}@${moduleVersion}`);

      let nodeModulesBase = path.join(path.dirname(path.join(process.cwd(), packagePath)), 'node_modules');

      if (nodeModulesRelativeDir) {
        const customNodeModulesDir = path.join(process.cwd(), nodeModulesRelativeDir, 'node_modules');

        if (fse.pathExistsSync(customNodeModulesDir)) {
          nodeModulesBase = customNodeModulesDir;
        } else {
          console.log(
            `WARNING: ${customNodeModulesDir} dose not exist. Please check nodeModulesRelativeDir setting`
          );
        }
      }

      // Check if the module has any peer dependencies and include them too
      try {
        const modulePackagePath = path.join(nodeModulesBase, module.external, 'package.json');

        const peerDependencies = require(modulePackagePath).peerDependencies;
        if (!_.isEmpty(peerDependencies)) {
          verbose && console.log(`Adding explicit peers for dependency ${module.external}`);

          const peerDependenciesMeta = require(modulePackagePath).peerDependenciesMeta;

          if (!_.isEmpty(peerDependenciesMeta)) {
            _.forEach(peerDependencies, (value, key) => {
              if (peerDependenciesMeta[key] && peerDependenciesMeta[key].optional === true) {
                verbose &&
                  console.log(
                    `Skipping peers dependency ${key} for dependency ${module.external} because it's optional`
                  );

                _.unset(peerDependencies, key);
              }
            });
          }

          if (!_.isEmpty(peerDependencies)) {
            const peerModules = getProdModules(
              _.map(peerDependencies, (value, key) => ({ external: key })),
              packagePath,
              nodeModulesRelativeDir,
              dependencyGraph,
              forceExcludes
            );
            Array.prototype.push.apply(prodModules, peerModules);
          }
        }
      } catch (e) {
        console.log(
          `WARNING: Could not check for peer dependencies of ${module.external}. Set nodeModulesRelativeDir if node_modules is in different directory.`
        );
      }
    } else {
      if (!packageJson.devDependencies || !packageJson.devDependencies[module.external]) {
        // Add transient dependencies if they appear not in the service's dev dependencies
        const originInfo = _.get(dependencyGraph, 'dependencies', {})[module.origin as string] || {};
        moduleVersion = _.get(_.get(originInfo, 'dependencies', {})[module.external], 'version');
        if (!moduleVersion) {
          // eslint-disable-next-line lodash/path-style
          moduleVersion = _.get(dependencyGraph, [ 'dependencies', module.external, 'version' ]);
        }
        if (!moduleVersion) {
          console.log(`WARNING: Could not determine version of module ${module.external}`);
        }
        prodModules.push(moduleVersion ? `${module.external}@${moduleVersion}` : module.external);
      } else if (
        packageJson.devDependencies &&
        packageJson.devDependencies[module.external] &&
        !_.includes(forceExcludes, module.external)
      ) {
        // To minimize the chance of breaking setups we whitelist packages available on AWS here. These are due to the previously missing check
        // most likely set in devDependencies and should not lead to an error now.
        const ignoredDevDependencies = ['aws-sdk'];

        if (!_.includes(ignoredDevDependencies, module.external)) {
          // Runtime dependency found in devDependencies but not forcefully excluded
          console.log(
            `ERROR: Runtime dependency '${module.external}' found in devDependencies. Move it to dependencies or use forceExclude to explicitly exclude it.`
          );
          throw new Error(`Serverless-webpack dependency error: ${module.external}.`);
        }

        verbose &&
          console.log(
            `INFO: Runtime dependency '${module.external}' found in devDependencies. It has been excluded automatically.`
          );
      }
    }
  });

  return prodModules;
}

export function packModules(stats: ExtModules, id: string, options: Options, buildPath: string): Promise<void> {
  const includes = options.includeModules

  if (!includes) {
    return BbPromise.resolve();
  }

  const packageForceIncludes = _.get(includes, 'forceInclude', []);
  const packageForceExcludes = _.get(includes, 'forceExclude', []);
  const packagePath = includes.packagePath || './package.json';
  const nodeModulesRelativeDir = includes.nodeModulesRelativeDir;
  const packageJsonPath = path.join(process.cwd(), packagePath);
  const packageScripts = _.reduce(
    [],
    (__: Record<string, unknown>, script, index) => {
      __[`script${index}` as string] = script;
      return __;
    },
    {}
  );
    
  return BbPromise.try(() => Promise.resolve(get(options.packager)).then(packager => {
    // Fetch needed original package.json sections
    const sectionNames = packager.copyPackageSectionNames;
    const packageJson = fs.readFileSync(packageJsonPath, 'utf-8');
    const packageSections = _.pick(packageJson, sectionNames);

    if (!_.isEmpty(packageSections)) {
      verbose && console.log(`Using package.json sections ${_.join(_.keys(packageSections), ', ')}`);
    }

    // Get first level dependency graph
    verbose && console.log(`Fetch dependency graph from ${packageJsonPath}`)

    console.log('=>>>>>>>> path is', path.dirname(packageJsonPath));
    return packager.getProdDependencies(path.dirname(packageJsonPath), 1).then(dependencyGraph => {
      const problems = _.get(dependencyGraph, 'problems', []);

      /** Log problems. */
      if (verbose && !_.isEmpty(problems)) {
        console.log(`Ignoring ${_.size(problems)} NPM errors:`);
        _.forEach(problems, problem => {
          console.log(`=> ${problem}`);
        });
      }

      // (1) Generate dependency composition
      const compositeModules = _.uniq(
        _.flatMap([stats], compileStats => {
          const externalModules = _.concat(
            compileStats.externalModules,
            _.map(packageForceIncludes, whitelistedPackage => ({
              external: whitelistedPackage
            }))
          );

          return getProdModules(
            externalModules,
            packagePath,
            nodeModulesRelativeDir,
            dependencyGraph,
            packageForceExcludes
          );
        })
      );
      
      removeExcludedModules(compositeModules, packageForceExcludes, true);

      if (_.isEmpty(compositeModules)) {
        // The compiled code does not reference any external modules at all
        console.log('No external modules needed');
        return BbPromise.resolve();
      }

      // (1.a) Install all needed modules
      const compositeModulePath = path.join(buildPath, 'dependencies');
      const compositePackageJson = path.join(compositeModulePath, 'package.json');

      // (1.a.1) Create a package.json
      const compositePackage = _.defaults(
        {
          name: id,
          version: '1.0.0',
          description: `Packaged externals for ${id}`,
          private: true,
          scripts: packageScripts
        },
        packageSections
      );
      fs.mkdirSync(compositeModulePath, { recursive: true });
      const relPath = path.relative(compositeModulePath, path.dirname(packageJsonPath));
      addModulesToPackageJson(compositeModules, compositePackage, relPath);
      fs.writeFileSync(compositePackageJson, JSON.stringify(compositePackage, null, 2), 'utf-8');

      // (1.a.2) Copy package-lock.json if it exists, to prevent unwanted upgrades
      const packageLockPath = path.join(path.dirname(packageJsonPath), packager.lockfileName);
      let hasPackageLock = false;
      return BbPromise.fromCallback(cb => fse.pathExists(packageLockPath, cb))
        .then(exists => {
          if (exists) {
            console.log('Package lock found - Using locked versions');
            try {
              let packageLockFile = fs.readFileSync(packageLockPath, 'utf-8');
              packageLockFile = packager.rebaseLockfile(relPath, packageLockFile);
              if (_.isObject(packageLockFile)) {
                packageLockFile = JSON.stringify(packageLockFile, null, 2);
              }

              fs.writeFileSync(
                path.join(compositeModulePath, packager.lockfileName),
                packageLockFile,
                'utf-8'
              );
              hasPackageLock = true;
            } catch (err) {
              console.log(`Warning: Could not read lock file: ${(err as Error).message}`);
            }
          }
          return BbPromise.resolve();
        })
        .then(() => {
          const start = _.now();
          console.log('Packing external modules: ' + compositeModules.join(', '));
          return packager
            .install(compositeModulePath, options.options)
            .then(() => verbose && console.log(`Package took [${_.now() - start} ms]`))
            .return(stats);
        })
        .then(compileStats => {
          const modulePath = (compileStats as StatsCompilation).outputPath as string;

          // Create package.json
          const modulePackageJson = path.join(modulePath, 'package.json');
          const modulePackage = _.defaults(
            {
              name: id,
              version: '1.0.0',
              description: `Packaged externals for ${id}`,
              private: true,
              scripts: packageScripts,
              dependencies: {}
            },
            packageSections
          );
          const prodModules = getProdModules(
            _.concat(
              (compileStats as StatsCompilation).externalModules,
              _.map(packageForceIncludes, whitelistedPackage => ({
                external: whitelistedPackage
              }))
            ),
            packagePath,
            nodeModulesRelativeDir,
            dependencyGraph,
            packageForceExcludes
          );

          removeExcludedModules(prodModules, packageForceExcludes, false);
          const relPath = path.relative(modulePath, path.dirname(packageJsonPath));
          addModulesToPackageJson(prodModules, modulePackage, relPath);
          fs.writeFileSync(modulePackageJson, JSON.stringify(modulePackage, null, 2), 'utf-8');

          const startCopy = _.now();
            return BbPromise.try(() => {
              // Only copy dependency modules if demanded by packager
              if (packager.mustCopyModules) {
                return BbPromise.fromCallback(callback =>
                  fse.copy(
                    path.join(compositeModulePath, 'node_modules'),
                    path.join(modulePath, 'node_modules'),
                    callback
                  )
                );
              }
              return BbPromise.resolve();
            })
            .then(() =>
                hasPackageLock
                  ? BbPromise.fromCallback(callback =>
                    fse.copy(
                      path.join(compositeModulePath, packager.lockfileName),
                      path.join(modulePath, packager.lockfileName),
                      callback
                    )
                  )
                  : BbPromise.resolve()
              )
              .tap(
                () =>
                  verbose &&
                  console.log(`Copy modules: ${modulePath} [${_.now() - startCopy} ms]`)
              )
              .then(() => {
                // Prune extraneous packages - removes not needed ones
                const startPrune = _.now();
                return packager
                  .prune(modulePath, options.options)
                  .tap(
                    () =>
                      verbose &&
                      console.log(`Prune: ${modulePath} [${_.now() - startPrune} ms]`)
                  );
              })
              .then(() => BbPromise.fromCallback(callback => fs.rm(compositeModulePath, { recursive: true, force: true }, callback)))
              .then(() => {
                // Prune extraneous packages - removes not needed ones
                const startRunScripts = _.now();
                return packager
                  .runScripts(modulePath, _.keys(packageScripts))
                  .tap(
                    () =>
                      verbose &&
                      console.log(`Run scripts: ${modulePath} [${_.now() - startRunScripts} ms]`)
                  );
              });


        })
        .return();
    })
  }))
}