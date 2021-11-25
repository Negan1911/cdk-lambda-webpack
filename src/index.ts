import path from 'path'
import _ from 'lodash'
import { Construct } from 'constructs'
import { zipDirectory } from './zipper'
import { packModules } from './modules'
import { webpackCompile } from './compiler'
import * as lambda from '@aws-cdk/aws-lambda'
import { Options, uid, getEntry } from './utils'

interface LambdaWebpackProps extends Omit<lambda.FunctionProps, 'code'> {
  webpack: Options
}

export async function LambdaWebpack(scope: Construct, id: string, { webpack, handler, ...props }: LambdaWebpackProps) {
  const zipId = uid()
  const config = require(path.isAbsolute(webpack.webpackConfigPath) ? webpack.webpackConfigPath : path.join(process.cwd(), webpack.webpackConfigPath))
  const buildPath = path.join(process.cwd(), '.build', id)
  const [entry, exportName] = getEntry(handler)
  
  const stat = await webpackCompile({
    ...config,
    entry,
    output: {
      ...(config.output ||{}),
      path: buildPath,
      filename: '[name].js'
    }
  })
  
  await packModules(stat, id, webpack, buildPath)
  await zipDirectory(process.cwd(), '.build', zipId)
  
  return new lambda.Function(scope, id, {
    ...props,
    handler: `main.${exportName}`,
    code: lambda.Code.fromAsset(path.join(process.cwd(), '.build', `${zipId}.zip`))
  })
}