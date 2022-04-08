import path from 'path'
import { stringifySyml } from '@yarnpkg/parsers'
import { getPluginConfiguration } from '@yarnpkg/cli'
import { xfs, npath, PortablePath } from '@yarnpkg/fslib'
import {
  Cache,
  Package,
  Project,
  Descriptor,
  StreamReport,
  Configuration,
  Workspace,
} from '@yarnpkg/core'

export class Yarn2 {
  cache?: Cache
  project?: Project
  cwd: PortablePath
  target: PortablePath
  configuration?: Configuration

  constructor(target: PortablePath, cwd: string) {
    this.cwd = npath.toPortablePath(cwd)
    this.target = target
    return this
  }

  private async populateInputs() {
    this.configuration = await Configuration.find(
      this.cwd,
      getPluginConfiguration()
    )
    this.cache = await Cache.find(this.configuration)

    const { project } = await Project.find(this.configuration, this.cwd)
    await project.restoreInstallState({ restoreResolutions: true })

    this.project = project
    return this
  }

  private isDescriptorWorkspaceTarget(descriptor: Descriptor) {
    if (!this.targetWorkspace)
      throw new Error('Target not initiated.')
    
    return descriptor.identHash === this.targetWorkspace.manifest.name?.identHash
  }

  private isPackageWorkspaceTarget(pkg: Package) {
    const target = this.targetWorkspace
    return pkg.identHash === target.manifest.name?.identHash
  }

  private get rootCwd() {
    const topWorkspace = this.project?.topLevelWorkspace

    if (!topWorkspace)
      throw new Error('Cannot found top workspace.')
    
    return topWorkspace.cwd
  }

  private parseDescriptor(descriptor: Descriptor) {
    if (descriptor.range.startsWith('workspace:')) {
      if (this.isDescriptorWorkspaceTarget(descriptor)) {
        descriptor.range = 'file:.'
      } else {
        descriptor.range = `file:${path.join(
          this.rootCwd,
          descriptor.range.replace('workspace:', '')
        )}`
      }
    }
  }

  private parsePackage(pkg: Package) {
    if (this.isPackageWorkspaceTarget(pkg)) {
      pkg.reference = 'file:.'
    } else {
      pkg.reference = `file:${path.join(
        this.rootCwd,
        pkg.reference.replace('workspace:', '')
      )}`
    }
  }

  private parseDeps(dep: string) {
    if (dep.startsWith('workspace:')) {
      return `file:${path.join(this.rootCwd, dep.replace('workspace:', ''))}`
    }

    return dep
  }

  get targetWorkspace(): Workspace {
    if (!this.project)
      throw new Error('Project not initiated.')

    const workspace = this.project.workspaces.find((_) => _.cwd === this.cwd)

    if (!workspace)
      throw new Error('Target workspace not found.')

    return workspace
  }

  private async computeWorkspace() {
    await this.populateInputs()
    const requiredWorkspaces = new Set([this.targetWorkspace])

    if (!this.project)
      throw new Error('Input populated but no project found.')

    // First we compute the dependency chain to see what workspaces are
    // dependencies of the one we're trying to focus on.
    //
    // Note: remember that new elements can be added in a set even while
    // iterating over it (because they're added at the end)

    for (const workspace of requiredWorkspaces) {
      for (const descriptor of workspace.manifest
        .getForScope('dependencies')
        .values()) {
        const matchingWorkspace =
          this.project.tryWorkspaceByDescriptor(descriptor)

        if (matchingWorkspace === null) continue

        requiredWorkspaces.add(matchingWorkspace)
      }
    }

    // Then we go over each workspace that didn't get selected, and remove all
    // their dependencies.

    for (const workspace of this.project.workspaces) {
      if (requiredWorkspaces.has(workspace)) {
        workspace.manifest.devDependencies.clear()
      } else {
        workspace.manifest.installConfig =
          workspace.manifest.installConfig || {}
        workspace.manifest.installConfig.selfReferences = false
        workspace.manifest.dependencies.clear()
        workspace.manifest.devDependencies.clear()
        workspace.manifest.peerDependencies.clear()
        workspace.manifest.scripts.clear()
      }
    }
  }

  async install() {
    await this.computeWorkspace()

    if (!this.configuration)
      throw new Error('Project Tree computed but no configuration found.')

    if (!this.project)
      throw new Error('Project Tree computed but no project found.')
    
    if (!this.targetWorkspace.manifest.name)
      throw new Error('Target Workspace does not have a name.')

    this.targetWorkspace.anchoredDescriptor.range = 'file:.'
    this.targetWorkspace.anchoredLocator.reference = 'file:.'

    // Replace workspace references with file references.
    for (const [, descriptor] of this.project.storedDescriptors) {
      // If is the target package, replace with root, otherwise with the file path.
      this.parseDescriptor(descriptor)
    }

    for (const [, pkg] of this.project.storedPackages) {
      if (pkg.reference.startsWith('workspace:')) {
        // If is the target package, replace with root, otherwise with the file path.
        this.parsePackage(pkg)

        for (const [, dep] of pkg.dependencies) {
          this.parseDescriptor(dep)
        }
      }
    }

    for (const [, pkg] of this.project.originalPackages) {
      if (pkg.reference.startsWith('workspace:')) {
        // If is the target package, replace with root, otherwise with the file path.
        this.parsePackage(pkg)

        for (const [, dep] of pkg.dependencies) {
          this.parseDescriptor(dep)
        }
      }
    }

    xfs.writeFileSync(
      npath.toPortablePath(path.join(this.target, '.yarnrc.yml')),
      stringifySyml({
        ...Object.fromEntries(this.configuration.values.entries()),
        rcFilename: undefined,
      })
    )

    xfs.writeFileSync(
      npath.toPortablePath(path.join(this.target, 'yarn.lock')),
      this.project.generateLockfile()
    )

    xfs.writeFileSync(
      npath.toPortablePath(path.join(this.target, 'package.json')),
      JSON.stringify({
        name: this.targetWorkspace.manifest.name.scope
          ? `@${this.targetWorkspace.manifest.name.scope}/${this.targetWorkspace.manifest.name.name}`
          : this.targetWorkspace.manifest.name.name,

        private: true,
        version: this.targetWorkspace.manifest.version,
        scripts: Object.fromEntries(
          this.targetWorkspace.manifest.scripts.entries()
        ),
        description: 'Builded with cdk-lambda-webpack',
        dependencies: Object.fromEntries(
          Array.from(this.targetWorkspace.manifest.dependencies).map(
            ([, _]) => [_.scope ? `@${_.scope}/${_.name}` : _.name, this.parseDeps(_.range)]
          )
        ),
      })
    )

    const newConfig = await Configuration.find(this.target, getPluginConfiguration())
    const { project: newProj } = await Project.find(newConfig, this.target)

    // And finally we can run the install, but we have to make sure we don't
    // persist the project state on the disk (otherwise all workspaces would
    // lose their dependencies!).

    const report = await StreamReport.start(
      {
        configuration: newConfig,
        stdout: process.stdout,
        includeLogs: true,
      },

      async (report: StreamReport) => {
        await newProj.install({
          report,
          persistProject: false,
          cache: await (this.cache ? Promise.resolve(this.cache) : Cache.find(newConfig)),
        })
      }
    )

    if (report.exitCode() !== 0)
      throw new Error('Yarn execution error, see input above.')
  }
}