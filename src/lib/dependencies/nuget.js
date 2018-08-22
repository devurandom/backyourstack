import debug from 'debug';

import cache from '../cache';

import xmldoc from 'xmldoc';

import { searchFilesFromRepo, fetchFileFromRepo } from '../github';

import { flatten, pick } from 'lodash';

const _debug = debug('dependencies:nuget');

function parseXml (text) {
  try {
    return new xmldoc.XmlDocument(text);
  } catch (e) {
    console.error(e);
  }
}

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

function aggregateDependencies (a, b) {
  return a.concat(b.filter(x => a.indexOf(x) == -1));
}

function getDependenciesFromGithubRepo (githubRepo, githubAccessToken) {
  const cacheKey = `repo_nuget_dependencies_${githubRepo.id}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  function mapPackages (searchPattern, transform) {
    _debug('getDependenciesFromGithubRepo mapPackages', githubRepo.full_name, searchPattern);
    return searchFilesFromRepo(githubRepo, searchPattern, githubAccessToken)
      // 1. pick the keys we want to work with
      .then(files => files.map(file => pick(file, ['name', 'path'])))
      // 2. filter GitHub results to be more restrictive (the query pattern doesn't let us to that before)
      .then(files => files.filter(file => file.name.endsWith(searchPattern.replace('*', ''))))
      // .. log what we have so far
      .then(files => {
        _debug(files);
        return files;
      })
      // 3. fetch the files
      .then(files => Promise.all(
        files.map(async file => {
          file.text = await fetchFileFromRepo(githubRepo, file.path, githubAccessToken);
          return file;
        })
      ))
      // 4. parse the files as XML
      .then(files => files.map(file => {
        file.xml = parseXml(file.text);
        return file;
      }))
      // 5. filter invalid XMLs
      .then(files => files.filter(file => !!file.xml))
      // 6. parse the dependencies
      .then(files => files.map(file => {
        const deps = transform(file.xml);
        return deps;
      }))
      // 7. aggregate the dependencies (is that equivalent to flatten?)
      .then(deps => deps && deps.length ? deps.reduce(aggregateDependencies) : []);
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
    .then(evalForFallbackToPackagesConfig)
    .then(result => {
      cache.set(cacheKey, result);
      return result;
    })
    .catch(err => {
      _debug(`getDependenciesFromGithubRepo error: ${err.message}`);
      return [];
    });
}

function dependenciesStats (file) {
  if (file.name === 'packages.config') {
    const xml = parseXml(file.text);
    if (xml) {
      return packagesConfigDependenciesStats(xml);
    }
  }
  if (file.name.indexOf('.csproj') !== -1) {
    const xml = parseXml(file.text);
    if (xml) {
      return csprojDependenciesStats(xml);
    }
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
