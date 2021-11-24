import _ from 'lodash'
import BbPromise from 'bluebird'
import { isBuiltinModule, ExtModule, ExtModules } from './utils'
import webpack, { Configuration, Stats, MultiStats, Module, NormalModule, ModuleGraph } from 'webpack'


function getExternalModuleName(module: Module) {
  const pathArray = /^external .*"(.*?)"$/.exec(module.identifier());
  if (!pathArray) {
    throw new Error(`Unable to extract module name from Webpack identifier: ${module.identifier()}`);
  }

  const path = pathArray[1];
  const pathComponents = path.split('/');
  const main = pathComponents[0];

  // this is a package within a namespace
  if (main.charAt(0) == '@') {
    return `${main}/${pathComponents[1]}`;
  }

  return main;
}

function isExternalModule(module: Module) {
  return _.startsWith(module.identifier(), 'external ') && !isBuiltinModule(getExternalModuleName(module));
}

/**
 * Gets the module issuer. The ModuleGraph api does not exists in webpack@4
 * so falls back to using module.issuer.
 */
function getIssuerCompat(moduleGraph: ModuleGraph, module: Module) {
  if (moduleGraph) {
    return moduleGraph.getIssuer(module) as Module;
  }

  return module.issuer as Module;
}

/**
 * Find the original module that required the transient dependency. Returns
 * undefined if the module is a first level dependency.
 * @param {Object} moduleGraph - Webpack module graph
 * @param {Object} issuer - Module issuer
 */
function findExternalOrigin(moduleGraph: ModuleGraph, issuer: Module): Module {
  if (issuer !== null) {
    if (!_.isNil(issuer) && _.startsWith((issuer as NormalModule).rawRequest, './')) {
      return findExternalOrigin(moduleGraph, getIssuerCompat(moduleGraph, issuer));
    }
  }
  return issuer;
}

function getExternalModules({ compilation }: Stats): ExtModule[] {
  const externals = new Set<ExtModule>();
  for (const module of compilation.modules) {
    if (isExternalModule(module)) {
      externals.add({
        origin: _.get(
          findExternalOrigin(compilation.moduleGraph, getIssuerCompat(compilation.moduleGraph, module)),
          'rawRequest'
        ),
        external: getExternalModuleName(module)
      });
    }
  }
  return Array.from(externals);
}


export function webpackCompile(config: Configuration): Promise<ExtModules> {
  return BbPromise.fromCallback<Stats>(cb => webpack(config).run(cb)).then(stats => {
    if (stats.hasErrors()) {
      throw new Error('Webpack compilation error, see stats above');
    }

    return {
      outputPath: stats.compilation.compiler.outputPath,
      externalModules: getExternalModules(stats)
    }
  });
}