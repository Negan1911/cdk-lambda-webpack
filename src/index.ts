import path from 'path'
import _ from 'lodash'
import { Construct } from 'constructs'
import { zipDirectory } from './zipper'
import { packModules } from './modules'
import { webpackCompile } from './compiler'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { Options, uid, getEntry } from './utils'

interface LambdaWebpackProps extends Omit<lambda.FunctionProps, 'code'> {
  /**
   * Options to build your lambda.
   */
  webpack: Options
}

export async function LambdaWebpack(scope: Construct, id: string, { webpack, handler, ...props }: LambdaWebpackProps) {
  const zipId = uid()
  const config = require(path.isAbsolute(webpack.webpackConfigPath) ? webpack.webpackConfigPath : path.join(process.cwd(), webpack.webpackConfigPath))
  const buildFolder = path.join(process.cwd(), '.build')
  const buildPath = path.join(buildFolder, id)
  const [entry, exportName] = getEntry(handler)
  const _config = typeof config === 'function' ? config({ id, buildPath, buildFolder, entry }) : (config || {})
  
  const stat = await webpackCompile({
    ..._config,
    entry,
    output: {
      ...(_config.output || {}),
      path: buildPath,
      filename: '[name].js'
    }
  })
  
  await packModules(stat, id, webpack, buildPath)
  await zipDirectory(buildPath, buildFolder, zipId)
  
  return new lambda.Function(scope, id, {
    ...props,
    handler: `main.${exportName}`,
    code: lambda.Code.fromAsset(path.join(process.cwd(), '.build', `${zipId}.zip`))
  })
}