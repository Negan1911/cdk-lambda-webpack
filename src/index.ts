import path from 'path'
import _ from 'lodash'
import { Construct } from 'constructs'
import { packModules } from './modules'
import { Yarn2 } from './packagers/yarn2'
import { webpackCompile } from './compiler'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { xfs, npath, PortablePath } from '@yarnpkg/fslib'
import { Options, uid, getEntry, NarrowOptions } from './utils'

interface LambdaWebpackProps extends Omit<lambda.FunctionProps, 'code'> {
  /**
   * Current working directory.
   */
  cwd?: string
  /**
   * Options to build your lambda.
   */
  webpack: Options
}

export async function LambdaWebpack(scope: Construct, id: string, { webpack, handler, cwd, ...props }: LambdaWebpackProps) {
  const zipId = uid()
  const _cwd = cwd || process.cwd()
  const config = require(path.isAbsolute(webpack.webpackConfigPath) ? webpack.webpackConfigPath : path.join(process.cwd(), webpack.webpackConfigPath))
  
  const buildFolder = await xfs.mktempPromise()
  const [entry, webpackEntry, exportName] = getEntry(handler, _cwd)
  const _config = typeof config === 'function' ? config({ id, buildPath: buildFolder, webpackEntry, buildFolder, entry }) : (config || {})
  
  const stat = await webpackCompile({
    ..._config,
    entry,
    output: {
        ...(_config.output || {}),
        path: buildFolder,
        filename: `${webpackEntry}.js`
    }
  })
  
  await packModules(stat, id, webpack, buildFolder)
  
  return new lambda.Function(scope, id, {
    ...props,
    handler: `${webpackEntry}.${exportName}`,
    code: lambda.Code.fromAsset(buildFolder)
  })
}

interface LambdaWebpackYarn2Props extends Omit<lambda.FunctionProps, 'code'> {
  /**
   * Current working directory.
   */
  cwd?: string
  /**
   * Options to build your lambda.
   */
  webpack: NarrowOptions
}

/**
 * Experimental Yarn2 support.
 */
export async function LambdaWebpackYarn2(scope: Construct, id: string, { webpack, handler, cwd, ...props }: LambdaWebpackYarn2Props) {
  const _cwd = cwd || process.cwd()
  const config = require(path.isAbsolute(webpack.webpackConfigPath) ? webpack.webpackConfigPath : path.join(process.cwd(), webpack.webpackConfigPath))

  const buildFolder = await xfs.mktempPromise()
  const [entry, webpackEntry, exportName] = getEntry(handler, _cwd)
  const _config = typeof config === 'function' ? config({ id, buildPath: buildFolder, webpackEntry, buildFolder, entry }) : (config || {})

  await webpackCompile({
    ..._config,
    entry,
    output: {
        ...(_config.output || {}),
        path: buildFolder,
        filename: `${webpackEntry}.js`
    }
  })

  await new Yarn2(buildFolder, _cwd).install()
  
  return new lambda.Function(scope, id, {
    ...props,
    handler: `${webpackEntry}.${exportName}`,
    code: lambda.Code.fromAsset(buildFolder)
  })
}