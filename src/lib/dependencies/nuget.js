import xmldoc from 'xmldoc';

import { searchFilesFromRepo } from '../github';

import { flatten } from 'lodash';

function csprojDependenciesStats (csproj) {
  const dependencies = {};
  const packageReferences = csproj.childrenNamed('ItemGroup').map(itemGroup => itemGroup.childrenNamed('PackageReference'));
  flatten(packageReferences).map(packageReference => packageReference.attr.Include).forEach(name => {
    dependencies[name] = dependencies[name] || { type: 'nuget', name, core: 1 };
  });
  return Object.values(dependencies);
}

function packagesConfigDependenciesStats (packagesConfig) {
  const dependencies = {};
  packagesConfig.childrenNamed('package').map(element => element.attr.id).filter(name => !!name).forEach(name => {
    dependencies[name] = dependencies[name] || { type: 'nuget', name, core: 1 };
  });
  return Object.values(dependencies);
}

function getDependenciesFromGithubRepo (githubRepo, githubAccessToken) {
  function mapPackages (searchPattern, transform) {
    return searchFilesFromRepo(githubRepo, searchPattern, githubAccessToken)
      .then(files => files.map(xml => new xmldoc.XmlDocument(xml))
        .map(transform)
      )
      .then(deps => flatten(deps));
  }

  // Modern C# projects define dependencies in the *.csproj files, however this is
  // relatively new starting when .NET Core was released. Fall back to the legacy
  // packages.config if no dependencies were found in *.csproj.
  function evalForFallbackToPackagesConfig (result) {
    return result && result.length
      ? result
      : mapPackages('packages.config', packagesConfigDependenciesStats);
  }

  return mapPackages('*.csproj', csprojDependenciesStats)
    .then(evalForFallbackToPackagesConfig);
}

function dependenciesStats (file) {
  if (file.name === 'packages.config') {
    const xml = new xmldoc.XmlDocument(file.text);
    return packagesConfigDependenciesStats(xml);
  }
  if (file.name.indexOf('.csproj') !== -1) {
    const xml = new xmldoc.XmlDocument(file.text);
    return csprojDependenciesStats(xml);
  }
  return [];
}

function isDependencyFile (file) {
  if (file.name === 'packages.config' || file.name.indexOf('.csproj') !== -1) {
    return true;
  }
}

function detectProjectName (file) {
  if (file.name.indexOf('.csproj') !== -1) {
    return file.name.replace('.csproj', '');
  }
}

export {
  getDependenciesFromGithubRepo,
  dependenciesStats,
  isDependencyFile,
  detectProjectName,
};
